begin;

-- 1. Trusted Time
create or replace function public.get_trusted_time()
returns table (server_time timestamptz)
language sql stable
as $$ select now(); $$;
grant execute on function public.get_trusted_time() to authenticated, service_role;

-- 2. Day Closures Schema Updates
alter table public.day_closures drop constraint day_closures_salesman_id_business_date_key;

alter table public.day_closures 
  add column closure_version integer not null default 1 check (closure_version > 0),
  add column status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUPERSEDED')),
  add column whatsapp_report_status text not null default 'CURRENT' check (whatsapp_report_status in ('CURRENT', 'OUTDATED'));

create unique index day_closures_version_idx on public.day_closures(salesman_id, business_date, closure_version);

-- 3. Day Reopens Table
create table public.day_reopens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  company_id uuid not null references public.companies(id),
  salesman_id uuid not null references public.salesmen(id),
  day_session_id uuid not null references public.day_sessions(id),
  reopen_count integer not null check (reopen_count > 0),
  reason text not null,
  original_closed_at timestamptz not null,
  reopened_at timestamptz not null default now(),
  business_date date not null,
  created_by uuid references auth.users(id)
);

create index day_reopens_session_idx on public.day_reopens(day_session_id);
alter table public.day_reopens enable row level security;
create policy "company members select" on public.day_reopens for select to authenticated using (company_id in (select public.current_company_ids()));
alter publication supabase_realtime add table public.day_reopens;

-- 4. Full Commission Rewards (Offers) Updates
alter table public.full_commission_rewards drop constraint full_commission_rewards_status_check;
alter table public.full_commission_rewards 
  add constraint full_commission_rewards_status_check check (status in ('earned', 'received', 'void')),
  add column received_at timestamptz;

-- 5. Mark Offer Received RPC
create or replace function public.mark_offer_received_atomic(
  p_salesman_id uuid,
  p_reward_id uuid
) returns public.full_commission_rewards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reward public.full_commission_rewards;
begin
  if auth.uid() is not null and not exists (
    select 1 from public.salesmen where id = p_salesman_id and user_id = auth.uid() and active
  ) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('reward:' || p_reward_id::text, 0));
  
  select * into v_reward from public.full_commission_rewards
    where id = p_reward_id and salesman_id = p_salesman_id for update;
    
  if not found then raise exception 'reward_not_found' using errcode = 'P0002'; end if;
  if v_reward.status = 'received' then return v_reward; end if;
  if v_reward.status = 'void' then raise exception 'reward_void' using errcode = '22023'; end if;

  update public.full_commission_rewards 
    set status = 'received', received_at = now() 
    where id = p_reward_id returning * into v_reward;

  insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_reward.tenant_id, v_reward.company_id, auth.uid(), 'offer.received', 'full_commission_reward',
      v_reward.id, jsonb_build_object('received_at', v_reward.received_at));
      
  return v_reward;
end;
$$;
revoke all on function public.mark_offer_received_atomic(uuid, uuid) from public;
grant execute on function public.mark_offer_received_atomic(uuid, uuid) to authenticated, service_role;

-- 6. Close Day Atomic Update (with versioning)
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
    total_earnings_paise, net_collection_paise, report_text, closure_version, status, created_by
  ) values (
    v_session.tenant_id, v_session.company_id, v_session.salesman_id, v_session.business_date,
    v_product_summary, v_totals.total_units, v_totals.gross, v_totals.normal, v_totals.full,
    v_totals.earnings, v_totals.net, v_report, v_version, 'ACTIVE', auth.uid()
  );
  
  insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_session.tenant_id, v_session.company_id, auth.uid(), 'day.closed', 'day_session',
      v_session.id, jsonb_build_object('business_date', v_session.business_date, 'closed_at', v_session.closed_at, 'closure_version', v_version));
  return v_session;
end;
$$;

-- 7. Reopen Day Atomic
create or replace function public.reopen_day_atomic(
  p_salesman_id uuid,
  p_reason text
) returns public.day_reopens
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.day_sessions;
  v_reopen public.day_reopens;
  v_reopen_count integer;
  v_timezone text;
begin
  if auth.uid() is not null and not exists (
    select 1 from public.salesmen where id = p_salesman_id and user_id = auth.uid() and active
  ) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('day:' || p_salesman_id::text, 0));
  
  -- Prevent reopening if another session is OPEN
  if exists (select 1 from public.day_sessions where salesman_id = p_salesman_id and status = 'OPEN') then
    raise exception 'previous_day_still_open' using errcode = '23505';
  end if;

  select coalesce(timezone, 'Asia/Kolkata') into v_timezone
    from public.app_settings 
    where company_id = (select company_id from public.salesmen where id = p_salesman_id);
    
  v_timezone := coalesce(v_timezone, 'Asia/Kolkata');

  select * into v_session from public.day_sessions
    where salesman_id = p_salesman_id and business_date = (now() at time zone v_timezone)::date for update;
    
  if not found then raise exception 'session_not_found' using errcode = 'P0002'; end if;
  if v_session.status <> 'CLOSED' then raise exception 'session_not_closed' using errcode = '22023'; end if;

  select coalesce(max(reopen_count), 0) + 1 into v_reopen_count 
    from public.day_reopens 
    where day_session_id = v_session.id;

  insert into public.day_reopens (
    tenant_id, company_id, salesman_id, day_session_id, reopen_count, reason, original_closed_at, business_date, created_by
  ) values (
    v_session.tenant_id, v_session.company_id, p_salesman_id, v_session.id, v_reopen_count, p_reason, v_session.closed_at, v_session.business_date, auth.uid()
  ) returning * into v_reopen;

  update public.day_sessions set status = 'OPEN', closed_at = null, updated_at = now()
    where id = v_session.id;

  insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_session.tenant_id, v_session.company_id, auth.uid(), 'day.reopened', 'day_session',
      v_session.id, jsonb_build_object('business_date', v_session.business_date, 'reopen_count', v_reopen_count, 'reason', p_reason));
      
  return v_reopen;
end;
$$;
revoke all on function public.reopen_day_atomic(uuid, text) from public;
grant execute on function public.reopen_day_atomic(uuid, text) to authenticated, service_role;

-- 8. Additional Pickup Atomic
create or replace function public.additional_pickup_atomic(
  p_salesman_id uuid,
  p_items jsonb,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.day_sessions;
  v_item record;
  v_stock public.day_stock_items;
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
  
  -- Must have reopened
  if not exists (select 1 from public.day_reopens where day_session_id = v_session.id) then
    raise exception 'reopen_required' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_to_recordset(p_items) as item(product_id uuid, additional_quantity integer)
  loop
    if v_item.additional_quantity > 0 then
      select * into v_stock from public.day_stock_items 
        where day_session_id = v_session.id and product_id = v_item.product_id for update;
        
      if not found then raise exception 'product_not_found_in_session' using errcode = 'P0002'; end if;
      
      update public.day_stock_items 
        set picked_quantity = picked_quantity + v_item.additional_quantity,
            remaining_quantity = remaining_quantity + v_item.additional_quantity,
            updated_at = now()
        where id = v_stock.id;
    end if;
  end loop;

  insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_session.tenant_id, v_session.company_id, auth.uid(), 'day.additional_pickup', 'day_session',
      v_session.id, jsonb_build_object('business_date', v_session.business_date, 'reason', p_reason, 'items', p_items));
end;
$$;
revoke all on function public.additional_pickup_atomic(uuid, jsonb, text) from public;
grant execute on function public.additional_pickup_atomic(uuid, jsonb, text) to authenticated, service_role;

commit;
