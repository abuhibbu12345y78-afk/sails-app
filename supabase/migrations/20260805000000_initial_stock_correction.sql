-- Update start_day_atomic to include items array in metadata for day.started audit log
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
  v_session public.day_sessions;
  v_timezone text;
  v_business_date date;
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

  -- Add items to day.started log
  insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_salesman.tenant_id, v_salesman.company_id, auth.uid(), 'day.started', 'day_session',
      v_session.id, jsonb_build_object('business_date', v_business_date, 'started_at', v_session.started_at, 'items', coalesce(p_items, '[]'::jsonb)));
  return v_session;
end;
$$;
revoke all on function public.start_day_atomic(uuid, jsonb) from public;
grant execute on function public.start_day_atomic(uuid, jsonb) to authenticated, service_role;

-- Update correct_additional_pickup_atomic to handle day.started logs appropriately
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

  -- Verify idempotent key early
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
  for v_item in select * from jsonb_to_recordset(v_audit_log.metadata->'items') as item(product_id uuid, additional_quantity integer, picked_quantity integer) loop
    if v_item.product_id = p_product_id then
      -- Fallback to picked_quantity for initial stock (day.started log)
      v_original_quantity := coalesce(v_item.additional_quantity, v_item.picked_quantity);
      exit;
    end if;
  end loop;

  -- If it wasn't specified in the array, for initial pickup it means it was 0!
  if v_original_quantity is null then
    if v_audit_log.action = 'day.started' then
      v_original_quantity := 0;
    else
      raise exception 'product_not_found_in_pickup' using errcode = '22023';
    end if;
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
  ) returning id into v_item.product_id;

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

-- Backfill missing items in day.started audit logs
-- For existing day.started logs, their initial stock items array can be determined by subtracting 
-- any subsequent additional_pickup and corrections from the current day_stock_items.
-- Since the user hasn't made any additional pickups or corrections yet, we can safely just use the current picked_quantity.
DO $$
DECLARE
  v_log RECORD;
  v_items jsonb;
BEGIN
  FOR v_log IN SELECT id, entity_id FROM public.audit_logs WHERE action = 'day.started' AND NOT (metadata ? 'items')
  LOOP
    SELECT jsonb_agg(jsonb_build_object('product_id', product_id, 'picked_quantity', picked_quantity))
    INTO v_items
    FROM public.day_stock_items
    WHERE day_session_id = v_log.entity_id;
    
    IF v_items IS NULL THEN
      v_items := '[]'::jsonb;
    END IF;

    UPDATE public.audit_logs
    SET metadata = metadata || jsonb_build_object('items', v_items)
    WHERE id = v_log.id;
  END LOOP;
END;
$$;
