with release_objects(kind, identity, definition) as (
  select
    'relation',
    namespace_record.nspname || '.' || relation_record.relname,
    pg_catalog.jsonb_build_array(
      relation_record.relkind,
      relation_record.relpersistence,
      relation_record.relrowsecurity,
      relation_record.relforcerowsecurity,
      coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_array(
            case when privilege_record.grantee = 0 then 'PUBLIC' else grantee_record.rolname end,
            privilege_record.privilege_type,
            privilege_record.is_grantable
          )
          order by
            case when privilege_record.grantee = 0 then 'PUBLIC' else grantee_record.rolname end,
            privilege_record.privilege_type,
            privilege_record.is_grantable
        )
        from pg_catalog.aclexplode(coalesce(
          relation_record.relacl,
          pg_catalog.acldefault(
            case when relation_record.relkind = 'S' then 'S'::"char" else 'r'::"char" end,
            relation_record.relowner
          )
        )) privilege_record
        left join pg_catalog.pg_roles grantee_record on grantee_record.oid = privilege_record.grantee
      ), '[]'::jsonb)
    )::text
  from pg_catalog.pg_class relation_record
  join pg_catalog.pg_namespace namespace_record on namespace_record.oid = relation_record.relnamespace
  where namespace_record.nspname in ('public', 'vmate_private')
  union all
  select
    'column',
    namespace_record.nspname || '.' || relation_record.relname || '.' || attribute_record.attname,
    pg_catalog.jsonb_build_array(
      attribute_record.attnum,
      pg_catalog.format_type(attribute_record.atttypid, attribute_record.atttypmod),
      attribute_record.attnotnull,
      pg_catalog.pg_get_expr(default_record.adbin, default_record.adrelid)
    )::text
  from pg_catalog.pg_attribute attribute_record
  join pg_catalog.pg_class relation_record on relation_record.oid = attribute_record.attrelid
  join pg_catalog.pg_namespace namespace_record on namespace_record.oid = relation_record.relnamespace
  left join pg_catalog.pg_attrdef default_record
    on default_record.adrelid = attribute_record.attrelid
   and default_record.adnum = attribute_record.attnum
  where namespace_record.nspname in ('public', 'vmate_private')
    and attribute_record.attnum > 0
    and not attribute_record.attisdropped
  union all
  select
    'constraint',
    namespace_record.nspname || '.' || relation_record.relname || '.' || constraint_record.conname,
    pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
  from pg_catalog.pg_constraint constraint_record
  join pg_catalog.pg_class relation_record on relation_record.oid = constraint_record.conrelid
  join pg_catalog.pg_namespace namespace_record on namespace_record.oid = relation_record.relnamespace
  where namespace_record.nspname in ('public', 'vmate_private')
  union all
  select
    'index',
    namespace_record.nspname || '.' || index_record.relname,
    pg_catalog.pg_get_indexdef(index_record.oid)
  from pg_catalog.pg_class index_record
  join pg_catalog.pg_namespace namespace_record on namespace_record.oid = index_record.relnamespace
  where namespace_record.nspname in ('public', 'vmate_private')
    and index_record.relkind = 'i'
  union all
  select
    'policy',
    namespace_record.nspname || '.' || relation_record.relname || '.' || policy_record.polname,
    pg_catalog.jsonb_build_array(
      policy_record.polcmd,
      policy_record.polpermissive,
      coalesce((
        select pg_catalog.jsonb_agg(
          case when policy_role.role_oid = 0 then 'PUBLIC' else role_record.rolname end
          order by case when policy_role.role_oid = 0 then 'PUBLIC' else role_record.rolname end
        )
        from pg_catalog.unnest(policy_record.polroles) policy_role(role_oid)
        left join pg_catalog.pg_roles role_record on role_record.oid = policy_role.role_oid
      ), '[]'::jsonb),
      pg_catalog.pg_get_expr(policy_record.polqual, policy_record.polrelid),
      pg_catalog.pg_get_expr(policy_record.polwithcheck, policy_record.polrelid)
    )::text
  from pg_catalog.pg_policy policy_record
  join pg_catalog.pg_class relation_record on relation_record.oid = policy_record.polrelid
  join pg_catalog.pg_namespace namespace_record on namespace_record.oid = relation_record.relnamespace
  where namespace_record.nspname in ('public', 'vmate_private')
  union all
  select
    'routine',
    namespace_record.nspname || '.' || routine_record.proname || '('
      || pg_catalog.pg_get_function_identity_arguments(routine_record.oid) || ')',
    pg_catalog.jsonb_build_array(
      pg_catalog.pg_get_functiondef(routine_record.oid),
      coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_array(
            case when privilege_record.grantee = 0 then 'PUBLIC' else grantee_record.rolname end,
            privilege_record.privilege_type,
            privilege_record.is_grantable
          )
          order by
            case when privilege_record.grantee = 0 then 'PUBLIC' else grantee_record.rolname end,
            privilege_record.privilege_type,
            privilege_record.is_grantable
        )
        from pg_catalog.aclexplode(coalesce(
          routine_record.proacl,
          pg_catalog.acldefault('f'::"char", routine_record.proowner)
        )) privilege_record
        left join pg_catalog.pg_roles grantee_record on grantee_record.oid = privilege_record.grantee
      ), '[]'::jsonb)
    )::text
  from pg_catalog.pg_proc routine_record
  join pg_catalog.pg_namespace namespace_record on namespace_record.oid = routine_record.pronamespace
  where namespace_record.nspname in ('public', 'vmate_private')
    and routine_record.prokind in ('f', 'p')
  union all
  select
    'trigger',
    namespace_record.nspname || '.' || relation_record.relname || '.' || trigger_record.tgname,
    pg_catalog.pg_get_triggerdef(trigger_record.oid, true)
  from pg_catalog.pg_trigger trigger_record
  join pg_catalog.pg_class relation_record on relation_record.oid = trigger_record.tgrelid
  join pg_catalog.pg_namespace namespace_record on namespace_record.oid = relation_record.relnamespace
  where namespace_record.nspname in ('public', 'vmate_private')
    and not trigger_record.tgisinternal
)
select pg_catalog.md5(coalesce(
  pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_array(kind, identity, definition)
    order by kind, identity
  )::text,
  '[]'
)) as application_release_state_fingerprint
from release_objects;
