begin;

select plan(29);

select ok(
  to_regclass('public.public_character_catalog') is not null
  and to_regclass('public.public_world_catalog') is not null
  and to_regclass('public.owned_character_details') is not null
  and to_regclass('public.owned_world_details') is not null
  and to_regclass('public.owned_room_summaries') is not null,
  'public and owner-safe read views exist'
);
select ok(
  not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'public_character_catalog', 'public_world_catalog',
        'owned_character_details', 'owned_world_details', 'owned_room_summaries'
      )
      and not coalesce(relation.reloptions, '{}'::text[]) @> array['security_barrier=true']
  ),
  'prompt-safe views enforce the security barrier option'
);

select ok(
  not has_column_privilege('anon', 'public.characters', 'profile_json', 'SELECT')
  and not has_column_privilege('anon', 'public.characters', 'speech_style_json', 'SELECT')
  and not has_column_privilege('anon', 'public.characters', 'prompt_profile_json', 'SELECT'),
  'anon cannot select character authoring JSON from the base table'
);
select ok(
  not has_column_privilege('authenticated', 'public.characters', 'profile_json', 'SELECT')
  and not has_column_privilege('authenticated', 'public.characters', 'speech_style_json', 'SELECT')
  and not has_column_privilege('authenticated', 'public.characters', 'prompt_profile_json', 'SELECT'),
  'authenticated cannot select character authoring JSON from the base table'
);
select ok(
  not has_column_privilege('anon', 'public.worlds', 'world_rules_markdown', 'SELECT')
  and not has_column_privilege('anon', 'public.worlds', 'prompt_profile_json', 'SELECT')
  and not has_column_privilege('authenticated', 'public.worlds', 'world_rules_markdown', 'SELECT')
  and not has_column_privilege('authenticated', 'public.worlds', 'prompt_profile_json', 'SELECT'),
  'client roles cannot select world rules or prompt JSON from the base table'
);
select ok(
  not has_column_privilege('authenticated', 'public.rooms', 'resolved_prompt_snapshot_json', 'SELECT'),
  'authenticated cannot select composed room prompts from the base table'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('public_character_catalog', 'public_world_catalog', 'owned_room_summaries')
      and column_name in (
        'profile_json', 'speech_style_json', 'prompt_profile_json',
        'world_rules_markdown', 'resolved_prompt_snapshot_json', 'bridge_profile_json'
      )
  ),
  'public catalog and room summary views contain no private prompt columns'
);
select ok(
  has_table_privilege('anon', 'public.public_character_catalog', 'SELECT')
  and has_table_privilege('anon', 'public.public_world_catalog', 'SELECT')
  and has_table_privilege('authenticated', 'public.public_character_catalog', 'SELECT')
  and has_table_privilege('authenticated', 'public.public_world_catalog', 'SELECT'),
  'public catalog views remain readable'
);
select ok(
  not has_table_privilege('anon', 'public.owned_character_details', 'SELECT')
  and not has_table_privilege('anon', 'public.owned_world_details', 'SELECT')
  and has_table_privilege('authenticated', 'public.owned_character_details', 'SELECT')
  and has_table_privilege('authenticated', 'public.owned_world_details', 'SELECT'),
  'private authoring views require an authenticated owner'
);
select ok(
  not has_table_privilege('anon', 'public.owned_room_summaries', 'SELECT')
  and has_table_privilege('authenticated', 'public.owned_room_summaries', 'SELECT'),
  'room summaries require authentication'
);
select ok(
  to_regnamespace('vmate_private') is not null
  and to_regclass('vmate_private.prompt_lockdown_room_state_backup_20260729') is not null
  and to_regclass('vmate_private.prompt_lockdown_greeting_backup_20260729') is not null
  and to_regclass('vmate_private.prompt_lockdown_backup_manifest_20260729') is not null
  and (
    select array_agg(column_name::text order by ordinal_position)
    from information_schema.columns
    where table_schema = 'vmate_private'
      and table_name = 'prompt_lockdown_room_state_backup_20260729'
  ) = array[
    'room_id', 'room_version_before', 'current_situation', 'location',
    'relationship_state', 'world_notes_json', 'updated_at'
  ]::text[]
  and (
    select array_agg(column_name::text order by ordinal_position)
    from information_schema.columns
    where table_schema = 'vmate_private'
      and table_name = 'prompt_lockdown_greeting_backup_20260729'
  ) = array[
    'message_id', 'room_id', 'room_version_before',
    'role', 'sequence_no', 'content_json'
  ]::text[]
  and (
    select array_agg(column_name::text order by ordinal_position)
    from information_schema.columns
    where table_schema = 'vmate_private'
      and table_name = 'prompt_lockdown_backup_manifest_20260729'
  ) = array[
    'singleton', 'state_count', 'greeting_count',
    'state_key_version_hash', 'greeting_key_version_hash',
    'state_payload_hash', 'greeting_payload_hash', 'captured_at'
  ]::text[]
  and not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'vmate_private'
      and relation.relname in (
        'prompt_lockdown_room_state_backup_20260729',
        'prompt_lockdown_greeting_backup_20260729',
        'prompt_lockdown_backup_manifest_20260729'
      )
      and not relation.relrowsecurity
  ),
  'dedicated prompt-lockdown backups and manifest have the exact private shape and RLS'
);
select ok(
  not exists (
    select 1
    from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
    cross join (values ('USAGE'), ('CREATE')) as privileges(privilege_name)
    where has_schema_privilege(roles.role_name, 'vmate_private', privileges.privilege_name)
  )
  and not exists (
    select 1
    from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
    cross join (values
      ('vmate_private.prompt_lockdown_room_state_backup_20260729'),
      ('vmate_private.prompt_lockdown_greeting_backup_20260729'),
      ('vmate_private.prompt_lockdown_backup_manifest_20260729')
    ) as relations(relation_name)
    cross join (values
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
      ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
    ) as privileges(privilege_name)
    where has_table_privilege(
      roles.role_name,
      relations.relation_name,
      privileges.privilege_name
    )
  )
  and not exists (
    select 1
    from pg_namespace namespace
    cross join lateral aclexplode(
      coalesce(namespace.nspacl, acldefault('n', namespace.nspowner))
    ) as privilege
    where namespace.nspname = 'vmate_private'
      and privilege.grantee = 0
  )
  and not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    cross join lateral aclexplode(
      coalesce(relation.relacl, acldefault('r', relation.relowner))
    ) as privilege
    where namespace.nspname = 'vmate_private'
      and relation.relname in (
        'prompt_lockdown_room_state_backup_20260729',
        'prompt_lockdown_greeting_backup_20260729',
        'prompt_lockdown_backup_manifest_20260729'
      )
      and privilege.grantee = 0
  ),
  'PUBLIC and runtime roles have no schema or table ACL on lockdown evidence'
);
select ok(
  exists (
    select 1
    from vmate_private.prompt_lockdown_backup_manifest_20260729 manifest
    where manifest.singleton
      and manifest.captured_at is not null
      and manifest.state_count = (
        select count(*)
        from vmate_private.prompt_lockdown_room_state_backup_20260729
      )
      and manifest.greeting_count = (
        select count(*)
        from vmate_private.prompt_lockdown_greeting_backup_20260729
      )
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
  'the immutable manifest matches both versioned backup tables'
);
select throws_like(
  $$update vmate_private.prompt_lockdown_backup_manifest_20260729
    set captured_at = captured_at$$,
  '%manifest is immutable%',
  'the lockdown manifest rejects updates'
);
select throws_like(
  $$delete from vmate_private.prompt_lockdown_backup_manifest_20260729$$,
  '%manifest is immutable%',
  'the lockdown manifest rejects deletion'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prompt-owner@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('a2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prompt-other@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.characters (
  id, owner_user_id, slug, name, headline, summary, cover_image_url,
  visibility, display_status, source_type, tags, rights_attested_at,
  profile_json, speech_style_json, prompt_profile_json
) values (
  'a3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001',
  'prompt-public-character', 'Prompt public character', 'Safe headline', 'Safe summary',
  'https://example.test/character.webp', 'public', 'visible', 'original', '{safe-tag}'::text[], now(),
  '{"creatorName":"Safe creator","personality":"Safe personality","privateNote":"profile secret"}'::jsonb,
  '{"voice":"Safe voice","privateNote":"speech secret"}'::jsonb,
  '{"masterPrompt":"character master secret","heroImageUrl":{"masterPrompt":"hero master secret"},"imageSlots":[{"id":"main","slot":"main","usage":"slot usage secret","trigger":"slot trigger secret","priority":100,"thumbUrl":"https://example.test/thumb.webp","cardUrl":"https://example.test/card.webp","detailUrl":"https://example.test/detail.webp","masterPrompt":"slot master secret"}]}'::jsonb
);

insert into public.worlds (
  id, owner_user_id, slug, name, headline, summary, cover_image_url,
  visibility, display_status, source_type, tags, rights_attested_at,
  world_rules_markdown, prompt_profile_json
) values (
  'a4000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001',
  'prompt-public-world', 'Prompt public world', 'Safe world headline', 'Safe world summary',
  'https://example.test/world.webp', 'public', 'visible', 'original', '{}'::text[], now(),
  'world rules secret', '{"creatorName":"Safe world creator","masterPrompt":"world master secret","imageSlots":[]}'::jsonb
);

insert into public.rooms (
  id, user_id, character_id, world_id, title, bridge_profile_json,
  resolved_prompt_snapshot_json, version
) values (
  'a5000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000004',
  'Prompt room', '{}'::jsonb, '{"basePromptSnapshot":"composed room secret"}'::jsonb, 1
);
insert into public.room_messages (id, room_id, role, content_json, sequence_no)
values (
  'a6000000-0000-4000-8000-000000000006',
  'a5000000-0000-4000-8000-000000000005', 'assistant',
  '{"response":"safe greeting"}'::jsonb, 1
);

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);

select is(
  (select creator_name from public.public_character_catalog where slug = 'prompt-public-character'),
  'Safe creator',
  'anon receives the explicit safe character projection'
);
select is(
  (select creator_name from public.public_world_catalog where slug = 'prompt-public-world'),
  'Safe world creator',
  'anon receives the explicit safe world projection'
);
select ok(
  (select image_slots #>> '{0,id}' from public.public_character_catalog where slug = 'prompt-public-character') = 'main'
  and (select image_slots #>> '{0,thumbUrl}' from public.public_character_catalog where slug = 'prompt-public-character') = 'https://example.test/thumb.webp'
  and (select hero_image_url from public.public_character_catalog where slug = 'prompt-public-character') = ''
  and not (select (image_slots -> 0) ? 'masterPrompt' from public.public_character_catalog where slug = 'prompt-public-character')
  and not (select (image_slots -> 0) ?| array['usage', 'trigger', 'priority'] from public.public_character_catalog where slug = 'prompt-public-character')
  and (select image_slots::text from public.public_character_catalog where slug = 'prompt-public-character') not like '%secret%',
  'public image slots expose only the explicit display projection'
);
select ok(
  (select search_text from public.public_character_catalog where slug = 'prompt-public-character') like '%Safe headline%'
  and (select search_text from public.public_character_catalog where slug = 'prompt-public-character') like '%Safe creator%'
  and (select search_text from public.public_character_catalog where slug = 'prompt-public-character') like '%safe-tag%'
  and (select search_text from public.public_character_catalog where slug = 'prompt-public-character') not like '%secret%'
  and (select search_text from public.public_world_catalog where slug = 'prompt-public-world') not like '%secret%',
  'catalog search text contains only explicit public display fields'
);
select throws_like(
  $$select prompt_profile_json from public.characters where slug = 'prompt-public-character'$$,
  '%permission denied%',
  'anon cannot bypass the catalog to read a character prompt'
);
select throws_like(
  $$select world_rules_markdown from public.worlds where slug = 'prompt-public-world'$$,
  '%permission denied%',
  'anon cannot bypass the catalog to read world rules'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

select is(
  (select prompt_profile_json ->> 'masterPrompt' from public.owned_character_details where slug = 'prompt-public-character'),
  'character master secret',
  'the authenticated owner can hydrate private character editing fields'
);
select is(
  (select prompt_profile_json ->> 'masterPrompt' from public.owned_world_details where slug = 'prompt-public-world'),
  'world master secret',
  'the authenticated owner can hydrate private world editing fields'
);
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000002', true);
select is_empty(
  $$select 1 from public.owned_character_details where slug = 'prompt-public-character'$$,
  'another authenticated user cannot read the owner view row'
);
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select is(
  (select title from public.owned_room_summaries where id = 'a5000000-0000-4000-8000-000000000005'),
  'Prompt room',
  'the room owner can read the safe room shell'
);
select throws_like(
  $$select resolved_prompt_snapshot_json from public.rooms where id = 'a5000000-0000-4000-8000-000000000005'$$,
  '%permission denied%',
  'the room owner cannot read the composed prompt directly'
);
select throws_like(
  $$select bridge_profile_json from public.rooms where id = 'a5000000-0000-4000-8000-000000000005'$$,
  '%permission denied%',
  'the room owner cannot read the internal bridge profile directly'
);
select is(
  (select content_json ->> 'response' from public.room_messages where room_id = 'a5000000-0000-4000-8000-000000000005'),
  'safe greeting',
  'safe room column grants preserve room-message RLS reads'
);

reset role;
select ok(
  has_column_privilege('service_role', 'public.characters', 'prompt_profile_json', 'SELECT')
  and has_column_privilege('service_role', 'public.worlds', 'world_rules_markdown', 'SELECT')
  and has_column_privilege('service_role', 'public.rooms', 'resolved_prompt_snapshot_json', 'SELECT'),
  'service_role retains prompt access for Worker-owned runtime assembly'
);

select * from finish();

rollback;
