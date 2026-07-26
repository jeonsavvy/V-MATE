-- Supabase may grant function execution to API roles through default privileges.
-- Keep callable SECURITY DEFINER functions limited to the roles that own their API contract.

revoke all on function public.has_confirmed_age() from public, anon;
grant execute on function public.has_confirmed_age() to authenticated;

revoke all on function public.apply_content_report_action(uuid, text, text) from public, anon;
grant execute on function public.apply_content_report_action(uuid, text, text) to authenticated;

revoke all on function public.get_daily_chat_quota(integer) from public, anon;
revoke all on function public.reserve_daily_chat_message(text, integer) from public, anon;
revoke all on function public.complete_daily_chat_message(text, jsonb) from public, anon;
revoke all on function public.refund_daily_chat_message(text, integer) from public, anon;
grant execute on function public.get_daily_chat_quota(integer) to authenticated;
grant execute on function public.reserve_daily_chat_message(text, integer) to authenticated;
grant execute on function public.complete_daily_chat_message(text, jsonb) to authenticated;
grant execute on function public.refund_daily_chat_message(text, integer) to authenticated;

-- Trigger functions are invoked by PostgreSQL and are not public RPC endpoints.
revoke all on function public.handle_new_profile() from public, anon, authenticated;
revoke all on function public.validate_content_report_target() from public, anon, authenticated;
revoke all on function public.quarantine_content_after_reports() from public, anon, authenticated;
