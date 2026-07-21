-- V-MATE does not collect or enforce an age attestation.
-- Keep public publishing gated only by the creator's rights attestation.

drop policy if exists "Users can insert their own characters" on public.characters;
create policy "Users can insert their own characters" on public.characters for insert with check (
  auth.uid() = owner_user_id and (visibility <> 'public' or rights_attested_at is not null)
);

drop policy if exists "Users can update their own characters" on public.characters;
create policy "Users can update their own characters" on public.characters for update using (auth.uid() = owner_user_id) with check (
  auth.uid() = owner_user_id and (visibility <> 'public' or rights_attested_at is not null)
);

drop policy if exists "Users can insert their own worlds" on public.worlds;
create policy "Users can insert their own worlds" on public.worlds for insert with check (
  auth.uid() = owner_user_id and (visibility <> 'public' or rights_attested_at is not null)
);

drop policy if exists "Users can update their own worlds" on public.worlds;
create policy "Users can update their own worlds" on public.worlds for update using (auth.uid() = owner_user_id) with check (
  auth.uid() = owner_user_id and (visibility <> 'public' or rights_attested_at is not null)
);

create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (user_id, handle, display_name)
  values (
    new.id,
    'user_' || left(replace(new.id::text, '-', ''), 12),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), '사용자')
  )
  on conflict (user_id) do nothing;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.handle_new_profile() from public, anon, authenticated;

drop function if exists public.has_confirmed_age();

update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'ageConfirmed'
where coalesce(raw_user_meta_data, '{}'::jsonb) ? 'ageConfirmed';

alter table public.profiles drop column if exists age_confirmed_at;
revoke insert, update on public.profiles from anon, authenticated;
grant insert (user_id, handle, display_name, avatar_url, bio, updated_at) on public.profiles to authenticated;
grant update (handle, display_name, avatar_url, bio, updated_at) on public.profiles to authenticated;
