begin;

select plan(23);

select ok(to_regclass('public.chat_usage_events') is not null, 'chat usage events exist');
select ok(
  (select count(*) = 5
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'chat_usage_events'
     and column_name in ('route', 'room_id', 'request_fingerprint', 'lease_expires_at', 'attempt_count')),
  'chat usage events retain the v2 reservation fields'
);
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rooms' and column_name = 'version'
  ),
  'rooms have an optimistic version column'
);
select ok(
  (select count(distinct columns.column_name) = 2
   from information_schema.key_column_usage columns
   join information_schema.referential_constraints constraints
     on constraints.constraint_schema = columns.constraint_schema
    and constraints.constraint_name = columns.constraint_name
   where columns.table_schema = 'public'
     and columns.table_name = 'rooms'
     and columns.column_name in ('character_id', 'world_id')
     and constraints.delete_rule = 'SET NULL')
  and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rooms'
      and column_name in ('character_id', 'world_id')
      and is_nullable <> 'YES'
  ),
  'room content references detach instead of cascading room deletion'
);
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'room_messages' and column_name = 'sequence_no'
  ),
  'room messages have a deterministic sequence number'
);
select ok(
  exists (
    select 1
    from pg_index index_definition
    where index_definition.indrelid = 'public.room_messages'::regclass
      and index_definition.indisunique
      and (
        select array_agg(attribute.attname order by key_column.ordinality)
        from unnest(index_definition.indkey) with ordinality as key_column(attribute_number, ordinality)
        join pg_attribute attribute
          on attribute.attrelid = index_definition.indrelid
         and attribute.attnum = key_column.attribute_number
      ) = array['room_id', 'sequence_no']::name[]
  ),
  'room message sequence is unique per room'
);

select ok(
  exists (
    select 1 from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public' and procedure.proname = 'get_daily_chat_quota'
      and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
  ),
  'authenticated users can read their daily quota'
);
select ok(
  not exists (
    select 1 from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'reserve_daily_chat_message',
        'complete_daily_chat_message',
        'refund_daily_chat_message',
        'reserve_chat_message_v2',
        'complete_legacy_chat_message_v2',
        'refund_chat_message_v2',
        'create_room_v2',
        'commit_room_turn_v2',
        'reconcile_expired_chat_reservations_v2'
      )
      and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
  ),
  'authenticated users cannot mutate chat quota or room state by RPC'
);
select ok(
  (select count(*) = 6
   from pg_proc procedure
   join pg_namespace namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname in (
       'reserve_chat_message_v2',
       'complete_legacy_chat_message_v2',
       'refund_chat_message_v2',
       'create_room_v2',
       'commit_room_turn_v2',
       'reconcile_expired_chat_reservations_v2'
     )
     and has_function_privilege('service_role', procedure.oid, 'EXECUTE')),
  'only the service role can call every v2 mutation RPC'
);

select ok(not has_table_privilege('authenticated', 'public.characters', 'INSERT'), 'authenticated users cannot insert characters directly');
select ok(not has_table_privilege('authenticated', 'public.worlds', 'UPDATE'), 'authenticated users cannot update worlds directly');
select ok(not has_table_privilege('authenticated', 'public.rooms', 'INSERT'), 'authenticated users cannot insert rooms directly');
select ok(not has_table_privilege('authenticated', 'public.room_messages', 'INSERT'), 'authenticated users cannot insert room messages directly');
select ok(not has_table_privilege('authenticated', 'public.character_assets', 'DELETE'), 'authenticated users cannot delete character assets directly');
select ok(not has_table_privilege('authenticated', 'public.world_assets', 'DELETE'), 'authenticated users cannot delete world assets directly');
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname ilike '%vmate%'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ),
  'no vmate storage mutation policy is available to client roles'
);

select ok(to_regclass('public.storage_deletion_outbox') is not null, 'storage deletion outbox exists');
select ok(
  not has_table_privilege('anon', 'public.storage_deletion_outbox', 'SELECT')
  and not has_table_privilege('authenticated', 'public.storage_deletion_outbox', 'SELECT')
  and not has_table_privilege('authenticated', 'public.storage_deletion_outbox', 'INSERT')
  and not has_table_privilege('authenticated', 'public.storage_deletion_outbox', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.storage_deletion_outbox', 'DELETE'),
  'client roles cannot inspect or mutate deletion jobs'
);
select ok(
  has_table_privilege('service_role', 'public.storage_deletion_outbox', 'SELECT')
  and has_table_privilege('service_role', 'public.storage_deletion_outbox', 'INSERT')
  and has_table_privilege('service_role', 'public.storage_deletion_outbox', 'UPDATE')
  and has_table_privilege('service_role', 'public.storage_deletion_outbox', 'DELETE'),
  'service role can reconcile deletion jobs'
);
select ok(
  to_regclass('public.account_storage_cleanup_fences') is not null
  and (select relrowsecurity from pg_class where oid = to_regclass('public.account_storage_cleanup_fences')),
  'account storage cleanup fence exists with row-level security enabled'
);
select ok(
  not has_table_privilege('anon', 'public.account_storage_cleanup_fences', 'SELECT')
  and not has_table_privilege('anon', 'public.account_storage_cleanup_fences', 'INSERT')
  and not has_table_privilege('anon', 'public.account_storage_cleanup_fences', 'UPDATE')
  and not has_table_privilege('anon', 'public.account_storage_cleanup_fences', 'DELETE')
  and not has_table_privilege('authenticated', 'public.account_storage_cleanup_fences', 'SELECT')
  and not has_table_privilege('authenticated', 'public.account_storage_cleanup_fences', 'INSERT')
  and not has_table_privilege('authenticated', 'public.account_storage_cleanup_fences', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.account_storage_cleanup_fences', 'DELETE')
  and not exists (
    select 1 from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'begin_account_storage_cleanup_v1'
      and (
        has_function_privilege('anon', procedure.oid, 'EXECUTE')
        or has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      )
  ),
  'client roles cannot inspect, mutate, or open account storage cleanup fences'
);
select ok(
  has_table_privilege('service_role', 'public.account_storage_cleanup_fences', 'SELECT')
  and has_table_privilege('service_role', 'public.account_storage_cleanup_fences', 'INSERT')
  and has_table_privilege('service_role', 'public.account_storage_cleanup_fences', 'UPDATE')
  and has_table_privilege('service_role', 'public.account_storage_cleanup_fences', 'DELETE')
  and exists (
    select 1 from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'begin_account_storage_cleanup_v1'
      and has_function_privilege('service_role', procedure.oid, 'EXECUTE')
  ),
  'service role can manage and open account storage cleanup fences'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'auth.users'::regclass
      and tgname = 'auth_user_cleanup_legacy_rows'
      and not tgisinternal
  )
  and not has_function_privilege('anon', 'public.cleanup_legacy_user_rows_before_auth_delete()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.cleanup_legacy_user_rows_before_auth_delete()', 'EXECUTE'),
  'legacy account cleanup runs only as an auth.users trigger'
);

select * from finish();

rollback;
