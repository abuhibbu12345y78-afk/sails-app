begin;

create or replace function public.historical_data_entry_atomic(
  p_salesman_id uuid,
  p_business_date date,
  p_pickup_items jsonb,
  p_sales_items jsonb
) returns public.day_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salesman public.salesmen;
  v_timezone text;
  v_today date;
  v_session public.day_sessions;
  v_sale_item record;
  v_product public.products;
  v_rule public.commission_rules;
  v_progress public.commission_progress;
  v_stock public.day_stock_items;
  v_sale public.sales;
  v_unit integer;
  v_normal_units integer;
  v_full_units integer;
  v_cycle bigint;
  v_full_cycles bigint[];
  v_product_summary jsonb;
  v_totals record;
  v_report text;
  v_fake_time timestamptz;
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
  v_today := (now() at time zone v_timezone)::date;

  if p_business_date >= v_today then
    raise exception 'invalid_historical_date' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('day:' || p_salesman_id::text, 0));
  
  if exists (select 1 from public.day_sessions where salesman_id = p_salesman_id and business_date = p_business_date) then
    raise exception 'day_already_exists' using errcode = '23505';
  end if;

  -- 1. Create Day Session
  v_fake_time := timezone(v_timezone, p_business_date::timestamp) + interval '8 hours';
  insert into public.day_sessions (tenant_id, company_id, salesman_id, business_date, status, started_at, closed_at, created_at)
    values (v_salesman.tenant_id, v_salesman.company_id, p_salesman_id, p_business_date, 'CLOSED', v_fake_time, v_fake_time + interval '10 hours', now())
    returning * into v_session;

  -- 2. Insert Stock
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_pickup_items, '[]'::jsonb))
      as item(product_id uuid, picked_quantity integer)
    left join public.products p on p.id = item.product_id
    where p.id is null or p.company_id <> v_salesman.company_id or item.picked_quantity < 0
  ) then
    raise exception 'invalid_day_stock' using errcode = '22023';
  end if;

  insert into public.day_stock_items (
    tenant_id, company_id, salesman_id, day_session_id, product_id,
    picked_quantity, sold_quantity, remaining_quantity,
    product_name_snapshot, unit_price_paise_snapshot
  )
  select v_salesman.tenant_id, v_salesman.company_id, p_salesman_id, v_session.id, p.id,
    coalesce(item.picked_quantity, 0), 0, coalesce(item.picked_quantity, 0), p.name, p.selling_price_paise
  from public.products p
  left join jsonb_to_recordset(coalesce(p_pickup_items, '[]'::jsonb))
    as item(product_id uuid, picked_quantity integer) on item.product_id = p.id
  where p.company_id = v_salesman.company_id and p.active;

  -- 3. Process Sales
  for v_sale_item in select * from jsonb_to_recordset(coalesce(p_sales_items, '[]'::jsonb)) as s(product_id uuid, quantity integer) loop
    if v_sale_item.quantity < 1 then continue; end if;

    select * into v_stock from public.day_stock_items
      where day_session_id = v_session.id and product_id = v_sale_item.product_id for update;
    if not found or v_stock.remaining_quantity < v_sale_item.quantity then
      raise exception 'insufficient_daily_stock' using errcode = '22023';
    end if;

    select * into v_product from public.products where id = v_sale_item.product_id and active for share;
    select * into v_rule from public.commission_rules where product_id = v_sale_item.product_id and valid_to is null for share;
    
    select * into v_progress from public.commission_progress
      where salesman_id = p_salesman_id and product_id = v_sale_item.product_id for update;
    if not found then
      insert into public.commission_progress (tenant_id, company_id, salesman_id, product_id)
        values (v_product.tenant_id, v_product.company_id, p_salesman_id, v_sale_item.product_id)
        returning * into v_progress;
    end if;

    v_cycle := v_progress.cycle_number;
    v_normal_units := 0;
    v_full_units := 0;
    v_full_cycles := '{}';

    for v_unit in 1..v_sale_item.quantity loop
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
      total_full_commission_paise, total_earnings_paise, net_collection_paise, created_by, created_at
    ) values (
      v_product.tenant_id, v_product.company_id, p_salesman_id, v_session.id, gen_random_uuid(), v_sale_item.product_id,
      v_product.name, v_sale_item.quantity, v_product.selling_price_paise, v_rule.normal_commission_paise,
      v_rule.full_commission_paise, v_rule.reward_threshold, v_normal_units, v_full_units,
      v_product.selling_price_paise * v_sale_item.quantity, v_rule.normal_commission_paise * v_normal_units,
      v_rule.full_commission_paise * v_full_units,
      (v_rule.normal_commission_paise * v_normal_units) + (v_rule.full_commission_paise * v_full_units),
      (v_product.selling_price_paise * v_sale_item.quantity) -
        ((v_rule.normal_commission_paise * v_normal_units) + (v_rule.full_commission_paise * v_full_units)),
      auth.uid(), v_fake_time + interval '5 hours'
    ) returning * into v_sale;

    update public.day_stock_items
      set sold_quantity = sold_quantity + v_sale_item.quantity,
        remaining_quantity = remaining_quantity - v_sale_item.quantity,
        updated_at = now()
      where id = v_stock.id;

    if cardinality(v_full_cycles) > 0 then
      insert into public.full_commission_rewards
        (tenant_id, company_id, salesman_id, sale_id, product_id, product_name_snapshot, cycle_number, amount_paise, created_at)
      select v_product.tenant_id, v_product.company_id, p_salesman_id, v_sale.id, v_sale_item.product_id,
        v_product.name, cycle_no, v_rule.full_commission_paise, v_fake_time + interval '5 hours'
      from unnest(v_full_cycles) cycle_no;
    end if;

    update public.commission_progress
      set normal_sales_completed = v_progress.normal_sales_completed, cycle_number = v_cycle, updated_at = now()
      where salesman_id = p_salesman_id and product_id = v_sale_item.product_id;

  end loop;

  -- 4. Close Day calculations
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

  v_report := format(E'Historical Sales Summary\n\nDate: %s\n\nGross Sales: %s\nNormal Commission: %s\nFull Commission: %s\nTotal Earnings: %s\nNet Collection: %s',
    v_session.business_date, v_totals.gross, v_totals.normal, v_totals.full, v_totals.earnings, v_totals.net);

  insert into public.day_closures (
    tenant_id, company_id, salesman_id, business_date, product_summary, total_units,
    gross_sales_paise, total_normal_commission_paise, total_full_commission_paise,
    total_earnings_paise, net_collection_paise, report_text, created_by, created_at
  ) values (
    v_session.tenant_id, v_session.company_id, v_session.salesman_id, v_session.business_date,
    v_product_summary, v_totals.total_units, v_totals.gross, v_totals.normal, v_totals.full,
    v_totals.earnings, v_totals.net, v_report, auth.uid(), now()
  );

  insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_session.tenant_id, v_session.company_id, auth.uid(), 'day.historical_entry', 'day_session',
      v_session.id, jsonb_build_object('business_date', v_session.business_date));

  return v_session;
end;
$$;

revoke all on function public.historical_data_entry_atomic(uuid, date, jsonb, jsonb) from public;
grant execute on function public.historical_data_entry_atomic(uuid, date, jsonb, jsonb) to authenticated, service_role;

commit;
