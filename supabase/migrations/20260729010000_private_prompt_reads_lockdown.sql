begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Lockdown phase: apply only after the view-compatible Worker is serving and
-- its public, owner-edit, room, and prompt-context reads have passed smoke tests.
-- Existing authoring JSON remains in place; only direct client privileges move.
revoke select on table public.characters, public.worlds from public, anon, authenticated;
revoke select on table public.rooms from public, anon, authenticated;
revoke select (profile_json, speech_style_json, prompt_profile_json)
  on public.characters from public, anon, authenticated;
revoke select (world_rules_markdown, prompt_profile_json)
  on public.worlds from public, anon, authenticated;
revoke select (bridge_profile_json, resolved_prompt_snapshot_json)
  on public.rooms from public, anon, authenticated;

-- Retain only non-secret base columns needed by existing RLS policy expressions
-- and explicit compatibility reads. Worker public/owner reads use the views.
grant select (
  id, owner_user_id, slug, name, headline, summary, cover_image_url,
  avatar_image_url, visibility, display_status, source_type, source_url, tags,
  favorite_count, chat_start_count, rights_attested_at, published_at,
  created_at, updated_at
) on public.characters to anon, authenticated;
grant select (
  id, owner_user_id, slug, name, headline, summary, cover_image_url,
  visibility, display_status, source_type, source_url, tags, favorite_count,
  chat_start_count, rights_attested_at, published_at, created_at, updated_at
) on public.worlds to anon, authenticated;
grant select (
  id, user_id, character_id, world_id, user_alias, title,
  last_message_at, created_at, updated_at, version
) on public.rooms to authenticated;

-- Earlier room shells could copy creator-only intro, relationship, and world
-- terms into owner-readable state rows. Once the compatible Worker is live,
-- replace only those derived caches; the service-owned prompt snapshot remains
-- the source of truth for subsequent model turns.
update public.room_state_summaries
set
  current_situation = '대화를 이어가고 있습니다.',
  location = '대화 공간',
  relationship_state = '처음 대화를 시작하는 거리감',
  world_notes_json = '[]'::jsonb,
  updated_at = timezone('utc'::text, now());
update public.room_messages
set content_json = jsonb_build_object(
  'emotion', 'normal',
  'inner_heart', '',
  'response', '대화를 시작합니다.',
  'narration', ''
)
where role = 'assistant' and sequence_no = 1;
-- The privilege rollback below does not reconstruct these derived cache values
-- or original greeting rows.
-- Use the approved pre-lockdown backup only if an operator must restore them.

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

grant select on table public.characters, public.worlds, public.rooms to service_role;
grant select on table
  public.public_character_catalog,
  public.public_world_catalog,
  public.owned_character_details,
  public.owned_world_details,
  public.owned_room_summaries
to service_role;

commit;

-- Manual lockdown rollback, only to restore an already-deployed old Worker:
--   begin;
--   grant select on public.characters, public.worlds to anon, authenticated;
--   grant select on public.rooms to authenticated;
--   commit;
-- This temporarily restores the original disclosure surface. Keep the safe
-- views, roll the Worker forward again, and reapply lockdown as soon as possible.
