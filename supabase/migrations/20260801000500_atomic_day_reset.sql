begin;

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
  v_sale record;
  v_later_exists boolean;
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

  -- 2. Roll back commission progress for each sale in this session
  for v_sale in (
    select s.product_id, sum(s.quantity) as total_qty
    from public.sales s
    where s.day_session_id = p_session_id and s.status = 'completed'
    group by s.product_id
  ) loop
    update public.commission_progress
    set normal_sales_completed = greatest(0, normal_sales_completed - v_sale.total_qty),
        updated_at = now()
    where salesman_id = p_salesman_id and product_id = v_sale.product_id;
  end loop;

  -- 3. Delete linked session records
  delete from public.full_commission_rewards where sale_id in (select id from public.sales where day_session_id = p_session_id);
  delete from public.sales where day_session_id = p_session_id;
  delete from public.day_expenses where day_session_id = p_session_id;
  delete from public.day_stock_items where day_session_id = p_session_id;
  delete from public.day_reopens where day_session_id = p_session_id;
  delete from public.day_closures where salesman_id = p_salesman_id and business_date = v_session.business_date;

  -- 4. Delete the active day session
  delete from public.day_sessions where id = p_session_id;

  -- 5. Audit log
  insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_session.tenant_id, v_session.company_id, auth.uid(), 'day.reset', 'day_session',
      p_session_id, jsonb_build_object('business_date', v_session.business_date));
end;
$$;

commit;
