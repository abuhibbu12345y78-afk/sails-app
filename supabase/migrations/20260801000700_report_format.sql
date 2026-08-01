-- Professional daily report format for close_day_atomic and historical closures.
-- Amounts are converted from paise to rupees and formatted with thousands separators.

-- 1. close_day_atomic
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
  v_product_lines text;
  v_totals record;
  v_report text;
  v_version integer;
  v_total_expenses_paise bigint;
  v_business_name text;
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

  select coalesce(string_agg(format('• %s — %s sold', x->>'product', x->>'sold'), E'\n'), '-')
  into v_product_lines from jsonb_array_elements(v_product_summary) x;

  select coalesce(sum(quantity),0)::integer total_units,
    coalesce(sum(gross_sales_paise),0)::bigint gross,
    coalesce(sum(total_normal_commission_paise),0)::bigint normal,
    coalesce(sum(total_full_commission_paise),0)::bigint full,
    coalesce(sum(total_earnings_paise),0)::bigint earnings,
    coalesce(sum(net_collection_paise),0)::bigint net
  into v_totals from public.sales where day_session_id = v_session.id and status = 'completed';

  select coalesce(sum(amount_paise), 0)::bigint
  into v_total_expenses_paise from public.day_expenses where day_session_id = v_session.id;

  v_totals.net := v_totals.net - v_total_expenses_paise;

  select coalesce(business_name, 'AL QUWWA') into v_business_name
    from public.app_settings where company_id = v_session.company_id;
  v_business_name := coalesce(v_business_name, 'AL QUWWA');

  v_report := format(
    E'%s — Daily Sales Report\n\nDate: %s\n\nProduct Breakdown:\n%s\n\nGross Sales: ₹%s\nNormal Commission: ₹%s\nOffer Earnings: ₹%s\nTotal Earnings: ₹%s\nTotal Expenses: ₹%s\nNet Collection: ₹%s\n\nRegards,\n%s',
    v_business_name, v_session.business_date, v_product_lines,
    to_char(v_totals.gross / 100.0, 'FM9999999990.00'),
    to_char(v_totals.normal / 100.0, 'FM9999999990.00'),
    to_char(v_totals.full / 100.0, 'FM9999999990.00'),
    to_char(v_totals.earnings / 100.0, 'FM9999999990.00'),
    to_char(v_total_expenses_paise / 100.0, 'FM9999999990.00'),
    to_char(v_totals.net / 100.0, 'FM9999999990.00'),
    v_business_name
  );

  update public.day_sessions set status = 'CLOSED', closed_at = now(), updated_at = now()
    where id = v_session.id returning * into v_session;

  -- Mark previous closures as superseded
  update public.day_closures set status = 'SUPERSEDED' 
    where salesman_id = p_salesman_id and business_date = v_session.business_date and status = 'ACTIVE';

  -- Calculate next version
  select coalesce(max(closure_version), 0) + 1 into v_version 
    from public.day_closures 
    where salesman_id = p_salesman_id and business_date = v_session.business_date;

  insert into public.day_closures (
    tenant_id, company_id, salesman_id, business_date, product_summary, total_units,
    gross_sales_paise, total_normal_commission_paise, total_full_commission_paise,
    total_earnings_paise, total_expenses_paise, net_collection_paise, report_text, closure_version, status, created_by
  ) values (
    v_session.tenant_id, v_session.company_id, v_session.salesman_id, v_session.business_date,
    v_product_summary, v_totals.total_units, v_totals.gross, v_totals.normal, v_totals.full,
    v_totals.earnings, v_total_expenses_paise, v_totals.net, v_report, v_version, 'ACTIVE', auth.uid()
  );
  
  insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_session.tenant_id, v_session.company_id, auth.uid(), 'day.closed', 'day_session',
      v_session.id, jsonb_build_object('business_date', v_session.business_date, 'closed_at', v_session.closed_at, 'closure_version', v_version));
  return v_session;
end;
$$;

revoke all on function public.close_day_atomic(uuid) from public;
grant execute on function public.close_day_atomic(uuid) to authenticated, service_role;

-- 2. historical_data_entry_atomic (same report format for replayed closures)
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
  v_product_lines text;
  v_business_name text;
  v_totals record;
  v_report text;
  v_fake_time timestamptz;
  
  v_past_units bigint;
  v_sale_record record;
  v_affected_sessions uuid[];
  v_affected_session uuid;
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

  select coalesce(business_name, 'AL QUWWA') into v_business_name
    from public.app_settings where company_id = v_salesman.company_id;
  v_business_name := coalesce(v_business_name, 'AL QUWWA');

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

  v_affected_sessions := array[v_session.id];

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
    coalesce(item.picked_quantity, 0), coalesce(s.quantity, 0), coalesce(item.picked_quantity, 0) - coalesce(s.quantity, 0), 
    p.name, p.selling_price_paise
  from public.products p
  left join jsonb_to_recordset(coalesce(p_pickup_items, '[]'::jsonb)) as item(product_id uuid, picked_quantity integer) on item.product_id = p.id
  left join jsonb_to_recordset(coalesce(p_sales_items, '[]'::jsonb)) as s(product_id uuid, quantity integer) on s.product_id = p.id
  where p.company_id = v_salesman.company_id and p.active;

  -- Check if sales exceed stock
  if exists (select 1 from public.day_stock_items where day_session_id = v_session.id and remaining_quantity < 0) then
    raise exception 'insufficient_daily_stock' using errcode = '22023';
  end if;

  -- 3. RECONCILIATION ENGINE
  for v_sale_item in select * from jsonb_to_recordset(coalesce(p_sales_items, '[]'::jsonb)) as s(product_id uuid, quantity integer) loop
    if v_sale_item.quantity < 1 then continue; end if;

    select * into v_product from public.products where id = v_sale_item.product_id and active for share;
    select * into v_rule from public.commission_rules where product_id = v_sale_item.product_id and valid_to is null for share;

    -- Lock progress
    select * into v_progress from public.commission_progress
      where salesman_id = p_salesman_id and product_id = v_sale_item.product_id for update;
    if not found then
      insert into public.commission_progress (tenant_id, company_id, salesman_id, product_id)
        values (v_product.tenant_id, v_product.company_id, p_salesman_id, v_sale_item.product_id)
        returning * into v_progress;
    end if;

    -- Check conflict
    if exists (
      select 1 from public.full_commission_rewards r
      join public.sales s on s.id = r.sale_id
      join public.day_sessions d on d.id = s.day_session_id
      where r.product_id = v_sale_item.product_id 
        and r.salesman_id = p_salesman_id
        and d.business_date >= p_business_date 
        and r.status = 'received'
    ) then
      raise exception 'received_offer_conflict' using errcode = '22023';
    end if;

    -- Insert historical sales (unprocessed)
    insert into public.sales (
      tenant_id, company_id, salesman_id, day_session_id, idempotency_key, product_id,
      product_name_snapshot, quantity, unit_selling_price_paise, normal_commission_paise_snapshot,
      full_commission_paise_snapshot, reward_threshold_snapshot, normal_commission_units,
      full_commission_units, gross_sales_paise, total_normal_commission_paise,
      total_full_commission_paise, total_earnings_paise, net_collection_paise, created_by, created_at
    ) values (
      v_product.tenant_id, v_product.company_id, p_salesman_id, v_session.id, gen_random_uuid(), v_sale_item.product_id,
      v_product.name, v_sale_item.quantity, v_product.selling_price_paise, v_rule.normal_commission_paise,
      v_rule.full_commission_paise, v_rule.reward_threshold, 0, 0,
      v_product.selling_price_paise * v_sale_item.quantity, 0, 0, 0, 0,
      auth.uid(), v_fake_time + interval '5 hours'
    );

    -- Delete all subsequent earned rewards
    delete from public.full_commission_rewards 
    where product_id = v_sale_item.product_id 
      and salesman_id = p_salesman_id
      and status = 'earned'
      and sale_id in (
        select s.id from public.sales s 
        join public.day_sessions d on d.id = s.day_session_id 
        where d.business_date >= p_business_date
      );

    -- Calculate state BEFORE p_business_date
    select coalesce(sum(quantity), 0) into v_past_units from public.sales s
    join public.day_sessions d on d.id = s.day_session_id
    where s.salesman_id = p_salesman_id and s.product_id = v_sale_item.product_id and d.business_date < p_business_date;

    v_cycle := (v_past_units / (v_rule.reward_threshold + 1)) + 1;
    v_progress.normal_sales_completed := v_past_units % (v_rule.reward_threshold + 1);

    -- Replay all sales on or after p_business_date
    for v_sale_record in 
      select s.*, d.business_date from public.sales s
      join public.day_sessions d on d.id = s.day_session_id
      where s.salesman_id = p_salesman_id and s.product_id = v_sale_item.product_id and d.business_date >= p_business_date
      order by d.business_date asc, s.created_at asc, s.id asc
    loop
      v_affected_sessions := array_append(v_affected_sessions, v_sale_record.day_session_id);
      
      v_normal_units := 0;
      v_full_units := 0;
      v_full_cycles := '{}';

      for v_unit in 1..v_sale_record.quantity loop
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

      update public.sales set
        normal_commission_units = v_normal_units,
        full_commission_units = v_full_units,
        total_normal_commission_paise = v_rule.normal_commission_paise * v_normal_units,
        total_full_commission_paise = v_rule.full_commission_paise * v_full_units,
        total_earnings_paise = (v_rule.normal_commission_paise * v_normal_units) + (v_rule.full_commission_paise * v_full_units),
        net_collection_paise = (unit_selling_price_paise * quantity) - ((v_rule.normal_commission_paise * v_normal_units) + (v_rule.full_commission_paise * v_full_units))
      where id = v_sale_record.id;

      if cardinality(v_full_cycles) > 0 then
        insert into public.full_commission_rewards
          (tenant_id, company_id, salesman_id, sale_id, product_id, product_name_snapshot, cycle_number, amount_paise, created_at, status)
        select v_product.tenant_id, v_product.company_id, p_salesman_id, v_sale_record.id, v_sale_item.product_id,
          v_product.name, cycle_no, v_rule.full_commission_paise, v_sale_record.created_at, 'earned'
        from unnest(v_full_cycles) cycle_no;
      end if;
    end loop;

    -- Save progress
    update public.commission_progress
      set normal_sales_completed = v_progress.normal_sales_completed, cycle_number = v_cycle, updated_at = now()
      where salesman_id = p_salesman_id and product_id = v_sale_item.product_id;
      
  end loop;

  -- 4. Re-calculate affected day closures
  for v_affected_session in select distinct unnest(v_affected_sessions) loop
    select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', product_id, 'product', product_name_snapshot, 'picked', picked_quantity,
      'sold', sold_quantity, 'remaining', remaining_quantity
    ) order by product_name_snapshot), '[]'::jsonb)
    into v_product_summary from public.day_stock_items where day_session_id = v_affected_session;

    select coalesce(string_agg(format('• %s — %s sold', x->>'product', x->>'sold'), E'\n'), '-')
    into v_product_lines from jsonb_array_elements(v_product_summary) x;

    select coalesce(sum(quantity),0)::integer total_units,
      coalesce(sum(gross_sales_paise),0)::bigint gross,
      coalesce(sum(total_normal_commission_paise),0)::bigint normal,
      coalesce(sum(total_full_commission_paise),0)::bigint full,
      coalesce(sum(total_earnings_paise),0)::bigint earnings,
      coalesce(sum(net_collection_paise),0)::bigint net
    into v_totals from public.sales where day_session_id = v_affected_session and status = 'completed';

    -- Find the business date for the report text
    select business_date into v_today from public.day_sessions where id = v_affected_session;
    v_report := format(
      E'%s — Daily Sales Report\n\nDate: %s\n\nProduct Breakdown:\n%s\n\nGross Sales: ₹%s\nNormal Commission: ₹%s\nOffer Earnings: ₹%s\nTotal Earnings: ₹%s\nTotal Expenses: ₹0.00\nNet Collection: ₹%s\n\nRegards,\n%s',
      v_business_name, v_today, v_product_lines,
      to_char(v_totals.gross / 100.0, 'FM9999999990.00'),
      to_char(v_totals.normal / 100.0, 'FM9999999990.00'),
      to_char(v_totals.full / 100.0, 'FM9999999990.00'),
      to_char(v_totals.earnings / 100.0, 'FM9999999990.00'),
      to_char(v_totals.net / 100.0, 'FM9999999990.00'),
      v_business_name
    );

    if exists (select 1 from public.day_closures where salesman_id = p_salesman_id and business_date = v_today) then
      update public.day_closures set
        product_summary = v_product_summary,
        total_units = v_totals.total_units,
        gross_sales_paise = v_totals.gross,
        total_normal_commission_paise = v_totals.normal,
        total_full_commission_paise = v_totals.full,
        total_earnings_paise = v_totals.earnings,
        net_collection_paise = v_totals.net,
        report_text = v_report
      where salesman_id = p_salesman_id and business_date = v_today;
    else
      -- Insert for the newly created historical day
      insert into public.day_closures (
        tenant_id, company_id, salesman_id, business_date, product_summary, total_units,
        gross_sales_paise, total_normal_commission_paise, total_full_commission_paise,
        total_earnings_paise, net_collection_paise, report_text, created_by, created_at
      ) values (
        v_salesman.tenant_id, v_salesman.company_id, p_salesman_id, v_today, v_product_summary, v_totals.total_units,
        v_totals.gross, v_totals.normal, v_totals.full, v_totals.earnings, v_totals.net, v_report, auth.uid(), now()
      );
    end if;
  end loop;

  insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_session.tenant_id, v_session.company_id, auth.uid(), 'day.historical_entry', 'day_session',
      v_session.id, jsonb_build_object('business_date', v_session.business_date, 'reconciled', true));

  return v_session;
end;
$$;

revoke all on function public.historical_data_entry_atomic(uuid, date, jsonb, jsonb) from public;
grant execute on function public.historical_data_entry_atomic(uuid, date, jsonb, jsonb) to authenticated, service_role;
