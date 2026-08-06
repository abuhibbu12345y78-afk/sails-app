-- Migration: Database-driven Product Management
-- Adds atomic RPCs for product CRUD (create/update/enable/disable/safe-delete),
-- commission rule versioning (close current version, open a new one), audit history,
-- and a management listing with live dependency counts.
-- Non-destructive: no table changes, no data migration, no index drops.
-- New RPCs are service_role-only (anon/authenticated have NO execute).

-- ---------------------------------------------------------------------------
-- 1. upsert_product_atomic
--    p_product_id = NULL  -> create a new product (generates a unique code)
--    p_product_id = uuid  -> update name/price/commissions/active/sort_order
--    Commission changes close the current rule (valid_to = now()) and open a
--    new version (valid_from = now()); historical sales keep their snapshots.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_product_atomic(
  p_product_id uuid,
  p_tenant_id uuid,
  p_company_id uuid,
  p_name text,
  p_selling_price_paise bigint,
  p_normal_commission_paise bigint,
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
  if p_selling_price_paise is null or p_selling_price_paise < 0 or p_selling_price_paise > 999999900 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  if p_normal_commission_paise is null or p_normal_commission_paise < 0 or p_normal_commission_paise > p_selling_price_paise then
    raise exception 'invalid_normal_commission' using errcode = '22023';
  end if;
  if p_full_commission_paise is null or p_full_commission_paise < 0 or p_full_commission_paise > 999999900 then
    raise exception 'invalid_full_commission' using errcode = '22023';
  end if;
  if p_reward_threshold is null or p_reward_threshold < 1 or p_reward_threshold > 999 then
    raise exception 'invalid_reward_threshold' using errcode = '22023';
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
      (tenant_id, company_id, product_id, normal_commission_paise, full_commission_paise, reward_threshold)
      values (p_tenant_id, p_company_id, v_product.id, p_normal_commission_paise, p_full_commission_paise, p_reward_threshold)
      returning * into v_rule;

    insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
      values (p_tenant_id, p_company_id, auth.uid(), 'product.created', 'product', v_product.id,
        jsonb_build_object('code', v_product.code, 'name', v_product.name, 'selling_price_paise', p_selling_price_paise,
          'normal_commission_paise', p_normal_commission_paise, 'full_commission_paise', p_full_commission_paise,
          'reward_threshold', p_reward_threshold, 'reason', coalesce(nullif(trim(p_reason), ''), null)));
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
      (tenant_id, company_id, product_id, normal_commission_paise, full_commission_paise, reward_threshold)
      values (v_product.tenant_id, v_product.company_id, v_product.id, p_normal_commission_paise, p_full_commission_paise, p_reward_threshold)
      returning * into v_rule;
    v_rule_created := true;
    v_changed := v_changed || jsonb_build_object('commission', jsonb_build_array(null,
      jsonb_build_object('normal_commission_paise', p_normal_commission_paise, 'full_commission_paise', p_full_commission_paise, 'reward_threshold', p_reward_threshold)));
  elsif v_rule.normal_commission_paise <> p_normal_commission_paise
      or v_rule.full_commission_paise <> p_full_commission_paise
      or v_rule.reward_threshold <> p_reward_threshold then
    update public.commission_rules set valid_to = now() where id = v_rule.id;
    insert into public.commission_rules
      (tenant_id, company_id, product_id, normal_commission_paise, full_commission_paise, reward_threshold, valid_from)
      values (v_product.tenant_id, v_product.company_id, v_product.id, p_normal_commission_paise, p_full_commission_paise, p_reward_threshold, now())
      returning * into v_rule;
    v_rule_created := true;
    v_changed := v_changed || jsonb_build_object('commission',
      jsonb_build_array(jsonb_build_object('normal_commission_paise', v_rule.normal_commission_paise,
        'full_commission_paise', v_rule.full_commission_paise, 'reward_threshold', v_rule.reward_threshold),
      jsonb_build_object('normal_commission_paise', p_normal_commission_paise,
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

-- ---------------------------------------------------------------------------
-- 2. delete_product_atomic
--    Safe delete: blocked when the product is referenced by any business
--    record (sales, day stock, commission progress, rewards, day closures,
--    audit logs). Returns a jsonb result instead of raising, so the caller
--    can present the exact dependency counts.
-- ---------------------------------------------------------------------------
create or replace function public.delete_product_atomic(
  p_product_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products;
  v_sales bigint;
  v_stock bigint;
  v_progress bigint;
  v_rewards bigint;
  v_closures bigint;
  v_audit bigint;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found then raise exception 'product_not_found' using errcode = 'P0002'; end if;

  if auth.uid() is not null and not exists (
    select 1 from public.salesmen where company_id = v_product.company_id and user_id = auth.uid() and active
  ) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  select count(*) into v_sales from public.sales where product_id = p_product_id;
  select count(*) into v_stock from public.day_stock_items where product_id = p_product_id;
  select count(*) into v_progress from public.commission_progress where product_id = p_product_id;
  select count(*) into v_rewards from public.full_commission_rewards where product_id = p_product_id;
  select count(*) into v_closures from public.day_closures
    where product_summary @> jsonb_build_array(jsonb_build_object('product_id', p_product_id));
  select count(*) into v_audit from public.audit_logs
    where (entity_type = 'product' and entity_id = p_product_id and action not like 'product.%')
       or (entity_type <> 'product' and metadata @> jsonb_build_object('product_id', p_product_id));

  if v_sales > 0 or v_stock > 0 or v_progress > 0 or v_rewards > 0 or v_closures > 0 or v_audit > 0 then
    return jsonb_build_object('deleted', false, 'blocked', true,
      'sales', v_sales, 'stock_items', v_stock, 'progress', v_progress,
      'rewards', v_rewards, 'closures', v_closures, 'audit_logs', v_audit);
  end if;

  delete from public.commission_rules where product_id = p_product_id;
  delete from public.commission_progress where product_id = p_product_id;
  delete from public.products where id = p_product_id;

  insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_product.tenant_id, v_product.company_id, auth.uid(), 'product.deleted', 'product', p_product_id,
      jsonb_build_object('code', v_product.code, 'name', v_product.name,
        'reason', coalesce(nullif(trim(p_reason), ''), null)));

  return jsonb_build_object('deleted', true, 'blocked', false,
    'sales', 0, 'stock_items', 0, 'progress', 0, 'rewards', 0, 'closures', 0, 'audit_logs', 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. list_product_management_atomic
--    Returns all products (active and inactive) with the current rule and
--    live dependency counts, ordered by sort_order then name.
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
      'normal_commission_paise', coalesce(r.normal_commission_paise, 0),
      'full_commission_paise', coalesce(r.full_commission_paise, 0),
      'reward_threshold', coalesce(r.reward_threshold, 12),
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

-- ---------------------------------------------------------------------------
-- Grants: service_role only. anon/authenticated get NO execute on these RPCs.
-- ---------------------------------------------------------------------------
revoke all on function public.upsert_product_atomic(uuid, uuid, uuid, text, bigint, bigint, bigint, integer, boolean, integer, text) from public, anon, authenticated;
revoke all on function public.delete_product_atomic(uuid, text) from public, anon, authenticated;
revoke all on function public.list_product_management_atomic(uuid) from public, anon, authenticated;

grant execute on function public.upsert_product_atomic(uuid, uuid, uuid, text, bigint, bigint, bigint, integer, boolean, integer, text) to service_role;
grant execute on function public.delete_product_atomic(uuid, text) to service_role;
grant execute on function public.list_product_management_atomic(uuid) to service_role;
