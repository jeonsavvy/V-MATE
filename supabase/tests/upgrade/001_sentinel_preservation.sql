begin;

select plan(8);

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
  not has_column_privilege('authenticated', 'public.characters', 'prompt_profile_json', 'SELECT')
  and not has_column_privilege('authenticated', 'public.worlds', 'world_rules_markdown', 'SELECT')
  and not has_column_privilege('authenticated', 'public.worlds', 'prompt_profile_json', 'SELECT')
  and not has_column_privilege('authenticated', 'public.rooms', 'resolved_prompt_snapshot_json', 'SELECT'),
  'upgraded client roles cannot read preserved prompt data directly'
);

select * from finish();

rollback;
