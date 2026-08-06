-- Migration: Optional Offer Support (offer_enabled)
-- Non-destructive: adds offer_enabled to commission_rules, makes the offer
-- columns nullable for products WITHOUT offers, and adapts the runtime
-- commission engine so a product with offer disabled earns ONLY normal
-- commission (no progress, no cycle, no rewards) while offer products
-- keep the exact existing 13th-sale-style cycle behavior.
--
-- Representation:
--   offer_enabled = true  -> full_commission_paise > 0 and reward_threshold > 0 (existing products unchanged)
--   offer_enabled = false -> full_commission_paise = NULL and reward_threshold = NULL
-- Sales snapshots store coalesce(..., 0) so existing NOT NULL snapshot
-- columns keep working; reward_threshold_snapshot = 0 marks a no-offer sale.
-- Historical sales are never recalculated; rule versioning applies only to
-- future sales (same mechanism as before).

-- ---------------------------------------------------------------------------
-- 1. Schema: commission_rules.offer_enabled + nullable offer columns
-- ---------------------------------------------------------------------------
alter table public.commission_rules
  add column offer_enabled boolean not null default true;

alter table public.commission_rules
  alter column full_commission_paise drop not null,
  alter column reward_threshold drop not null,
  alter column reward_threshold drop default;

alter table public.commission_rules
  add constraint commission_rules_offer_consistency_check check (
    (offer_enabled and full_commission_paise is not null and reward_threshold is not null
       and full_commission_paise > 0 and reward_threshold > 0)
    or
    (not offer_enabled and full_commission_paise is null and reward_threshold is null)
  );

-- ---------------------------------------------------------------------------
-- 2. upsert_product_atomic (new signature with p_offer_enabled)
--    Old 11-arg overload is dropped; no caller uses it outside this migration.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_product_atomic(
  p_product_id uuid,
  p_tenant_id uuid,
  p_company_id uuid,
  p_name text,
  p_selling_price_paise bigint,
  p_normal_commission_paise bigint,
  p_offer_enabled boolean,
  p_full_commission_paise bigint,
  p_reward_threshold integer,
  p_active boolean,
  p_sort_order integer,
  p_reason text
) returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products;
  v_rule public.commission_rules;
  v_code text;
  v_prev jsonb;
  v_changed jsonb := '{}'::jsonb;
  v_action text;
  v_rule_created boolean := false;
begin
  if trim(coalesce(p_name, '')) = '' or length(trim(p_name)) > 80 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_selling_price_paise is null or p_selling_price_paise < 1 or p_selling_price_paise > 999999900 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  if p_normal_commission_paise is null or p_normal_commission_paise < 0 or p_normal_commission_paise > p_selling_price_paise then
    raise exception 'invalid_normal_commission' using errcode = '22023';
  end if;
  if p_offer_enabled then
    if p_full_commission_paise is null or p_full_commission_paise < 1 or p_full_commission_paise > 999999900 then
      raise exception 'invalid_full_commission' using errcode = '22023';
    end if;
    if p_reward_threshold is null or p_reward_threshold < 1 or p_reward_threshold > 999 then
      raise exception 'invalid_reward_threshold' using errcode = '22023';
    end if;
  else
    p_full_commission_paise := null;
    p_reward_threshold := null;
  end if;
  if p_sort_order is null or p_sort_order < 0 or p_sort_order > 9999 then
    raise exception 'invalid_sort_order' using errcode = '22023';
  end if;

  if auth.uid() is not null and not exists (
    select 1 from public.salesmen where company_id = p_company_id and user_id = auth.uid() and active
  ) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  if p_product_id is null then
    -- CREATE ---------------------------------------------------------------
    v_code := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
    v_code := trim(both '-' from v_code);
    if v_code = '' then v_code := 'product'; end if;
    if length(v_code) > 40 then v_code := left(v_code, 40); end if;
    if exists (select 1 from public.products where company_id = p_company_id and code = v_code) then
      v_code := v_code || '-' || substr(md5(p_name || ':' || now()::text), 1, 6);
    end if;

    insert into public.products (id, tenant_id, company_id, code, name, selling_price_paise, active, sort_order)
      values (gen_random_uuid(), p_tenant_id, p_company_id, v_code, trim(p_name), p_selling_price_paise, p_active, p_sort_order)
      returning * into v_product;

    insert into public.commission_rules
      (tenant_id, company_id, product_id, offer_enabled, normal_commission_paise, full_commission_paise, reward_threshold)
      values (p_tenant_id, p_company_id, v_product.id, p_offer_enabled, p_normal_commission_paise, p_full_commission_paise, p_reward_threshold)
      returning * into v_rule;

    insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
      values (p_tenant_id, p_company_id, auth.uid(), 'product.created', 'product', v_product.id,
        jsonb_build_object('code', v_product.code, 'name', v_product.name, 'selling_price_paise', p_selling_price_paise,
          'offer_enabled', p_offer_enabled, 'normal_commission_paise', p_normal_commission_paise,
          'full_commission_paise', p_full_commission_paise, 'reward_threshold', p_reward_threshold,
          'reason', coalesce(nullif(trim(p_reason), ''), null)));
    return v_product;
  end if;

  -- UPDATE ----------------------------------------------------------------
  select * into v_product from public.products where id = p_product_id for update;
  if not found then raise exception 'product_not_found' using errcode = 'P0002'; end if;

  v_prev := jsonb_build_object(
    'name', v_product.name, 'selling_price_paise', v_product.selling_price_paise,
    'active', v_product.active, 'sort_order', v_product.sort_order);

  if trim(p_name) <> v_product.name then
    update public.products set name = trim(p_name) where id = v_product.id;
    v_changed := v_changed || jsonb_build_object('name', jsonb_build_array(v_product.name, trim(p_name)));
  end if;
  if p_selling_price_paise <> v_product.selling_price_paise then
    update public.products set selling_price_paise = p_selling_price_paise where id = v_product.id;
    v_changed := v_changed || jsonb_build_object('selling_price_paise', jsonb_build_array(v_product.selling_price_paise, p_selling_price_paise));
  end if;
  if p_sort_order <> v_product.sort_order then
    update public.products set sort_order = p_sort_order where id = v_product.id;
    v_changed := v_changed || jsonb_build_object('sort_order', jsonb_build_array(v_product.sort_order, p_sort_order));
  end if;
  if p_active <> v_product.active then
    update public.products set active = p_active where id = v_product.id;
    v_changed := v_changed || jsonb_build_object('active', jsonb_build_array(v_product.active, p_active));
  end if;
  if v_changed <> '{}'::jsonb then
    update public.products set updated_at = now() where id = v_product.id;
  end if;

  select * into v_rule from public.commission_rules
    where product_id = v_product.id and valid_to is null for update;
  if not found then
    -- No open rule (should not happen for managed data): open one.
    insert into public.commission_rules
      (tenant_id, company_id, product_id, offer_enabled, normal_commission_paise, full_commission_paise, reward_threshold)
      values (v_product.tenant_id, v_product.company_id, v_product.id, p_offer_enabled, p_normal_commission_paise, p_full_commission_paise, p_reward_threshold)
      returning * into v_rule;
    v_rule_created := true;
    v_changed := v_changed || jsonb_build_object('commission', jsonb_build_array(null,
      jsonb_build_object('offer_enabled', p_offer_enabled, 'normal_commission_paise', p_normal_commission_paise,
        'full_commission_paise', p_full_commission_paise, 'reward_threshold', p_reward_threshold)));
  elsif v_rule.offer_enabled <> p_offer_enabled
      or v_rule.normal_commission_paise <> p_normal_commission_paise
      or coalesce(v_rule.full_commission_paise, -1) <> coalesce(p_full_commission_paise, -1)
      or coalesce(v_rule.reward_threshold, -1) <> coalesce(p_reward_threshold, -1) then
    update public.commission_rules set valid_to = now() where id = v_rule.id;
    insert into public.commission_rules
      (tenant_id, company_id, product_id, offer_enabled, normal_commission_paise, full_commission_paise, reward_threshold, valid_from)
      values (v_product.tenant_id, v_product.company_id, v_product.id, p_offer_enabled, p_normal_commission_paise, p_full_commission_paise, p_reward_threshold, now())
      returning * into v_rule;
    v_rule_created := true;
    v_changed := v_changed || jsonb_build_object('commission',
      jsonb_build_array(jsonb_build_object('offer_enabled', v_rule.offer_enabled,
        'normal_commission_paise', v_rule.normal_commission_paise,
        'full_commission_paise', v_rule.full_commission_paise, 'reward_threshold', v_rule.reward_threshold),
      jsonb_build_object('offer_enabled', p_offer_enabled, 'normal_commission_paise', p_normal_commission_paise,
        'full_commission_paise', p_full_commission_paise, 'reward_threshold', p_reward_threshold)));
  end if;

  if v_product.active and not p_active then
    v_action := 'product.disabled';
  elsif not v_product.active and p_active then
    v_action := 'product.enabled';
  else
    v_action := 'product.updated';
  end if;

  if v_changed <> '{}'::jsonb or v_rule_created then
    insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
      values (v_product.tenant_id, v_product.company_id, auth.uid(), v_action, 'product', v_product.id,
        jsonb_build_object('previous', v_prev, 'changed', v_changed,
          'reason', coalesce(nullif(trim(p_reason), ''), null)));
  end if;

  select * into v_product from public.products where id = p_product_id;
  return v_product;
end;
$$;

drop function if exists public.upsert_product_atomic(uuid, uuid, uuid, text, bigint, bigint, bigint, integer, boolean, integer, text);

revoke all on function public.upsert_product_atomic(uuid, uuid, uuid, text, bigint, bigint, boolean, bigint, integer, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.upsert_product_atomic(uuid, uuid, uuid, text, bigint, bigint, boolean, bigint, integer, boolean, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. create_sale_atomic (offer branch: no progress/cycle for no-offer products)
-- ---------------------------------------------------------------------------
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

  if v_rule.offer_enabled then
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
  else
    v_normal_units := p_quantity;
  end if;

  insert into public.sales (
    tenant_id, company_id, salesman_id, day_session_id, idempotency_key, product_id,
    product_name_snapshot, quantity, unit_selling_price_paise, normal_commission_paise_snapshot,
    full_commission_paise_snapshot, reward_threshold_snapshot, normal_commission_units,
    full_commission_units, gross_sales_paise, total_normal_commission_paise,
    total_full_commission_paise, total_earnings_paise, net_collection_paise, created_by
  ) values (
    v_product.tenant_id, v_product.company_id, p_salesman_id, v_session.id, p_idempotency_key, p_product_id,
    v_product.name, p_quantity, v_product.selling_price_paise, v_rule.normal_commission_paise,
    coalesce(v_rule.full_commission_paise, 0), coalesce(v_rule.reward_threshold, 0), v_normal_units, v_full_units,
    v_product.selling_price_paise * p_quantity, v_rule.normal_commission_paise * v_normal_units,
    coalesce(v_rule.full_commission_paise, 0) * v_full_units,
    (v_rule.normal_commission_paise * v_normal_units) + (coalesce(v_rule.full_commission_paise, 0) * v_full_units),
    (v_product.selling_price_paise * p_quantity) -
      ((v_rule.normal_commission_paise * v_normal_units) + (coalesce(v_rule.full_commission_paise, 0) * v_full_units)),
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

  if v_rule.offer_enabled then
    update public.commission_progress
      set normal_sales_completed = v_progress.normal_sales_completed, cycle_number = v_cycle, updated_at = now()
      where salesman_id = p_salesman_id and product_id = p_product_id;
  end if;

  insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_product.tenant_id, v_product.company_id, auth.uid(), 'sale.created', 'sale', v_sale.id,
      jsonb_build_object('day_session_id', v_session.id, 'quantity', p_quantity,
        'normal_units', v_normal_units, 'full_units', v_full_units));
  return v_sale;
end;
$$;

revoke all on function public.create_sale_atomic(uuid, uuid, integer, uuid) from public, anon;
grant execute on function public.create_sale_atomic(uuid, uuid, integer, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. reverse_sale_atomic (replay: snapshot threshold 0 = no-offer sale)
-- ---------------------------------------------------------------------------
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

    if v_curr_sale.reward_threshold_snapshot = 0 then
      -- No-offer sale: every unit is a normal commission unit.
      v_sale_normal_units := v_effective_qty;
    else
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
    end if;

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

revoke all on function public.reverse_sale_atomic(uuid, uuid, integer, text, uuid) from public, anon;
grant execute on function public.reverse_sale_atomic(uuid, uuid, integer, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. historical_data_entry_atomic (reconciliation engine: no-offer branch)
-- ---------------------------------------------------------------------------
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

    -- Lock progress (offer products only; no-offer products have no cycle)
    if v_rule.offer_enabled then
      select * into v_progress from public.commission_progress
        where salesman_id = p_salesman_id and product_id = v_sale_item.product_id for update;
      if not found then
        insert into public.commission_progress (tenant_id, company_id, salesman_id, product_id)
          values (v_product.tenant_id, v_product.company_id, p_salesman_id, v_sale_item.product_id)
          returning * into v_progress;
      end if;
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
      coalesce(v_rule.full_commission_paise, 0), coalesce(v_rule.reward_threshold, 0), 0, 0,
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

    -- Calculate state BEFORE p_business_date (offer products only)
    if v_rule.offer_enabled then
      select coalesce(sum(quantity), 0) into v_past_units from public.sales s
      join public.day_sessions d on d.id = s.day_session_id
      where s.salesman_id = p_salesman_id and s.product_id = v_sale_item.product_id and d.business_date < p_business_date;

      v_cycle := (v_past_units / (v_rule.reward_threshold + 1)) + 1;
      v_progress.normal_sales_completed := v_past_units % (v_rule.reward_threshold + 1);
    end if;

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

      if not v_rule.offer_enabled then
        v_normal_units := v_sale_record.quantity;
      else
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
      end if;

      update public.sales set
        normal_commission_units = v_normal_units,
        full_commission_units = v_full_units,
        total_normal_commission_paise = v_rule.normal_commission_paise * v_normal_units,
        total_full_commission_paise = coalesce(v_rule.full_commission_paise, 0) * v_full_units,
        total_earnings_paise = (v_rule.normal_commission_paise * v_normal_units) + (coalesce(v_rule.full_commission_paise, 0) * v_full_units),
        net_collection_paise = (unit_selling_price_paise * quantity) - ((v_rule.normal_commission_paise * v_normal_units) + (coalesce(v_rule.full_commission_paise, 0) * v_full_units))
      where id = v_sale_record.id;

      if cardinality(v_full_cycles) > 0 then
        insert into public.full_commission_rewards
          (tenant_id, company_id, salesman_id, sale_id, product_id, product_name_snapshot, cycle_number, amount_paise, created_at, status)
        select v_product.tenant_id, v_product.company_id, p_salesman_id, v_sale_record.id, v_sale_item.product_id,
          v_product.name, cycle_no, v_rule.full_commission_paise, v_sale_record.created_at, 'earned'
        from unnest(v_full_cycles) cycle_no;
      end if;
    end loop;

    -- Save progress (offer products only)
    if v_rule.offer_enabled then
      update public.commission_progress
        set normal_sales_completed = v_progress.normal_sales_completed, cycle_number = v_cycle, updated_at = now()
        where salesman_id = p_salesman_id and product_id = v_sale_item.product_id;
    end if;

  end loop;

  -- 4. Re-calculate affected day closures
  for v_affected_session in select distinct unnest(v_affected_sessions) loop
    select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', product_id, 'product', product_name_snapshot, 'picked', picked_quantity,
      'sold', sold_quantity, 'remaining', remaining_quantity
    ) order by product_name_snapshot), '[]'::jsonb)
    into v_product_summary from public.day_stock_items where day_session_id = v_affected_session;

    select coalesce(string_agg(format('• %s — Picked %s / Sold %s', x->>'product', x->>'picked', x->>'sold'), E'\n'), '-')
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

revoke all on function public.historical_data_entry_atomic(uuid, date, jsonb, jsonb) from public, anon;
grant execute on function public.historical_data_entry_atomic(uuid, date, jsonb, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. reset_day_atomic (rule-aware progress rebuild; no-offer products untouched)
--    Replaces the hardcoded threshold 12 with each product's current rule.
-- ---------------------------------------------------------------------------
create or replace function public.reset_day_atomic(
  p_salesman_id uuid,
  p_session_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.day_sessions;
  v_sale_product record;
  v_later_exists boolean;
  v_has_received_offers boolean;
  v_remaining_qty bigint;
  v_offer_enabled boolean;
  v_rule_threshold integer;
begin
  -- 1. Lock salesman session
  perform pg_advisory_xact_lock(hashtextextended('day:' || p_salesman_id::text, 0));

  select * into v_session from public.day_sessions
    where id = p_session_id and salesman_id = p_salesman_id for update;

  if not found then
    raise exception 'day_session_not_found' using errcode = 'P0002';
  end if;

  if v_session.status <> 'OPEN' then
    raise exception 'only_active_days_can_be_reset' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.day_sessions
      where salesman_id = p_salesman_id and business_date > v_session.business_date
  ) into v_later_exists;

  if v_later_exists then
    raise exception 'newer_session_exists' using errcode = '22023';
  end if;

  -- 2. Block reset if session contains RECEIVED offers
  select exists (
    select 1 from public.full_commission_rewards r
    join public.sales s on s.id = r.sale_id
    where s.day_session_id = p_session_id and upper(r.status) = 'RECEIVED'
  ) into v_has_received_offers;

  if v_has_received_offers then
    raise exception 'Cannot reset a day that contains received offers. Please undo or resolve received offers first.' using errcode = '22023';
  end if;

  -- 3. Identify products sold during this session for commission rollback
  create temp table _affected_products on commit drop as
    select distinct s.product_id
    from public.sales s
    where s.day_session_id = p_session_id and s.status = 'completed';

  -- 4. Delete linked session records
  delete from public.full_commission_rewards where sale_id in (select id from public.sales where day_session_id = p_session_id);
  delete from public.sales where day_session_id = p_session_id;
  delete from public.day_expenses where day_session_id = p_session_id;
  delete from public.day_stock_items where day_session_id = p_session_id;
  delete from public.day_reopens where day_session_id = p_session_id;
  delete from public.day_closures where salesman_id = p_salesman_id and business_date = v_session.business_date;

  -- 5. Delete the active day session
  delete from public.day_sessions where id = p_session_id;

  -- 6. Authoritative Commission Rollback: Rebuild progress from remaining chronological sales
  for v_sale_product in (select product_id from _affected_products) loop
    select offer_enabled, reward_threshold into v_offer_enabled, v_rule_threshold
      from public.commission_rules where product_id = v_sale_product.product_id and valid_to is null;

    if v_offer_enabled then
      select coalesce(sum(s.quantity), 0) into v_remaining_qty
      from public.sales s
      where s.salesman_id = p_salesman_id
        and s.product_id = v_sale_product.product_id
        and s.status = 'completed';

      update public.commission_progress
      set normal_sales_completed = (v_remaining_qty % v_rule_threshold)::integer,
          cycle_number = (v_remaining_qty / v_rule_threshold) + 1,
          updated_at = now()
      where salesman_id = p_salesman_id and product_id = v_sale_product.product_id;
    end if;
  end loop;

  -- 7. Audit log
  insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_session.tenant_id, v_session.company_id, auth.uid(), 'day.reset', 'day_session',
      p_session_id, jsonb_build_object('business_date', v_session.business_date));
end;
$$;

revoke all on function public.reset_day_atomic(uuid, uuid) from public, anon;
grant execute on function public.reset_day_atomic(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. list_product_management_atomic (offer_enabled + nullable offer fields)
-- ---------------------------------------------------------------------------
create or replace function public.list_product_management_atomic(
  p_company_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is not null and not exists (
    select 1 from public.salesmen where company_id = p_company_id and user_id = auth.uid() and active
  ) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'code', p.code,
      'name', p.name,
      'selling_price_paise', p.selling_price_paise,
      'active', p.active,
      'sort_order', p.sort_order,
      'created_at', p.created_at,
      'offer_enabled', coalesce(r.offer_enabled, true),
      'normal_commission_paise', coalesce(r.normal_commission_paise, 0),
      'full_commission_paise', r.full_commission_paise,
      'reward_threshold', r.reward_threshold,
      'rule_id', r.id,
      'rule_valid_from', r.valid_from,
      'usage', jsonb_build_object(
        'sales', (select count(*) from public.sales s where s.product_id = p.id),
        'stock_items', (select count(*) from public.day_stock_items d where d.product_id = p.id),
        'progress', (select count(*) from public.commission_progress cp where cp.product_id = p.id),
        'rewards', (select count(*) from public.full_commission_rewards fr where fr.product_id = p.id),
        'closures', (select count(*) from public.day_closures dc
          where dc.product_summary @> jsonb_build_array(jsonb_build_object('product_id', p.id))),
        'audit_logs', (select count(*) from public.audit_logs al
          where (al.entity_type = 'product' and al.entity_id = p.id and al.action not like 'product.%')
             or (al.entity_type <> 'product' and al.metadata @> jsonb_build_object('product_id', p.id)))
      )
    ) order by p.sort_order, p.name),
    '[]'::jsonb)
  into v_result
  from public.products p
  left join lateral (
    select * from public.commission_rules r
    where r.product_id = p.id and r.valid_to is null
    order by r.valid_from desc limit 1
  ) r on true
  where p.company_id = p_company_id;

  return v_result;
end;
$$;

revoke all on function public.list_product_management_atomic(uuid) from public, anon, authenticated;
grant execute on function public.list_product_management_atomic(uuid) to service_role;
