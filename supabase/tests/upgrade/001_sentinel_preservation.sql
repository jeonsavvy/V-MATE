begin;

select plan(3);

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

select * from finish();

rollback;
