-- Create day_expenses table
create table public.day_expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
  company_id uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
  salesman_id uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
  day_session_id uuid not null references public.day_sessions(id) on delete restrict,
  category text not null check (category in ('Petrol', 'Food', 'Other')),
  amount_paise integer not null check (amount_paise > 0),
  created_by uuid references auth.users(id),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index day_expenses_session_idx on public.day_expenses (day_session_id, category);

alter table public.day_expenses enable row level security;

create policy "Users can view their company's day expenses" on public.day_expenses
  for select to authenticated using (company_id in (
    select company_id from public.salesmen where user_id = auth.uid() and active = true
  ));

create policy "Users can insert their company's day expenses" on public.day_expenses
  for insert to authenticated with check (company_id in (
    select company_id from public.salesmen where user_id = auth.uid() and active = true
  ));

create policy "Users can delete their company's day expenses" on public.day_expenses
  for delete to authenticated using (company_id in (
    select company_id from public.salesmen where user_id = auth.uid() and active = true
  ));

-- Add total_expenses_paise to day_closures
alter table public.day_closures add column total_expenses_paise bigint not null default 0;

-- Update close_day_atomic
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
  v_version integer;
  v_total_expenses_paise bigint;
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

  select coalesce(sum(amount_paise), 0)::bigint
  into v_total_expenses_paise from public.day_expenses where day_session_id = v_session.id;

  v_totals.net := v_totals.net - v_total_expenses_paise;

  v_report := format(E'Sales Summary\n\nDate: %s\n\nGross Sales: %s\nNormal Commission: %s\nFull Commission: %s\nTotal Earnings: %s\nTotal Expenses: %s\nNet Collection: %s',
    v_session.business_date, v_totals.gross, v_totals.normal, v_totals.full, v_totals.earnings, v_total_expenses_paise, v_totals.net);

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
