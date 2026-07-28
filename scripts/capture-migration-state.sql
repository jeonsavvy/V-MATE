select pg_catalog.md5(pg_catalog.coalesce(
  pg_catalog.jsonb_agg(pg_catalog.to_jsonb(migration_record) order by migration_record.version)::text,
  '[]'
)) as migration_rows_fingerprint
from supabase_migrations.schema_migrations migration_record;
