-- V-MATE B2C hardening: owner isolation, 17+ publishing, UGC reports, and daily chat quota.
-- Review in a staging project before applying. This migration does not delete existing content.

alter table public.profiles add column if not exists handle text;
alter table public.profiles add column if not exists age_confirmed_at timestamp with time zone;
create unique index if not exists profiles_handle_unique on public.profiles (lower(handle)) where handle is not null;

create table if not exists public.owner_users (
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

insert into public.owner_users (user_id)
select user_id from public.profiles where is_owner is true
on conflict (user_id) do nothing;

insert into public.owner_users (user_id)
select owner_id.value::uuid
from public.app_settings settings,
lateral jsonb_array_elements_text(
  case
    when jsonb_typeof(settings.value_json) = 'array' then settings.value_json
    when jsonb_typeof(settings.value_json) = 'object' and jsonb_typeof(settings.value_json -> 'ids') = 'array' then settings.value_json -> 'ids'
    else '[]'::jsonb
  end
) as owner_id(value)
where settings.key = 'owner_user_ids'
  and owner_id.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
on conflict (user_id) do nothing;

update public.profiles set is_owner = false where is_owner is true;

alter table public.owner_users enable row level security;

create or replace function public.is_owner_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.owner_users where user_id = auth.uid()
  );
$$;

revoke all on function public.is_owner_user() from public;
grant execute on function public.is_owner_user() to anon, authenticated;

drop policy if exists "Owner users can read owner roles" on public.owner_users;
create policy "Owner users can read owner roles" on public.owner_users for select using (public.is_owner_user());
drop policy if exists "Owner users can manage owner roles" on public.owner_users;
create policy "Owner users can manage owner roles" on public.owner_users for all using (public.is_owner_user()) with check (public.is_owner_user());

drop policy if exists "Users can read their own profile" on public.profiles;
drop policy if exists "Users can write their own profile" on public.profiles;
drop policy if exists "Public can read creator profiles" on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Public can read creator profiles" on public.profiles for select using (auth.uid() = user_id or public.is_owner_user());
create policy "Users can insert their own profile" on public.profiles for insert with check (auth.uid() = user_id and is_owner is false);
create policy "Users can update their own profile" on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id and is_owner is false);

revoke insert, update on public.profiles from anon, authenticated;
grant insert (user_id, handle, display_name, avatar_url, bio, age_confirmed_at, updated_at) on public.profiles to authenticated;
grant update (handle, display_name, avatar_url, bio, age_confirmed_at, updated_at) on public.profiles to authenticated;

create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (user_id, handle, display_name, age_confirmed_at)
  values (
    new.id,
    'user_' || left(replace(new.id::text, '-', ''), 12),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), '사용자'),
    case when lower(coalesce(new.raw_user_meta_data ->> 'ageConfirmed', '')) in ('true', '1', 'yes') then timezone('utc'::text, now()) else null end
  )
  on conflict (user_id) do nothing;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_profile on auth.users;
create trigger on_auth_user_created_create_profile after insert on auth.users for each row execute procedure public.handle_new_profile();

create or replace function public.has_confirmed_age()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles where user_id = auth.uid() and age_confirmed_at is not null
  );
$$;
revoke all on function public.has_confirmed_age() from public;
grant execute on function public.has_confirmed_age() to authenticated;

drop policy if exists "Public can read app settings" on public.app_settings;
create policy "Public can read non-sensitive app settings" on public.app_settings for select using (key <> 'owner_user_ids');

alter table public.characters add column if not exists source_url text;
alter table public.characters add column if not exists rights_attested_at timestamp with time zone;
alter table public.worlds add column if not exists source_url text;
alter table public.worlds add column if not exists rights_attested_at timestamp with time zone;

create table if not exists public.content_moderation (
  entity_type text not null check (entity_type in ('character', 'world')),
  entity_id uuid not null,
  status text not null default 'clear' check (status in ('clear', 'quarantined', 'blocked')),
  reason text not null default '',
  actioned_by uuid references auth.users on delete set null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (entity_type, entity_id)
);

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid references auth.users on delete cascade not null,
  entity_type text not null check (entity_type in ('character', 'world')),
  entity_id uuid not null,
  entity_name text not null default '',
  reason text not null check (reason in ('sexual_content', 'minor_safety', 'hate_or_harassment', 'copyright', 'spam', 'other')),
  details text not null default '' check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  reviewed_by uuid references auth.users on delete set null,
  review_note text not null default '',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  reviewed_at timestamp with time zone
);

create unique index if not exists content_reports_one_open_per_reporter
  on public.content_reports (reporter_user_id, entity_type, entity_id) where status = 'open';
create index if not exists content_reports_status_created on public.content_reports (status, created_at desc);

create table if not exists public.content_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.content_reports on delete set null,
  entity_type text not null check (entity_type in ('character', 'world')),
  entity_id uuid not null,
  action text not null check (action in ('auto_quarantine', 'dismiss', 'restore', 'quarantine', 'remove')),
  note text not null default '' check (char_length(note) <= 1000),
  actioned_by uuid references auth.users on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index if not exists content_moderation_actions_entity_created
  on public.content_moderation_actions (entity_type, entity_id, created_at desc);

alter table public.content_moderation enable row level security;
alter table public.content_reports enable row level security;
alter table public.content_moderation_actions enable row level security;

create or replace function public.validate_content_report_target()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_name text;
begin
  if new.entity_type = 'character' then
    select name into target_name from public.characters
    where id = new.entity_id and visibility = 'public' and display_status = 'visible'
      and not exists (select 1 from public.content_moderation where entity_type = 'character' and entity_id = new.entity_id and status in ('quarantined', 'blocked'));
  elsif new.entity_type = 'world' then
    select name into target_name from public.worlds
    where id = new.entity_id and visibility = 'public' and display_status = 'visible'
      and not exists (select 1 from public.content_moderation where entity_type = 'world' and entity_id = new.entity_id and status in ('quarantined', 'blocked'));
  end if;
  if target_name is null then raise exception 'REPORT_TARGET_NOT_FOUND' using errcode = '23503'; end if;
  new.entity_name := target_name;
  return new;
end;
$$;

drop trigger if exists validate_content_report_target on public.content_reports;
create trigger validate_content_report_target before insert on public.content_reports for each row execute procedure public.validate_content_report_target();

drop policy if exists "Users can create content reports" on public.content_reports;
create policy "Users can create content reports" on public.content_reports for insert with check (auth.uid() = reporter_user_id);
drop policy if exists "Users can read their reports" on public.content_reports;
create policy "Users can read their reports" on public.content_reports for select using (auth.uid() = reporter_user_id or public.is_owner_user());
drop policy if exists "Owner users can manage content reports" on public.content_reports;
create policy "Owner users can manage content reports" on public.content_reports for all using (public.is_owner_user()) with check (public.is_owner_user());
drop policy if exists "Owner users can manage moderation" on public.content_moderation;
create policy "Owner users can manage moderation" on public.content_moderation for all using (public.is_owner_user()) with check (public.is_owner_user());
drop policy if exists "Owner users can read moderation actions" on public.content_moderation_actions;
create policy "Owner users can read moderation actions" on public.content_moderation_actions for select using (public.is_owner_user());
revoke all on public.content_moderation_actions from anon, authenticated;
grant select on public.content_moderation_actions to authenticated;

create or replace function public.is_content_publicly_allowed(p_entity_type text, p_entity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from public.content_moderation
    where entity_type = p_entity_type and entity_id = p_entity_id and status in ('quarantined', 'blocked')
  );
$$;
revoke all on function public.is_content_publicly_allowed(text, uuid) from public;
grant execute on function public.is_content_publicly_allowed(text, uuid) to anon, authenticated;

create or replace function public.quarantine_content_after_reports()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reporter_count integer;
  current_status text;
begin
  select count(distinct reporter_user_id) into reporter_count
  from public.content_reports
  where entity_type = new.entity_type and entity_id = new.entity_id and status = 'open';
  select status into current_status from public.content_moderation where entity_type = new.entity_type and entity_id = new.entity_id;
  if reporter_count >= 3 and coalesce(current_status, 'clear') not in ('quarantined', 'blocked') then
    insert into public.content_moderation (entity_type, entity_id, status, reason, updated_at)
    values (new.entity_type, new.entity_id, 'quarantined', 'report_threshold', timezone('utc'::text, now()))
    on conflict (entity_type, entity_id) do update
      set status = case when public.content_moderation.status = 'blocked' then 'blocked' else 'quarantined' end,
          reason = case when public.content_moderation.status = 'blocked' then public.content_moderation.reason else 'report_threshold' end,
          updated_at = timezone('utc'::text, now());
    insert into public.content_moderation_actions (report_id, entity_type, entity_id, action, note)
    values (new.id, new.entity_type, new.entity_id, 'auto_quarantine', 'report_threshold');
  end if;
  return new;
end;
$$;

drop trigger if exists quarantine_content_after_reports on public.content_reports;
create trigger quarantine_content_after_reports after insert on public.content_reports for each row execute procedure public.quarantine_content_after_reports();

drop policy if exists "Public can read visible characters or owners can read their own" on public.characters;
create policy "Public can read unmoderated visible characters or owners can read their own" on public.characters for select using (
  auth.uid() = owner_user_id or (
    visibility = 'public' and display_status = 'visible' and public.is_content_publicly_allowed('character', characters.id)
  )
);
drop policy if exists "Public can read visible worlds or owners can read their own" on public.worlds;
create policy "Public can read unmoderated visible worlds or owners can read their own" on public.worlds for select using (
  auth.uid() = owner_user_id or (
    visibility = 'public' and display_status = 'visible' and public.is_content_publicly_allowed('world', worlds.id)
  )
);

drop policy if exists "Users can insert their own characters" on public.characters;
create policy "Users can insert their own characters" on public.characters for insert with check (
  auth.uid() = owner_user_id and (visibility <> 'public' or (public.has_confirmed_age() and rights_attested_at is not null))
);
drop policy if exists "Users can update their own characters" on public.characters;
create policy "Users can update their own characters" on public.characters for update using (auth.uid() = owner_user_id) with check (
  auth.uid() = owner_user_id and (visibility <> 'public' or (public.has_confirmed_age() and rights_attested_at is not null))
);
drop policy if exists "Users can insert their own worlds" on public.worlds;
create policy "Users can insert their own worlds" on public.worlds for insert with check (
  auth.uid() = owner_user_id and (visibility <> 'public' or (public.has_confirmed_age() and rights_attested_at is not null))
);
drop policy if exists "Users can update their own worlds" on public.worlds;
create policy "Users can update their own worlds" on public.worlds for update using (auth.uid() = owner_user_id) with check (
  auth.uid() = owner_user_id and (visibility <> 'public' or (public.has_confirmed_age() and rights_attested_at is not null))
);

create or replace function public.apply_content_report_action(p_report_id uuid, p_action text, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target public.content_reports%rowtype;
  next_status text := 'clear';
begin
  if not public.is_owner_user() then raise exception 'OWNER_FORBIDDEN' using errcode = '42501'; end if;
  select * into target from public.content_reports where id = p_report_id for update;
  if not found then return null; end if;
  if p_action = 'dismiss' then
    update public.content_reports set status = 'dismissed', reviewed_by = auth.uid(), review_note = left(coalesce(p_note, ''), 1000), reviewed_at = timezone('utc'::text, now()) where id = p_report_id;
  elsif p_action = 'restore' then
    insert into public.content_moderation (entity_type, entity_id, status, reason, actioned_by, updated_at)
    values (target.entity_type, target.entity_id, 'clear', 'owner_restore', auth.uid(), timezone('utc'::text, now()))
    on conflict (entity_type, entity_id) do update set status = 'clear', reason = 'owner_restore', actioned_by = auth.uid(), updated_at = timezone('utc'::text, now());
    update public.content_reports set status = 'dismissed', reviewed_by = auth.uid(), review_note = left(coalesce(p_note, ''), 1000), reviewed_at = timezone('utc'::text, now()) where entity_type = target.entity_type and entity_id = target.entity_id and status = 'open';
  elsif p_action in ('quarantine', 'remove') then
    next_status := case when p_action = 'remove' then 'blocked' else 'quarantined' end;
    insert into public.content_moderation (entity_type, entity_id, status, reason, actioned_by, updated_at)
    values (target.entity_type, target.entity_id, next_status, 'owner_' || p_action, auth.uid(), timezone('utc'::text, now()))
    on conflict (entity_type, entity_id) do update set status = excluded.status, reason = excluded.reason, actioned_by = auth.uid(), updated_at = timezone('utc'::text, now());
    update public.content_reports set status = 'actioned', reviewed_by = auth.uid(), review_note = left(coalesce(p_note, ''), 1000), reviewed_at = timezone('utc'::text, now()) where id = p_report_id;
  else
    raise exception 'INVALID_MODERATION_ACTION' using errcode = '22023';
  end if;
  select coalesce(status, 'clear') into next_status from public.content_moderation where entity_type = target.entity_type and entity_id = target.entity_id;
  next_status := coalesce(next_status, 'clear');
  insert into public.content_moderation_actions (report_id, entity_type, entity_id, action, note, actioned_by)
  values (target.id, target.entity_type, target.entity_id, p_action, left(coalesce(p_note, ''), 1000), auth.uid());
  return jsonb_build_object('reportId', p_report_id, 'moderationStatus', next_status, 'action', p_action);
end;
$$;
revoke all on function public.apply_content_report_action(uuid, text, text) from public;
grant execute on function public.apply_content_report_action(uuid, text, text) to authenticated;

create table if not exists public.chat_usage_daily (
  user_id uuid references auth.users on delete cascade not null,
  usage_date date not null,
  used_count integer not null default 0 check (used_count >= 0),
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (user_id, usage_date)
);
create table if not exists public.chat_usage_events (
  request_id text not null,
  user_id uuid references auth.users on delete cascade not null,
  usage_date date not null,
  status text not null check (status in ('reserved', 'completed', 'refunded')),
  response_json jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  completed_at timestamp with time zone,
  refunded_at timestamp with time zone,
  primary key (user_id, request_id)
);
alter table public.chat_usage_events add column if not exists response_json jsonb;
alter table public.chat_usage_events add column if not exists completed_at timestamp with time zone;
alter table public.chat_usage_events drop constraint if exists chat_usage_events_pkey;
alter table public.chat_usage_events add constraint chat_usage_events_pkey primary key (user_id, request_id);
alter table public.chat_usage_events drop constraint if exists chat_usage_events_status_check;
alter table public.chat_usage_events add constraint chat_usage_events_status_check check (status in ('reserved', 'completed', 'refunded'));
alter table public.chat_usage_daily enable row level security;
alter table public.chat_usage_events enable row level security;
drop policy if exists "Users can read their daily chat usage" on public.chat_usage_daily;
create policy "Users can read their daily chat usage" on public.chat_usage_daily for select using (auth.uid() = user_id);
drop policy if exists "Users can read their chat usage events" on public.chat_usage_events;
create policy "Users can read their chat usage events" on public.chat_usage_events for select using (auth.uid() = user_id);
revoke insert, update, delete on public.chat_usage_daily from authenticated;
revoke insert, update, delete on public.chat_usage_events from authenticated;

create or replace function public.get_daily_chat_quota(p_limit integer default 30)
returns table(message_limit integer, remaining integer, reset_at timestamp with time zone)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_date_kst date := timezone('Asia/Seoul', now())::date;
  used integer := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  p_limit := greatest(1, least(coalesce(p_limit, 30), 500));
  select used_count into used from public.chat_usage_daily where user_id = auth.uid() and usage_date = current_date_kst;
  used := coalesce(used, 0);
  return query select p_limit, greatest(0, p_limit - used), ((current_date_kst + 1)::timestamp at time zone 'Asia/Seoul');
end;
$$;

drop function if exists public.reserve_daily_chat_message(text, integer);
create or replace function public.reserve_daily_chat_message(p_request_id text, p_limit integer default 30)
returns table(allowed boolean, duplicate boolean, message_limit integer, remaining integer, reset_at timestamp with time zone, response_json jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_date_kst date := timezone('Asia/Seoul', now())::date;
  next_count integer;
  existing_status text;
  existing_response jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  p_limit := greatest(1, least(coalesce(p_limit, 30), 500));
  if p_request_id is null or char_length(p_request_id) < 8 or char_length(p_request_id) > 300 then raise exception 'INVALID_REQUEST_ID' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_request_id, 0));
  select events.status, events.response_json into existing_status, existing_response
  from public.chat_usage_events events where events.request_id = p_request_id and events.user_id = auth.uid();
  if existing_status is not null and existing_status <> 'refunded' then
    select used_count into next_count from public.chat_usage_daily where user_id = auth.uid() and usage_date = current_date_kst;
    return query select false, true, p_limit, greatest(0, p_limit - coalesce(next_count, 0)), ((current_date_kst + 1)::timestamp at time zone 'Asia/Seoul'), existing_response;
    return;
  end if;
  insert into public.chat_usage_daily (user_id, usage_date, used_count) values (auth.uid(), current_date_kst, 0) on conflict do nothing;
  update public.chat_usage_daily set used_count = used_count + 1, updated_at = timezone('utc'::text, now())
    where user_id = auth.uid() and usage_date = current_date_kst and used_count < p_limit returning used_count into next_count;
  if next_count is null then
    return query select false, false, p_limit, 0, ((current_date_kst + 1)::timestamp at time zone 'Asia/Seoul'), null::jsonb;
    return;
  end if;
  insert into public.chat_usage_events (request_id, user_id, usage_date, status)
  values (p_request_id, auth.uid(), current_date_kst, 'reserved')
  on conflict (user_id, request_id) do update
    set usage_date = excluded.usage_date, status = 'reserved', response_json = null, completed_at = null, refunded_at = null
    where public.chat_usage_events.status = 'refunded';
  return query select true, false, p_limit, greatest(0, p_limit - next_count), ((current_date_kst + 1)::timestamp at time zone 'Asia/Seoul'), null::jsonb;
end;
$$;

create or replace function public.complete_daily_chat_message(p_request_id text, p_response_json jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or char_length(p_request_id) < 8 or char_length(p_request_id) > 300 then raise exception 'INVALID_REQUEST_ID' using errcode = '22023'; end if;
  update public.chat_usage_events
  set status = 'completed', response_json = coalesce(p_response_json, '{}'::jsonb), completed_at = timezone('utc'::text, now())
  where request_id = p_request_id and user_id = auth.uid() and status in ('reserved', 'completed');
  return found;
end;
$$;

create or replace function public.refund_daily_chat_message(p_request_id text, p_limit integer default 30)
returns table(message_limit integer, remaining integer, reset_at timestamp with time zone)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_date date;
  used integer := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  p_limit := greatest(1, least(coalesce(p_limit, 30), 500));
  if p_request_id is null or char_length(p_request_id) < 8 or char_length(p_request_id) > 300 then raise exception 'INVALID_REQUEST_ID' using errcode = '22023'; end if;
  update public.chat_usage_events set status = 'refunded', refunded_at = timezone('utc'::text, now())
    where request_id = p_request_id and user_id = auth.uid() and status = 'reserved' returning usage_date into target_date;
  if target_date is not null then
    update public.chat_usage_daily set used_count = greatest(0, used_count - 1), updated_at = timezone('utc'::text, now())
      where user_id = auth.uid() and usage_date = target_date returning used_count into used;
  else
    target_date := timezone('Asia/Seoul', now())::date;
    select used_count into used from public.chat_usage_daily where user_id = auth.uid() and usage_date = target_date;
  end if;
  return query select p_limit, greatest(0, p_limit - coalesce(used, 0)), ((target_date + 1)::timestamp at time zone 'Asia/Seoul');
end;
$$;

revoke all on function public.get_daily_chat_quota(integer) from public;
revoke all on function public.reserve_daily_chat_message(text, integer) from public;
revoke all on function public.complete_daily_chat_message(text, jsonb) from public;
revoke all on function public.refund_daily_chat_message(text, integer) from public;
grant execute on function public.get_daily_chat_quota(integer) to authenticated;
grant execute on function public.reserve_daily_chat_message(text, integer) to authenticated;
grant execute on function public.complete_daily_chat_message(text, jsonb) to authenticated;
grant execute on function public.refund_daily_chat_message(text, integer) to authenticated;
