select md5(coalesce(
  jsonb_agg(to_jsonb(migration_record) order by migration_record.version)::text,
  '[]'
)) as migration_rows_fingerprint
from supabase_migrations.schema_migrations migration_record;
