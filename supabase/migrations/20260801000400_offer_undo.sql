-- Migration: Add Undo Offer Received Atomic RPC
create or replace function public.undo_offer_received_atomic(
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
  if v_reward.status = 'earned' then return v_reward; end if;
  if v_reward.status = 'void' then raise exception 'reward_void' using errcode = '22023'; end if;

  update public.full_commission_rewards 
    set status = 'earned', received_at = null 
    where id = p_reward_id returning * into v_reward;

  insert into public.audit_logs (tenant_id, company_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_reward.tenant_id, v_reward.company_id, auth.uid(), 'offer.undo_received', 'full_commission_reward',
      v_reward.id, jsonb_build_object('undone_at', now()));
      
  return v_reward;
end;
$$;

revoke all on function public.undo_offer_received_atomic(uuid, uuid) from public;
grant execute on function public.undo_offer_received_atomic(uuid, uuid) to authenticated, service_role;
