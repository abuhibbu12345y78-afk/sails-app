-- Remove the reopen_required constraint from additional_pickup_atomic so pickups can be made anytime during the day
drop function if exists public.additional_pickup_atomic(uuid, jsonb, text);

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
  v_stock public.day_stock_items;
  v_item record;
  v_has_updates boolean := false;
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
        
      v_has_updates := true;
    end if;
  end loop;

  if v_has_updates then
    insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
      values (v_session.tenant_id, v_session.company_id, auth.uid(), 'day.additional_pickup', 'day_session',
        v_session.id, jsonb_build_object('items', p_items, 'reason', p_reason));
  end if;
end;
$$;
revoke all on function public.additional_pickup_atomic(uuid, jsonb, text) from public;
grant execute on function public.additional_pickup_atomic(uuid, jsonb, text) to authenticated, service_role;
