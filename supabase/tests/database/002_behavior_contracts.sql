begin;

select plan(40);

-- Seed as the database owner. Every user-facing assertion below explicitly
-- switches to anon, authenticated, or service_role before exercising the API.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'contract-a@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'contract-b@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.characters (
  id, owner_user_id, slug, name, summary, visibility, display_status,
  source_type, tags, profile_json, speech_style_json, prompt_profile_json
) values (
  '30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
  'contract-private-a', 'Contract private character', '', 'private', 'draft',
  'original', '{}'::text[], '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
)
on conflict (id) do nothing;

insert into public.rooms (
  id, user_id, character_id, title, bridge_profile_json, resolved_prompt_snapshot_json, version
) values (
  '40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000003', 'Contract room', '{}'::jsonb, '{}'::jsonb, 0
)
on conflict (id) do nothing;

insert into public.room_state_summaries (room_id)
values ('40000000-0000-4000-8000-000000000004')
on conflict (room_id) do nothing;

insert into public.room_messages (room_id, role, content_json, sequence_no)
values ('40000000-0000-4000-8000-000000000004', 'assistant', '{"text":"sentinel"}'::jsonb, 1)
on conflict do nothing;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '50000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'legacy-delete@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
) on conflict (id) do nothing;
insert into public.chat_messages (user_id, character_id, role, content)
values ('50000000-0000-4000-8000-000000000005', 'legacy-delete', 'user', '{"text":"delete me"}'::jsonb);
delete from auth.users where id = '50000000-0000-4000-8000-000000000005';
select ok(
  not exists (select 1 from auth.users where id = '50000000-0000-4000-8000-000000000005')
  and not exists (select 1 from public.chat_messages where user_id = '50000000-0000-4000-8000-000000000005'),
  'auth deletion removes legacy chat rows inside the same transaction'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '60000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'shared-content-creator@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
) on conflict (id) do nothing;
insert into public.characters (
  id, owner_user_id, slug, name, summary, visibility, display_status,
  source_type, tags, profile_json, speech_style_json, prompt_profile_json,
  cover_image_url, rights_attested_at
) values (
  '70000000-0000-4000-8000-000000000007', '60000000-0000-4000-8000-000000000006',
  'shared-public-character', 'Shared public character', '', 'public', 'visible',
  'original', '{}'::text[], '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
  'https://example.test/shared-character.webp', now()
);
insert into public.worlds (
  id, owner_user_id, slug, name, summary, visibility, display_status,
  source_type, tags, prompt_profile_json, cover_image_url, rights_attested_at
) values (
  '80000000-0000-4000-8000-000000000008', '60000000-0000-4000-8000-000000000006',
  'shared-public-world', 'Shared public world', '', 'public', 'visible',
  'original', '{}'::text[], '{}'::jsonb, 'https://example.test/shared-world.webp', now()
);
insert into public.rooms (
  id, user_id, character_id, world_id, title,
  bridge_profile_json, resolved_prompt_snapshot_json, version
) values (
  '90000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000007', '80000000-0000-4000-8000-000000000008',
  'Preserved shared-content room', '{}'::jsonb, '{"character":"snapshot"}'::jsonb, 0
);
insert into public.room_state_summaries (room_id)
values ('90000000-0000-4000-8000-000000000009');
insert into public.room_messages (room_id, role, content_json, sequence_no)
values ('90000000-0000-4000-8000-000000000009', 'assistant', '{"text":"preserve me"}'::jsonb, 1);

delete from auth.users where id = '60000000-0000-4000-8000-000000000006';
select ok(
  not exists (select 1 from auth.users where id = '60000000-0000-4000-8000-000000000006')
  and not exists (select 1 from public.characters where id = '70000000-0000-4000-8000-000000000007')
  and not exists (select 1 from public.worlds where id = '80000000-0000-4000-8000-000000000008')
  and exists (
    select 1 from public.rooms
    where id = '90000000-0000-4000-8000-000000000009'
      and user_id = '20000000-0000-4000-8000-000000000002'
      and character_id is null
      and world_id is null
  )
  and exists (select 1 from public.room_messages where room_id = '90000000-0000-4000-8000-000000000009')
  and exists (select 1 from public.room_state_summaries where room_id = '90000000-0000-4000-8000-000000000009'),
  'deleting a shared-content creator preserves another user''s room and chat history'
);

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select is_empty(
  $$select 1 from public.characters where id = '30000000-0000-4000-8000-000000000003'$$,
  'anon cannot read a private character'
);
select throws_like(
  $$select * from public.reserve_chat_message_v2('10000000-0000-4000-8000-000000000001', 'legacy', null, 'anon-request-01', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 30, 120)$$,
  '%permission denied%',
  'anon cannot reserve chat quota'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is(
  (select slug from public.characters where id = '30000000-0000-4000-8000-000000000003'),
  'contract-private-a',
  'owner can read private character'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
select is_empty(
  $$select 1 from public.characters where id = '30000000-0000-4000-8000-000000000003'$$,
  'user B cannot read user A private character'
);
select is_empty(
  $$select 1 from public.rooms where id = '40000000-0000-4000-8000-000000000004'$$,
  'user B cannot read user A room'
);
select throws_like(
  $$insert into public.characters (owner_user_id, slug, name) values ('20000000-0000-4000-8000-000000000002', 'client-write-denied', 'Denied')$$,
  '%permission denied%',
  'authenticated users cannot create content directly after lockdown'
);
select throws_like(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata) values ('vmate-assets', '10000000-0000-4000-8000-000000000001/character/x/thumb.webp', '20000000-0000-4000-8000-000000000002', '{}'::jsonb)$$,
  '%row-level security%',
  'user B cannot write into user A vmate storage prefix after lockdown'
);
select throws_like(
  $$select * from public.refund_chat_message_v2('20000000-0000-4000-8000-000000000002', 'client-refund-01', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 30)$$,
  '%permission denied%',
  'authenticated users cannot refund quota directly'
);
reset role;

set local role service_role;
select ok(
  (select allowed and disposition = 'reserved'
   from public.reserve_chat_message_v2(
     '10000000-0000-4000-8000-000000000001', 'legacy', null,
     'legacy-request-01', '11111111111111111111111111111111', 30, 120
   )),
  'service role reserves a legacy quota event'
);
select ok(
  (select disposition = 'in_progress'
   from public.reserve_chat_message_v2(
     '10000000-0000-4000-8000-000000000001', 'legacy', null,
     'legacy-request-01', '11111111111111111111111111111111', 30, 120
   )),
  'same active request is in progress'
);
select ok(
  (select disposition = 'conflict'
   from public.reserve_chat_message_v2(
     '10000000-0000-4000-8000-000000000001', 'legacy', null,
     'legacy-request-01', '22222222222222222222222222222222', 30, 120
   )),
  'same request id with a different fingerprint conflicts'
);
select ok(
  (select remaining = 30 from public.refund_chat_message_v2(
    '10000000-0000-4000-8000-000000000001', 'legacy-request-01', '11111111111111111111111111111111', 30
  )),
  'service role refund restores the consumed quota'
);
select ok(
  (select disposition = 'reserved'
   from public.reserve_chat_message_v2(
     '10000000-0000-4000-8000-000000000001', 'legacy', null,
     'legacy-request-01', '11111111111111111111111111111111', 30, 120
   )),
  'a refunded request can be reserved again'
);
select ok(
  public.complete_legacy_chat_message_v2(
    '10000000-0000-4000-8000-000000000001', 'legacy-request-01',
    '11111111111111111111111111111111', '{"text":"replay"}'::jsonb
  ),
  'service role completes a legacy response'
);
select ok(
  (select disposition = 'replay' and response_json = '{"text":"replay"}'::jsonb
   from public.reserve_chat_message_v2(
     '10000000-0000-4000-8000-000000000001', 'legacy', null,
     'legacy-request-01', '11111111111111111111111111111111', 30, 120
   )),
  'completed identical legacy request replays the saved response'
);
select ok(
  (select disposition = 'reserved'
   from public.reserve_chat_message_v2(
     '10000000-0000-4000-8000-000000000001', 'legacy', null,
     'expiry-request-01', '33333333333333333333333333333333', 30, 120
   )),
  'expiry contract starts with a reservation'
);
reset role;

update public.chat_usage_events
set lease_expires_at = timezone('utc', now()) - interval '1 second'
where user_id = '10000000-0000-4000-8000-000000000001' and request_id = 'expiry-request-01';

set local role service_role;
select ok(
  (select disposition = 'reserved'
   from public.reserve_chat_message_v2(
     '10000000-0000-4000-8000-000000000001', 'legacy', null,
     'expiry-request-01', '33333333333333333333333333333333', 30, 120
   )),
  'expired reservation is reclaimed without another quota increment'
);
reset role;
select is(
  (select attempt_count::text from public.chat_usage_events
   where user_id = '10000000-0000-4000-8000-000000000001' and request_id = 'expiry-request-01'),
  '2',
  'expired request records a second lease attempt'
);

set local role service_role;
select ok(
  (select disposition = 'reserved' and room_version = 0
   from public.reserve_chat_message_v2(
     '10000000-0000-4000-8000-000000000001', 'room', '40000000-0000-4000-8000-000000000004',
     'room-request-01', '44444444444444444444444444444444', 30, 120
   )),
  'room turn reserves against the current room version'
);
select is(
  (public.commit_room_turn_v2(
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000004',
    'room-request-01', '44444444444444444444444444444444', 0,
    '{"text":"user"}'::jsonb, '{"text":"assistant"}'::jsonb,
    '{"currentSituation":"after turn"}'::jsonb, '{"snapshot":true}'::jsonb,
    '{"text":"assistant"}'::jsonb
  ) ->> 'version'),
  '1',
  'atomic room turn advances the version'
);
reset role;
select is(
  (select count(*)::text from public.room_messages where room_id = '40000000-0000-4000-8000-000000000004'),
  '3',
  'atomic room turn writes both messages'
);
select is(
  (select string_agg(sequence_no::text, ',' order by sequence_no) from public.room_messages where room_id = '40000000-0000-4000-8000-000000000004'),
  '1,2,3',
  'room messages retain contiguous deterministic sequence numbers'
);
select is(
  (select current_situation from public.room_state_summaries where room_id = '40000000-0000-4000-8000-000000000004'),
  'after turn',
  'atomic room turn updates state with messages and quota completion'
);

set local role service_role;
select ok(
  (select disposition = 'reserved'
   from public.reserve_chat_message_v2(
     '10000000-0000-4000-8000-000000000001', 'room', '40000000-0000-4000-8000-000000000004',
     'room-request-bad', '55555555555555555555555555555555', 30, 120
   )),
  'second room request reserves normally'
);
select throws_like(
  $$select public.commit_room_turn_v2(
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000004',
    'room-request-bad', '55555555555555555555555555555555', 99,
    '{"text":"user"}'::jsonb, '{"text":"assistant"}'::jsonb,
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  )$$,
  '%CHAT_ROOM_VERSION_CONFLICT%',
  'wrong room version aborts the whole commit'
);
select ok(
  (select remaining >= 0 from public.refund_chat_message_v2(
    '10000000-0000-4000-8000-000000000001', 'room-request-bad', '55555555555555555555555555555555', 30
  )),
  'failed room commit can be refunded by the service role'
);
reset role;
select is(
  (select count(*)::text from public.room_messages where room_id = '40000000-0000-4000-8000-000000000004'),
  '3',
  'failed room commit leaves no partial messages'
);

set local role service_role;
select ok(
  (select disposition = 'reserved' from public.reserve_chat_message_v2(
    '20000000-0000-4000-8000-000000000002', 'legacy', null,
    'limit-request-001', '66666666666666666666666666666666', 2, 120
  )),
  'small configured quota reserves the first request'
);
select ok(
  (select disposition = 'reserved' from public.reserve_chat_message_v2(
    '20000000-0000-4000-8000-000000000002', 'legacy', null,
    'limit-request-002', '77777777777777777777777777777777', 2, 120
  )),
  'small configured quota reserves the second request'
);
select ok(
  (select disposition = 'limit_exceeded' and not allowed from public.reserve_chat_message_v2(
    '20000000-0000-4000-8000-000000000002', 'legacy', null,
    'limit-request-003', '88888888888888888888888888888888', 2, 120
  )),
  'daily quota enforces the configured limit'
);
reset role;

select lives_ok(
  $$insert into public.characters (
    id, owner_user_id, slug, name, summary, visibility, display_status,
    source_type, tags, profile_json, speech_style_json, prompt_profile_json, created_at
  ) values (
    'a1000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    'legacy-public-character', 'Legacy public character', '', 'public', 'visible',
    'original', '{}'::text[], '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '2026-06-30T23:59:59Z'
  )$$,
  'pre-cutoff public character without rights or image remains a valid legacy row'
);
select lives_ok(
  $$insert into public.worlds (
    id, owner_user_id, slug, name, summary, visibility, display_status,
    source_type, tags, prompt_profile_json, created_at
  ) values (
    'a2000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
    'legacy-public-world', 'Legacy public world', '', 'public', 'visible',
    'original', '{}'::text[], '{}'::jsonb, '2026-06-30T23:59:59Z'
  )$$,
  'pre-cutoff public world without rights or image remains a valid legacy row'
);
select lives_ok(
  $$update public.characters set favorite_count = favorite_count + 1
    where id = 'a1000000-0000-4000-8000-000000000001'$$,
  'legacy public character counter updates remain possible'
);
select lives_ok(
  $$update public.characters set summary = 'legacy character metadata update'
    where id = 'a1000000-0000-4000-8000-000000000001'$$,
  'legacy public character general updates remain possible'
);
select lives_ok(
  $$update public.worlds set chat_start_count = chat_start_count + 1
    where id = 'a2000000-0000-4000-8000-000000000002'$$,
  'legacy public world counter updates remain possible'
);
select lives_ok(
  $$update public.worlds set summary = 'legacy world metadata update'
    where id = 'a2000000-0000-4000-8000-000000000002'$$,
  'legacy public world general updates remain possible'
);
select throws_like(
  $$insert into public.characters (
    id, owner_user_id, slug, name, summary, visibility, display_status,
    source_type, tags, profile_json, speech_style_json, prompt_profile_json,
    cover_image_url, created_at
  ) values (
    'a3000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
    'post-cutoff-character-no-rights', 'Post cutoff character', '', 'public', 'visible',
    'original', '{}'::text[], '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
    'https://example.test/post-cutoff-character.webp', '2026-07-01T00:00:00Z'
  )$$,
  '%characters_backend_input_contract%',
  'post-cutoff public character without rights attestation is rejected'
);
select throws_like(
  $$insert into public.worlds (
    id, owner_user_id, slug, name, summary, visibility, display_status,
    source_type, tags, prompt_profile_json, rights_attested_at, created_at
  ) values (
    'a4000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001',
    'post-cutoff-world-no-image', 'Post cutoff world', '', 'public', 'visible',
    'original', '{}'::text[], '{}'::jsonb, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'
  )$$,
  '%worlds_backend_input_contract%',
  'post-cutoff public world without a main image is rejected'
);

select * from finish();

rollback;
