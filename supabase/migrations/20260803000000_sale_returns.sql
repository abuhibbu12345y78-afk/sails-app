-- Migration: sale_returns_and_reversal

create table public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  company_id uuid not null references public.companies(id),
  salesman_id uuid not null references public.salesmen(id),
  sale_id uuid not null references public.sales(id),
  day_session_id uuid not null references public.day_sessions(id),
  product_id uuid not null references public.products(id),
  returned_quantity integer not null check (returned_quantity > 0),
  reason text not null,
  idempotency_key uuid not null unique,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.sale_returns enable row level security;
create policy "Salesmen can access their own sale returns" on public.sale_returns for all to authenticated using (salesman_id in (select id from public.salesmen where user_id = auth.uid()));

create or replace function public.reverse_sale_atomic(
  p_salesman_id uuid,
  p_sale_id uuid,
  p_return_quantity integer,
  p_reason text,
  p_idempotency_key uuid
) returns public.sale_returns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales;
  v_session public.day_sessions;
  v_stock public.day_stock_items;
  v_return public.sale_returns;
  v_already_returned integer;
  
  -- Replay vars
  v_curr_sale public.sales;
  v_rule public.commission_rules;
  v_effective_qty integer;
  v_unit integer;
  v_normal_sales_completed integer := 0;
  v_cycle bigint := 1;
  v_sale_normal_units integer;
  v_sale_full_units integer;
  v_sale_full_cycles bigint[];
  v_expected_rewards jsonb := '[]'::jsonb;
  v_existing_reward public.full_commission_rewards;
begin
  if p_return_quantity < 1 then
    raise exception 'invalid_return_quantity' using errcode = '22023';
  end if;
  if trim(p_reason) = '' then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  if auth.uid() is not null and not exists (
    select 1 from public.salesmen where id = p_salesman_id and user_id = auth.uid() and active
  ) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  select * into v_return from public.sale_returns
    where salesman_id = p_salesman_id and idempotency_key = p_idempotency_key;
  if found then return v_return; end if;

  -- Lock the sale
  select * into v_sale from public.sales
    where id = p_sale_id and salesman_id = p_salesman_id and status = 'completed' for update;
  if not found then raise exception 'sale_not_found' using errcode = 'P0002'; end if;

  -- Verify active day session
  select * into v_session from public.day_sessions
    where id = v_sale.day_session_id and salesman_id = p_salesman_id and status = 'OPEN' for update;
  if not found then raise exception 'day_not_open' using errcode = 'P0002'; end if;

  -- Lock the stock
  select * into v_stock from public.day_stock_items
    where day_session_id = v_session.id and product_id = v_sale.product_id for update;
  if not found then raise exception 'stock_not_found' using errcode = 'P0002'; end if;

  -- Check reversible quantity
  select coalesce(sum(returned_quantity), 0) into v_already_returned
    from public.sale_returns where sale_id = p_sale_id;
  
  if v_already_returned + p_return_quantity > v_sale.quantity then
    raise exception 'exceeds_reversible_quantity' using errcode = '22023';
  end if;

  -- Insert return record
  insert into public.sale_returns (
    tenant_id, company_id, salesman_id, sale_id, day_session_id, product_id,
    returned_quantity, reason, idempotency_key, created_by
  ) values (
    v_sale.tenant_id, v_sale.company_id, p_salesman_id, p_sale_id, v_session.id, v_sale.product_id,
    p_return_quantity, p_reason, p_idempotency_key, auth.uid()
  ) returning * into v_return;

  -- Update stock
  update public.day_stock_items
    set sold_quantity = sold_quantity - p_return_quantity,
        remaining_quantity = remaining_quantity + p_return_quantity,
        updated_at = now()
    where id = v_stock.id;

  -- REPLAY COMMISSION
  select * into v_rule from public.commission_rules where product_id = v_sale.product_id and valid_to is null for share;
  
  for v_curr_sale in
    select * from public.sales 
    where salesman_id = p_salesman_id and product_id = v_sale.product_id and status = 'completed'
    order by created_at asc
  loop
    v_effective_qty := v_curr_sale.quantity - coalesce((select sum(returned_quantity) from public.sale_returns where sale_id = v_curr_sale.id), 0);
    v_sale_normal_units := 0;
    v_sale_full_units := 0;
    v_sale_full_cycles := '{}'::bigint[];

    for v_unit in 1..v_effective_qty loop
       if v_normal_sales_completed = v_curr_sale.reward_threshold_snapshot then
          v_sale_full_units := v_sale_full_units + 1;
          v_sale_full_cycles := array_append(v_sale_full_cycles, v_cycle);
          v_normal_sales_completed := 0;
          v_cycle := v_cycle + 1;
       else
          v_sale_normal_units := v_sale_normal_units + 1;
          v_normal_sales_completed := v_normal_sales_completed + 1;
       end if;
    end loop;

    if cardinality(v_sale_full_cycles) > 0 then
      for i in 1..cardinality(v_sale_full_cycles) loop
         v_expected_rewards := v_expected_rewards || jsonb_build_object(
           'sale_id', v_curr_sale.id,
           'cycle_number', v_sale_full_cycles[i],
           'amount_paise', v_curr_sale.full_commission_paise_snapshot
         );
      end loop;
    end if;

    if v_sale_normal_units != v_curr_sale.normal_commission_units or v_sale_full_units != v_curr_sale.full_commission_units or v_curr_sale.gross_sales_paise != (v_effective_qty * v_curr_sale.unit_selling_price_paise) then
       update public.sales set
         normal_commission_units = v_sale_normal_units,
         full_commission_units = v_sale_full_units,
         gross_sales_paise = v_effective_qty * unit_selling_price_paise,
         total_normal_commission_paise = v_sale_normal_units * normal_commission_paise_snapshot,
         total_full_commission_paise = v_sale_full_units * full_commission_paise_snapshot,
         total_earnings_paise = (v_sale_normal_units * normal_commission_paise_snapshot) + (v_sale_full_units * full_commission_paise_snapshot),
         net_collection_paise = (v_effective_qty * unit_selling_price_paise) - ((v_sale_normal_units * normal_commission_paise_snapshot) + (v_sale_full_units * full_commission_paise_snapshot)),
         updated_at = now()
       where id = v_curr_sale.id;
    end if;
  end loop;

  -- CHECK RECEIVED OFFERS CONFLICT
  for v_existing_reward in 
    select * from public.full_commission_rewards 
    where salesman_id = p_salesman_id and product_id = v_sale.product_id and status = 'received' 
  loop
     if not (
       select exists (
         select 1 from jsonb_array_elements(v_expected_rewards) as elem
         where (elem->>'sale_id')::uuid = v_existing_reward.sale_id
           and (elem->>'cycle_number')::bigint = v_existing_reward.cycle_number
       )
     ) then
       raise exception 'offer_conflict' using errcode = '22023';
     end if;
  end loop;

  -- SYNC EARNED OFFERS
  delete from public.full_commission_rewards 
    where salesman_id = p_salesman_id and product_id = v_sale.product_id and status = 'earned';

  if jsonb_array_length(v_expected_rewards) > 0 then
    insert into public.full_commission_rewards (
      tenant_id, company_id, salesman_id, sale_id, product_id, product_name_snapshot, cycle_number, amount_paise
    )
    select v_sale.tenant_id, v_sale.company_id, p_salesman_id, (elem->>'sale_id')::uuid, v_sale.product_id, v_sale.product_name_snapshot, (elem->>'cycle_number')::bigint, (elem->>'amount_paise')::bigint
    from jsonb_array_elements(v_expected_rewards) as elem
    on conflict (salesman_id, product_id, cycle_number) do nothing;
  end if;

  update public.commission_progress
    set normal_sales_completed = v_normal_sales_completed, cycle_number = v_cycle, updated_at = now()
    where salesman_id = p_salesman_id and product_id = v_sale.product_id;

  insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_sale.tenant_id, v_sale.company_id, auth.uid(), 'sale.reversed', 'sale', p_sale_id,
      jsonb_build_object('day_session_id', v_session.id, 'returned_quantity', p_return_quantity, 'reason', p_reason));

  return v_return;
end;
$$;
