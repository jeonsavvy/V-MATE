-- Apply only after the v2 Worker is serving production traffic.
-- Roll back the Worker forward; do not restore these direct mutation grants.

revoke all on function public.reserve_daily_chat_message(text, integer) from public, anon, authenticated;
revoke all on function public.complete_daily_chat_message(text, jsonb) from public, anon, authenticated;
revoke all on function public.refund_daily_chat_message(text, integer) from public, anon, authenticated;

revoke insert, update, delete on public.characters from anon, authenticated;
revoke insert, update, delete on public.worlds from anon, authenticated;
revoke insert, update, delete on public.character_assets from anon, authenticated;
revoke insert, update, delete on public.world_assets from anon, authenticated;
revoke insert, update, delete on public.rooms from anon, authenticated;
revoke insert, update, delete on public.room_messages from anon, authenticated;
revoke insert, update, delete on public.room_state_summaries from anon, authenticated;

drop policy if exists "Users can insert their own characters" on public.characters;
drop policy if exists "Users can update their own characters" on public.characters;
drop policy if exists "Users can delete their own characters" on public.characters;
drop policy if exists "Owner users can manage all characters" on public.characters;
drop policy if exists "Users can insert their own worlds" on public.worlds;
drop policy if exists "Users can update their own worlds" on public.worlds;
drop policy if exists "Users can delete their own worlds" on public.worlds;
drop policy if exists "Owner users can manage all worlds" on public.worlds;
drop policy if exists "Users can insert their own character assets" on public.character_assets;
drop policy if exists "Users can update their own character assets" on public.character_assets;
drop policy if exists "Users can delete their own character assets" on public.character_assets;
drop policy if exists "Users can insert their own world assets" on public.world_assets;
drop policy if exists "Users can update their own world assets" on public.world_assets;
drop policy if exists "Users can delete their own world assets" on public.world_assets;
drop policy if exists "Users can insert their own rooms" on public.rooms;
drop policy if exists "Users can update their own rooms" on public.rooms;
drop policy if exists "Users can insert messages in their own rooms" on public.room_messages;
drop policy if exists "Users can write room state summaries in their own rooms" on public.room_state_summaries;

drop policy if exists "Authenticated users can upload vmate assets to their own folder" on storage.objects;
drop policy if exists "Authenticated users can update vmate assets in their own folder" on storage.objects;
drop policy if exists "Authenticated users can delete vmate assets in their own folder" on storage.objects;

revoke all on function public.reserve_chat_message_v2(uuid, text, uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_legacy_chat_message_v2(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.refund_chat_message_v2(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.create_room_v2(uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.commit_room_turn_v2(uuid, uuid, text, text, bigint, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.reconcile_expired_chat_reservations_v2(integer) from public, anon, authenticated;
grant execute on function public.reserve_chat_message_v2(uuid, text, uuid, text, text, integer, integer) to service_role;
grant execute on function public.complete_legacy_chat_message_v2(uuid, text, text, jsonb) to service_role;
grant execute on function public.refund_chat_message_v2(uuid, text, text, integer) to service_role;
grant execute on function public.create_room_v2(uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.commit_room_turn_v2(uuid, uuid, text, text, bigint, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.reconcile_expired_chat_reservations_v2(integer) to service_role;
