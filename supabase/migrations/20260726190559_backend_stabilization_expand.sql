-- Additive backend stabilization. Apply before the Worker cutover.
-- No existing client privileges are removed in this phase.

-- Fail fast instead of waiting indefinitely behind production traffic, while
-- still allowing the bounded message-history backfill to complete.
set lock_timeout = '5s';
set statement_timeout = '15min';

-- Rooms retain an immutable prompt snapshot and chat history. Shared source
-- content deletion must detach those references, not delete another user's room.
alter table public.rooms alter column character_id drop not null;
alter table public.rooms alter column world_id drop not null;
alter table public.rooms drop constraint if exists rooms_character_id_fkey;
alter table public.rooms add constraint rooms_character_id_fkey
  foreign key (character_id) references public.characters (id) on delete set null not valid;
alter table public.rooms drop constraint if exists rooms_world_id_fkey;
alter table public.rooms add constraint rooms_world_id_fkey
  foreign key (world_id) references public.worlds (id) on delete set null not valid;
alter table public.rooms validate constraint rooms_character_id_fkey;
alter table public.rooms validate constraint rooms_world_id_fkey;

alter table public.chat_usage_events add column if not exists route text not null default 'room';
alter table public.chat_usage_events add column if not exists room_id uuid references public.rooms on delete cascade;
alter table public.chat_usage_events add column if not exists request_fingerprint text;
alter table public.chat_usage_events add column if not exists lease_expires_at timestamp with time zone;
alter table public.chat_usage_events add column if not exists attempt_count integer not null default 1;

alter table public.rooms add column if not exists version bigint not null default 0;
alter table public.room_messages add column if not exists sequence_no bigint;

with room_max as (
  select room_id, coalesce(max(sequence_no), 0) as max_sequence_no
  from public.room_messages
  group by room_id
), ranked as (
  select messages.id, room_max.max_sequence_no + row_number() over (
    partition by messages.room_id
    order by messages.created_at, case messages.role when 'user' then 0 when 'assistant' then 1 else 2 end, messages.id
  ) as sequence_no
  from public.room_messages messages
  join room_max on room_max.room_id = messages.room_id
  where messages.sequence_no is null
)
update public.room_messages messages
set sequence_no = ranked.sequence_no
from ranked
where messages.id = ranked.id;

create or replace function public.assign_room_message_sequence()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.sequence_no is null then
    perform pg_advisory_xact_lock(hashtextextended(new.room_id::text, 0));
    select coalesce(max(messages.sequence_no), 0) + 1
      into new.sequence_no
    from public.room_messages messages
    where messages.room_id = new.room_id;
  end if;
  return new;
end;
$$;

drop trigger if exists room_messages_assign_sequence on public.room_messages;
create trigger room_messages_assign_sequence
before insert on public.room_messages
for each row execute function public.assign_room_message_sequence();

alter table public.room_messages alter column sequence_no set not null;
create unique index if not exists room_messages_room_sequence_unique
  on public.room_messages (room_id, sequence_no);
create index if not exists room_messages_room_sequence
  on public.room_messages (room_id, sequence_no asc);

create or replace function public.reserve_chat_message_v2(
  p_user_id uuid,
  p_route text,
  p_room_id uuid,
  p_request_id text,
  p_request_fingerprint text,
  p_limit integer default 30,
  p_lease_seconds integer default 120
)
returns table(
  disposition text,
  allowed boolean,
  duplicate boolean,
  message_limit integer,
  remaining integer,
  reset_at timestamp with time zone,
  response_json jsonb,
  room_version bigint,
  lease_expires_at timestamp with time zone
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_date_kst date := timezone('Asia/Seoul', now())::date;
  next_count integer;
  existing_event public.chat_usage_events%rowtype;
  current_room_version bigint := 0;
  next_lease timestamp with time zone;
  expired_event record;
begin
  if p_user_id is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_route not in ('legacy', 'room') then raise exception 'INVALID_CHAT_ROUTE' using errcode = '22023'; end if;
  if p_route = 'room' and p_room_id is null then raise exception 'ROOM_REQUIRED' using errcode = '22023'; end if;
  if p_route = 'legacy' then p_room_id := null; end if;
  if p_request_id is null or char_length(p_request_id) < 8 or char_length(p_request_id) > 300 then raise exception 'INVALID_REQUEST_ID' using errcode = '22023'; end if;
  if p_request_fingerprint is null or char_length(p_request_fingerprint) < 16 or char_length(p_request_fingerprint) > 128 then raise exception 'INVALID_REQUEST_FINGERPRINT' using errcode = '22023'; end if;
  p_limit := greatest(1, least(coalesce(p_limit, 30), 500));
  p_lease_seconds := greatest(30, least(coalesce(p_lease_seconds, 120), 600));
  next_lease := timezone('utc'::text, now()) + make_interval(secs => p_lease_seconds);

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_request_id, 0));
  if p_room_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('room:' || p_room_id::text, 0));
    select rooms.version into current_room_version
    from public.rooms rooms
    where rooms.id = p_room_id and rooms.user_id = p_user_id;
    if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002'; end if;

    if exists (
      select 1 from public.chat_usage_events events
      where events.user_id = p_user_id
        and events.room_id = p_room_id
        and events.status = 'reserved'
        and events.request_id <> p_request_id
        and events.lease_expires_at > timezone('utc'::text, now())
    ) then
      select used_count into next_count from public.chat_usage_daily where user_id = p_user_id and usage_date = current_date_kst;
      return query select 'in_progress'::text, false, true, p_limit,
        greatest(0, p_limit - coalesce(next_count, 0)),
        ((current_date_kst + 1)::timestamp at time zone 'Asia/Seoul'), null::jsonb,
        current_room_version, null::timestamp with time zone;
      return;
    end if;
  end if;

  select events.* into existing_event
  from public.chat_usage_events events
  where events.user_id = p_user_id and events.request_id = p_request_id
  for update;

  if found then
    select used_count into next_count from public.chat_usage_daily where user_id = p_user_id and usage_date = current_date_kst;
    if existing_event.request_fingerprint is distinct from p_request_fingerprint
      or existing_event.route is distinct from p_route
      or existing_event.room_id is distinct from p_room_id then
      return query select 'conflict'::text, false, true, p_limit,
        greatest(0, p_limit - coalesce(next_count, 0)),
        ((current_date_kst + 1)::timestamp at time zone 'Asia/Seoul'), null::jsonb,
        current_room_version, existing_event.lease_expires_at;
      return;
    end if;
    if existing_event.status = 'completed' then
      return query select 'replay'::text, false, true, p_limit,
        greatest(0, p_limit - coalesce(next_count, 0)),
        ((current_date_kst + 1)::timestamp at time zone 'Asia/Seoul'), existing_event.response_json,
        current_room_version, existing_event.lease_expires_at;
      return;
    end if;
    if existing_event.status = 'reserved' and existing_event.lease_expires_at > timezone('utc'::text, now()) then
      return query select 'in_progress'::text, false, true, p_limit,
        greatest(0, p_limit - coalesce(next_count, 0)),
        ((current_date_kst + 1)::timestamp at time zone 'Asia/Seoul'), null::jsonb,
        current_room_version, existing_event.lease_expires_at;
      return;
    end if;
    if existing_event.status = 'reserved' and existing_event.attempt_count >= 2 then
      update public.chat_usage_events
      set status = 'refunded',
          refunded_at = timezone('utc'::text, now()),
          lease_expires_at = null
      where user_id = p_user_id and request_id = p_request_id and status = 'reserved';
      if found then
        update public.chat_usage_daily
        set used_count = greatest(0, used_count - 1), updated_at = timezone('utc'::text, now())
        where user_id = p_user_id and usage_date = existing_event.usage_date
        returning used_count into next_count;
      end if;
      return query select 'conflict'::text, false, true, p_limit,
        greatest(0, p_limit - coalesce(next_count, 0)),
        ((current_date_kst + 1)::timestamp at time zone 'Asia/Seoul'), null::jsonb,
        current_room_version, null::timestamp with time zone;
      return;
    end if;
    if existing_event.status = 'reserved' then
      update public.chat_usage_events
      set lease_expires_at = next_lease,
          attempt_count = attempt_count + 1
      where user_id = p_user_id and request_id = p_request_id;
      return query select 'reserved'::text, true, false, p_limit,
        greatest(0, p_limit - coalesce(next_count, 0)),
        ((current_date_kst + 1)::timestamp at time zone 'Asia/Seoul'), null::jsonb,
        current_room_version, next_lease;
      return;
    end if;
    if existing_event.status = 'refunded' and existing_event.attempt_count >= 2 then
      return query select 'conflict'::text, false, true, p_limit,
        greatest(0, p_limit - coalesce(next_count, 0)),
        ((current_date_kst + 1)::timestamp at time zone 'Asia/Seoul'), null::jsonb,
        current_room_version, null::timestamp with time zone;
      return;
    end if;
  end if;

  -- A new reservation opportunistically refunds a bounded batch of this user's expired leases.
  for expired_event in
    select events.user_id, events.request_id, events.usage_date
    from public.chat_usage_events events
    where events.user_id = p_user_id
      and events.request_id <> p_request_id
      and events.status = 'reserved'
      and events.lease_expires_at <= timezone('utc'::text, now())
    order by events.lease_expires_at asc
    limit 20
    for update skip locked
  loop
    update public.chat_usage_events
    set status = 'refunded', refunded_at = timezone('utc'::text, now()), lease_expires_at = null
    where user_id = expired_event.user_id
      and request_id = expired_event.request_id
      and status = 'reserved';
    if found then
      update public.chat_usage_daily
      set used_count = greatest(0, used_count - 1), updated_at = timezone('utc'::text, now())
      where user_id = expired_event.user_id and usage_date = expired_event.usage_date;
    end if;
  end loop;

  insert into public.chat_usage_daily (user_id, usage_date, used_count)
  values (p_user_id, current_date_kst, 0)
  on conflict do nothing;
  next_count := null;
  update public.chat_usage_daily
  set used_count = used_count + 1, updated_at = timezone('utc'::text, now())
  where user_id = p_user_id and usage_date = current_date_kst and used_count < p_limit
  returning used_count into next_count;
  if next_count is null then
    return query select 'limit_exceeded'::text, false, false, p_limit, 0,
      ((current_date_kst + 1)::timestamp at time zone 'Asia/Seoul'), null::jsonb,
      current_room_version, null::timestamp with time zone;
    return;
  end if;

  insert into public.chat_usage_events (
    request_id, user_id, usage_date, status, route, room_id,
    request_fingerprint, lease_expires_at, attempt_count,
    response_json, completed_at, refunded_at
  ) values (
    p_request_id, p_user_id, current_date_kst, 'reserved', p_route, p_room_id,
    p_request_fingerprint, next_lease, 1, null, null, null
  )
  on conflict (user_id, request_id) do update
  set usage_date = excluded.usage_date,
      status = 'reserved',
      route = excluded.route,
      room_id = excluded.room_id,
      request_fingerprint = excluded.request_fingerprint,
      lease_expires_at = excluded.lease_expires_at,
      attempt_count = public.chat_usage_events.attempt_count + 1,
      response_json = null,
      completed_at = null,
      refunded_at = null
  where public.chat_usage_events.status = 'refunded';

  return query select 'reserved'::text, true, false, p_limit,
    greatest(0, p_limit - next_count),
    ((current_date_kst + 1)::timestamp at time zone 'Asia/Seoul'), null::jsonb,
    current_room_version, next_lease;
end;
$$;

create or replace function public.complete_legacy_chat_message_v2(
  p_user_id uuid,
  p_request_id text,
  p_request_fingerprint text,
  p_response_json jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_request_id, 0));
  update public.chat_usage_events
  set status = 'completed',
      response_json = coalesce(p_response_json, '{}'::jsonb),
      completed_at = timezone('utc'::text, now()),
      lease_expires_at = null
  where user_id = p_user_id
    and request_id = p_request_id
    and request_fingerprint = p_request_fingerprint
    and route = 'legacy'
    and status = 'reserved'
    and lease_expires_at > timezone('utc'::text, now());
  if not found then raise exception 'CHAT_RESERVATION_EXPIRED' using errcode = '40001'; end if;
  return true;
end;
$$;

create or replace function public.refund_chat_message_v2(
  p_user_id uuid,
  p_request_id text,
  p_request_fingerprint text,
  p_limit integer default 30
)
returns table(message_limit integer, remaining integer, reset_at timestamp with time zone)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_date date;
  used integer := 0;
begin
  p_limit := greatest(1, least(coalesce(p_limit, 30), 500));
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_request_id, 0));
  update public.chat_usage_events
  set status = 'refunded', refunded_at = timezone('utc'::text, now()), lease_expires_at = null
  where user_id = p_user_id
    and request_id = p_request_id
    and request_fingerprint = p_request_fingerprint
    and status = 'reserved'
  returning usage_date into target_date;
  if target_date is not null then
    update public.chat_usage_daily
    set used_count = greatest(0, used_count - 1), updated_at = timezone('utc'::text, now())
    where user_id = p_user_id and usage_date = target_date
    returning used_count into used;
  else
    target_date := timezone('Asia/Seoul', now())::date;
    select used_count into used from public.chat_usage_daily where user_id = p_user_id and usage_date = target_date;
  end if;
  return query select p_limit, greatest(0, p_limit - coalesce(used, 0)), ((target_date + 1)::timestamp at time zone 'Asia/Seoul');
end;
$$;

create or replace function public.create_room_v2(
  p_user_id uuid,
  p_character_slug text,
  p_world_slug text,
  p_user_alias text,
  p_title text,
  p_bridge_profile jsonb,
  p_prompt_snapshot jsonb,
  p_state jsonb,
  p_greeting jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_character public.characters%rowtype;
  target_world public.worlds%rowtype;
  created_room public.rooms%rowtype;
begin
  select * into target_character from public.characters where slug = p_character_slug;
  if not found then raise exception 'ROOM_TARGET_NOT_FOUND' using errcode = 'P0002'; end if;
  if target_character.owner_user_id <> p_user_id
    and not (target_character.visibility = 'public' and target_character.display_status = 'visible') then
    raise exception 'ROOM_TARGET_NOT_FOUND' using errcode = 'P0002';
  end if;
  if target_character.display_status = 'hidden' or exists (
    select 1 from public.content_moderation moderation
    where moderation.entity_type = 'character' and moderation.entity_id = target_character.id
      and moderation.status in ('quarantined', 'blocked')
  ) then raise exception 'ROOM_TARGET_NOT_STARTABLE' using errcode = '22023'; end if;

  if nullif(btrim(coalesce(p_world_slug, '')), '') is not null then
    select * into target_world from public.worlds where slug = p_world_slug;
    if not found then raise exception 'ROOM_TARGET_NOT_FOUND' using errcode = 'P0002'; end if;
    if target_world.owner_user_id <> p_user_id
      and not (target_world.visibility = 'public' and target_world.display_status = 'visible') then
      raise exception 'ROOM_TARGET_NOT_FOUND' using errcode = 'P0002';
    end if;
    if target_world.display_status = 'hidden' or exists (
      select 1 from public.content_moderation moderation
      where moderation.entity_type = 'world' and moderation.entity_id = target_world.id
        and moderation.status in ('quarantined', 'blocked')
    ) then raise exception 'ROOM_TARGET_NOT_STARTABLE' using errcode = '22023'; end if;
  end if;

  insert into public.rooms (
    user_id, character_id, world_id, user_alias, title,
    bridge_profile_json, resolved_prompt_snapshot_json, last_message_at, version
  ) values (
    p_user_id, target_character.id, target_world.id, left(coalesce(nullif(btrim(p_user_alias), ''), '나'), 40),
    left(coalesce(p_title, target_character.name), 200), coalesce(p_bridge_profile, '{}'::jsonb),
    coalesce(p_prompt_snapshot, '{}'::jsonb), timezone('utc'::text, now()), 0
  ) returning * into created_room;

  insert into public.room_state_summaries (
    room_id, current_situation, location, relationship_state,
    inventory_json, appearance_json, pose_json, future_promises_json, world_notes_json
  ) values (
    created_room.id, p_state ->> 'currentSituation', p_state ->> 'location', p_state ->> 'relationshipState',
    coalesce(p_state -> 'inventory', '[]'::jsonb), coalesce(p_state -> 'appearance', '[]'::jsonb),
    coalesce(p_state -> 'pose', '[]'::jsonb), coalesce(p_state -> 'futurePromises', '[]'::jsonb),
    coalesce(p_state -> 'worldNotes', '[]'::jsonb)
  );
  insert into public.room_messages (room_id, role, content_json, sequence_no)
  values (created_room.id, 'assistant', coalesce(p_greeting, '{}'::jsonb), 1);
  update public.characters set chat_start_count = chat_start_count + 1 where id = target_character.id;
  if target_world.id is not null then update public.worlds set chat_start_count = chat_start_count + 1 where id = target_world.id; end if;
  return jsonb_build_object('room_id', created_room.id, 'version', created_room.version);
end;
$$;

create or replace function public.commit_room_turn_v2(
  p_user_id uuid,
  p_room_id uuid,
  p_request_id text,
  p_request_fingerprint text,
  p_expected_version bigint,
  p_user_content jsonb,
  p_assistant_content jsonb,
  p_next_state jsonb,
  p_next_prompt_snapshot jsonb,
  p_response_json jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_room public.rooms%rowtype;
  reservation public.chat_usage_events%rowtype;
  next_sequence bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('room:' || p_room_id::text, 0));
  select * into target_room from public.rooms where id = p_room_id and user_id = p_user_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002'; end if;
  if target_room.version <> p_expected_version then raise exception 'CHAT_ROOM_VERSION_CONFLICT' using errcode = '40001'; end if;
  select * into reservation from public.chat_usage_events
  where user_id = p_user_id and request_id = p_request_id for update;
  if not found
    or reservation.status <> 'reserved'
    or reservation.route <> 'room'
    or reservation.room_id is distinct from p_room_id
    or reservation.request_fingerprint is distinct from p_request_fingerprint
    or reservation.lease_expires_at <= timezone('utc'::text, now()) then
    raise exception 'CHAT_RESERVATION_EXPIRED' using errcode = '40001';
  end if;
  select coalesce(max(sequence_no), 0) + 1 into next_sequence from public.room_messages where room_id = p_room_id;
  insert into public.room_messages (room_id, role, content_json, sequence_no) values
    (p_room_id, 'user', coalesce(p_user_content, '{}'::jsonb), next_sequence),
    (p_room_id, 'assistant', coalesce(p_assistant_content, '{}'::jsonb), next_sequence + 1);
  insert into public.room_state_summaries (
    room_id, current_situation, location, relationship_state,
    inventory_json, appearance_json, pose_json, future_promises_json, world_notes_json, updated_at
  ) values (
    p_room_id, p_next_state ->> 'currentSituation', p_next_state ->> 'location', p_next_state ->> 'relationshipState',
    coalesce(p_next_state -> 'inventory', '[]'::jsonb), coalesce(p_next_state -> 'appearance', '[]'::jsonb),
    coalesce(p_next_state -> 'pose', '[]'::jsonb), coalesce(p_next_state -> 'futurePromises', '[]'::jsonb),
    coalesce(p_next_state -> 'worldNotes', '[]'::jsonb), timezone('utc'::text, now())
  )
  on conflict (room_id) do update set
    current_situation = excluded.current_situation,
    location = excluded.location,
    relationship_state = excluded.relationship_state,
    inventory_json = excluded.inventory_json,
    appearance_json = excluded.appearance_json,
    pose_json = excluded.pose_json,
    future_promises_json = excluded.future_promises_json,
    world_notes_json = excluded.world_notes_json,
    updated_at = excluded.updated_at;
  update public.rooms set
    resolved_prompt_snapshot_json = coalesce(p_next_prompt_snapshot, resolved_prompt_snapshot_json),
    version = version + 1,
    updated_at = timezone('utc'::text, now()),
    last_message_at = timezone('utc'::text, now())
  where id = p_room_id;
  update public.chat_usage_events set
    status = 'completed', response_json = coalesce(p_response_json, '{}'::jsonb),
    completed_at = timezone('utc'::text, now()), lease_expires_at = null
  where user_id = p_user_id and request_id = p_request_id;
  return jsonb_build_object('room_id', p_room_id, 'version', target_room.version + 1);
end;
$$;

create or replace function public.reconcile_expired_chat_reservations_v2(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target record;
  reconciled_count integer := 0;
begin
  p_limit := greatest(1, least(coalesce(p_limit, 100), 1000));
  for target in
    select events.user_id, events.request_id, events.usage_date
    from public.chat_usage_events events
    where events.status = 'reserved' and events.lease_expires_at <= timezone('utc'::text, now())
    order by events.lease_expires_at asc
    limit p_limit
    for update skip locked
  loop
    update public.chat_usage_events set
      status = 'refunded', refunded_at = timezone('utc'::text, now()), lease_expires_at = null
    where user_id = target.user_id and request_id = target.request_id and status = 'reserved';
    if found then
      update public.chat_usage_daily set
        used_count = greatest(0, used_count - 1), updated_at = timezone('utc'::text, now())
      where user_id = target.user_id and usage_date = target.usage_date;
      reconciled_count := reconciled_count + 1;
    end if;
  end loop;
  return jsonb_build_object('reconciled', reconciled_count);
end;
$$;

revoke all on function public.assign_room_message_sequence() from public, anon, authenticated;
revoke all on function public.reserve_chat_message_v2(uuid, text, uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_legacy_chat_message_v2(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.refund_chat_message_v2(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.create_room_v2(uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.commit_room_turn_v2(uuid, uuid, text, text, bigint, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.reconcile_expired_chat_reservations_v2(integer) from public, anon, authenticated;
grant execute on function public.reserve_chat_message_v2(uuid, text, uuid, text, text, integer, integer) to service_role;
grant execute on function public.complete_legacy_chat_message_v2(uuid, text, text, jsonb) to service_role;
grant execute on function public.refund_chat_message_v2(uuid, text, text, integer) to service_role;
grant execute on function public.create_room_v2(uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.commit_room_turn_v2(uuid, uuid, text, text, bigint, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.reconcile_expired_chat_reservations_v2(integer) to service_role;

create or replace function public.tags_within_contract(p_tags text[])
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(cardinality(p_tags), 0) <= 12
    and coalesce((select bool_and(char_length(btrim(tag)) between 1 and 32) from unnest(coalesce(p_tags, '{}'::text[])) tag), true);
$$;

alter table public.characters drop constraint if exists characters_backend_input_contract;
alter table public.characters add constraint characters_backend_input_contract check (
  char_length(btrim(name)) between 1 and 80
  and char_length(coalesce(headline, '')) <= 160
  and char_length(summary) <= 4000
  and public.tags_within_contract(tags)
  and octet_length(profile_json::text) <= 16384
  and octet_length(speech_style_json::text) <= 16384
  and octet_length(prompt_profile_json::text) <= 16384
  and (source_type <> 'derivative' or (btrim(coalesce(source_url, '')) ~ '^https://' and char_length(btrim(coalesce(source_url, ''))) <= 2048))
  and (
    visibility <> 'public'
    or created_at < timestamptz '2026-07-01 00:00:00+00'
    or (rights_attested_at is not null and nullif(btrim(coalesce(cover_image_url, '')), '') is not null)
  )
) not valid;

alter table public.worlds drop constraint if exists worlds_backend_input_contract;
alter table public.worlds add constraint worlds_backend_input_contract check (
  char_length(btrim(name)) between 1 and 80
  and char_length(coalesce(headline, '')) <= 160
  and char_length(summary) <= 4000
  and char_length(coalesce(world_rules_markdown, '')) <= 8000
  and public.tags_within_contract(tags)
  and octet_length(prompt_profile_json::text) <= 16384
  and (source_type <> 'derivative' or (btrim(coalesce(source_url, '')) ~ '^https://' and char_length(btrim(coalesce(source_url, ''))) <= 2048))
  and (
    visibility <> 'public'
    or created_at < timestamptz '2026-07-01 00:00:00+00'
    or (rights_attested_at is not null and nullif(btrim(coalesce(cover_image_url, '')), '') is not null)
  )
) not valid;

-- Client reads remain RLS-scoped while all mutations move behind the Worker.
grant select on public.characters, public.worlds, public.character_assets, public.world_assets to anon, authenticated;
grant select on public.rooms, public.room_messages, public.room_state_summaries to authenticated;

-- Durable cleanup intent for content deletions. The subject UUID deliberately
-- has no auth.users foreign key so retries survive the row being deleted.
create table if not exists public.storage_deletion_outbox (
  id uuid primary key default gen_random_uuid(),
  operation_key text not null unique check (char_length(operation_key) between 1 and 200),
  operation_kind text not null check (operation_kind = 'content'),
  subject_user_id uuid not null,
  entity_type text check (entity_type in ('character', 'world')),
  entity_id uuid,
  object_paths text[] not null default '{}',
  status text not null default 'prepared',
  lease_expires_at timestamp with time zone,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 64),
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  completed_at timestamp with time zone,
  check (cardinality(object_paths) <= 10000),
  constraint storage_deletion_outbox_status_valid check (status in ('prepared', 'processing', 'completed')),
  constraint storage_deletion_outbox_lease_valid check ((status = 'processing') = (lease_expires_at is not null)),
  check (entity_type is not null and entity_id is not null)
);

alter table public.storage_deletion_outbox add column if not exists lease_expires_at timestamp with time zone;
alter table public.storage_deletion_outbox drop constraint if exists storage_deletion_outbox_status_check;
alter table public.storage_deletion_outbox drop constraint if exists storage_deletion_outbox_status_valid;
alter table public.storage_deletion_outbox drop constraint if exists storage_deletion_outbox_lease_valid;
update public.storage_deletion_outbox
set status = 'prepared', lease_expires_at = null
where status not in ('prepared', 'processing', 'completed')
   or (status = 'processing' and lease_expires_at is null);
alter table public.storage_deletion_outbox
  add constraint storage_deletion_outbox_status_valid check (status in ('prepared', 'processing', 'completed'));
alter table public.storage_deletion_outbox
  add constraint storage_deletion_outbox_lease_valid check ((status = 'processing') = (lease_expires_at is not null));

drop index if exists public.storage_deletion_outbox_pending_created;
create index if not exists storage_deletion_outbox_pending_updated
  on public.storage_deletion_outbox (updated_at, id)
  where status <> 'completed';

alter table public.storage_deletion_outbox enable row level security;
revoke all on table public.storage_deletion_outbox from public, anon, authenticated;
grant select, insert, update, delete on table public.storage_deletion_outbox to service_role;

-- A deletion fence prevents new signed upload URLs from escaping while an
-- account prefix is being removed. It survives auth.users deletion so the
-- scheduled Worker can remove uploads made with already-issued URLs until
-- every pre-fence URL has expired.
create table if not exists public.account_storage_cleanup_fences (
  user_id uuid primary key,
  cleanup_until timestamp with time zone not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 64),
  last_scan_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists account_storage_cleanup_fences_due
  on public.account_storage_cleanup_fences (cleanup_until, user_id);

alter table public.account_storage_cleanup_fences enable row level security;
revoke all on table public.account_storage_cleanup_fences from public, anon, authenticated;
grant select, insert, update, delete on table public.account_storage_cleanup_fences to service_role;

create or replace function public.begin_account_storage_cleanup_v1(
  p_user_id uuid,
  p_cleanup_until timestamp with time zone
)
returns timestamp with time zone
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  effective_cleanup_until timestamp with time zone;
begin
  if p_user_id is null
    or p_cleanup_until <= timezone('utc'::text, now())
    or p_cleanup_until > timezone('utc'::text, now()) + interval '3 hours' then
    raise exception 'INVALID_ACCOUNT_STORAGE_CLEANUP_FENCE' using errcode = '22023';
  end if;

  insert into public.account_storage_cleanup_fences (user_id, cleanup_until)
  values (p_user_id, p_cleanup_until)
  on conflict (user_id) do update set
    cleanup_until = greatest(
      public.account_storage_cleanup_fences.cleanup_until,
      excluded.cleanup_until
    ),
    updated_at = timezone('utc'::text, now())
  returning cleanup_until into effective_cleanup_until;

  return effective_cleanup_until;
end;
$$;

revoke all on function public.begin_account_storage_cleanup_v1(uuid, timestamp with time zone)
  from public, anon, authenticated;
grant execute on function public.begin_account_storage_cleanup_v1(uuid, timestamp with time zone)
  to service_role;

-- chat_messages predates the cascading user-owned tables. Delete only that
-- legacy blocker inside the same auth.users transaction; all other user data
-- continues to use its declared FK cascades.
create or replace function public.cleanup_legacy_user_rows_before_auth_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.chat_messages where user_id = old.id;
  return old;
end;
$$;

drop trigger if exists auth_user_cleanup_legacy_rows on auth.users;
create trigger auth_user_cleanup_legacy_rows
before delete on auth.users
for each row execute function public.cleanup_legacy_user_rows_before_auth_delete();

revoke all on function public.cleanup_legacy_user_rows_before_auth_delete()
  from public, anon, authenticated, service_role;

reset statement_timeout;
reset lock_timeout;
