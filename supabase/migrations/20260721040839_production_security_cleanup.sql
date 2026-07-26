-- Event-trigger functions are database-internal and must not be exposed as RPC endpoints.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- Public buckets serve object URLs without a SELECT policy; removing it prevents file listing.
drop policy if exists "Public can read vmate assets" on storage.objects;
