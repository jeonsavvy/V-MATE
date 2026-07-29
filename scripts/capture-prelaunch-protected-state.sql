with protected_records(kind, sort_key, record_fingerprint) as (
  select
    'auth.users',
    account_record.id::text,
    pg_catalog.md5(pg_catalog.to_jsonb(account_record)::text)
  from auth.users account_record
  union all
  select
    'public.characters.prompt',
    character_record.id::text,
    pg_catalog.md5(pg_catalog.jsonb_build_array(
      character_record.id,
      character_record.profile_json,
      character_record.speech_style_json,
      character_record.prompt_profile_json
    )::text)
  from public.characters character_record
  union all
  select
    'public.worlds.prompt',
    world_record.id::text,
    pg_catalog.md5(pg_catalog.jsonb_build_array(
      world_record.id,
      world_record.world_rules_markdown,
      world_record.prompt_profile_json
    )::text)
  from public.worlds world_record
  union all
  select
    'public.rooms.prompt-version',
    room_record.id::text,
    pg_catalog.md5(pg_catalog.jsonb_build_array(
      room_record.id,
      room_record.bridge_profile_json,
      room_record.resolved_prompt_snapshot_json,
      room_record.version
    )::text)
  from public.rooms room_record
  union all
  select
    'public.room_state_summaries.state',
    state_record.room_id::text,
    pg_catalog.md5(pg_catalog.to_jsonb(state_record)::text)
  from public.room_state_summaries state_record
  union all
  select
    'public.room_messages.first-greeting',
    message_record.room_id::text || ':' || message_record.id::text,
    pg_catalog.md5(pg_catalog.jsonb_build_array(
      message_record.id,
      message_record.room_id,
      message_record.role,
      message_record.sequence_no,
      message_record.content_json
    )::text)
  from public.room_messages message_record
  where message_record.role = 'assistant'
    and message_record.sequence_no = 1
  union all
  select
    'storage.objects.key-metadata',
    object_record.bucket_id || ':' || object_record.name || ':' || object_record.id::text,
    pg_catalog.md5((
      pg_catalog.to_jsonb(object_record)
      - array['created_at', 'updated_at', 'last_accessed_at']
    )::text)
  from storage.objects object_record
)
select pg_catalog.md5(coalesce(
  pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_array(kind, sort_key, record_fingerprint)
    order by kind, sort_key
  )::text,
  '[]'
)) as protected_state_fingerprint
from protected_records;
