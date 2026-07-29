begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- A pre-existing schema with this security-sensitive name is an ownership and
-- contents ambiguity. Exact creation makes the first apply fail closed.
create schema vmate_private;
revoke all on schema vmate_private from public, anon, authenticated, service_role;

create table vmate_private.prompt_lockdown_room_state_backup_20260729 (
  room_id uuid primary key,
  room_version_before bigint not null check (room_version_before >= 0),
  current_situation text,
  location text,
  relationship_state text,
  world_notes_json jsonb not null,
  updated_at timestamp with time zone not null
);
create table vmate_private.prompt_lockdown_greeting_backup_20260729 (
  message_id uuid primary key,
  room_id uuid not null,
  room_version_before bigint not null check (room_version_before >= 0),
  role text not null check (role = 'assistant'),
  sequence_no bigint not null check (sequence_no = 1),
  content_json jsonb not null
);
create table vmate_private.prompt_lockdown_backup_manifest_20260729 (
  singleton boolean primary key check (singleton),
  state_count bigint not null check (state_count >= 0),
  greeting_count bigint not null check (greeting_count >= 0),
  state_key_version_hash text not null
    check (state_key_version_hash ~ '^[0-9a-f]{64}$'),
  greeting_key_version_hash text not null
    check (greeting_key_version_hash ~ '^[0-9a-f]{64}$'),
  state_payload_hash text not null
    check (state_payload_hash ~ '^[0-9a-f]{64}$'),
  greeting_payload_hash text not null
    check (greeting_payload_hash ~ '^[0-9a-f]{64}$'),
  captured_at timestamp with time zone not null
);

alter table vmate_private.prompt_lockdown_room_state_backup_20260729
  enable row level security;
alter table vmate_private.prompt_lockdown_greeting_backup_20260729
  enable row level security;
alter table vmate_private.prompt_lockdown_backup_manifest_20260729
  enable row level security;
revoke all on table
  vmate_private.prompt_lockdown_room_state_backup_20260729,
  vmate_private.prompt_lockdown_greeting_backup_20260729,
  vmate_private.prompt_lockdown_backup_manifest_20260729
from public, anon, authenticated, service_role;

create function vmate_private.reject_prompt_lockdown_manifest_mutation_20260729()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'prompt lockdown backup manifest is immutable';
end;
$$;
revoke all on function
  vmate_private.reject_prompt_lockdown_manifest_mutation_20260729()
from public, anon, authenticated, service_role;
create trigger prompt_lockdown_manifest_update_delete_guard_20260729
before update or delete
on vmate_private.prompt_lockdown_backup_manifest_20260729
for each row execute function
  vmate_private.reject_prompt_lockdown_manifest_mutation_20260729();
create trigger prompt_lockdown_manifest_truncate_guard_20260729
before truncate
on vmate_private.prompt_lockdown_backup_manifest_20260729
for each statement execute function
  vmate_private.reject_prompt_lockdown_manifest_mutation_20260729();

-- Parent-first EXCLUSIVE locks stop room commits, child writes, and deletes
-- until the snapshot, scrub, and room-version fence commit together.
lock table public.rooms in exclusive mode;
lock table public.room_state_summaries in exclusive mode;
lock table public.room_messages in exclusive mode;

-- Lockdown phase: apply only after the view-compatible Worker is serving and
-- its public, owner-edit, room, and prompt-context reads have passed smoke tests.
-- Existing authoring JSON remains in place; only direct client privileges move.
revoke select on table public.characters, public.worlds from public, anon, authenticated;
revoke select on table public.rooms from public, anon, authenticated;
revoke select (profile_json, speech_style_json, prompt_profile_json)
  on public.characters from public, anon, authenticated;
revoke select (world_rules_markdown, prompt_profile_json)
  on public.worlds from public, anon, authenticated;
revoke select (bridge_profile_json, resolved_prompt_snapshot_json)
  on public.rooms from public, anon, authenticated;

-- Retain only non-secret base columns needed by existing RLS policy expressions
-- and explicit compatibility reads. Worker public/owner reads use the views.
grant select (
  id, owner_user_id, slug, name, headline, summary, cover_image_url,
  avatar_image_url, visibility, display_status, source_type, source_url, tags,
  favorite_count, chat_start_count, rights_attested_at, published_at,
  created_at, updated_at
) on public.characters to anon, authenticated;
grant select (
  id, owner_user_id, slug, name, headline, summary, cover_image_url,
  visibility, display_status, source_type, source_url, tags, favorite_count,
  chat_start_count, rights_attested_at, published_at, created_at, updated_at
) on public.worlds to anon, authenticated;
grant select (
  id, user_id, character_id, world_id, user_alias, title,
  last_message_at, created_at, updated_at, version
) on public.rooms to authenticated;

-- Earlier room shells could copy creator-only intro, relationship, and world
-- terms into owner-readable state rows. Capture their owning room version so the
-- scrub can invalidate every stale or in-flight commit derived from that state.
insert into vmate_private.prompt_lockdown_room_state_backup_20260729 (
  room_id, room_version_before, current_situation, location,
  relationship_state, world_notes_json, updated_at
)
select
  state.room_id, rooms.version, state.current_situation, state.location,
  state.relationship_state, state.world_notes_json, state.updated_at
from public.room_state_summaries state
join public.rooms rooms on rooms.id = state.room_id;

insert into vmate_private.prompt_lockdown_greeting_backup_20260729 (
  message_id, room_id, room_version_before, role, sequence_no, content_json
)
select
  messages.id, messages.room_id, rooms.version,
  messages.role, messages.sequence_no, messages.content_json
from public.room_messages messages
join public.rooms rooms on rooms.id = messages.room_id
where messages.role = 'assistant' and messages.sequence_no = 1;

insert into vmate_private.prompt_lockdown_backup_manifest_20260729 (
  singleton, state_count, greeting_count,
  state_key_version_hash, greeting_key_version_hash,
  state_payload_hash, greeting_payload_hash, captured_at
)
select
  true,
  (select count(*)
   from vmate_private.prompt_lockdown_room_state_backup_20260729),
  (select count(*)
   from vmate_private.prompt_lockdown_greeting_backup_20260729),
  (select encode(sha256(convert_to(coalesce(string_agg(
     backup.room_id::text || ':' || backup.room_version_before::text,
     E'\n' order by backup.room_id
   ), ''), 'UTF8')), 'hex')
   from vmate_private.prompt_lockdown_room_state_backup_20260729 backup),
  (select encode(sha256(convert_to(coalesce(string_agg(
     backup.message_id::text || ':' || backup.room_id::text || ':'
       || backup.room_version_before::text,
     E'\n' order by backup.message_id
   ), ''), 'UTF8')), 'hex')
   from vmate_private.prompt_lockdown_greeting_backup_20260729 backup),
  (select encode(sha256(convert_to(coalesce(string_agg(
     jsonb_build_array(
       backup.room_id::text,
       backup.room_version_before,
       backup.current_situation,
       backup.location,
       backup.relationship_state,
       backup.world_notes_json,
       extract(epoch from backup.updated_at)
     )::text,
     E'\n' order by backup.room_id
   ), ''), 'UTF8')), 'hex')
   from vmate_private.prompt_lockdown_room_state_backup_20260729 backup),
  (select encode(sha256(convert_to(coalesce(string_agg(
     jsonb_build_array(
       backup.message_id::text,
       backup.room_id::text,
       backup.room_version_before,
       backup.role,
       backup.sequence_no,
       backup.content_json
     )::text,
     E'\n' order by backup.message_id
   ), ''), 'UTF8')), 'hex')
   from vmate_private.prompt_lockdown_greeting_backup_20260729 backup),
  clock_timestamp();

-- Guard both directions and every overwritten value before redaction. The
-- manifest hashes make later backup drift detectable without exposing payloads.
do $$
declare
  manifest vmate_private.prompt_lockdown_backup_manifest_20260729%rowtype;
  source_state_count bigint;
  source_greeting_count bigint;
  source_state_hash text;
  source_greeting_hash text;
  backup_state_count bigint;
  backup_greeting_count bigint;
  backup_state_hash text;
  backup_greeting_hash text;
  backup_state_payload_hash text;
  backup_greeting_payload_hash text;
begin
  if (select count(*) from vmate_private.prompt_lockdown_backup_manifest_20260729) <> 1 then
    raise exception 'prompt lockdown backup manifest cardinality mismatch';
  end if;

  select * into strict manifest
  from vmate_private.prompt_lockdown_backup_manifest_20260729
  where singleton;

  select
    count(*),
    encode(sha256(convert_to(coalesce(string_agg(
      state.room_id::text || ':' || rooms.version::text,
      E'\n' order by state.room_id
    ), ''), 'UTF8')), 'hex')
  into source_state_count, source_state_hash
  from public.room_state_summaries state
  join public.rooms rooms on rooms.id = state.room_id;

  select
    count(*),
    encode(sha256(convert_to(coalesce(string_agg(
      messages.id::text || ':' || messages.room_id::text || ':'
        || rooms.version::text,
      E'\n' order by messages.id
    ), ''), 'UTF8')), 'hex')
  into source_greeting_count, source_greeting_hash
  from public.room_messages messages
  join public.rooms rooms on rooms.id = messages.room_id
  where messages.role = 'assistant' and messages.sequence_no = 1;

  select
    count(*),
    encode(sha256(convert_to(coalesce(string_agg(
      backup.room_id::text || ':' || backup.room_version_before::text,
      E'\n' order by backup.room_id
    ), ''), 'UTF8')), 'hex')
  into backup_state_count, backup_state_hash
  from vmate_private.prompt_lockdown_room_state_backup_20260729 backup;

  select
    count(*),
    encode(sha256(convert_to(coalesce(string_agg(
      backup.message_id::text || ':' || backup.room_id::text || ':'
        || backup.room_version_before::text,
      E'\n' order by backup.message_id
    ), ''), 'UTF8')), 'hex')
  into backup_greeting_count, backup_greeting_hash
  from vmate_private.prompt_lockdown_greeting_backup_20260729 backup;

  select encode(sha256(convert_to(coalesce(string_agg(
    jsonb_build_array(
      backup.room_id::text,
      backup.room_version_before,
      backup.current_situation,
      backup.location,
      backup.relationship_state,
      backup.world_notes_json,
      extract(epoch from backup.updated_at)
    )::text,
    E'\n' order by backup.room_id
  ), ''), 'UTF8')), 'hex')
  into backup_state_payload_hash
  from vmate_private.prompt_lockdown_room_state_backup_20260729 backup;

  select encode(sha256(convert_to(coalesce(string_agg(
    jsonb_build_array(
      backup.message_id::text,
      backup.room_id::text,
      backup.room_version_before,
      backup.role,
      backup.sequence_no,
      backup.content_json
    )::text,
    E'\n' order by backup.message_id
  ), ''), 'UTF8')), 'hex')
  into backup_greeting_payload_hash
  from vmate_private.prompt_lockdown_greeting_backup_20260729 backup;

  if manifest.captured_at < transaction_timestamp()
    or manifest.captured_at > clock_timestamp()
    or manifest.state_count is distinct from source_state_count
    or manifest.greeting_count is distinct from source_greeting_count
    or manifest.state_key_version_hash is distinct from source_state_hash
    or manifest.greeting_key_version_hash is distinct from source_greeting_hash
    or manifest.state_count is distinct from backup_state_count
    or manifest.greeting_count is distinct from backup_greeting_count
    or manifest.state_key_version_hash is distinct from backup_state_hash
    or manifest.greeting_key_version_hash is distinct from backup_greeting_hash
    or manifest.state_payload_hash is distinct from backup_state_payload_hash
    or manifest.greeting_payload_hash is distinct from backup_greeting_payload_hash then
    raise exception 'prompt lockdown backup manifest parity mismatch';
  end if;

  if exists (
    select 1
    from public.room_state_summaries source
    full join vmate_private.prompt_lockdown_room_state_backup_20260729 backup
      on backup.room_id = source.room_id
    left join public.rooms rooms
      on rooms.id = coalesce(source.room_id, backup.room_id)
    where source.room_id is null
      or backup.room_id is null
      or backup.room_version_before is distinct from rooms.version
      or backup.current_situation is distinct from source.current_situation
      or backup.location is distinct from source.location
      or backup.relationship_state is distinct from source.relationship_state
      or backup.world_notes_json is distinct from source.world_notes_json
      or backup.updated_at is distinct from source.updated_at
  ) then
    raise exception 'prompt lockdown room-state backup payload mismatch';
  end if;

  if exists (
    select 1
    from (
      select id, room_id, role, sequence_no, content_json
      from public.room_messages
      where role = 'assistant' and sequence_no = 1
    ) source
    full join vmate_private.prompt_lockdown_greeting_backup_20260729 backup
      on backup.message_id = source.id
    left join public.rooms rooms
      on rooms.id = coalesce(source.room_id, backup.room_id)
    where source.id is null
      or backup.message_id is null
      or backup.room_id is distinct from source.room_id
      or backup.room_version_before is distinct from rooms.version
      or backup.role is distinct from source.role
      or backup.sequence_no is distinct from source.sequence_no
      or backup.content_json is distinct from source.content_json
  ) then
    raise exception 'prompt lockdown greeting backup payload mismatch';
  end if;
end;
$$;

update public.room_state_summaries target
set
  current_situation = '대화를 이어가고 있습니다.',
  location = '대화 공간',
  relationship_state = '처음 대화를 시작하는 거리감',
  world_notes_json = '[]'::jsonb,
  updated_at = manifest.captured_at
from vmate_private.prompt_lockdown_backup_manifest_20260729 manifest
where manifest.singleton;

update public.room_messages
set content_json = jsonb_build_object(
  'emotion', 'normal',
  'inner_heart', '',
  'response', '대화를 시작합니다.',
  'narration', ''
)
where role = 'assistant' and sequence_no = 1;

-- Each affected room receives one version fence even when it has both source
-- row kinds. Matching the captured version makes a partial bump fail closed.
do $$
declare
  expected_room_count bigint;
  bumped_room_count bigint;
begin
  select count(*) into expected_room_count
  from (
    select room_id, room_version_before
    from vmate_private.prompt_lockdown_room_state_backup_20260729
    union
    select room_id, room_version_before
    from vmate_private.prompt_lockdown_greeting_backup_20260729
  ) affected;

  with affected as (
    select room_id, room_version_before
    from vmate_private.prompt_lockdown_room_state_backup_20260729
    union
    select room_id, room_version_before
    from vmate_private.prompt_lockdown_greeting_backup_20260729
  ), bumped as (
    update public.rooms target
    set version = affected.room_version_before + 1
    from affected
    where target.id = affected.room_id
      and target.version = affected.room_version_before
    returning target.id
  )
  select count(*) into bumped_room_count from bumped;

  if bumped_room_count is distinct from expected_room_count
    or exists (
      select 1
      from (
        select room_id, room_version_before
        from vmate_private.prompt_lockdown_room_state_backup_20260729
        union
        select room_id, room_version_before
        from vmate_private.prompt_lockdown_greeting_backup_20260729
      ) affected
      join public.rooms rooms on rooms.id = affected.room_id
      where rooms.version is distinct from affected.room_version_before + 1
    ) then
    raise exception 'prompt lockdown room-version fence mismatch';
  end if;
end;
$$;

do $$
declare
  scrub_captured_at timestamp with time zone;
begin
  select captured_at into strict scrub_captured_at
  from vmate_private.prompt_lockdown_backup_manifest_20260729
  where singleton;

  if exists (
    select 1
    from vmate_private.prompt_lockdown_room_state_backup_20260729 backup
    join public.room_state_summaries state on state.room_id = backup.room_id
    where state.current_situation is distinct from '대화를 이어가고 있습니다.'
      or state.location is distinct from '대화 공간'
      or state.relationship_state is distinct from '처음 대화를 시작하는 거리감'
      or state.world_notes_json is distinct from '[]'::jsonb
      or state.updated_at is distinct from scrub_captured_at
  ) or exists (
    select 1
    from vmate_private.prompt_lockdown_greeting_backup_20260729 backup
    join public.room_messages messages on messages.id = backup.message_id
    where messages.content_json is distinct from jsonb_build_object(
      'emotion', 'normal',
      'inner_heart', '',
      'response', '대화를 시작합니다.',
      'narration', ''
    )
  ) then
    raise exception 'prompt lockdown scrub verification failed';
  end if;
end;
$$;

revoke all on table
  public.public_character_catalog,
  public.public_world_catalog,
  public.owned_character_details,
  public.owned_world_details,
  public.owned_room_summaries
from public, anon, authenticated;
grant select on table public.public_character_catalog, public.public_world_catalog
  to anon, authenticated;
grant select on table public.owned_character_details, public.owned_world_details,
  public.owned_room_summaries
  to authenticated;

grant select on table public.characters, public.worlds, public.rooms to service_role;
grant select on table
  public.public_character_catalog,
  public.public_world_catalog,
  public.owned_character_details,
  public.owned_world_details,
  public.owned_room_summaries
to service_role;

commit;

-- Manual privilege rollback, only to restore an already-deployed old Worker:
--   begin;
--   grant select on public.characters, public.worlds to anon, authenticated;
--   grant select on public.rooms to authenticated;
--   commit;
-- This temporarily restores the original disclosure surface. Keep the safe
-- views, roll the Worker forward again, and reapply lockdown as soon as possible.

-- Conditional forward restore. It restores only an unchanged scrub sentinel at
-- version before + 1, then increments the room version again. Verify the
-- manifest against both backup tables before running these statements.
--   begin;
--   set local lock_timeout = '5s';
--   set local statement_timeout = '60s';
--   lock table public.rooms in exclusive mode;
--   lock table public.room_state_summaries in exclusive mode;
--   lock table public.room_messages in exclusive mode;
--
--   do $prompt_restore_guard$
--   declare
--     manifest vmate_private.prompt_lockdown_backup_manifest_20260729%rowtype;
--     state_count bigint;
--     greeting_count bigint;
--     state_hash text;
--     greeting_hash text;
--     state_payload_hash text;
--     greeting_payload_hash text;
--   begin
--     if (select count(*) from vmate_private.prompt_lockdown_backup_manifest_20260729) <> 1 then
--       raise exception 'prompt lockdown backup manifest cardinality mismatch';
--     end if;
--     select * into strict manifest
--     from vmate_private.prompt_lockdown_backup_manifest_20260729
--     where singleton;
--     select count(*), encode(sha256(convert_to(coalesce(string_agg(
--       backup.room_id::text || ':' || backup.room_version_before::text,
--       E'\n' order by backup.room_id
--     ), ''), 'UTF8')), 'hex')
--     into state_count, state_hash
--     from vmate_private.prompt_lockdown_room_state_backup_20260729 backup;
--     select count(*), encode(sha256(convert_to(coalesce(string_agg(
--       backup.message_id::text || ':' || backup.room_id::text || ':'
--         || backup.room_version_before::text,
--       E'\n' order by backup.message_id
--     ), ''), 'UTF8')), 'hex')
--     into greeting_count, greeting_hash
--     from vmate_private.prompt_lockdown_greeting_backup_20260729 backup;
--     select encode(sha256(convert_to(coalesce(string_agg(
--       jsonb_build_array(
--         backup.room_id::text,
--         backup.room_version_before,
--         backup.current_situation,
--         backup.location,
--         backup.relationship_state,
--         backup.world_notes_json,
--         extract(epoch from backup.updated_at)
--       )::text,
--       E'\n' order by backup.room_id
--     ), ''), 'UTF8')), 'hex')
--     into state_payload_hash
--     from vmate_private.prompt_lockdown_room_state_backup_20260729 backup;
--     select encode(sha256(convert_to(coalesce(string_agg(
--       jsonb_build_array(
--         backup.message_id::text,
--         backup.room_id::text,
--         backup.room_version_before,
--         backup.role,
--         backup.sequence_no,
--         backup.content_json
--       )::text,
--       E'\n' order by backup.message_id
--     ), ''), 'UTF8')), 'hex')
--     into greeting_payload_hash
--     from vmate_private.prompt_lockdown_greeting_backup_20260729 backup;
--     if manifest.state_count is distinct from state_count
--       or manifest.greeting_count is distinct from greeting_count
--       or manifest.state_key_version_hash is distinct from state_hash
--       or manifest.greeting_key_version_hash is distinct from greeting_hash
--       or manifest.state_payload_hash is distinct from state_payload_hash
--       or manifest.greeting_payload_hash is distinct from greeting_payload_hash then
--       raise exception 'prompt lockdown backup manifest parity mismatch';
--     end if;
--   end;
--   $prompt_restore_guard$;
--
--   create temporary table prompt_lockdown_restored_rooms_20260729 (
--     room_id uuid primary key,
--     room_version_before bigint not null
--   ) on commit drop;
--
--   with restored as (
--     update public.room_state_summaries target
--     set
--       current_situation = backup.current_situation,
--       location = backup.location,
--       relationship_state = backup.relationship_state,
--       world_notes_json = backup.world_notes_json,
--       updated_at = backup.updated_at
--     from vmate_private.prompt_lockdown_room_state_backup_20260729 backup,
--       vmate_private.prompt_lockdown_backup_manifest_20260729 manifest,
--       public.rooms rooms
--     where manifest.singleton
--       and target.room_id = backup.room_id
--       and rooms.id = backup.room_id
--       and rooms.version = backup.room_version_before + 1
--       and target.current_situation = '대화를 이어가고 있습니다.'
--       and target.location = '대화 공간'
--       and target.relationship_state = '처음 대화를 시작하는 거리감'
--       and target.world_notes_json = '[]'::jsonb
--       and target.updated_at = manifest.captured_at
--     returning target.room_id
--   )
--   insert into prompt_lockdown_restored_rooms_20260729 (
--     room_id, room_version_before
--   )
--   select restored.room_id, backup.room_version_before
--   from restored
--   join vmate_private.prompt_lockdown_room_state_backup_20260729 backup
--     on backup.room_id = restored.room_id;
--
--   with restored as (
--     update public.room_messages target
--     set content_json = backup.content_json
--     from vmate_private.prompt_lockdown_greeting_backup_20260729 backup,
--       public.rooms rooms
--     where target.id = backup.message_id
--       and target.room_id = backup.room_id
--       and target.role = backup.role
--       and target.sequence_no = backup.sequence_no
--       and rooms.id = backup.room_id
--       and rooms.version = backup.room_version_before + 1
--       and target.content_json = jsonb_build_object(
--         'emotion', 'normal',
--         'inner_heart', '',
--         'response', '대화를 시작합니다.',
--         'narration', ''
--       )
--     returning target.room_id
--   )
--   insert into prompt_lockdown_restored_rooms_20260729 (
--     room_id, room_version_before
--   )
--   select restored.room_id, backup.room_version_before
--   from restored
--   join vmate_private.prompt_lockdown_greeting_backup_20260729 backup
--     on backup.room_id = restored.room_id
--   on conflict (room_id) do nothing;
--
--   update public.rooms rooms
--   set version = restored.room_version_before + 2
--   from prompt_lockdown_restored_rooms_20260729 restored
--   where rooms.id = restored.room_id
--     and rooms.version = restored.room_version_before + 1;
--
--   do $prompt_restore_version_guard$
--   begin
--     if exists (
--       select 1
--       from prompt_lockdown_restored_rooms_20260729 restored
--       join public.rooms rooms on rooms.id = restored.room_id
--       where rooms.version is distinct from restored.room_version_before + 2
--     ) then
--       raise exception 'prompt lockdown restore room-version fence mismatch';
--     end if;
--   end;
--   $prompt_restore_version_guard$;
--   commit;
