begin;

create extension if not exists pgcrypto;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table public.salesmen (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  company_id uuid not null references public.companies(id),
  user_id uuid references auth.users(id),
  display_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  company_id uuid not null references public.companies(id),
  code text not null,
  name text not null,
  selling_price_paise bigint not null check (selling_price_paise >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  company_id uuid not null references public.companies(id),
  product_id uuid not null references public.products(id),
  normal_commission_paise bigint not null check (normal_commission_paise >= 0),
  full_commission_paise bigint not null check (full_commission_paise >= 0),
  reward_threshold integer not null default 12 check (reward_threshold > 0),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from)
);
create unique index commission_rules_current_idx on public.commission_rules(product_id) where valid_to is null;

create table public.commission_progress (
  tenant_id uuid not null references public.tenants(id),
  company_id uuid not null references public.companies(id),
  salesman_id uuid not null references public.salesmen(id),
  product_id uuid not null references public.products(id),
  normal_sales_completed integer not null default 0 check (normal_sales_completed >= 0),
  cycle_number bigint not null default 1 check (cycle_number > 0),
  updated_at timestamptz not null default now(),
  primary key (salesman_id, product_id)
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  company_id uuid not null references public.companies(id),
  salesman_id uuid not null references public.salesmen(id),
  idempotency_key uuid not null,
  product_id uuid not null references public.products(id),
  product_name_snapshot text not null,
  quantity integer not null check (quantity > 0 and quantity <= 999),
  unit_selling_price_paise bigint not null,
  normal_commission_paise_snapshot bigint not null,
  full_commission_paise_snapshot bigint not null,
  reward_threshold_snapshot integer not null,
  normal_commission_units integer not null,
  full_commission_units integer not null,
  gross_sales_paise bigint not null,
  total_normal_commission_paise bigint not null,
  total_full_commission_paise bigint not null,
  total_earnings_paise bigint not null,
  net_collection_paise bigint not null,
  status text not null default 'completed' check (status in ('completed','cancelled')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salesman_id, idempotency_key)
);

create table public.full_commission_rewards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  company_id uuid not null references public.companies(id),
  salesman_id uuid not null references public.salesmen(id),
  sale_id uuid not null references public.sales(id),
  product_id uuid not null references public.products(id),
  product_name_snapshot text not null,
  cycle_number bigint not null,
  amount_paise bigint not null,
  status text not null default 'earned' check (status in ('earned','void')),
  notes text,
  created_at timestamptz not null default now(),
  unique (salesman_id, product_id, cycle_number)
);

create table public.day_closures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  company_id uuid not null references public.companies(id),
  salesman_id uuid not null references public.salesmen(id),
  business_date date not null,
  product_summary jsonb not null default '[]'::jsonb,
  total_units integer not null,
  gross_sales_paise bigint not null,
  total_normal_commission_paise bigint not null,
  total_full_commission_paise bigint not null,
  total_earnings_paise bigint not null,
  net_collection_paise bigint not null,
  report_text text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (salesman_id, business_date)
);

create table public.app_settings (
  company_id uuid primary key references public.companies(id),
  tenant_id uuid not null references public.tenants(id),
  business_name text not null,
  whatsapp_report_number text not null default '',
  currency text not null default 'INR',
  locale text not null default 'en-IN',
  timezone text not null default 'Asia/Kolkata',
  realtime_enabled boolean not null default true,
  theme jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  company_id uuid not null references public.companies(id),
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index sales_scope_date_idx on public.sales(company_id, salesman_id, created_at desc);
create index rewards_scope_date_idx on public.full_commission_rewards(company_id, salesman_id, created_at desc);
create index audit_scope_date_idx on public.audit_logs(company_id, created_at desc);
create index progress_company_idx on public.commission_progress(company_id, salesman_id);

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
  v_sale public.sales;
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

  select * into v_product from public.products where id = p_product_id and active for share;
  if not found then raise exception 'product_not_found' using errcode = 'P0002'; end if;
  select * into v_rule from public.commission_rules where product_id = p_product_id and valid_to is null for share;
  if not found then raise exception 'commission_rule_not_found' using errcode = 'P0002'; end if;
  select * into v_progress from public.commission_progress
    where salesman_id = p_salesman_id and product_id = p_product_id for update;
  if not found then
    insert into public.commission_progress
      (tenant_id, company_id, salesman_id, product_id)
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
    tenant_id, company_id, salesman_id, idempotency_key, product_id, product_name_snapshot, quantity,
    unit_selling_price_paise, normal_commission_paise_snapshot, full_commission_paise_snapshot,
    reward_threshold_snapshot, normal_commission_units, full_commission_units, gross_sales_paise,
    total_normal_commission_paise, total_full_commission_paise, total_earnings_paise, net_collection_paise, created_by
  ) values (
    v_product.tenant_id, v_product.company_id, p_salesman_id, p_idempotency_key, p_product_id, v_product.name, p_quantity,
    v_product.selling_price_paise, v_rule.normal_commission_paise, v_rule.full_commission_paise,
    v_rule.reward_threshold, v_normal_units, v_full_units, v_product.selling_price_paise * p_quantity,
    v_rule.normal_commission_paise * v_normal_units, v_rule.full_commission_paise * v_full_units,
    (v_rule.normal_commission_paise * v_normal_units) + (v_rule.full_commission_paise * v_full_units),
    (v_product.selling_price_paise * p_quantity) -
      ((v_rule.normal_commission_paise * v_normal_units) + (v_rule.full_commission_paise * v_full_units)),
    auth.uid()
  ) returning * into v_sale;

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
      jsonb_build_object('quantity', p_quantity, 'normal_units', v_normal_units, 'full_units', v_full_units));
  return v_sale;
end;
$$;

alter table public.tenants enable row level security;
alter table public.companies enable row level security;
alter table public.salesmen enable row level security;
alter table public.products enable row level security;
alter table public.commission_rules enable row level security;
alter table public.commission_progress enable row level security;
alter table public.sales enable row level security;
alter table public.full_commission_rewards enable row level security;
alter table public.day_closures enable row level security;
alter table public.app_settings enable row level security;
alter table public.audit_logs enable row level security;

create or replace function public.current_company_ids() returns setof uuid
language sql stable security definer set search_path = public
as $$ select company_id from public.salesmen where user_id = auth.uid() and active $$;

create policy "members read tenants" on public.tenants for select to authenticated
  using (id in (select tenant_id from public.salesmen where user_id = auth.uid() and active));
create policy "members read companies" on public.companies for select to authenticated
  using (id in (select public.current_company_ids()));
create policy "members read salesmen" on public.salesmen for select to authenticated
  using (company_id in (select public.current_company_ids()));

do $$
declare t text;
begin
  foreach t in array array['products','commission_rules','commission_progress','sales','full_commission_rewards','day_closures','app_settings','audit_logs']
  loop
    execute format('create policy "company members select" on public.%I for select to authenticated using (company_id in (select public.current_company_ids()))', t);
  end loop;
end $$;

revoke all on function public.create_sale_atomic(uuid, uuid, integer, uuid) from public;
grant execute on function public.create_sale_atomic(uuid, uuid, integer, uuid) to authenticated, service_role;

alter publication supabase_realtime add table public.sales;
alter publication supabase_realtime add table public.commission_progress;
alter publication supabase_realtime add table public.full_commission_rewards;
alter publication supabase_realtime add table public.day_closures;

commit;
