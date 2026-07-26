begin;

select plan(1);

select ok(
  exists (
    select 1 from public.app_settings
    where key = 'test.upgrade.sentinel' and value_json = '{"preserved":true}'::jsonb
  ),
  'upgrade fixture sentinel survives all migrations'
);

select * from finish();

rollback;
