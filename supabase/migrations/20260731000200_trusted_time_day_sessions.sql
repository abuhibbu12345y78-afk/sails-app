begin;

create table public.day_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  company_id uuid not null references public.companies(id),
  salesman_id uuid not null references public.salesmen(id),
  business_date date not null,
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, salesman_id, business_date),
  check ((status = 'OPEN' and closed_at is null) or (status = 'CLOSED' and closed_at is not null))
);

create unique index one_open_day_per_salesman_idx
  on public.day_sessions(tenant_id, company_id, salesman_id)
  where status = 'OPEN';

create table public.day_stock_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  company_id uuid not null references public.companies(id),
  salesman_id uuid not null references public.salesmen(id),
  day_session_id uuid not null references public.day_sessions(id),
  product_id uuid not null references public.products(id),
  picked_quantity integer not null check (picked_quantity >= 0),
  sold_quantity integer not null default 0 check (sold_quantity >= 0),
  remaining_quantity integer not null check (remaining_quantity >= 0),
  product_name_snapshot text not null,
  unit_price_paise_snapshot bigint not null check (unit_price_paise_snapshot >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (day_session_id, product_id),
  check (sold_quantity <= picked_quantity),
  check (remaining_quantity = picked_quantity - sold_quantity)
);

alter table public.sales add column day_session_id uuid references public.day_sessions(id);
create index sales_day_session_idx on public.sales(day_session_id, created_at desc);
create index day_stock_session_idx on public.day_stock_items(day_session_id, product_id);

alter table public.day_sessions enable row level security;
alter table public.day_stock_items enable row level security;

create policy "company members select" on public.day_sessions for select to authenticated
  using (company_id in (select public.current_company_ids()));
create policy "company members select" on public.day_stock_items for select to authenticated
  using (company_id in (select public.current_company_ids()));

create or replace function public.start_day_atomic(
  p_salesman_id uuid,
  p_items jsonb
) returns public.day_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salesman public.salesmen;
  v_timezone text;
  v_business_date date;
  v_session public.day_sessions;
begin
  if auth.uid() is not null and not exists (
    select 1 from public.salesmen where id = p_salesman_id and user_id = auth.uid() and active
  ) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  select * into v_salesman from public.salesmen where id = p_salesman_id and active for share;
  if not found then raise exception 'salesman_not_found' using errcode = 'P0002'; end if;
  select coalesce(timezone, 'Asia/Kolkata') into v_timezone
    from public.app_settings where company_id = v_salesman.company_id;
  v_timezone := coalesce(v_timezone, 'Asia/Kolkata');
  v_business_date := (now() at time zone v_timezone)::date;

  perform pg_advisory_xact_lock(hashtextextended('day:' || p_salesman_id::text, 0));
  if exists (select 1 from public.day_sessions where salesman_id = p_salesman_id and status = 'OPEN') then
    raise exception 'previous_day_still_open' using errcode = '23505';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
      as item(product_id uuid, picked_quantity integer)
    left join public.products p on p.id = item.product_id
    where p.id is null or p.company_id <> v_salesman.company_id or item.picked_quantity < 0
  ) then
    raise exception 'invalid_day_stock' using errcode = '22023';
  end if;

  insert into public.day_sessions (tenant_id, company_id, salesman_id, business_date)
    values (v_salesman.tenant_id, v_salesman.company_id, p_salesman_id, v_business_date)
    returning * into v_session;

  insert into public.day_stock_items (
    tenant_id, company_id, salesman_id, day_session_id, product_id,
    picked_quantity, sold_quantity, remaining_quantity,
    product_name_snapshot, unit_price_paise_snapshot
  )
  select v_salesman.tenant_id, v_salesman.company_id, p_salesman_id, v_session.id, p.id,
    coalesce(item.picked_quantity, 0), 0, coalesce(item.picked_quantity, 0), p.name, p.selling_price_paise
  from public.products p
  left join jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
    as item(product_id uuid, picked_quantity integer) on item.product_id = p.id
  where p.company_id = v_salesman.company_id and p.active;

  insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_salesman.tenant_id, v_salesman.company_id, auth.uid(), 'day.started', 'day_session',
      v_session.id, jsonb_build_object('business_date', v_business_date, 'started_at', v_session.started_at));
  return v_session;
end;
$$;

create or replace function public.create_sale_atomic(
  p_salesman_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_idempotency_key uuid
) returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products;
  v_rule public.commission_rules;
  v_progress public.commission_progress;
  v_session public.day_sessions;
  v_stock public.day_stock_items;
  v_sale public.sales;
  v_timezone text;
  v_unit integer;
  v_normal_units integer := 0;
  v_full_units integer := 0;
  v_cycle bigint;
  v_full_cycles bigint[] := '{}';
begin
  if p_quantity < 1 or p_quantity > 999 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;
  if auth.uid() is not null and not exists (
    select 1 from public.salesmen where id = p_salesman_id and user_id = auth.uid() and active
  ) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  select * into v_sale from public.sales
    where salesman_id = p_salesman_id and idempotency_key = p_idempotency_key;
  if found then return v_sale; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_salesman_id::text || ':' || p_product_id::text, 0));
  select * into v_session from public.day_sessions
    where salesman_id = p_salesman_id and status = 'OPEN' for update;
  if not found then raise exception 'day_not_started' using errcode = 'P0002'; end if;
  select coalesce(timezone, 'Asia/Kolkata') into v_timezone
    from public.app_settings where company_id = v_session.company_id;
  if v_session.business_date <> (now() at time zone coalesce(v_timezone, 'Asia/Kolkata'))::date then
    raise exception 'previous_day_still_open' using errcode = '22023';
  end if;

  select * into v_stock from public.day_stock_items
    where day_session_id = v_session.id and product_id = p_product_id for update;
  if not found or v_stock.picked_quantity = 0 then
    raise exception 'product_not_picked' using errcode = '22023';
  end if;
  if v_stock.remaining_quantity < p_quantity then
    raise exception 'insufficient_daily_stock' using errcode = '22023';
  end if;

  select * into v_product from public.products where id = p_product_id and active for share;
  if not found then raise exception 'product_not_found' using errcode = 'P0002'; end if;
  select * into v_rule from public.commission_rules where product_id = p_product_id and valid_to is null for share;
  if not found then raise exception 'commission_rule_not_found' using errcode = 'P0002'; end if;
  select * into v_progress from public.commission_progress
    where salesman_id = p_salesman_id and product_id = p_product_id for update;
  if not found then
    insert into public.commission_progress (tenant_id, company_id, salesman_id, product_id)
      values (v_product.tenant_id, v_product.company_id, p_salesman_id, p_product_id)
      returning * into v_progress;
  end if;

  v_cycle := v_progress.cycle_number;
  for v_unit in 1..p_quantity loop
    if v_progress.normal_sales_completed = v_rule.reward_threshold then
      v_full_units := v_full_units + 1;
      v_full_cycles := array_append(v_full_cycles, v_cycle);
      v_progress.normal_sales_completed := 0;
      v_cycle := v_cycle + 1;
    else
      v_normal_units := v_normal_units + 1;
      v_progress.normal_sales_completed := v_progress.normal_sales_completed + 1;
    end if;
  end loop;

  insert into public.sales (
    tenant_id, company_id, salesman_id, day_session_id, idempotency_key, product_id,
    product_name_snapshot, quantity, unit_selling_price_paise, normal_commission_paise_snapshot,
    full_commission_paise_snapshot, reward_threshold_snapshot, normal_commission_units,
    full_commission_units, gross_sales_paise, total_normal_commission_paise,
    total_full_commission_paise, total_earnings_paise, net_collection_paise, created_by
  ) values (
    v_product.tenant_id, v_product.company_id, p_salesman_id, v_session.id, p_idempotency_key, p_product_id,
    v_product.name, p_quantity, v_product.selling_price_paise, v_rule.normal_commission_paise,
    v_rule.full_commission_paise, v_rule.reward_threshold, v_normal_units, v_full_units,
    v_product.selling_price_paise * p_quantity, v_rule.normal_commission_paise * v_normal_units,
    v_rule.full_commission_paise * v_full_units,
    (v_rule.normal_commission_paise * v_normal_units) + (v_rule.full_commission_paise * v_full_units),
    (v_product.selling_price_paise * p_quantity) -
      ((v_rule.normal_commission_paise * v_normal_units) + (v_rule.full_commission_paise * v_full_units)),
    auth.uid()
  ) returning * into v_sale;

  update public.day_stock_items
    set sold_quantity = sold_quantity + p_quantity,
      remaining_quantity = remaining_quantity - p_quantity,
      updated_at = now()
    where id = v_stock.id;

  if cardinality(v_full_cycles) > 0 then
    insert into public.full_commission_rewards
      (tenant_id, company_id, salesman_id, sale_id, product_id, product_name_snapshot, cycle_number, amount_paise)
    select v_product.tenant_id, v_product.company_id, p_salesman_id, v_sale.id, p_product_id,
      v_product.name, cycle_no, v_rule.full_commission_paise
    from unnest(v_full_cycles) cycle_no;
  end if;

  update public.commission_progress
    set normal_sales_completed = v_progress.normal_sales_completed, cycle_number = v_cycle, updated_at = now()
    where salesman_id = p_salesman_id and product_id = p_product_id;

  insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_product.tenant_id, v_product.company_id, auth.uid(), 'sale.created', 'sale', v_sale.id,
      jsonb_build_object('day_session_id', v_session.id, 'quantity', p_quantity,
        'normal_units', v_normal_units, 'full_units', v_full_units));
  return v_sale;
end;
$$;

create or replace function public.close_day_atomic(
  p_salesman_id uuid
) returns public.day_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.day_sessions;
  v_product_summary jsonb;
  v_totals record;
  v_report text;
begin
  if auth.uid() is not null and not exists (
    select 1 from public.salesmen where id = p_salesman_id and user_id = auth.uid() and active
  ) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('day:' || p_salesman_id::text, 0));
  select * into v_session from public.day_sessions
    where salesman_id = p_salesman_id and status = 'OPEN' for update;
  if not found then raise exception 'open_day_not_found' using errcode = 'P0002'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', product_id, 'product', product_name_snapshot, 'picked', picked_quantity,
    'sold', sold_quantity, 'remaining', remaining_quantity
  ) order by product_name_snapshot), '[]'::jsonb)
  into v_product_summary from public.day_stock_items where day_session_id = v_session.id;

  select coalesce(sum(quantity),0)::integer total_units,
    coalesce(sum(gross_sales_paise),0)::bigint gross,
    coalesce(sum(total_normal_commission_paise),0)::bigint normal,
    coalesce(sum(total_full_commission_paise),0)::bigint full,
    coalesce(sum(total_earnings_paise),0)::bigint earnings,
    coalesce(sum(net_collection_paise),0)::bigint net
  into v_totals from public.sales where day_session_id = v_session.id and status = 'completed';

  v_report := format(E'Sales Summary\n\nDate: %s\n\nGross Sales: %s\nNormal Commission: %s\nFull Commission: %s\nTotal Earnings: %s\nNet Collection: %s',
    v_session.business_date, v_totals.gross, v_totals.normal, v_totals.full, v_totals.earnings, v_totals.net);

  update public.day_sessions set status = 'CLOSED', closed_at = now(), updated_at = now()
    where id = v_session.id returning * into v_session;
  insert into public.day_closures (
    tenant_id, company_id, salesman_id, business_date, product_summary, total_units,
    gross_sales_paise, total_normal_commission_paise, total_full_commission_paise,
    total_earnings_paise, net_collection_paise, report_text, created_by
  ) values (
    v_session.tenant_id, v_session.company_id, v_session.salesman_id, v_session.business_date,
    v_product_summary, v_totals.total_units, v_totals.gross, v_totals.normal, v_totals.full,
    v_totals.earnings, v_totals.net, v_report, auth.uid()
  );
  insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_session.tenant_id, v_session.company_id, auth.uid(), 'day.closed', 'day_session',
      v_session.id, jsonb_build_object('business_date', v_session.business_date, 'closed_at', v_session.closed_at));
  return v_session;
end;
$$;

revoke all on function public.start_day_atomic(uuid, jsonb) from public;
revoke all on function public.close_day_atomic(uuid) from public;
grant execute on function public.start_day_atomic(uuid, jsonb) to authenticated, service_role;
grant execute on function public.close_day_atomic(uuid) to authenticated, service_role;

alter publication supabase_realtime add table public.day_sessions;
alter publication supabase_realtime add table public.day_stock_items;

commit;
