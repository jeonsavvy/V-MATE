-- Manual operation: run only after reviewing 20260718_b2c_platform.sql in staging.
-- This publishes the four official test fixtures and hides, but never deletes, superseded starter rows.

do $$
declare
  v_owner uuid;
begin
  select owner.user_id into v_owner
  from public.owner_users owner
  order by owner.created_at asc
  limit 1;

  if v_owner is null then
    raise exception 'An owner_users row is required before publishing starter content.';
  end if;

  update public.characters
  set display_status = 'hidden', updated_at = timezone('utc'::text, now())
  where slug <> 'character-a-test'
    and (
      lower(coalesce(slug, '')) in ('charactera', 'character-a', 'momoka', 'kang-taehyun')
      or lower(coalesce(name, '')) in ('charactera', '캐릭터a', '모모카', '강태현')
    );

  update public.worlds
  set display_status = 'hidden', updated_at = timezone('utc'::text, now())
  where slug <> 'world-a-test'
    and (
      lower(coalesce(slug, '')) in ('world1', 'world-1', 'misty-harbor-city', 'seoul-after-rain', 'skyward-kingdom')
      or lower(coalesce(name, '')) in ('world1', '월드1', '안개 낀 항구 도시', '비 온 뒤, 서울', '하늘로 흐르는 왕국')
    );

  insert into public.characters (
    owner_user_id, slug, name, headline, summary, cover_image_url, avatar_image_url,
    visibility, display_status, source_type, source_url, rights_attested_at, tags,
    profile_json, speech_style_json, prompt_profile_json, published_at, updated_at
  ) values
  (
    v_owner, 'character-a-test', '캐릭터A', '테스트 캐릭터',
    '밝고 자신감 있는 테스트 캐릭터.',
    '/starter/character-a.webp', '/starter/character-a.webp',
    'public', 'visible', 'original', null, timezone('utc'::text, now()),
    array['서브컬처', 'SF', '밝은성격'],
    jsonb_build_object('occupation', '아카데미 기술부', 'creatorName', 'V-MATE'),
    jsonb_build_object('tone', '밝고 빠른 반말', 'habits', jsonb_build_array('상대의 핵심 단어를 잡아 질문한다', '과장된 밈이나 이모지는 남발하지 않는다')),
    jsonb_build_object('creatorName', 'V-MATE', 'relationshipBaseline', '처음 만난 두 사람이 테스트 대화를 시작한다', 'roleTendency', 'lead', 'conflictStyle', 'ask-then-clarify'),
    timezone('utc'::text, now()), timezone('utc'::text, now())
  ),
  (
    v_owner, 'character-b-test', '캐릭터B', '테스트 캐릭터',
    '차분하고 냉정한 테스트 캐릭터.',
    '/starter/character-b.webp', '/starter/character-b.webp',
    'public', 'visible', 'original', null, timezone('utc'::text, now()),
    array['서브컬처', 'SF판타지', '냉정'],
    jsonb_build_object('occupation', '성간 항로 안내인', 'creatorName', 'V-MATE'),
    jsonb_build_object('tone', '낮고 단정한 존댓말', 'habits', jsonb_build_array('사실관계를 확인한다', '앞선 약속을 정확히 되짚는다')),
    jsonb_build_object('creatorName', 'V-MATE', 'relationshipBaseline', '비가 오는 저녁 처음 협력하게 된 두 사람', 'roleTendency', 'balanced', 'conflictStyle', 'verify-then-commit'),
    timezone('utc'::text, now()), timezone('utc'::text, now())
  )
  on conflict (slug) do update set
    owner_user_id = excluded.owner_user_id,
    name = excluded.name,
    headline = excluded.headline,
    summary = excluded.summary,
    cover_image_url = excluded.cover_image_url,
    avatar_image_url = excluded.avatar_image_url,
    visibility = excluded.visibility,
    display_status = excluded.display_status,
    source_type = excluded.source_type,
    source_url = excluded.source_url,
    rights_attested_at = excluded.rights_attested_at,
    tags = excluded.tags,
    profile_json = excluded.profile_json,
    speech_style_json = excluded.speech_style_json,
    prompt_profile_json = excluded.prompt_profile_json,
    published_at = excluded.published_at,
    updated_at = excluded.updated_at;

  insert into public.worlds (
    owner_user_id, slug, name, headline, summary, cover_image_url, visibility,
    display_status, source_type, source_url, rights_attested_at, tags,
    world_rules_markdown, prompt_profile_json, published_at, updated_at
  ) values
  (
    v_owner, 'world-a-test', '월드A', '현대 도시 월드',
    '비가 갠 밤의 현대 도시.',
    '/starter/world-a.webp', 'public', 'visible', 'original', null, timezone('utc'::text, now()),
    array['현대', '도시', '일상'],
    E'- 현실적인 시간과 이동을 지킨다.\n- 날씨와 장소의 감각을 다음 장면에 이어간다.\n- 생활 속 선택이 관계를 바꾼다.',
    jsonb_build_object('creatorName', 'V-MATE', 'genreKey', 'modern-city', 'starterLocations', jsonb_build_array('지하철 입구', '24시간 편의점', '젖은 교차로')),
    timezone('utc'::text, now()), timezone('utc'::text, now())
  ),
  (
    v_owner, 'world-b-test', '월드B', '판타지 하늘섬 월드',
    '구름 바다 위의 판타지 하늘섬.',
    '/starter/world-b.webp', 'public', 'visible', 'original', null, timezone('utc'::text, now()),
    array['판타지', '하늘섬', '모험'],
    E'- 하늘섬은 정해진 항로로만 오간다.\n- 마법은 기억을 대가로 사용한다.\n- 선택의 결과는 세계 상태와 관계에 남는다.',
    jsonb_build_object('creatorName', 'V-MATE', 'genreKey', 'sky-fantasy', 'starterLocations', jsonb_build_array('부유 성채 전망대', '하늘섬 연결교', '구름 항구')),
    timezone('utc'::text, now()), timezone('utc'::text, now())
  )
  on conflict (slug) do update set
    owner_user_id = excluded.owner_user_id,
    name = excluded.name,
    headline = excluded.headline,
    summary = excluded.summary,
    cover_image_url = excluded.cover_image_url,
    visibility = excluded.visibility,
    display_status = excluded.display_status,
    source_type = excluded.source_type,
    source_url = excluded.source_url,
    rights_attested_at = excluded.rights_attested_at,
    tags = excluded.tags,
    world_rules_markdown = excluded.world_rules_markdown,
    prompt_profile_json = excluded.prompt_profile_json,
    published_at = excluded.published_at,
    updated_at = excluded.updated_at;

  insert into public.app_settings (key, value_json, updated_at)
  values ('home.hero', jsonb_build_object('mode', 'auto', 'targetPath', ''), timezone('utc'::text, now()))
  on conflict (key) do update set value_json = excluded.value_json, updated_at = excluded.updated_at;
end;
$$;
