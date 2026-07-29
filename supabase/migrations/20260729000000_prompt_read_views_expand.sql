begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Expand phase: add the prompt-safe read contracts without changing any base
-- table privilege. The old Worker keeps reading base tables, while the new
-- Worker can be deployed against these views before lockdown.
create or replace function public.to_public_image_slots(p_prompt_profile jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'id', case when jsonb_typeof(slot -> 'id') = 'string' then slot ->> 'id' else '' end,
        'slot', case when jsonb_typeof(slot -> 'slot') = 'string' then slot ->> 'slot' else '' end,
        'thumbUrl', case when jsonb_typeof(slot -> 'thumbUrl') = 'string' then slot ->> 'thumbUrl' end,
        'feedUrl', case when jsonb_typeof(slot -> 'feedUrl') = 'string' then slot ->> 'feedUrl' end,
        'feedWidth', case when jsonb_typeof(slot -> 'feedWidth') = 'number' then slot -> 'feedWidth' end,
        'cardUrl', case when jsonb_typeof(slot -> 'cardUrl') = 'string' then slot ->> 'cardUrl' end,
        'detailUrl', case
          when jsonb_typeof(slot -> 'detailUrl') = 'string' then slot ->> 'detailUrl'
          when jsonb_typeof(slot -> 'heroUrl') = 'string' then slot ->> 'heroUrl'
        end
      ))
      order by ordinal
    ),
    '[]'::jsonb
  )
  from (
    select value as slot, ordinal
    from jsonb_array_elements(
      case
        when jsonb_typeof(p_prompt_profile -> 'imageSlots') = 'array'
          then p_prompt_profile -> 'imageSlots'
        else '[]'::jsonb
      end
    ) with ordinality as raw_slots(value, ordinal)
    order by ordinal
    limit 6
  ) safe_slots;
$$;

revoke all on function public.to_public_image_slots(jsonb) from public;
grant execute on function public.to_public_image_slots(jsonb) to anon, authenticated, service_role;

drop view if exists public.public_character_catalog;
create view public.public_character_catalog
with (security_barrier = true)
as
select
  c.id,
  c.owner_user_id,
  c.slug,
  c.name,
  c.headline,
  c.summary,
  c.cover_image_url,
  c.avatar_image_url,
  c.visibility,
  c.display_status,
  c.source_type,
  c.source_url,
  c.tags,
  c.favorite_count,
  c.chat_start_count,
  c.rights_attested_at,
  c.published_at,
  c.created_at,
  c.updated_at,
  coalesce(
    case when jsonb_typeof(c.profile_json -> 'creatorName') = 'string'
      then nullif(btrim(c.profile_json ->> 'creatorName'), '') end,
    case when jsonb_typeof(c.prompt_profile_json -> 'creatorName') = 'string'
      then nullif(btrim(c.prompt_profile_json ->> 'creatorName'), '') end
  ) as creator_name,
  case when jsonb_typeof(c.profile_json -> 'personality') = 'string'
    then nullif(btrim(c.profile_json ->> 'personality'), '') end as personality,
  case when jsonb_typeof(c.speech_style_json -> 'voice') = 'string'
    then nullif(btrim(c.speech_style_json ->> 'voice'), '') end as voice,
  case when jsonb_typeof(c.profile_json -> 'relationship') = 'string'
    then nullif(btrim(c.profile_json ->> 'relationship'), '') end as relationship,
  coalesce(
    case when jsonb_typeof(c.prompt_profile_json -> 'heroImageUrl') = 'string'
      then c.prompt_profile_json ->> 'heroImageUrl' end,
    ''
  ) as hero_image_url,
  public.to_public_image_slots(c.prompt_profile_json) as image_slots,
  concat_ws(
    ' ',
    c.name,
    c.headline,
    c.summary,
    coalesce(
      case when jsonb_typeof(c.profile_json -> 'creatorName') = 'string'
        then nullif(btrim(c.profile_json ->> 'creatorName'), '') end,
      case when jsonb_typeof(c.prompt_profile_json -> 'creatorName') = 'string'
        then nullif(btrim(c.prompt_profile_json ->> 'creatorName'), '') end,
      ''
    ),
    array_to_string(c.tags, ' ')
  ) as search_text
from public.characters c
where c.visibility = 'public'
  and c.display_status = 'visible'
  and public.is_content_publicly_allowed('character', c.id);

drop view if exists public.public_world_catalog;
create view public.public_world_catalog
with (security_barrier = true)
as
select
  w.id,
  w.owner_user_id,
  w.slug,
  w.name,
  w.headline,
  w.summary,
  w.cover_image_url,
  w.visibility,
  w.display_status,
  w.source_type,
  w.source_url,
  w.tags,
  w.favorite_count,
  w.chat_start_count,
  w.rights_attested_at,
  w.published_at,
  w.created_at,
  w.updated_at,
  case when jsonb_typeof(w.prompt_profile_json -> 'creatorName') = 'string'
    then nullif(btrim(w.prompt_profile_json ->> 'creatorName'), '') end as creator_name,
  public.to_public_image_slots(w.prompt_profile_json) as image_slots,
  concat_ws(
    ' ',
    w.name,
    w.headline,
    w.summary,
    coalesce(
      case when jsonb_typeof(w.prompt_profile_json -> 'creatorName') = 'string'
        then nullif(btrim(w.prompt_profile_json ->> 'creatorName'), '') end,
      ''
    ),
    array_to_string(w.tags, ' ')
  ) as search_text
from public.worlds w
where w.visibility = 'public'
  and w.display_status = 'visible'
  and public.is_content_publicly_allowed('world', w.id);

-- These views execute with their owner privileges, but the security barrier and
-- auth.uid() predicate make the private authoring rows visible only to owners.
drop view if exists public.owned_character_details;
create view public.owned_character_details
with (security_barrier = true)
as
select
  c.*,
  coalesce(
    case when jsonb_typeof(c.profile_json -> 'creatorName') = 'string'
      then nullif(btrim(c.profile_json ->> 'creatorName'), '') end,
    case when jsonb_typeof(c.prompt_profile_json -> 'creatorName') = 'string'
      then nullif(btrim(c.prompt_profile_json ->> 'creatorName'), '') end
  ) as creator_name,
  case when jsonb_typeof(c.profile_json -> 'personality') = 'string'
    then nullif(btrim(c.profile_json ->> 'personality'), '') end as personality,
  case when jsonb_typeof(c.speech_style_json -> 'voice') = 'string'
    then nullif(btrim(c.speech_style_json ->> 'voice'), '') end as voice,
  case when jsonb_typeof(c.profile_json -> 'relationship') = 'string'
    then nullif(btrim(c.profile_json ->> 'relationship'), '') end as relationship,
  coalesce(
    case when jsonb_typeof(c.prompt_profile_json -> 'heroImageUrl') = 'string'
      then c.prompt_profile_json ->> 'heroImageUrl' end,
    ''
  ) as hero_image_url,
  public.to_public_image_slots(c.prompt_profile_json) as image_slots
from public.characters c
where c.owner_user_id = auth.uid();

drop view if exists public.owned_world_details;
create view public.owned_world_details
with (security_barrier = true)
as
select
  w.*,
  case when jsonb_typeof(w.prompt_profile_json -> 'creatorName') = 'string'
    then nullif(btrim(w.prompt_profile_json ->> 'creatorName'), '') end as creator_name,
  public.to_public_image_slots(w.prompt_profile_json) as image_slots
from public.worlds w
where w.owner_user_id = auth.uid();

-- Room users receive the room shell, never the composed system prompt snapshot.
drop view if exists public.owned_room_summaries;
create view public.owned_room_summaries
with (security_barrier = true)
as
select
  r.id,
  r.user_id,
  r.character_id,
  r.world_id,
  r.user_alias,
  r.title,
  r.last_message_at,
  r.created_at,
  r.updated_at,
  r.version
from public.rooms r
where r.user_id = auth.uid();

revoke all on table
  public.public_character_catalog,
  public.public_world_catalog,
  public.owned_character_details,
  public.owned_world_details,
  public.owned_room_summaries
from public, anon, authenticated;

grant select on table public.public_character_catalog, public.public_world_catalog
  to anon, authenticated;
grant select on table public.owned_character_details, public.owned_world_details,
  public.owned_room_summaries
  to authenticated;
grant select on table
  public.public_character_catalog,
  public.public_world_catalog,
  public.owned_character_details,
  public.owned_world_details,
  public.owned_room_summaries
to service_role;

commit;

-- Manual expand rollback, only before the new Worker is deployed:
--   begin;
--   drop view if exists public.owned_room_summaries;
--   drop view if exists public.owned_world_details;
--   drop view if exists public.owned_character_details;
--   drop view if exists public.public_world_catalog;
--   drop view if exists public.public_character_catalog;
--   drop function if exists public.to_public_image_slots(jsonb);
--   commit;
-- Base-table grants are unchanged in this phase, so the old Worker remains the
-- bounded rollback path.
