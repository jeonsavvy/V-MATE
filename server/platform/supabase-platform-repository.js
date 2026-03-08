import { createHash, randomUUID } from 'node:crypto';
import { extractBearerToken } from '../modules/auth-guard.js';
import { logServerWarn } from '../modules/server-logger.js';
import { buildRoomPromptSnapshot, createInitialRoomState, generateBridgeProfile, updateRoomStateFromMessages } from './prompt-builder.js';

const STORAGE_BUCKET = process.env.PUBLIC_ASSETS_BUCKET || 'vmate-assets';

const resolveSupabaseConfig = () => {
  const supabaseUrl = String(
    process.env.SUPABASE_URL
    || process.env.VITE_SUPABASE_URL
    || process.env.VITE_PUBLIC_SUPABASE_URL
    || ''
  ).trim().replace(/\/+$/, '');

  const supabaseAnonKey = String(
    process.env.SUPABASE_ANON_KEY
    || process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.VITE_SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    || process.env.VITE_PUBLIC_SUPABASE_ANON_KEY
    || process.env.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || ''
  ).trim();

  return {
    supabaseUrl,
    supabaseAnonKey,
    configured: Boolean(supabaseUrl && supabaseAnonKey),
  };
};

export const isPersistentPlatformAvailable = () => resolveSupabaseConfig().configured;

let createClientPromise = null;
const getCreateClient = async () => {
  if (!createClientPromise) {
    createClientPromise = import('@supabase/supabase-js').then((module) => module.createClient);
  }
  return createClientPromise;
};

const createSupabaseClient = async ({ accessToken = '', asUser = false } = {}) => {
  const { supabaseUrl, supabaseAnonKey, configured } = resolveSupabaseConfig();
  if (!configured) return null;
  const createClient = await getCreateClient();
  const normalizedToken = String(accessToken || '').trim();
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: asUser && normalizedToken ? {
      headers: {
        Authorization: `Bearer ${normalizedToken}`,
      },
    } : undefined,
  });
};

const publicClient = () => createSupabaseClient();
const userClient = (event) => createSupabaseClient({ accessToken: extractBearerToken(event?.headers), asUser: true });

const clone = (value) => structuredClone(value);
const nowIso = () => new Date().toISOString();

const summarizeCharacter = (row) => ({
  id: row.id,
  entityType: 'character',
  slug: row.slug,
  name: row.name,
  headline: row.headline || '',
  summary: row.summary,
  coverImageUrl: row.cover_image_url || '/mika_normal.webp',
  avatarImageUrl: row.avatar_image_url || row.cover_image_url || '/mika_normal.webp',
  tags: Array.isArray(row.tags) ? row.tags : [],
  creator: {
    id: row.owner_user_id,
    slug: String(row.owner_user_id || ''),
    name: row.profile_json?.creatorName || row.creator_name || '크리에이터',
  },
  visibility: row.visibility,
  displayStatus: row.display_status,
  sourceType: row.source_type,
  favoriteCount: Number(row.favorite_count || 0),
  chatStartCount: Number(row.chat_start_count || 0),
  updatedAt: row.updated_at || nowIso(),
  imageSlots: Array.isArray(row.prompt_profile_json?.imageSlots) ? clone(row.prompt_profile_json.imageSlots) : [],
});

const summarizeWorld = (row) => ({
  id: row.id,
  entityType: 'world',
  slug: row.slug,
  name: row.name,
  headline: row.headline || '',
  summary: row.summary,
  coverImageUrl: row.cover_image_url || '/world_tokyo.svg',
  tags: Array.isArray(row.tags) ? row.tags : [],
  creator: {
    id: row.owner_user_id,
    slug: String(row.owner_user_id || ''),
    name: row.prompt_profile_json?.creatorName || row.creator_name || '크리에이터',
  },
  visibility: row.visibility,
  displayStatus: row.display_status,
  sourceType: row.source_type,
  favoriteCount: Number(row.favorite_count || 0),
  chatStartCount: Number(row.chat_start_count || 0),
  updatedAt: row.updated_at || nowIso(),
  imageSlots: Array.isArray(row.prompt_profile_json?.imageSlots) ? clone(row.prompt_profile_json.imageSlots) : [],
});

const basePublicContentQuery = (client, table) => client
  .from(table)
  .select('*')
  .eq('visibility', 'public')
  .eq('display_status', 'visible');

const applySearchFilter = (items, search) => {
  const query = String(search || '').trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => JSON.stringify(item).toLowerCase().includes(query));
};

const sortByFilter = (items, filter) => {
  if (filter === 'new') {
    return [...items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }
  return [...items].sort((a, b) => b.chatStartCount - a.chatStartCount || b.favoriteCount - a.favoriteCount || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
};

export const listCharacters = async ({ search = '', filter = '' } = {}) => {
  const client = await publicClient();
  if (!client) return [];
  const { data, error } = await basePublicContentQuery(client, 'characters').limit(200);
  if (error) throw error;
  return sortByFilter(applySearchFilter((data || []).map(summarizeCharacter), search), filter);
};

export const listWorlds = async ({ search = '', filter = '' } = {}) => {
  const client = await publicClient();
  if (!client) return [];
  const { data, error } = await basePublicContentQuery(client, 'worlds').limit(200);
  if (error) throw error;
  return sortByFilter(applySearchFilter((data || []).map(summarizeWorld), search), filter);
};

const getSetting = async (client, key) => {
  const { data } = await client.from('app_settings').select('value_json').eq('key', key).maybeSingle();
  return data?.value_json || null;
};

const resolveStoragePathFromPublicUrl = (url) => {
  try {
    const parsed = new URL(String(url || ''));
    const marker = `/object/public/${STORAGE_BUCKET}/`;
    const index = parsed.pathname.indexOf(marker);
    if (index === -1) return null;
    return decodeURIComponent(parsed.pathname.slice(index + marker.length));
  } catch {
    return null;
  }
};

const removeStorageObjectsByUrls = async ({ client, urls }) => {
  const paths = urls.map(resolveStoragePathFromPublicUrl).filter(Boolean);
  if (!paths.length) return;
  const { error } = await client.storage.from(STORAGE_BUCKET).remove(paths);
  if (error) throw error;
};

export const isOwnerUser = async ({ event, userId }) => {
  const client = await userClient(event);
  if (!client || !userId) return false;
  const [{ data: profile }, ownerSetting] = await Promise.all([
    client.from('profiles').select('is_owner').eq('user_id', userId).maybeSingle(),
    getSetting(client, 'owner_user_ids'),
  ]);
  if (profile?.is_owner === true) return true;
  if (Array.isArray(ownerSetting) && ownerSetting.includes(userId)) return true;
  if (Array.isArray(ownerSetting?.ids) && ownerSetting.ids.includes(userId)) return true;
  return false;
};

const resolveEntityByTargetPath = ({ targetPath, characters, worlds }) => {
  if (!targetPath) return null;
  if (targetPath.startsWith('/worlds/')) {
    return worlds.find((item) => targetPath.endsWith(`/${item.slug}`)) || null;
  }
  if (targetPath.startsWith('/characters/')) {
    return characters.find((item) => targetPath.endsWith(`/${item.slug}`)) || null;
  }
  return null;
};

export const incrementChatStartCountsBestEffort = async ({ client, character, world }) => {
  const operations = [
    {
      label: 'character',
      entityId: character?.id || '',
      run: () => client.from('characters').update({ chat_start_count: Number(character?.chat_start_count || 0) + 1 }).eq('id', character.id),
    },
    ...(world ? [{
      label: 'world',
      entityId: world.id,
      run: () => client.from('worlds').update({ chat_start_count: Number(world.chat_start_count || 0) + 1 }).eq('id', world.id),
    }] : []),
  ];

  for (const operation of operations) {
    try {
      const result = await operation.run();
      if (result?.error) {
        logServerWarn('[V-MATE] chat_start_count update skipped', {
          label: operation.label,
          entityId: operation.entityId,
          message: result.error?.message || String(result.error),
        });
      }
    } catch (error) {
      logServerWarn('[V-MATE] chat_start_count update threw and was ignored', {
        label: operation.label,
        entityId: operation.entityId,
        message: error?.message || String(error),
      });
    }
  }
};

export const getHomePayload = async ({ tab = 'characters', search = '', filter = '' } = {}) => {
  const client = await publicClient();
  if (!client) return null;
  const [characters, worlds, heroSetting] = await Promise.all([
    listCharacters({ search, filter }),
    listWorlds({ search, filter }),
    getSetting(client, 'home.hero'),
  ]);
  const heroMode = heroSetting?.mode === 'manual' ? 'manual' : 'auto';
  const autoHero = [...characters, ...worlds].sort((a, b) => b.chatStartCount - a.chatStartCount || b.favoriteCount - a.favoriteCount || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  const manualHero = resolveEntityByTargetPath({ targetPath: String(heroSetting?.targetPath || ''), characters, worlds });
  const hero = heroMode === 'manual' && manualHero ? manualHero : autoHero;
  return {
    home: {
      defaultTab: 'characters',
      filterChips: ['신작', '인기'],
      hero: {
        title: hero?.name || '캐릭터',
        subtitle: hero?.headline || hero?.summary || '',
        coverImageUrl: hero?.coverImageUrl || '/world_tokyo.svg',
        targetPath: hero?.entityType === 'world' ? `/worlds/${hero.slug}` : `/characters/${hero?.slug || characters[0]?.slug || ''}`,
      },
      characterFeed: { items: characters },
      worldFeed: { items: worlds },
    },
  };
};

const getCharacterRowBySlug = async (client, slug) => {
  const { data, error } = await basePublicContentQuery(client, 'characters').eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data;
};

const getWorldRowBySlug = async (client, slug) => {
  const { data, error } = await basePublicContentQuery(client, 'worlds').eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data;
};

const getWorldRowsByIds = async (client, ids) => {
  if (!ids.length) return [];
  const { data, error } = await basePublicContentQuery(client, 'worlds').in('id', ids);
  if (error) throw error;
  return data || [];
};

const getCharacterRowsByIds = async (client, ids) => {
  if (!ids.length) return [];
  const { data, error } = await basePublicContentQuery(client, 'characters').in('id', ids);
  if (error) throw error;
  return data || [];
};

export const getCharacterWorldLinks = async (slug) => {
  const client = await publicClient();
  if (!client) return [];
  const character = await getCharacterRowBySlug(client, slug);
  if (!character) return [];
  const { data: links, error: linkError } = await client
    .from('character_world_links')
    .select('*')
    .eq('character_id', character.id)
    .order('sort_order', { ascending: true });
  if (linkError) throw linkError;
  const worlds = await getWorldRowsByIds(client, (links || []).map((item) => item.world_id));
  const worldMap = new Map(worlds.map((item) => [item.id, summarizeWorld(item)]));
  return (links || [])
    .filter((link) => worldMap.has(link.world_id))
    .map((link) => ({
      id: link.id,
      characterSlug: slug,
      worldSlug: worldMap.get(link.world_id).slug,
      world: worldMap.get(link.world_id),
      linkReason: link.link_reason,
      defaultOpeningContext: link.default_opening_context || '',
      defaultRelationshipContext: link.default_relationship_context || '',
    }));
};

export const getCharacterDetail = async (slug) => {
  const client = await publicClient();
  if (!client) return null;
  const character = await getCharacterRowBySlug(client, slug);
  if (!character) return null;
  const links = await getCharacterWorldLinks(slug);
  const { data: assets } = await client.from('character_assets').select('url').eq('character_id', character.id).order('created_at', { ascending: true });
  const profileJson = character.profile_json || {};
  const speechJson = character.speech_style_json || {};
  const sections = [
    profileJson.personality ? { title: '성격', body: String(profileJson.personality) } : null,
    speechJson.voice ? { title: '말투', body: String(speechJson.voice) } : null,
    profileJson.relationship ? { title: '관계감', body: String(profileJson.relationship) } : null,
  ].filter(Boolean);
  return {
    ...summarizeCharacter(character),
    profileSections: sections.length ? sections : [{ title: '설정', body: character.summary }],
    gallery: (assets || []).map((item) => item.url),
    worlds: links,
  };
};

export const getWorldCharacters = async (slug) => {
  const client = await publicClient();
  if (!client) return [];
  const world = await getWorldRowBySlug(client, slug);
  if (!world) return [];
  const { data: links, error } = await client.from('character_world_links').select('character_id').eq('world_id', world.id).order('sort_order', { ascending: true });
  if (error) throw error;
  const rows = await getCharacterRowsByIds(client, (links || []).map((item) => item.character_id));
  return rows.map(summarizeCharacter);
};

export const getWorldDetail = async (slug) => {
  const client = await publicClient();
  if (!client) return null;
  const world = await getWorldRowBySlug(client, slug);
  if (!world) return null;
  const characters = await getWorldCharacters(slug);
  const { data: assets } = await client.from('world_assets').select('url').eq('world_id', world.id).order('created_at', { ascending: true });
  const sections = [
    { title: '월드 소개', body: world.summary },
    world.world_rules_markdown ? { title: '월드 규칙', body: world.world_rules_markdown } : null,
    world.prompt_profile_json?.tone ? { title: '분위기', body: String(world.prompt_profile_json.tone) } : null,
  ].filter(Boolean);
  return {
    ...summarizeWorld(world),
    worldSections: sections,
    gallery: (assets || []).map((item) => item.url),
    characters,
  };
};

const resolveEntityByRef = async (client, entityType, ref) => {
  if (entityType === 'character') {
    const row = await getCharacterRowBySlug(client, ref);
    return row ? { row, summary: summarizeCharacter(row) } : null;
  }
  const row = await getWorldRowBySlug(client, ref);
  return row ? { row, summary: summarizeWorld(row) } : null;
};

export const addRecentView = async ({ event, userId, entityType, ref }) => {
  const client = await userClient(event);
  const publicReadClient = await publicClient();
  if (!client || !publicReadClient) return null;
  const entity = await resolveEntityByRef(publicReadClient, entityType, ref);
  if (!entity) return null;
  const { error } = await client.from('recent_views').insert({
    user_id: userId,
    target_type: entityType,
    target_id: entity.row.id,
    viewed_at: nowIso(),
  });
  if (error) throw error;
  return true;
};

export const toggleBookmark = async ({ event, userId, entityType, ref }) => {
  const client = await userClient(event);
  const publicReadClient = await publicClient();
  if (!client || !publicReadClient) return null;
  const entity = await resolveEntityByRef(publicReadClient, entityType, ref);
  if (!entity) return null;
  const { data: existing } = await client.from('bookmarks').select('id').eq('user_id', userId).eq('target_type', entityType).eq('target_id', entity.row.id).maybeSingle();
  if (existing?.id) {
    const { error } = await client.from('bookmarks').delete().eq('id', existing.id);
    if (error) throw error;
    return { active: false, id: existing.id };
  }
  const { data, error } = await client.from('bookmarks').insert({ user_id: userId, target_type: entityType, target_id: entity.row.id }).select('id').single();
  if (error) throw error;
  return { active: true, id: data.id };
};

export const removeBookmark = async ({ event, bookmarkId }) => {
  const client = await userClient(event);
  if (!client) return false;
  const { error } = await client.from('bookmarks').delete().eq('id', bookmarkId);
  if (error) throw error;
  return true;
};

const hydrateRoom = async ({ client, publicClientInstance, row }) => {
  const [characterRows, worldRows, stateRows, messageRows] = await Promise.all([
    getCharacterRowsByIds(publicClientInstance, [row.character_id]),
    row.world_id ? getWorldRowsByIds(publicClientInstance, [row.world_id]) : Promise.resolve([]),
    client.from('room_state_summaries').select('*').eq('room_id', row.id).maybeSingle(),
    client.from('room_messages').select('*').eq('room_id', row.id).order('created_at', { ascending: true }),
  ]);

  const character = summarizeCharacter(characterRows[0]);
  const world = worldRows[0] ? summarizeWorld(worldRows[0]) : null;
  const stateRow = stateRows.data || {};
  const messages = (messageRows.data || []).map((message) => ({
    id: message.id,
    role: message.role,
    createdAt: message.created_at,
    content: message.role === 'user'
      ? String(message.content_json?.text || '')
      : message.content_json,
  }));

  return {
    id: row.id,
    title: row.title,
    userAlias: row.user_alias || '나',
    character,
    world,
    bridgeProfile: row.bridge_profile_json,
    state: {
      currentSituation: stateRow.current_situation || '',
      location: stateRow.location || '',
      relationshipState: stateRow.relationship_state || '',
      inventory: stateRow.inventory_json || [],
      appearance: stateRow.appearance_json || [],
      pose: stateRow.pose_json || [],
      futurePromises: stateRow.future_promises_json || [],
      worldNotes: stateRow.world_notes_json || [],
    },
    messages,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
  };
};

export const listRecentRooms = async ({ event, userId }) => {
  const client = await userClient(event);
  const publicReadClient = await publicClient();
  if (!client || !publicReadClient) return [];
  const { data, error } = await client.from('rooms').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(20);
  if (error) throw error;
  const rooms = [];
  for (const row of data || []) {
    rooms.push(await hydrateRoom({ client, publicClientInstance: publicReadClient, row }));
  }
  return rooms;
};

export const getLibraryPayload = async ({ event, userId }) => {
  const client = await userClient(event);
  const publicReadClient = await publicClient();
  if (!client || !publicReadClient) return null;

  const [{ data: bookmarks }, { data: recentViews }, recentRooms, { data: ownedCharacters }, { data: ownedWorlds }] = await Promise.all([
    client.from('bookmarks').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    client.from('recent_views').select('*').eq('user_id', userId).order('viewed_at', { ascending: false }).limit(20),
    listRecentRooms({ event, userId }),
    client.from('characters').select('*').eq('owner_user_id', userId).order('updated_at', { ascending: false }),
    client.from('worlds').select('*').eq('owner_user_id', userId).order('updated_at', { ascending: false }),
  ]);

  const bookmarkedCharacterIds = (bookmarks || []).filter((item) => item.target_type === 'character').map((item) => item.target_id);
  const bookmarkedWorldIds = (bookmarks || []).filter((item) => item.target_type === 'world').map((item) => item.target_id);
  const recentCharacterIds = (recentViews || []).filter((item) => item.target_type === 'character').map((item) => item.target_id);
  const recentWorldIds = (recentViews || []).filter((item) => item.target_type === 'world').map((item) => item.target_id);

  const [bookmarkCharacters, bookmarkWorlds, viewedCharacters, viewedWorlds] = await Promise.all([
    getCharacterRowsByIds(publicReadClient, bookmarkedCharacterIds),
    getWorldRowsByIds(publicReadClient, bookmarkedWorldIds),
    getCharacterRowsByIds(publicReadClient, recentCharacterIds),
    getWorldRowsByIds(publicReadClient, recentWorldIds),
  ]);

  const bookmarkCharacterMap = new Map(bookmarkCharacters.map((item) => [item.id, summarizeCharacter(item)]));
  const bookmarkWorldMap = new Map(bookmarkWorlds.map((item) => [item.id, summarizeWorld(item)]));
  const recentCharacterMap = new Map(viewedCharacters.map((item) => [item.id, summarizeCharacter(item)]));
  const recentWorldMap = new Map(viewedWorlds.map((item) => [item.id, summarizeWorld(item)]));

  return {
    bookmarks: (bookmarks || []).flatMap((item) => {
      const mapped = item.target_type === 'character' ? bookmarkCharacterMap.get(item.target_id) : bookmarkWorldMap.get(item.target_id);
      return mapped ? [{ id: item.id, entityType: item.target_type, item: mapped, createdAt: item.created_at }] : [];
    }),
    recentViews: (recentViews || []).flatMap((item) => {
      const mapped = item.target_type === 'character' ? recentCharacterMap.get(item.target_id) : recentWorldMap.get(item.target_id);
      return mapped ? [{ id: item.id, entityType: item.target_type, item: mapped, viewedAt: item.viewed_at }] : [];
    }),
    recentRooms,
    owned: {
      characters: (ownedCharacters || []).map(summarizeCharacter),
      worlds: (ownedWorlds || []).map(summarizeWorld),
    },
  };
};

export const createCharacter = async ({ event, userId, payload }) => {
  const client = await userClient(event);
  if (!client) return null;
  const creatorName = String(payload.creatorName || payload.profileJson?.creatorName || payload.promptProfileJson?.creatorName || '').trim();
  const insertPayload = {
    owner_user_id: userId,
    slug: payload.slug || createHash('sha1').update(`${userId}:${payload.name}:${Date.now()}`).digest('hex').slice(0, 10),
    name: payload.name,
    headline: payload.headline,
    summary: payload.summary,
    cover_image_url: payload.coverImageUrl,
    avatar_image_url: payload.avatarImageUrl || payload.coverImageUrl,
    visibility: payload.visibility,
    display_status: payload.visibility === 'public' ? 'visible' : 'draft',
    source_type: payload.sourceType,
    tags: payload.tags,
    profile_json: { creatorName, ...(payload.profileJson || { personality: payload.summary, relationship: '처음 대화를 시작하는 거리감' }) },
    speech_style_json: payload.speechStyleJson || { voice: payload.headline || payload.summary },
    prompt_profile_json: { creatorName, ...(payload.promptProfileJson || { persona: [payload.summary], speechStyle: [payload.headline || payload.summary], relationshipBaseline: '처음 대화를 시작하는 거리감' }) },
    published_at: payload.visibility === 'public' ? nowIso() : null,
  };
  const { data, error } = await client.from('characters').insert(insertPayload).select('*').single();
  if (error) throw error;
  if (Array.isArray(payload.assets) && payload.assets.length > 0) {
    const assetRows = payload.assets.map((asset) => ({ character_id: data.id, asset_kind: asset.kind, url: asset.url, width: asset.width, height: asset.height }));
    const { error: assetError } = await client.from('character_assets').insert(assetRows);
    if (assetError) throw assetError;
  }
  return summarizeCharacter(data);
};

export const createWorld = async ({ event, userId, payload }) => {
  const client = await userClient(event);
  if (!client) return null;
  const creatorName = String(payload.creatorName || payload.promptProfileJson?.creatorName || '').trim();
  const insertPayload = {
    owner_user_id: userId,
    slug: payload.slug || createHash('sha1').update(`${userId}:${payload.name}:${Date.now()}`).digest('hex').slice(0, 10),
    name: payload.name,
    headline: payload.headline,
    summary: payload.summary,
    cover_image_url: payload.coverImageUrl,
    visibility: payload.visibility,
    display_status: payload.visibility === 'public' ? 'visible' : 'draft',
    source_type: payload.sourceType,
    tags: payload.tags,
    world_rules_markdown: payload.worldRulesMarkdown,
    prompt_profile_json: { creatorName, ...(payload.promptProfileJson || { tone: payload.headline || payload.summary, rules: [payload.worldRulesMarkdown || payload.summary], starterLocations: ['첫 장면 위치'], worldTerms: payload.tags || [] }) },
    published_at: payload.visibility === 'public' ? nowIso() : null,
  };
  const { data, error } = await client.from('worlds').insert(insertPayload).select('*').single();
  if (error) throw error;
  if (Array.isArray(payload.assets) && payload.assets.length > 0) {
    const assetRows = payload.assets.map((asset) => ({ world_id: data.id, asset_kind: asset.kind, url: asset.url, width: asset.width, height: asset.height }));
    const { error: assetError } = await client.from('world_assets').insert(assetRows);
    if (assetError) throw assetError;
  }
  return summarizeWorld(data);
};

export const createCharacterWorldLink = async ({ event, userId, payload }) => {
  const client = await userClient(event);
  const publicReadClient = await publicClient();
  if (!client || !publicReadClient) return null;
  const character = await getCharacterRowBySlug(publicReadClient, payload.characterSlug);
  const world = await getWorldRowBySlug(publicReadClient, payload.worldSlug);
  if (!character || !world) return null;
  const { data, error } = await client.from('character_world_links').insert({
    character_id: character.id,
    world_id: world.id,
    owner_user_id: userId,
    is_recommended: payload.isRecommended !== false,
    link_reason: payload.linkReason,
    default_opening_context: payload.defaultOpeningContext || null,
    default_relationship_context: payload.defaultRelationshipContext || null,
  }).select('*').single();
  if (error) throw error;
  return {
    id: data.id,
    characterSlug: payload.characterSlug,
    worldSlug: payload.worldSlug,
    world: summarizeWorld(world),
    linkReason: data.link_reason,
    defaultOpeningContext: data.default_opening_context || '',
    defaultRelationshipContext: data.default_relationship_context || '',
  };
};

const buildGreetingMessage = ({ userAlias, characterName, bridgeProfile }) => ({
  role: 'assistant',
  content_json: {
    emotion: 'normal',
    inner_heart: '',
    response: bridgeProfile.entryMode === 'direct_character'
      ? `${userAlias || '나'}, 왔네. 어디부터 이야기할래?`
      : `${bridgeProfile.meetingTrigger} ${characterName}이 먼저 시선을 보냈다.`,
    ...(bridgeProfile.entryMode === 'in_world' ? { narration: `${bridgeProfile.startingLocation}에서 장면이 시작됩니다.` } : {}),
  },
});

const buildRoomSummaryFromContext = ({
  roomRow,
  character,
  world,
  bridgeProfile,
  state,
  greetingRow,
  greeting,
  userAlias,
}) => ({
  id: roomRow.id,
  title: roomRow.title,
  userAlias: userAlias || '나',
  character: summarizeCharacter(character),
  world: world ? summarizeWorld(world) : null,
  bridgeProfile,
  state,
  messages: [{
    id: greetingRow?.id || `assistant-${randomUUID()}`,
    role: 'assistant',
    createdAt: greetingRow?.created_at || nowIso(),
    content: greeting.content_json,
  }],
  createdAt: roomRow.created_at,
  updatedAt: roomRow.updated_at,
  lastMessageAt: roomRow.last_message_at,
});

export const createRoom = async ({ event, userId, characterSlug, worldSlug = null, userAlias = '나' }) => {
  const client = await userClient(event);
  const publicReadClient = await publicClient();
  if (!client || !publicReadClient) return null;
  const character = await getCharacterRowBySlug(publicReadClient, characterSlug);
  const world = worldSlug ? await getWorldRowBySlug(publicReadClient, worldSlug) : null;
  if (!character) return null;
  const link = world ? (await getCharacterWorldLinks(characterSlug)).find((item) => item.worldSlug === worldSlug) : null;
  const bridgeProfile = generateBridgeProfile({ character: {
    name: character.name,
    headline: character.headline,
    summary: character.summary,
    promptProfile: character.prompt_profile_json,
  }, world: world ? {
    name: world.name,
    headline: world.headline,
    summary: world.summary,
    promptProfile: world.prompt_profile_json,
  } : null, link });
  const state = createInitialRoomState({ bridgeProfile, world: world ? { promptProfile: world.prompt_profile_json } : null });
  const promptSnapshot = buildRoomPromptSnapshot({ character: {
    name: character.name,
    headline: character.headline,
    summary: character.summary,
    promptProfile: character.prompt_profile_json,
  }, world: world ? {
    name: world.name,
    headline: world.headline,
    summary: world.summary,
    promptProfile: world.prompt_profile_json,
  } : null, bridgeProfile, state });

  const { data: roomRow, error: roomError } = await client.from('rooms').insert({
    user_id: userId,
    character_id: character.id,
    world_id: world?.id || null,
    character_world_link_id: link?.id || null,
    user_alias: userAlias,
    title: world ? `${character.name} · ${world.name}` : character.name,
    bridge_profile_json: bridgeProfile,
    resolved_prompt_snapshot_json: promptSnapshot,
    last_message_at: nowIso(),
  }).select('*').single();
  if (roomError) {
    logServerWarn('[V-MATE] room insert failed', { message: roomError.message, code: roomError.code, userId, characterSlug, worldSlug });
    throw roomError;
  }

  const { error: stateError } = await client.from('room_state_summaries').insert({
    room_id: roomRow.id,
    current_situation: state.currentSituation,
    location: state.location,
    relationship_state: state.relationshipState,
    inventory_json: state.inventory,
    appearance_json: state.appearance,
    pose_json: state.pose,
    future_promises_json: state.futurePromises,
    world_notes_json: state.worldNotes,
  });
  if (stateError) {
    logServerWarn('[V-MATE] room state insert failed', { message: stateError.message, code: stateError.code, roomId: roomRow.id });
    throw stateError;
  }

  const greeting = buildGreetingMessage({ userAlias, characterName: character.name, bridgeProfile });
  const { data: greetingRow, error: messageError } = await client
    .from('room_messages')
    .insert({ room_id: roomRow.id, ...greeting })
    .select('id, created_at')
    .single();
  if (messageError) {
    logServerWarn('[V-MATE] room greeting insert failed', { message: messageError.message, code: messageError.code, roomId: roomRow.id });
    throw messageError;
  }

  await incrementChatStartCountsBestEffort({ client, character, world });

  return buildRoomSummaryFromContext({
    roomRow,
    character,
    world,
    bridgeProfile,
    state,
    greetingRow,
    greeting,
    userAlias,
  });
};

export const getRoom = async ({ event, roomId }) => {
  const client = await userClient(event);
  const publicReadClient = await publicClient();
  if (!client || !publicReadClient) return null;
  const { data: row, error } = await client.from('rooms').select('*').eq('id', roomId).maybeSingle();
  if (error) throw error;
  if (!row) return null;
  return hydrateRoom({ client, publicClientInstance: publicReadClient, row });
};

export const getRoomHistoryForModel = async ({ event, roomId }) => {
  const client = await userClient(event);
  if (!client) return [];
  const { data, error } = await client.from('room_messages').select('*').eq('room_id', roomId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map((item) => ({
    role: item.role,
    content: item.role === 'user' ? String(item.content_json?.text || '') : String(item.content_json?.response || ''),
  })).filter((item) => item.content);
};

export const getRoomPromptContext = async ({ event, roomId }) => {
  const client = await userClient(event);
  if (!client) return null;
  const { data, error } = await client.from('rooms').select('resolved_prompt_snapshot_json, bridge_profile_json').eq('id', roomId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    promptSnapshot: data.resolved_prompt_snapshot_json,
    bridgeProfile: data.bridge_profile_json,
  };
};

export const appendRoomMessages = async ({ event, roomId, userMessage, assistantMessage }) => {
  const client = await userClient(event);
  const publicReadClient = await publicClient();
  if (!client || !publicReadClient) return null;
  const room = await getRoom({ event, roomId });
  if (!room) return null;
  const nextState = updateRoomStateFromMessages({ state: clone(room.state), assistantMessage, userMessage });
  const { error: insertError } = await client.from('room_messages').insert([
    { room_id: roomId, role: 'user', content_json: { text: userMessage } },
    { room_id: roomId, role: 'assistant', content_json: assistantMessage },
  ]);
  if (insertError) throw insertError;
  const { error: stateError } = await client.from('room_state_summaries').update({
    current_situation: nextState.currentSituation,
    location: nextState.location,
    relationship_state: nextState.relationshipState,
    inventory_json: nextState.inventory,
    appearance_json: nextState.appearance,
    pose_json: nextState.pose,
    future_promises_json: nextState.futurePromises,
    world_notes_json: nextState.worldNotes,
    updated_at: nowIso(),
  }).eq('room_id', roomId);
  if (stateError) throw stateError;
  await client.from('rooms').update({ updated_at: nowIso(), last_message_at: nowIso() }).eq('id', roomId);
  const { data: roomRow } = await client.from('rooms').select('*').eq('id', roomId).single();
  return hydrateRoom({ client, publicClientInstance: publicReadClient, row: roomRow });
};

export const getOpsDashboard = async ({ event, userId }) => {
  const client = await userClient(event);
  if (!client) return null;
  const ownerMode = await isOwnerUser({ event, userId });
  const characterVisibleQuery = ownerMode
    ? client.from('characters').select('*').eq('display_status', 'visible')
    : client.from('characters').select('*').eq('owner_user_id', userId).eq('display_status', 'visible');
  const characterHiddenQuery = ownerMode
    ? client.from('characters').select('*').eq('display_status', 'hidden')
    : client.from('characters').select('*').eq('owner_user_id', userId).eq('display_status', 'hidden');
  const worldVisibleQuery = ownerMode
    ? client.from('worlds').select('*').eq('display_status', 'visible')
    : client.from('worlds').select('*').eq('owner_user_id', userId).eq('display_status', 'visible');
  const worldHiddenQuery = ownerMode
    ? client.from('worlds').select('*').eq('display_status', 'hidden')
    : client.from('worlds').select('*').eq('owner_user_id', userId).eq('display_status', 'hidden');
  const [charactersVisible, charactersHidden, worldsVisible, worldsHidden, heroSetting] = await Promise.all([
    characterVisibleQuery,
    characterHiddenQuery,
    worldVisibleQuery,
    worldHiddenQuery,
    getSetting(client, 'home.hero'),
  ]);
  return {
    items: {
      visibleCharacters: (charactersVisible.data || []).map(summarizeCharacter),
      hiddenCharacters: (charactersHidden.data || []).map(summarizeCharacter),
      visibleWorlds: (worldsVisible.data || []).map(summarizeWorld),
      hiddenWorlds: (worldsHidden.data || []).map(summarizeWorld),
    },
    home: {
      heroMode: heroSetting?.mode === 'manual' ? 'manual' : 'auto',
      heroTargetPath: typeof heroSetting?.targetPath === 'string' ? heroSetting.targetPath : '',
    },
  };
};

export const setContentVisibility = async ({ event, entityType, id, status }) => {
  const client = await userClient(event);
  if (!client) return false;
  const table = entityType === 'character' ? 'characters' : 'worlds';
  const { error } = await client.from(table).update({ display_status: status, updated_at: nowIso() }).or(`id.eq.${id},slug.eq.${id}`);
  if (error) throw error;
  return true;
};

export const deleteContent = async ({ event, entityType, id }) => {
  const client = await userClient(event);
  if (!client) return false;
  const table = entityType === 'character' ? 'characters' : 'worlds';
  const assetTable = entityType === 'character' ? 'character_assets' : 'world_assets';
  const fkColumn = entityType === 'character' ? 'character_id' : 'world_id';
  const { data: row, error: rowError } = await client.from(table).select('id').or(`id.eq.${id},slug.eq.${id}`).maybeSingle();
  if (rowError) throw rowError;
  if (!row?.id) return false;
  const { data: assets, error: assetError } = await client.from(assetTable).select('url').eq(fkColumn, row.id);
  if (assetError) throw assetError;
  await removeStorageObjectsByUrls({ client, urls: (assets || []).map((asset) => asset.url) });
  const { error } = await client.from(table).delete().eq('id', row.id);
  if (error) throw error;
  return true;
};

export const setHomeHeroTarget = async ({ event, targetPath }) => {
  const client = await userClient(event);
  if (!client) return null;
  const current = await getSetting(client, 'home.hero');
  const { error } = await client.from('app_settings').upsert({
    key: 'home.hero',
    value_json: {
      ...(current && typeof current === 'object' ? current : {}),
      targetPath,
    },
    updated_at: nowIso(),
  });
  if (error) throw error;
  return {
    heroMode: current?.mode === 'manual' ? 'manual' : 'auto',
    heroTargetPath: targetPath,
  };
};

export const setHomeHeroMode = async ({ event, mode }) => {
  const client = await userClient(event);
  if (!client) return null;
  const current = await getSetting(client, 'home.hero');
  const heroMode = mode === 'manual' ? 'manual' : 'auto';
  const { error } = await client.from('app_settings').upsert({
    key: 'home.hero',
    value_json: {
      ...(current && typeof current === 'object' ? current : {}),
      mode: heroMode,
    },
    updated_at: nowIso(),
  });
  if (error) throw error;
  return {
    heroMode,
    heroTargetPath: typeof current?.targetPath === 'string' ? current.targetPath : '',
  };
};

export const prepareAssetUploads = async ({ event, userId, entityType, variants }) => {
  const client = await userClient(event);
  if (!client) return null;
  const baseDir = `${userId}/${entityType}/${Date.now()}-${randomUUID().slice(0, 8)}`;
  const uploads = [];
  for (const variant of variants) {
    const path = `${baseDir}/${variant.kind}.webp`;
    const { data, error } = await client.storage.from(STORAGE_BUCKET).createSignedUploadUrl(path, { upsert: true });
    if (error) throw error;
    const { data: publicUrlData } = client.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    uploads.push({
      kind: variant.kind,
      width: variant.width,
      height: variant.height,
      path: data.path,
      token: data.token,
      signedUrl: data.signedUrl,
      publicUrl: publicUrlData.publicUrl,
      bucket: STORAGE_BUCKET,
    });
  }
  return { bucket: STORAGE_BUCKET, uploads };
};
