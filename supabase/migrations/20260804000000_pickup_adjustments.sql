-- Pickup Adjustments table for safe corrections

create table public.additional_pickup_adjustments (
  id uuid primary key default gen_random_uuid(),
  audit_log_id uuid not null references public.audit_logs(id),
  day_session_id uuid not null references public.day_sessions(id),
  product_id uuid not null references public.products(id),
  previous_quantity integer not null,
  corrected_quantity integer not null,
  adjustment_quantity integer not null,
  reason text not null,
  idempotency_key uuid unique not null,
  created_at timestamptz not null default now()
);

-- Index for quick lookups during session loads and total calculations
create index additional_pickup_adjustments_session_product_idx on public.additional_pickup_adjustments(audit_log_id, product_id);
create index additional_pickup_adjustments_day_session_idx on public.additional_pickup_adjustments(day_session_id);

-- Enable RLS
alter table public.additional_pickup_adjustments enable row level security;
create policy "Users can read own adjustments" on public.additional_pickup_adjustments
  for select using (
    exists (
      select 1 from public.day_sessions ds
      inner join public.salesmen s on ds.salesman_id = s.id
      where ds.id = additional_pickup_adjustments.day_session_id
      and s.user_id = auth.uid()
    )
  );

-- Atomic RPC to correct additional pickup
create or replace function public.correct_additional_pickup_atomic(
  p_salesman_id uuid,
  p_audit_log_id uuid,
  p_product_id uuid,
  p_corrected_quantity integer,
  p_reason text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.day_sessions;
  v_audit_log public.audit_logs;
  v_stock public.day_stock_items;
  v_item record;
  v_original_quantity integer;
  v_previous_adjustments integer := 0;
  v_current_effective integer;
  v_adjustment integer;
begin
  -- Validate salesman auth
  if auth.uid() is not null and not exists (
    select 1 from public.salesmen where id = p_salesman_id and user_id = auth.uid() and active
  ) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  -- Verify idempotent key early to avoid locking if possible
  if exists (select 1 from public.additional_pickup_adjustments where idempotency_key = p_idempotency_key) then
    return jsonb_build_object('id', (select id from public.additional_pickup_adjustments where idempotency_key = p_idempotency_key limit 1));
  end if;

  -- Lock session to prevent concurrency issues
  perform pg_advisory_xact_lock(hashtextextended('day:' || p_salesman_id::text, 0));
  
  -- Find original audit log
  select * into v_audit_log from public.audit_logs where id = p_audit_log_id for update;
  if not found then raise exception 'pickup_not_found' using errcode = 'P0002'; end if;
  
  -- Validate session is OPEN
  select * into v_session from public.day_sessions where id = v_audit_log.entity_id and salesman_id = p_salesman_id for update;
  if not found or v_session.status != 'OPEN' then raise exception 'day_not_open' using errcode = 'P0002'; end if;

  -- Find original quantity from audit log metadata
  v_original_quantity := null;
  for v_item in select * from jsonb_to_recordset(v_audit_log.metadata->'items') as item(product_id uuid, additional_quantity integer) loop
    if v_item.product_id = p_product_id then
      v_original_quantity := v_item.additional_quantity;
      exit;
    end if;
  end loop;

  if v_original_quantity is null then
    raise exception 'product_not_found_in_pickup' using errcode = '22023';
  end if;

  if p_corrected_quantity < 0 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;

  -- Get sum of previous adjustments for this specific pickup item
  select coalesce(sum(adjustment_quantity), 0) into v_previous_adjustments
  from public.additional_pickup_adjustments
  where audit_log_id = p_audit_log_id and product_id = p_product_id;

  v_current_effective := v_original_quantity + v_previous_adjustments;
  v_adjustment := p_corrected_quantity - v_current_effective;

  if v_adjustment = 0 then
    -- No change needed
    return jsonb_build_object('id', null, 'ignored', true);
  end if;

  -- Lock and load stock
  select * into v_stock from public.day_stock_items 
    where day_session_id = v_session.id and product_id = p_product_id for update;
    
  if not found then raise exception 'product_not_found_in_session' using errcode = 'P0002'; end if;

  -- Validate stock constraints (effective picked cannot be less than sold)
  if v_stock.picked_quantity + v_adjustment < v_stock.sold_quantity then
    raise exception 'exceeds_sold_quantity' using errcode = '22023';
  end if;

  -- Update stock
  update public.day_stock_items 
    set picked_quantity = picked_quantity + v_adjustment,
        remaining_quantity = remaining_quantity + v_adjustment,
        updated_at = now()
    where id = v_stock.id;

  -- Insert adjustment record
  insert into public.additional_pickup_adjustments (
    audit_log_id, day_session_id, product_id, previous_quantity, corrected_quantity, adjustment_quantity, reason, idempotency_key
  ) values (
    p_audit_log_id, v_session.id, p_product_id, v_current_effective, p_corrected_quantity, v_adjustment, p_reason, p_idempotency_key
  ) returning id into v_item.product_id; -- Reusing v_item.product_id for uuid capture

  -- Audit log for the correction
  insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_session.tenant_id, v_session.company_id, auth.uid(), 'day.pickup_correction', 'day_session',
      v_session.id, jsonb_build_object('audit_log_id', p_audit_log_id, 'product_id', p_product_id, 'adjustment', v_adjustment, 'reason', p_reason));

  return jsonb_build_object('id', v_item.product_id);
end;
$$;
revoke all on function public.correct_additional_pickup_atomic(uuid, uuid, uuid, integer, text, uuid) from public;
grant execute on function public.correct_additional_pickup_atomic(uuid, uuid, uuid, integer, text, uuid) to authenticated, service_role;

commit;
