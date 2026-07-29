begin;

select plan(16);

select ok(
  exists (
    select 1 from public.app_settings
    where key = 'test.upgrade.sentinel' and value_json = '{"preserved":true}'::jsonb
  ),
  'upgrade fixture sentinel survives all migrations'
);

select is(
  (select string_agg(sequence_no::text, ',' order by sequence_no)
   from public.room_messages
   where room_id = '93000000-0000-4000-8000-000000000003'),
  '1,2,3',
  'retrying a partial room-message sequence backfill preserves deterministic ordinals'
);

select is(
  (select sequence_no::text from public.room_messages where id = '94000000-0000-4000-8000-000000000004'),
  '1',
  'retry-safe backfill does not overwrite an already assigned sequence number'
);

select is(
  (select prompt_profile_json ->> 'masterPrompt'
   from public.characters
   where id = '92000000-0000-4000-8000-000000000002'),
  'upgrade character prompt secret',
  'prompt privilege migration preserves existing character authoring data'
);

select is(
  (select resolved_prompt_snapshot_json ->> 'basePromptSnapshot'
   from public.rooms
   where id = '93000000-0000-4000-8000-000000000003'),
  'upgrade room prompt secret',
  'prompt privilege migration preserves existing composed room data'
);

select is(
  (select world_rules_markdown
   from public.worlds
   where id = '92500000-0000-4000-8000-000000000025'),
  'upgrade world rules secret',
  'prompt privilege migration preserves existing world rules'
);

select is(
  (select prompt_profile_json ->> 'masterPrompt'
   from public.worlds
   where id = '92500000-0000-4000-8000-000000000025'),
  'upgrade world prompt secret',
  'prompt privilege migration preserves existing world authoring data'
);

select ok(
  exists (
    select 1
    from vmate_private.prompt_lockdown_room_state_backup_20260729
    where room_id = '93100000-0000-4000-8000-000000000010'
      and room_version_before = 0
      and current_situation = 'Restore original situation'
      and location = 'Restore original location'
      and relationship_state = 'Restore original relationship'
      and world_notes_json = '[{"note":"restore original world note"}]'::jsonb
      and updated_at = '2026-06-29T10:00:00Z'::timestamp with time zone
  )
  and exists (
    select 1
    from vmate_private.prompt_lockdown_greeting_backup_20260729
    where message_id = '94100000-0000-4000-8000-000000000010'
      and room_id = '93100000-0000-4000-8000-000000000010'
      and room_version_before = 0
      and role = 'assistant'
      and sequence_no = 1
      and content_json = '{"response":"restore original greeting"}'::jsonb
  )
  and exists (
    select 1
    from vmate_private.prompt_lockdown_room_state_backup_20260729
    where room_id = '93100000-0000-4000-8000-000000000011'
      and room_version_before = 0
      and current_situation = 'Guarded original situation'
  )
  and exists (
    select 1
    from vmate_private.prompt_lockdown_greeting_backup_20260729
    where message_id = '94100000-0000-4000-8000-000000000011'
      and room_version_before = 0
      and content_json = '{"response":"guarded original greeting"}'::jsonb
  ),
  'lockdown migration backs up original legacy state and greetings with room versions'
);

select ok(
  not exists (
    select 1
    from vmate_private.prompt_lockdown_room_state_backup_20260729 backup
    join public.room_state_summaries state on state.room_id = backup.room_id
    cross join vmate_private.prompt_lockdown_backup_manifest_20260729 manifest
    where state.current_situation is distinct from '대화를 이어가고 있습니다.'
      or state.location is distinct from '대화 공간'
      or state.relationship_state is distinct from '처음 대화를 시작하는 거리감'
      or state.world_notes_json is distinct from '[]'::jsonb
      or state.updated_at is distinct from manifest.captured_at
  )
  and not exists (
    select 1
    from vmate_private.prompt_lockdown_greeting_backup_20260729 backup
    join public.room_messages messages on messages.id = backup.message_id
    where messages.content_json is distinct from jsonb_build_object(
      'emotion', 'normal',
      'inner_heart', '',
      'response', '대화를 시작합니다.',
      'narration', ''
    )
  ),
  'lockdown migration replaces every captured legacy value with the exact scrub sentinel'
);

select ok(
  (select version from public.rooms where id = '93100000-0000-4000-8000-000000000010') = 1
  and (select version from public.rooms where id = '93100000-0000-4000-8000-000000000011') = 1
  and (select version from public.rooms where id = '93000000-0000-4000-8000-000000000003') = 0,
  'lockdown increments each affected room version exactly once and leaves other rooms unchanged'
);

select ok(
  exists (
    select 1
    from vmate_private.prompt_lockdown_backup_manifest_20260729 manifest
    where manifest.singleton
      and manifest.state_count = 2
      and manifest.greeting_count = 2
      and manifest.captured_at is not null
      and manifest.state_key_version_hash = (
        select encode(sha256(convert_to(coalesce(string_agg(
          backup.room_id::text || ':' || backup.room_version_before::text,
          E'\n' order by backup.room_id
        ), ''), 'UTF8')), 'hex')
        from vmate_private.prompt_lockdown_room_state_backup_20260729 backup
      )
      and manifest.greeting_key_version_hash = (
        select encode(sha256(convert_to(coalesce(string_agg(
          backup.message_id::text || ':' || backup.room_id::text || ':'
            || backup.room_version_before::text,
          E'\n' order by backup.message_id
        ), ''), 'UTF8')), 'hex')
        from vmate_private.prompt_lockdown_greeting_backup_20260729 backup
      )
      and manifest.state_payload_hash = (
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
        from vmate_private.prompt_lockdown_room_state_backup_20260729 backup
      )
      and manifest.greeting_payload_hash = (
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
        from vmate_private.prompt_lockdown_greeting_backup_20260729 backup
      )
  ),
  'lockdown manifest records snapshot counts, ordered key-version hashes, and capture time'
);

select ok(
  not exists (
    select 1
    from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
    cross join (values ('USAGE'), ('CREATE')) privileges(privilege_name)
    where has_schema_privilege(
      roles.role_name, 'vmate_private', privileges.privilege_name
    )
  )
  and not exists (
    select 1
    from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
    cross join (values
      ('vmate_private.prompt_lockdown_room_state_backup_20260729'),
      ('vmate_private.prompt_lockdown_greeting_backup_20260729'),
      ('vmate_private.prompt_lockdown_backup_manifest_20260729')
    ) relations(relation_name)
    cross join (values
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
      ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
    ) privileges(privilege_name)
    where has_table_privilege(
      roles.role_name, relations.relation_name, privileges.privilege_name
    )
  )
  and not exists (
    select 1
    from pg_namespace namespace
    cross join lateral aclexplode(
      coalesce(namespace.nspacl, acldefault('n', namespace.nspowner))
    ) privilege
    where namespace.nspname = 'vmate_private'
      and privilege.grantee = 0
  )
  and not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    cross join lateral aclexplode(
      coalesce(relation.relacl, acldefault('r', relation.relowner))
    ) privilege
    where namespace.nspname = 'vmate_private'
      and relation.relname in (
        'prompt_lockdown_room_state_backup_20260729',
        'prompt_lockdown_greeting_backup_20260729',
        'prompt_lockdown_backup_manifest_20260729'
      )
      and privilege.grantee = 0
  ),
  'PUBLIC and runtime roles have no ACL on lockdown evidence'
);

select throws_like(
  $$update vmate_private.prompt_lockdown_backup_manifest_20260729
    set captured_at = captured_at$$,
  '%manifest is immutable%',
  'the captured lockdown manifest is immutable'
);

select ok(
  not has_column_privilege('authenticated', 'public.characters', 'prompt_profile_json', 'SELECT')
  and not has_column_privilege('authenticated', 'public.worlds', 'world_rules_markdown', 'SELECT')
  and not has_column_privilege('authenticated', 'public.worlds', 'prompt_profile_json', 'SELECT')
  and not has_column_privilege('authenticated', 'public.rooms', 'resolved_prompt_snapshot_json', 'SELECT'),
  'upgraded client roles cannot read preserved prompt data directly'
);

-- Model a successful post-lockdown turn on one room: payloads change and its
-- room version advances atomically. Conditional restore must leave it intact.
update public.room_state_summaries
set
  current_situation = 'Post-lockdown situation',
  location = 'Post-lockdown location',
  relationship_state = 'Post-lockdown relationship',
  world_notes_json = '[{"note":"post-lockdown world note"}]'::jsonb,
  updated_at = '2026-07-30T12:00:00Z'
where room_id = '93100000-0000-4000-8000-000000000011';
update public.room_messages
set content_json = '{"response":"post-lockdown greeting"}'::jsonb
where id = '94100000-0000-4000-8000-000000000011';
update public.rooms
set version = version + 1
where id = '93100000-0000-4000-8000-000000000011';

-- Exercise the conditional forward-restore statements documented by lockdown.
lock table public.rooms in exclusive mode;
lock table public.room_state_summaries in exclusive mode;
lock table public.room_messages in exclusive mode;

do $prompt_restore_guard$
declare
  manifest vmate_private.prompt_lockdown_backup_manifest_20260729%rowtype;
  state_count bigint;
  greeting_count bigint;
  state_hash text;
  greeting_hash text;
  state_payload_hash text;
  greeting_payload_hash text;
begin
  if (select count(*) from vmate_private.prompt_lockdown_backup_manifest_20260729) <> 1 then
    raise exception 'prompt lockdown backup manifest cardinality mismatch';
  end if;
  select * into strict manifest
  from vmate_private.prompt_lockdown_backup_manifest_20260729
  where singleton;
  select count(*), encode(sha256(convert_to(coalesce(string_agg(
    backup.room_id::text || ':' || backup.room_version_before::text,
    E'\n' order by backup.room_id
  ), ''), 'UTF8')), 'hex')
  into state_count, state_hash
  from vmate_private.prompt_lockdown_room_state_backup_20260729 backup;
  select count(*), encode(sha256(convert_to(coalesce(string_agg(
    backup.message_id::text || ':' || backup.room_id::text || ':'
      || backup.room_version_before::text,
    E'\n' order by backup.message_id
  ), ''), 'UTF8')), 'hex')
  into greeting_count, greeting_hash
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
  into state_payload_hash
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
  into greeting_payload_hash
  from vmate_private.prompt_lockdown_greeting_backup_20260729 backup;
  if manifest.state_count is distinct from state_count
    or manifest.greeting_count is distinct from greeting_count
    or manifest.state_key_version_hash is distinct from state_hash
    or manifest.greeting_key_version_hash is distinct from greeting_hash
    or manifest.state_payload_hash is distinct from state_payload_hash
    or manifest.greeting_payload_hash is distinct from greeting_payload_hash then
    raise exception 'prompt lockdown backup manifest parity mismatch';
  end if;
end;
$prompt_restore_guard$;

create temporary table prompt_lockdown_restored_rooms_20260729 (
  room_id uuid primary key,
  room_version_before bigint not null
) on commit drop;

with restored as (
  update public.room_state_summaries target
  set
    current_situation = backup.current_situation,
    location = backup.location,
    relationship_state = backup.relationship_state,
    world_notes_json = backup.world_notes_json,
    updated_at = backup.updated_at
  from vmate_private.prompt_lockdown_room_state_backup_20260729 backup,
    vmate_private.prompt_lockdown_backup_manifest_20260729 manifest,
    public.rooms rooms
  where manifest.singleton
    and target.room_id = backup.room_id
    and rooms.id = backup.room_id
    and rooms.version = backup.room_version_before + 1
    and target.current_situation = '대화를 이어가고 있습니다.'
    and target.location = '대화 공간'
    and target.relationship_state = '처음 대화를 시작하는 거리감'
    and target.world_notes_json = '[]'::jsonb
    and target.updated_at = manifest.captured_at
  returning target.room_id
)
insert into prompt_lockdown_restored_rooms_20260729 (
  room_id, room_version_before
)
select restored.room_id, backup.room_version_before
from restored
join vmate_private.prompt_lockdown_room_state_backup_20260729 backup
  on backup.room_id = restored.room_id;

with restored as (
  update public.room_messages target
  set content_json = backup.content_json
  from vmate_private.prompt_lockdown_greeting_backup_20260729 backup,
    public.rooms rooms
  where target.id = backup.message_id
    and target.room_id = backup.room_id
    and target.role = backup.role
    and target.sequence_no = backup.sequence_no
    and rooms.id = backup.room_id
    and rooms.version = backup.room_version_before + 1
    and target.content_json = jsonb_build_object(
      'emotion', 'normal',
      'inner_heart', '',
      'response', '대화를 시작합니다.',
      'narration', ''
    )
  returning target.room_id
)
insert into prompt_lockdown_restored_rooms_20260729 (
  room_id, room_version_before
)
select restored.room_id, backup.room_version_before
from restored
join vmate_private.prompt_lockdown_greeting_backup_20260729 backup
  on backup.room_id = restored.room_id
on conflict (room_id) do nothing;

update public.rooms rooms
set version = restored.room_version_before + 2
from prompt_lockdown_restored_rooms_20260729 restored
where rooms.id = restored.room_id
  and rooms.version = restored.room_version_before + 1;

do $prompt_restore_version_guard$
begin
  if exists (
    select 1
    from prompt_lockdown_restored_rooms_20260729 restored
    join public.rooms rooms on rooms.id = restored.room_id
    where rooms.version is distinct from restored.room_version_before + 2
  ) then
    raise exception 'prompt lockdown restore room-version fence mismatch';
  end if;
end;
$prompt_restore_version_guard$;

select ok(
  exists (
    select 1
    from public.room_state_summaries
    where room_id = '93100000-0000-4000-8000-000000000010'
      and current_situation = 'Restore original situation'
      and location = 'Restore original location'
      and relationship_state = 'Restore original relationship'
      and world_notes_json = '[{"note":"restore original world note"}]'::jsonb
      and updated_at = '2026-06-29T10:00:00Z'::timestamp with time zone
  )
  and exists (
    select 1
    from public.room_messages
    where id = '94100000-0000-4000-8000-000000000010'
      and content_json = '{"response":"restore original greeting"}'::jsonb
  )
  and (select version from public.rooms
       where id = '93100000-0000-4000-8000-000000000010') = 2,
  'conditional restore recovers unchanged scrubbed rows and advances their room version'
);

select ok(
  exists (
    select 1
    from public.room_state_summaries
    where room_id = '93100000-0000-4000-8000-000000000011'
      and current_situation = 'Post-lockdown situation'
      and location = 'Post-lockdown location'
      and relationship_state = 'Post-lockdown relationship'
      and world_notes_json = '[{"note":"post-lockdown world note"}]'::jsonb
      and updated_at = '2026-07-30T12:00:00Z'::timestamp with time zone
  )
  and exists (
    select 1
    from public.room_messages
    where id = '94100000-0000-4000-8000-000000000011'
      and content_json = '{"response":"post-lockdown greeting"}'::jsonb
  )
  and (select version from public.rooms
       where id = '93100000-0000-4000-8000-000000000011') = 2,
  'conditional restore never overwrites a later normal write'
);

select * from finish();

rollback;
