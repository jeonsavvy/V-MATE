import { createHash, randomUUID } from 'node:crypto';
import { extractBearerToken } from '../modules/auth-guard.js';
import { toSafeErrorMeta } from '../modules/safe-error-meta.js';
import { logServerWarn } from '../modules/server-logger.js';
import { normalizeQuotaResult } from './quota-contract.js';
import {
  ASSET_LIMITS,
  resolveCanonicalAssetPath,
  resolveCanonicalAssetPathsFromRows,
} from './asset-contracts.js';
import {
  claimStorageDeletionJob,
  confirmAuthUserAbsent,
  drainStorageDeletionOutbox,
  prepareStorageDeletionJob,
  processStorageDeletionJob,
} from './storage-deletion-saga.js';
import {
  buildConversationTurns,
  buildRecentRawHistory,
  buildRoomPromptSnapshot,
  buildRunningSummary,
  buildRuntimePromptSnapshot,
  buildStoredPromptSnapshot,
  createInitialRoomState,
  generateBridgeProfile,
  normalizeStoredPromptSnapshot,
  ROOM_MEMORY_CONFIG,
  shouldRefreshRunningSummary,
  updateRoomStateFromMessages,
} from './prompt-builder.js';

// Supabase persistence adapter는 platform API가 기대하는 동일한 메서드 집합을 DB/Storage 기반으로 구현한다.
const STORAGE_SCAN_LIMITS = Object.freeze({ maxEntries: 10_000, maxFolders: 1_000, maxDepth: 8, maxPages: 2_000 });
const CONTENT_REFERENCE_SCAN_LIMITS = Object.freeze({ maxRows: 10_000, maxAssets: 10_000, pageSize: 100, idBatchSize: 100 });
const ACCOUNT_STORAGE_CLEANUP_TABLE = 'account_storage_cleanup_fences';
const PUBLIC_CONTENT_VIEWS = Object.freeze({
  character: 'public_character_catalog',
  world: 'public_world_catalog',
});
const OWNED_CONTENT_VIEWS = Object.freeze({
  character: 'owned_character_details',
  world: 'owned_world_details',
});
const OWNED_ROOM_SUMMARY_VIEW = 'owned_room_summaries';
const CATALOG_LIMIT = 200;
const CATALOG_SEARCH_LIMIT = 160;
const RECENT_ROOM_LIMIT = 20;
const CHARACTER_BASE_SUMMARY_COLUMNS = [
  'id', 'owner_user_id', 'slug', 'name', 'headline', 'summary',
  'cover_image_url', 'avatar_image_url', 'visibility', 'display_status',
  'source_type', 'source_url', 'tags', 'favorite_count', 'chat_start_count',
  'rights_attested_at', 'published_at', 'created_at', 'updated_at',
].join(', ');
const WORLD_BASE_SUMMARY_COLUMNS = [
  'id', 'owner_user_id', 'slug', 'name', 'headline', 'summary',
  'cover_image_url', 'visibility', 'display_status', 'source_type',
  'source_url', 'tags', 'favorite_count', 'chat_start_count',
  'rights_attested_at', 'published_at', 'created_at', 'updated_at',
].join(', ');
const CHARACTER_SAFE_VIEW_COLUMNS = [
  CHARACTER_BASE_SUMMARY_COLUMNS,
  'creator_name', 'personality', 'voice', 'relationship',
  'hero_image_url', 'image_slots',
].join(', ');
const WORLD_SAFE_VIEW_COLUMNS = [
  WORLD_BASE_SUMMARY_COLUMNS,
  'creator_name', 'image_slots',
].join(', ');
const CHARACTER_OWNER_DETAIL_COLUMNS = [
  CHARACTER_SAFE_VIEW_COLUMNS,
  'profile_json', 'speech_style_json', 'prompt_profile_json',
].join(', ');
const WORLD_OWNER_DETAIL_COLUMNS = [
  WORLD_SAFE_VIEW_COLUMNS,
  'world_rules_markdown', 'prompt_profile_json',
].join(', ');
const ROOM_SAFE_VIEW_COLUMNS = [
  'id', 'user_id', 'character_id', 'world_id', 'user_alias', 'title',
  'last_message_at', 'created_at', 'updated_at', 'version',
].join(', ');
const CHARACTER_ROOM_CONTEXT_COLUMNS = [
  'id', 'owner_user_id', 'slug', 'name', 'headline', 'summary',
  'visibility', 'display_status', 'prompt_profile_json',
].join(', ');
const WORLD_ROOM_CONTEXT_COLUMNS = [
  'id', 'owner_user_id', 'slug', 'name', 'headline', 'summary',
  'visibility', 'display_status', 'prompt_profile_json',
].join(', ');
const SIGNED_UPLOAD_URL_TTL_MS = 2 * 60 * 60 * 1000;
const ACCOUNT_STORAGE_CLEANUP_BUFFER_MS = 10 * 60 * 1000;

const runtimeEnvironmentFromEvent = (event) => (
  event?.runtimeEnvironment || event?.context?.runtimeEnvironment || null
);
const resolveRuntimeEnvironment = (environment) => (
  environment && typeof environment === 'object' ? environment : process.env
);
const resolveStorageBucket = (environment) => String(
  resolveRuntimeEnvironment(environment).PUBLIC_ASSETS_BUCKET || 'vmate-assets'
).trim() || 'vmate-assets';

const resolveSupabaseConfig = (environment) => {
  const runtimeEnvironment = resolveRuntimeEnvironment(environment);
  const supabaseUrl = String(
    runtimeEnvironment.SUPABASE_URL
    || runtimeEnvironment.VITE_SUPABASE_URL
    || runtimeEnvironment.VITE_PUBLIC_SUPABASE_URL
    || ''
  ).trim().replace(/\/+$/, '');

  const supabaseAnonKey = String(
    runtimeEnvironment.SUPABASE_ANON_KEY
    || runtimeEnvironment.SUPABASE_PUBLISHABLE_KEY
    || runtimeEnvironment.VITE_SUPABASE_ANON_KEY
    || runtimeEnvironment.VITE_SUPABASE_PUBLISHABLE_KEY
    || runtimeEnvironment.VITE_PUBLIC_SUPABASE_ANON_KEY
    || runtimeEnvironment.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || ''
  ).trim();

  const supabaseServiceRoleKey = String(
    runtimeEnvironment.SUPABASE_SERVICE_ROLE_KEY
    || runtimeEnvironment.SUPABASE_SERVICE_KEY
    || ''
  ).trim();

  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    configured: Boolean(supabaseUrl && supabaseAnonKey),
  };
};

export const isPersistentPlatformAvailable = (environment) => resolveSupabaseConfig(environment).configured;
export const isPersistentPlatformRequired = (environment) => {
  const runtimeEnvironment = resolveRuntimeEnvironment(environment);
  const explicit = String(runtimeEnvironment.REQUIRE_CONFIGURED_SUPABASE_URL || '').trim().toLowerCase();
  if (explicit) return explicit !== 'false';
  const runtimeEnv = String(runtimeEnvironment.APP_ENV || runtimeEnvironment.NODE_ENV || '').trim().toLowerCase();
  return runtimeEnv === 'production' || runtimeEnv === 'prod';
};
export const isPersistentMutationAvailable = (environment) => {
  const config = resolveSupabaseConfig(environment);
  return Boolean(config.configured && config.supabaseServiceRoleKey);
};
export const getPlatformPersistenceConfig = (environment) => {
  const config = resolveSupabaseConfig(environment);
  return {
    supabaseUrl: config.supabaseUrl,
    storageBucket: resolveStorageBucket(environment),
    configured: config.configured,
    mutationConfigured: Boolean(config.configured && config.supabaseServiceRoleKey),
  };
};

let createClientPromise = null;
const getCreateClient = async () => {
  if (!createClientPromise) {
    createClientPromise = import('@supabase/supabase-js').then((module) => module.createClient);
  }
  return createClientPromise;
};

// 공개 조회와 사용자 권한 조회를 분리해 RLS 경계를 명확히 유지한다.
const createSupabaseClient = async ({ accessToken = '', asUser = false, runtimeEnvironment = null } = {}) => {
  const { supabaseUrl, supabaseAnonKey, configured } = resolveSupabaseConfig(runtimeEnvironment);
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

const publicClient = (runtimeEnvironment) => createSupabaseClient({ runtimeEnvironment });
const userClient = (event) => createSupabaseClient({
  accessToken: extractBearerToken(event?.headers),
  asUser: true,
  runtimeEnvironment: runtimeEnvironmentFromEvent(event),
});

const createSupabaseAdminClient = async (runtimeEnvironment) => {
  const { supabaseUrl, supabaseServiceRoleKey } = resolveSupabaseConfig(runtimeEnvironment);
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;
  const createClient = await getCreateClient();
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
};

const clone = (value) => structuredClone(value);
const nowIso = () => new Date().toISOString();

const toRoomStateSummary = (stateRow = {}) => ({
  currentSituation: stateRow.current_situation || '',
  location: stateRow.location || '',
  relationshipState: stateRow.relationship_state || '',
  inventory: stateRow.inventory_json || [],
  appearance: stateRow.appearance_json || [],
  pose: stateRow.pose_json || [],
  futurePromises: stateRow.future_promises_json || [],
  worldNotes: stateRow.world_notes_json || [],
});

export const resolveDataOrFallback = async ({ label, queryPromise, fallback }) => {
  try {
    const result = await queryPromise;
    if (result?.error) {
      logServerWarn('[V-MATE] Query failed, using fallback data', {
        ...toSafeErrorMeta(result.error),
      });
      return fallback;
    }
    return typeof result?.data === 'undefined' || result?.data === null ? fallback : result.data;
  } catch (error) {
    logServerWarn('[V-MATE] Query threw, using fallback data', {
      ...toSafeErrorMeta(error),
    });
    return fallback;
  }
};

export const resolveAsyncOrFallback = async ({ label, promise, fallback }) => {
  try {
    const value = await promise;
    return typeof value === 'undefined' || value === null ? fallback : value;
  } catch (error) {
    logServerWarn('[V-MATE] Async task threw, using fallback data', {
      ...toSafeErrorMeta(error),
    });
    return fallback;
  }
};

const dedupeRecentViewRows = (rows) => {
  const seen = new Set();
  return (rows || []).filter((row) => {
    const key = `${row?.target_type || ''}:${row?.target_id || ''}`;
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

export const mapLibraryEntriesToResolvedItems = ({
  entries,
  timestampKey,
  ownedCharacters = [],
  ownedWorlds = [],
  publicCharacters = [],
  publicWorlds = [],
}) => {
  const ownedCharacterMap = new Map((ownedCharacters || []).map((item) => [item.id, item]));
  const ownedWorldMap = new Map((ownedWorlds || []).map((item) => [item.id, item]));
  const publicCharacterMap = new Map((publicCharacters || []).map((item) => [item.id, item]));
  const publicWorldMap = new Map((publicWorlds || []).map((item) => [item.id, item]));

  return (entries || []).flatMap((entry) => {
    const item = entry.target_type === 'character'
      ? ownedCharacterMap.get(entry.target_id) || publicCharacterMap.get(entry.target_id)
      : ownedWorldMap.get(entry.target_id) || publicWorldMap.get(entry.target_id);

    if (!item) {
      return [];
    }

    return [{
      id: entry.id,
      entityType: entry.target_type,
      item,
      [timestampKey === 'viewed_at' ? 'viewedAt' : 'createdAt']: entry[timestampKey],
    }];
  });
};

const summarizeCharacter = (row) => ({
  id: row.id,
  entityType: 'character',
  slug: row.slug,
  name: row.name,
  headline: row.headline || '',
  summary: row.summary,
  coverImageUrl: row.cover_image_url || '',
  avatarImageUrl: row.avatar_image_url || row.cover_image_url || '',
  tags: Array.isArray(row.tags) ? row.tags : [],
  creator: {
    id: row.owner_user_id,
    slug: String(row.owner_user_id || ''),
    name: row.creator_name || row.profile_json?.creatorName || row.prompt_profile_json?.creatorName || '크리에이터',
  },
  visibility: row.visibility,
  displayStatus: row.display_status,
  sourceType: row.source_type,
  sourceUrl: row.source_url || '',
  rightsAttestedAt: row.rights_attested_at || '',
  heroImageUrl: row.hero_image_url || row.prompt_profile_json?.heroImageUrl || '',
  favoriteCount: Number(row.favorite_count || 0),
  chatStartCount: Number(row.chat_start_count || 0),
  updatedAt: row.updated_at || nowIso(),
  imageSlots: Array.isArray(row.image_slots)
    ? clone(row.image_slots)
    : Array.isArray(row.prompt_profile_json?.imageSlots) ? clone(row.prompt_profile_json.imageSlots) : [],
});

const summarizeWorld = (row) => ({
  id: row.id,
  entityType: 'world',
  slug: row.slug,
  name: row.name,
  headline: row.headline || '',
  summary: row.summary,
  coverImageUrl: row.cover_image_url || '',
  tags: Array.isArray(row.tags) ? row.tags : [],
  creator: {
    id: row.owner_user_id,
    slug: String(row.owner_user_id || ''),
    name: row.creator_name || row.prompt_profile_json?.creatorName || '크리에이터',
  },
  visibility: row.visibility,
  displayStatus: row.display_status,
  sourceType: row.source_type,
  sourceUrl: row.source_url || '',
  rightsAttestedAt: row.rights_attested_at || '',
  favoriteCount: Number(row.favorite_count || 0),
  chatStartCount: Number(row.chat_start_count || 0),
  updatedAt: row.updated_at || nowIso(),
  imageSlots: Array.isArray(row.image_slots)
    ? clone(row.image_slots)
    : Array.isArray(row.prompt_profile_json?.imageSlots) ? clone(row.prompt_profile_json.imageSlots) : [],
});

const resolveRequiredRows = async (queryPromise) => {
  const result = await queryPromise;
  if (result?.error) throw result.error;
  return Array.isArray(result?.data) ? result.data : [];
};

const basePublicContentQuery = (client, entityType) => client
  .from(PUBLIC_CONTENT_VIEWS[entityType])
  .select(entityType === 'character' ? CHARACTER_SAFE_VIEW_COLUMNS : WORLD_SAFE_VIEW_COLUMNS);

const escapeLikePattern = (value) => String(value || '').replace(/[\\%_]/g, (character) => `\\${character}`);

const buildCatalogQuery = (client, entityType, { search = '', filter = '' } = {}) => {
  let query = basePublicContentQuery(client, entityType);
  const normalizedSearch = String(search || '').trim().slice(0, CATALOG_SEARCH_LIMIT);
  if (normalizedSearch) {
    query = query.ilike('search_text', `%${escapeLikePattern(normalizedSearch)}%`);
  }
  if (filter === 'new') {
    query = query
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true });
  } else {
    query = query
      .order('chat_start_count', { ascending: false })
      .order('favorite_count', { ascending: false })
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true });
  }
  return query.limit(CATALOG_LIMIT);
};

export const listCharacters = async ({ event = null, search = '', filter = '', runtimeEnvironment = runtimeEnvironmentFromEvent(event) } = {}) => {
  const client = await publicClient(runtimeEnvironment);
  if (!client) return [];
  const { data, error } = await buildCatalogQuery(client, 'character', { search, filter });
  if (error) throw error;
  return (data || []).map(summarizeCharacter);
};

export const listWorlds = async ({ event = null, search = '', filter = '', runtimeEnvironment = runtimeEnvironmentFromEvent(event) } = {}) => {
  const client = await publicClient(runtimeEnvironment);
  if (!client) return [];
  const { data, error } = await buildCatalogQuery(client, 'world', { search, filter });
  if (error) throw error;
  return (data || []).map(summarizeWorld);
};

const getSetting = async (client, key) => {
  const { data } = await client.from('app_settings').select('value_json').eq('key', key).maybeSingle();
  return data?.value_json || null;
};

// 삭제 대상은 configured origin/bucket/owner/entity prefix를 모두 만족한 경로로 제한한다.
export const resolveStoragePathFromPublicUrl = (url, { ownerUserId, entityType, runtimeEnvironment = null } = {}) => {
  const { supabaseUrl } = resolveSupabaseConfig(runtimeEnvironment);
  return resolveCanonicalAssetPath({
    url,
    userId: ownerUserId,
    entityType,
    supabaseUrl,
    bucket: resolveStorageBucket(runtimeEnvironment),
  });
};

export const buildAssetStoragePath = ({ userId, entityType, uploadId, slot, variant }) => {
  const normalizedUserId = String(userId || '').trim();
  const normalizedUploadId = String(uploadId || '').trim();
  const normalizedSlot = String(slot || '').trim();
  const normalizedVariant = String(variant || '').trim();
  if (!/^[A-Za-z0-9-]{1,64}$/.test(normalizedUserId)
    || !['character', 'world'].includes(entityType)
    || !/^[0-9]{10,}-[A-Za-z0-9]{8}$/.test(normalizedUploadId)
    || !/^[A-Za-z0-9_-]{1,32}$/.test(normalizedSlot)
    || !/^[A-Za-z0-9_-]{1,32}$/.test(normalizedVariant)) return null;
  return `${normalizedUserId}/${entityType}/${normalizedUploadId}/${normalizedSlot}/${normalizedVariant}.webp`;
};

const resolveStoragePathsByUrls = ({ urls, ownerUserId, entityType, runtimeEnvironment = null }) => Array.from(new Set(
  urls.map((url) => resolveStoragePathFromPublicUrl(url, {
    ownerUserId,
    entityType,
    runtimeEnvironment,
  })).filter(Boolean),
));

const removeStorageObjectsByPaths = async ({ client, paths, bucket }) => {
  if (!paths.length) return 0;
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await client.storage.from(bucket).remove(paths.slice(index, index + 100));
    if (error) throw error;
  }
  return paths.length;
};

export const listOwnedStoragePaths = async ({
  client,
  userId,
  entityType,
  pageSize = 100,
  runtimeEnvironment = null,
}) => {
  if (!client || !userId || !['character', 'world'].includes(entityType)) return [];
  const rootPrefix = `${userId}/${entityType}`;
  const safePageSize = Math.max(1, Math.min(100, Math.floor(Number(pageSize) || 100)));
  const pending = [{ prefix: rootPrefix, depth: 0 }];
  const visited = new Set();
  const files = [];
  let scannedEntries = 0;
  let scannedPages = 0;
  while (pending.length) {
    const { prefix, depth } = pending.shift();
    if (visited.has(prefix)) continue;
    visited.add(prefix);
    if (visited.size > STORAGE_SCAN_LIMITS.maxFolders || depth > STORAGE_SCAN_LIMITS.maxDepth) {
      const error = new Error('Owned storage prefix exceeds the safe folder scan limit.');
      error.code = 'STORAGE_PREFIX_SCAN_LIMIT_EXCEEDED';
      throw error;
    }
    let offset = 0;
    while (true) {
      scannedPages += 1;
      if (scannedPages > STORAGE_SCAN_LIMITS.maxPages) {
        const error = new Error('Owned storage prefix exceeds the safe page scan limit.');
        error.code = 'STORAGE_PREFIX_SCAN_LIMIT_EXCEEDED';
        throw error;
      }
      const { data, error } = await client.storage.from(resolveStorageBucket(runtimeEnvironment)).list(prefix, {
        limit: safePageSize,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw error;
      const entries = data || [];
      scannedEntries += entries.length;
      if (scannedEntries > STORAGE_SCAN_LIMITS.maxEntries) {
        const error = new Error('Owned storage prefix exceeds the safe entry scan limit.');
        error.code = 'STORAGE_PREFIX_SCAN_LIMIT_EXCEEDED';
        throw error;
      }
      for (const entry of entries) {
        const name = String(entry?.name || '').trim();
        if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) continue;
        const path = `${prefix}/${name}`;
        if (!path.startsWith(`${rootPrefix}/`)) continue;
        if (entry?.id || entry?.metadata) files.push(path);
        else pending.push({ prefix: path, depth: depth + 1 });
      }
      if (entries.length < safePageSize) break;
      offset += safePageSize;
    }
  }
  return Array.from(new Set(files));
};

const removeAccountStorageObjectsByPrefix = async ({ client, userId, runtimeEnvironment = null }) => {
  const paths = [
    ...(await listOwnedStoragePaths({ client, userId, entityType: 'character', runtimeEnvironment })),
    ...(await listOwnedStoragePaths({ client, userId, entityType: 'world', runtimeEnvironment })),
  ];
  try {
    return await removeStorageObjectsByPaths({
      client,
      paths,
      bucket: resolveStorageBucket(runtimeEnvironment),
    });
  } catch (cause) {
    const error = new Error('Account storage cleanup state is unknown.');
    error.code = 'ACCOUNT_DELETE_STORAGE_STATE_UNKNOWN';
    error.cause = cause;
    throw error;
  }
};

const getAccountStorageCleanupFence = async ({ client, userId }) => {
  const result = await client
    .from(ACCOUNT_STORAGE_CLEANUP_TABLE)
    .select('user_id, cleanup_until')
    .eq('user_id', userId)
    .maybeSingle();
  if (result?.error) {
    const error = new Error('Account upload state could not be confirmed.');
    error.code = 'ASSET_UPLOAD_STATE_UNKNOWN';
    error.cause = result.error;
    throw error;
  }
  return result?.data || null;
};

const assertAssetUploadsAllowed = async ({ client, userId }) => {
  if (!await getAccountStorageCleanupFence({ client, userId })) return;
  const error = new Error('Account deletion is already in progress.');
  error.code = 'ACCOUNT_DELETE_IN_PROGRESS';
  throw error;
};

const beginAccountStorageCleanup = async ({ client, userId }) => {
  const requestedCleanupUntil = new Date(
    Date.now() + SIGNED_UPLOAD_URL_TTL_MS + ACCOUNT_STORAGE_CLEANUP_BUFFER_MS,
  ).toISOString();
  const result = await client.rpc('begin_account_storage_cleanup_v1', {
    p_user_id: userId,
    p_cleanup_until: requestedCleanupUntil,
  });
  if (result?.error || !result?.data) {
    const error = new Error('Account storage cleanup fence could not be created.');
    error.code = 'ACCOUNT_DELETE_STORAGE_STATE_UNKNOWN';
    error.cause = result?.error;
    throw error;
  }
  return String(result.data);
};

const throwIfSupabaseError = (label, result) => {
  if (result?.error) {
    const error = new Error(`${label}: ${result.error.message || 'Supabase operation failed'}`);
    error.cause = result.error;
    throw error;
  }
  return result;
};

export const collectLegacyContentAssetUrls = ({ entityType, row }) => {
  const urls = new Set();
  const pushUrl = (value) => {
    const normalized = String(value || '').trim();
    if (normalized) {
      urls.add(normalized);
    }
  };

  pushUrl(row?.cover_image_url);
  if (entityType === 'character') {
    pushUrl(row?.avatar_image_url);
  }

  const imageSlots = Array.isArray(row?.prompt_profile_json?.imageSlots)
    ? row.prompt_profile_json.imageSlots.slice(0, ASSET_LIMITS.slots)
    : [];
  for (const slot of imageSlots) {
    pushUrl(slot?.thumbUrl);
    pushUrl(slot?.cardUrl);
    pushUrl(slot?.detailUrl);
    pushUrl(slot?.heroUrl);
  }

  return Array.from(urls);
};

export const resolveContentAssetStoragePaths = ({
  entityType,
  row,
  assets = [],
  runtimeEnvironment = null,
}) => {
  const ownerUserId = String(row?.owner_user_id || '').trim();
  const { supabaseUrl } = resolveSupabaseConfig(runtimeEnvironment);
  const relationRows = Array.isArray(assets) ? assets : [];
  const canonicalPaths = resolveCanonicalAssetPathsFromRows({
    assets: relationRows,
    userId: ownerUserId,
    entityType,
    supabaseUrl,
    bucket: resolveStorageBucket(runtimeEnvironment),
  });
  if (relationRows.length > 0) return canonicalPaths;

  // Rows created before asset relations were required may only retain URL
  // projections. Keep that compatibility source bounded by the slot contract.
  return resolveStoragePathsByUrls({
    urls: collectLegacyContentAssetUrls({ entityType, row }),
    ownerUserId,
    entityType,
    runtimeEnvironment,
  });
};

export const isOwnerUser = async ({ event, userId }) => {
  const client = await userClient(event);
  if (!client || !userId) return false;
  const { data, error } = await client.rpc('is_owner_user');
  if (error) return false;
  return data === true;
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

// 카운터 증분은 실패하더라도 방 생성 자체를 막지 않도록 best-effort로 처리한다.
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
          isWorldCounter: operation.label === 'world',
          ...toSafeErrorMeta(result.error),
        });
      }
    } catch (error) {
      logServerWarn('[V-MATE] chat_start_count update threw and was ignored', {
        isWorldCounter: operation.label === 'world',
        ...toSafeErrorMeta(error),
      });
    }
  }
};

export const getHomePayload = async ({
  event = null,
  tab = 'characters',
  search = '',
  filter = '',
  characterFilter = filter,
  worldFilter = filter,
  runtimeEnvironment = runtimeEnvironmentFromEvent(event),
} = {}) => {
  const client = await publicClient(runtimeEnvironment);
  if (!client) return null;
  const [characters, worlds, heroSetting] = await Promise.all([
    listCharacters({ search, filter: characterFilter, runtimeEnvironment }),
    listWorlds({ search, filter: worldFilter, runtimeEnvironment }),
    getSetting(client, 'home.hero'),
  ]);
  const heroMode = heroSetting?.mode === 'manual' ? 'manual' : 'auto';
  const manualHero = resolveEntityByTargetPath({ targetPath: String(heroSetting?.targetPath || ''), characters, worlds });
  const hero = heroMode === 'manual' ? manualHero : null;
  return {
    home: {
      defaultTab: 'characters',
      filterChips: ['신작', '인기'],
      hero: hero ? {
        title: hero?.name || '캐릭터',
        subtitle: hero?.headline || hero?.summary || '',
        coverImageUrl: hero?.heroImageUrl || hero?.coverImageUrl || '',
        targetPath: hero?.entityType === 'world' ? `/worlds/${hero.slug}` : `/characters/${hero?.slug || characters[0]?.slug || ''}`,
      } : null,
      characterFeed: { items: characters },
      worldFeed: { items: worlds },
    },
  };
};

const getCharacterRowBySlug = async (client, slug) => {
  const { data, error } = await basePublicContentQuery(client, 'character').eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data;
};

const getCharacterRowById = async (client, id) => {
  const { data, error } = await basePublicContentQuery(client, 'character').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
};

const getWorldRowBySlug = async (client, slug) => {
  const { data, error } = await basePublicContentQuery(client, 'world').eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data;
};

const getWorldRowById = async (client, id) => {
  const { data, error } = await basePublicContentQuery(client, 'world').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
};

const getOwnedCharacterRowBySlug = async (client, slug, userId, { includeAuthoring = false } = {}) => {
  if (!client || !userId) return null;
  const columns = includeAuthoring ? CHARACTER_OWNER_DETAIL_COLUMNS : CHARACTER_SAFE_VIEW_COLUMNS;
  const { data, error } = await client.from(OWNED_CONTENT_VIEWS.character).select(columns).eq('owner_user_id', userId).eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data;
};

const getOwnedCharacterRowById = async (client, id, userId) => {
  if (!client || !userId) return null;
  const { data, error } = await client.from(OWNED_CONTENT_VIEWS.character).select(CHARACTER_SAFE_VIEW_COLUMNS).eq('owner_user_id', userId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
};

const getOwnedWorldRowBySlug = async (client, slug, userId, { includeAuthoring = false } = {}) => {
  if (!client || !userId) return null;
  const columns = includeAuthoring ? WORLD_OWNER_DETAIL_COLUMNS : WORLD_SAFE_VIEW_COLUMNS;
  const { data, error } = await client.from(OWNED_CONTENT_VIEWS.world).select(columns).eq('owner_user_id', userId).eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data;
};

const getOwnedWorldRowById = async (client, id, userId) => {
  if (!client || !userId) return null;
  const { data, error } = await client.from(OWNED_CONTENT_VIEWS.world).select(WORLD_SAFE_VIEW_COLUMNS).eq('owner_user_id', userId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
};

const getWorldRowsByIds = async (client, ids) => {
  if (!ids.length) return [];
  const { data, error } = await basePublicContentQuery(client, 'world').in('id', ids);
  if (error) throw error;
  return data || [];
};

const getCharacterRowsByIds = async (client, ids) => {
  if (!ids.length) return [];
  const { data, error } = await basePublicContentQuery(client, 'character').in('id', ids);
  if (error) throw error;
  return data || [];
};

const getOwnedWorldRowsByIds = async (client, ids, userId) => {
  if (!client || !ids.length || !userId) return [];
  const { data, error } = await client.from(OWNED_CONTENT_VIEWS.world).select(WORLD_SAFE_VIEW_COLUMNS).eq('owner_user_id', userId).in('id', ids);
  if (error) throw error;
  return data || [];
};

const getOwnedCharacterRowsByIds = async (client, ids, userId) => {
  if (!client || !ids.length || !userId) return [];
  const { data, error } = await client.from(OWNED_CONTENT_VIEWS.character).select(CHARACTER_SAFE_VIEW_COLUMNS).eq('owner_user_id', userId).in('id', ids);
  if (error) throw error;
  return data || [];
};

const mergeRowsById = (primaryRows, fallbackRows) => {
  const merged = new Map();
  for (const row of fallbackRows || []) {
    if (row?.id) {
      merged.set(row.id, row);
    }
  }
  for (const row of primaryRows || []) {
    if (row?.id) {
      merged.set(row.id, row);
    }
  }
  return Array.from(merged.values());
};

export const getCharacterDetail = async (input) => {
  const slug = typeof input === 'string' ? input : input?.slug;
  const event = typeof input === 'string' ? null : input?.event;
  const userId = typeof input === 'string' ? '' : String(input?.userId || '');
  const runtimeEnvironment = input?.runtimeEnvironment || runtimeEnvironmentFromEvent(event);
  const client = await publicClient(runtimeEnvironment);
  const authenticatedClient = userId ? await userClient(event) : null;
  if (!client) return null;
  const character = await getOwnedCharacterRowBySlug(authenticatedClient, slug, userId, { includeAuthoring: true })
    || await getCharacterRowBySlug(client, slug);
  if (!character) return null;
  const readClient = character.owner_user_id === userId && authenticatedClient ? authenticatedClient : client;
  const { data: assets, error: assetError } = await readClient.from('character_assets').select('url').eq('character_id', character.id).order('created_at', { ascending: true });
  if (assetError) throw assetError;
  const isOwner = Boolean(userId) && character.owner_user_id === userId;
  const profileJson = isOwner ? character.profile_json || {} : {};
  const speechJson = isOwner ? character.speech_style_json || {} : {};
  const sections = [
    (isOwner ? profileJson.personality : character.personality) ? { title: '성격', body: String(isOwner ? profileJson.personality : character.personality) } : null,
    (isOwner ? speechJson.voice : character.voice) ? { title: '말투', body: String(isOwner ? speechJson.voice : character.voice) } : null,
    (isOwner ? profileJson.relationship : character.relationship) ? { title: '관계감', body: String(isOwner ? profileJson.relationship : character.relationship) } : null,
  ].filter(Boolean);
  return {
    ...summarizeCharacter(character),
    profileSections: sections.length ? sections : [{ title: '설정', body: character.summary }],
    gallery: (assets || []).map((item) => item.url),
    ...(isOwner ? {
      imageSlots: Array.isArray(character.prompt_profile_json?.imageSlots)
        ? clone(character.prompt_profile_json.imageSlots.slice(0, 6))
        : [],
      profileJson,
      speechStyleJson: speechJson,
      promptProfileJson: character.prompt_profile_json || {},
    } : {}),
  };
};

export const getWorldDetail = async (input) => {
  const slug = typeof input === 'string' ? input : input?.slug;
  const event = typeof input === 'string' ? null : input?.event;
  const userId = typeof input === 'string' ? '' : String(input?.userId || '');
  const runtimeEnvironment = input?.runtimeEnvironment || runtimeEnvironmentFromEvent(event);
  const client = await publicClient(runtimeEnvironment);
  const authenticatedClient = userId ? await userClient(event) : null;
  if (!client) return null;
  const world = await getOwnedWorldRowBySlug(authenticatedClient, slug, userId, { includeAuthoring: true })
    || await getWorldRowBySlug(client, slug);
  if (!world) return null;
  const isOwner = Boolean(userId) && world.owner_user_id === userId;
  const readClient = world.owner_user_id === userId && authenticatedClient ? authenticatedClient : client;
  const { data: assets, error: assetError } = await readClient.from('world_assets').select('url').eq('world_id', world.id).order('created_at', { ascending: true });
  if (assetError) throw assetError;
  return {
    ...summarizeWorld(world),
    worldSections: [{ title: '월드 소개', body: world.summary }],
    gallery: (assets || []).map((item) => item.url),
    characters: [],
    ...(isOwner ? {
      imageSlots: Array.isArray(world.prompt_profile_json?.imageSlots)
        ? clone(world.prompt_profile_json.imageSlots.slice(0, 6))
        : [],
      worldRulesMarkdown: world.world_rules_markdown || '',
      promptProfileJson: world.prompt_profile_json || {},
    } : {}),
  };
};

export const resolveEntityByRef = async ({ publicClientInstance, userClientInstance, userId, entityType, ref }) => {
  if (entityType === 'character') {
    const row = await getOwnedCharacterRowBySlug(userClientInstance, ref, userId) || await getCharacterRowBySlug(publicClientInstance, ref);
    return row ? { row, summary: summarizeCharacter(row) } : null;
  }
  const row = await getOwnedWorldRowBySlug(userClientInstance, ref, userId) || await getWorldRowBySlug(publicClientInstance, ref);
  return row ? { row, summary: summarizeWorld(row) } : null;
};

export const resolveEntityById = async ({ publicClientInstance, userClientInstance, userId, entityType, id }) => {
  if (entityType === 'character') {
    const row = await getOwnedCharacterRowById(userClientInstance, id, userId) || await getCharacterRowById(publicClientInstance, id);
    return row ? { row, summary: summarizeCharacter(row) } : null;
  }
  const row = await getOwnedWorldRowById(userClientInstance, id, userId) || await getWorldRowById(publicClientInstance, id);
  return row ? { row, summary: summarizeWorld(row) } : null;
};

export const persistRecentView = async ({ client, userId, entityType, targetId, viewedAt }) => {
  const payload = {
    user_id: userId,
    target_type: entityType,
    target_id: targetId,
    viewed_at: viewedAt,
  };

  const { error } = await client
    .from('recent_views')
    .upsert(payload, { onConflict: 'user_id,target_type,target_id' });

  if (!error) {
    return true;
  }

  const message = error?.message || String(error);
  const shouldFallbackToReplace =
    /on conflict/i.test(message) ||
    /constraint/i.test(message) ||
    /unique/i.test(message);

  if (!shouldFallbackToReplace) {
    throw error;
  }

  logServerWarn('[V-MATE] recent_views upsert fallback to replace flow', {
    usedReplaceFallback: true,
    ...toSafeErrorMeta(error),
  });

  const { error: deleteError } = await client
    .from('recent_views')
    .delete()
    .eq('user_id', userId)
    .eq('target_type', entityType)
    .eq('target_id', targetId);
  if (deleteError) throw deleteError;

  const { error: insertError } = await client.from('recent_views').insert(payload);
  if (insertError) throw insertError;
  return true;
};

export const addRecentView = async ({ event, userId, entityType, ref }) => {
  const client = await userClient(event);
  const publicReadClient = await publicClient(runtimeEnvironmentFromEvent(event));
  if (!client || !publicReadClient) return null;
  const entity = await resolveEntityByRef({ publicClientInstance: publicReadClient, userClientInstance: client, userId, entityType, ref });
  if (!entity) return null;
  return persistRecentView({
    client,
    userId,
    entityType,
    targetId: entity.row.id,
    viewedAt: nowIso(),
  });
};

export const getBookmarkStatus = async ({ event, userId, entityType, targetId }) => {
  if (!userId || !['character', 'world'].includes(entityType) || !targetId) return false;
  const client = await userClient(event);
  if (!client) return false;
  const { data, error } = await client
    .from('bookmarks')
    .select('id')
    .eq('user_id', userId)
    .eq('target_type', entityType)
    .eq('target_id', targetId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
};

export const toggleBookmark = async ({ event, userId, entityType, ref }) => {
  const client = await userClient(event);
  const publicReadClient = await publicClient(runtimeEnvironmentFromEvent(event));
  if (!client || !publicReadClient) return null;
  const entity = await resolveEntityByRef({ publicClientInstance: publicReadClient, userClientInstance: client, userId, entityType, ref });
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

const mapRoomMessage = (message) => ({
  id: message.id,
  role: message.role,
  createdAt: message.created_at,
  content: message.role === 'user'
    ? String(message.content_json?.text || '')
    : message.content_json,
});

const toHydratedRoom = ({ row, characterRow, worldRow = null, stateRow = {}, messageRows = [] }) => {
  if (!characterRow) return null;
  return {
    id: row.id,
    title: row.title,
    userAlias: row.user_alias || '나',
    character: summarizeCharacter(characterRow),
    world: worldRow ? summarizeWorld(worldRow) : null,
    state: toRoomStateSummary(stateRow),
    messages: messageRows.map(mapRoomMessage),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
    version: Number(row.version || 0),
  };
};

const hydrateRoom = async ({ client, publicClientInstance, row }) => {
  const [publicCharacterRows, ownedCharacterRows, publicWorldRows, ownedWorldRows, stateRows, messageRows] = await Promise.all([
    getCharacterRowsByIds(publicClientInstance, [row.character_id]),
    getOwnedCharacterRowsByIds(client, [row.character_id], row.user_id),
    row.world_id ? getWorldRowsByIds(publicClientInstance, [row.world_id]) : Promise.resolve([]),
    row.world_id ? getOwnedWorldRowsByIds(client, [row.world_id], row.user_id) : Promise.resolve([]),
    client.from('room_state_summaries').select('*').eq('room_id', row.id).maybeSingle(),
    client.from('room_messages').select('*').eq('room_id', row.id).order('sequence_no', { ascending: true }).order('created_at', { ascending: true }),
  ]);
  if (stateRows.error) throw stateRows.error;
  if (messageRows.error) throw messageRows.error;

  const characterRows = mergeRowsById(publicCharacterRows, ownedCharacterRows);
  const worldRows = mergeRowsById(publicWorldRows, ownedWorldRows);
  return toHydratedRoom({
    row,
    characterRow: characterRows[0],
    worldRow: worldRows[0],
    stateRow: stateRows.data || {},
    messageRows: messageRows.data || [],
  });
};

const normalizeRecentRoomLimit = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(RECENT_ROOM_LIMIT, Math.floor(parsed)))
    : RECENT_ROOM_LIMIT;
};

const hydrateRoomsBatch = async ({ client, publicClientInstance, rows, userId, includeMessages }) => {
  if (!rows.length) return [];
  const characterIds = Array.from(new Set(rows.map((row) => row.character_id).filter(Boolean)));
  const worldIds = Array.from(new Set(rows.map((row) => row.world_id).filter(Boolean)));
  const roomIds = rows.map((row) => row.id);
  const [publicCharacterRows, ownedCharacterRows, publicWorldRows, ownedWorldRows, stateResult, messageResult] = await Promise.all([
    getCharacterRowsByIds(publicClientInstance, characterIds),
    getOwnedCharacterRowsByIds(client, characterIds, userId),
    getWorldRowsByIds(publicClientInstance, worldIds),
    getOwnedWorldRowsByIds(client, worldIds, userId),
    client.from('room_state_summaries').select('*').in('room_id', roomIds),
    includeMessages
      ? client.from('room_messages').select('*').in('room_id', roomIds).order('room_id', { ascending: true }).order('sequence_no', { ascending: true }).order('created_at', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (stateResult.error) throw stateResult.error;
  if (messageResult.error) throw messageResult.error;

  const characterById = new Map(mergeRowsById(publicCharacterRows, ownedCharacterRows).map((row) => [row.id, row]));
  const worldById = new Map(mergeRowsById(publicWorldRows, ownedWorldRows).map((row) => [row.id, row]));
  const stateByRoomId = new Map((stateResult.data || []).map((row) => [row.room_id, row]));
  const messagesByRoomId = new Map();
  for (const message of messageResult.data || []) {
    if (!messagesByRoomId.has(message.room_id)) messagesByRoomId.set(message.room_id, []);
    messagesByRoomId.get(message.room_id).push(message);
  }

  return rows.flatMap((row) => {
    const room = toHydratedRoom({
      row,
      characterRow: characterById.get(row.character_id),
      worldRow: worldById.get(row.world_id),
      stateRow: stateByRoomId.get(row.id) || {},
      messageRows: includeMessages ? messagesByRoomId.get(row.id) || [] : [],
    });
    return room ? [room] : [];
  });
};

export const listRecentRooms = async ({ event, userId, limit = RECENT_ROOM_LIMIT, includeMessages = true }) => {
  const client = await userClient(event);
  const publicReadClient = await publicClient(runtimeEnvironmentFromEvent(event));
  if (!client || !publicReadClient) return [];
  const boundedLimit = normalizeRecentRoomLimit(limit);
  const { data, error } = await client.from(OWNED_ROOM_SUMMARY_VIEW).select(ROOM_SAFE_VIEW_COLUMNS).eq('user_id', userId).order('updated_at', { ascending: false }).limit(boundedLimit);
  if (error) throw error;
  try {
    return await hydrateRoomsBatch({
      client,
      publicClientInstance: publicReadClient,
      rows: data || [],
      userId,
      includeMessages: includeMessages !== false,
    });
  } catch (hydrateError) {
    logServerWarn('[V-MATE] Recent room batch hydrate failed', {
      ...toSafeErrorMeta(hydrateError),
    });
    throw hydrateError;
  }
};

export const getLibraryPayload = async ({ event, userId, includeRecentRooms = true }) => {
  const client = await userClient(event);
  const publicReadClient = await publicClient(runtimeEnvironmentFromEvent(event));
  if (!client || !publicReadClient) return null;

  try {
    const [bookmarks, recentViewsRaw, recentRooms, ownedCharacters, ownedWorlds] = await Promise.all([
      resolveRequiredRows(client.from('bookmarks').select('*').eq('user_id', userId).order('created_at', { ascending: false })),
      resolveRequiredRows(client.from('recent_views').select('*').eq('user_id', userId).order('viewed_at', { ascending: false }).limit(20)),
      includeRecentRooms ? listRecentRooms({ event, userId }) : Promise.resolve([]),
      resolveRequiredRows(client.from(OWNED_CONTENT_VIEWS.character).select(CHARACTER_SAFE_VIEW_COLUMNS).eq('owner_user_id', userId).order('updated_at', { ascending: false })),
      resolveRequiredRows(client.from(OWNED_CONTENT_VIEWS.world).select(WORLD_SAFE_VIEW_COLUMNS).eq('owner_user_id', userId).order('updated_at', { ascending: false })),
    ]);

    const recentViews = dedupeRecentViewRows(recentViewsRaw);

    const unresolvedBookmarkCharacterIds = (bookmarks || [])
      .filter((item) => item.target_type === 'character' && !ownedCharacters.some((row) => row.id === item.target_id))
      .map((item) => item.target_id);
    const unresolvedBookmarkWorldIds = (bookmarks || [])
      .filter((item) => item.target_type === 'world' && !ownedWorlds.some((row) => row.id === item.target_id))
      .map((item) => item.target_id);
    const unresolvedRecentCharacterIds = recentViews
      .filter((item) => item.target_type === 'character' && !ownedCharacters.some((row) => row.id === item.target_id))
      .map((item) => item.target_id);
    const unresolvedRecentWorldIds = recentViews
      .filter((item) => item.target_type === 'world' && !ownedWorlds.some((row) => row.id === item.target_id))
      .map((item) => item.target_id);

    const [publicBookmarkCharacters, publicBookmarkWorlds, publicRecentCharacters, publicRecentWorlds] = await Promise.all([
      getCharacterRowsByIds(publicReadClient, unresolvedBookmarkCharacterIds),
      getWorldRowsByIds(publicReadClient, unresolvedBookmarkWorldIds),
      getCharacterRowsByIds(publicReadClient, unresolvedRecentCharacterIds),
      getWorldRowsByIds(publicReadClient, unresolvedRecentWorldIds),
    ]);

    const resolvedBookmarks = mapLibraryEntriesToResolvedItems({
      entries: bookmarks,
      timestampKey: 'created_at',
      ownedCharacters: ownedCharacters.map(summarizeCharacter),
      ownedWorlds: ownedWorlds.map(summarizeWorld),
      publicCharacters: publicBookmarkCharacters.map(summarizeCharacter),
      publicWorlds: publicBookmarkWorlds.map(summarizeWorld),
    });

    const resolvedRecentViews = mapLibraryEntriesToResolvedItems({
      entries: recentViews,
      timestampKey: 'viewed_at',
      ownedCharacters: ownedCharacters.map(summarizeCharacter),
      ownedWorlds: ownedWorlds.map(summarizeWorld),
      publicCharacters: publicRecentCharacters.map(summarizeCharacter),
      publicWorlds: publicRecentWorlds.map(summarizeWorld),
    });

    return {
      bookmarks: resolvedBookmarks,
      recentViews: resolvedRecentViews,
      recentRooms,
      owned: {
        characters: ownedCharacters.map(summarizeCharacter),
        worlds: ownedWorlds.map(summarizeWorld),
      },
    };
  } catch (error) {
    logServerWarn('[V-MATE] Library read failed', {
      ...toSafeErrorMeta(error),
    });
    throw error;
  }
};

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const assetKindForRow = (asset) => String(asset?.variant || asset?.kind || '').split(':').pop();
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
const matchContentIdOrSlug = (query, value) => query.eq(isUuid(value) ? 'id' : 'slug', value);

export const buildCharacterWritePayload = ({ payload, existing = null, create = false, userId }) => {
  const output = create ? {
    owner_user_id: userId,
    slug: payload.slug || createHash('sha1').update(`${userId}:${payload.name}:${Date.now()}`).digest('hex').slice(0, 10),
  } : {};
  const map = {
    name: 'name',
    headline: 'headline',
    summary: 'summary',
    coverImageUrl: 'cover_image_url',
    avatarImageUrl: 'avatar_image_url',
    visibility: 'visibility',
    sourceType: 'source_type',
    sourceUrl: 'source_url',
    tags: 'tags',
  };
  for (const [source, target] of Object.entries(map)) {
    if (create || hasOwn(payload, source)) output[target] = source === 'sourceUrl' ? payload[source] || null : payload[source];
  }
  if (create && !output.avatar_image_url) output.avatar_image_url = output.cover_image_url || '';
  const creatorName = String(
    payload.creatorName
    ?? payload.profileJson?.creatorName
    ?? payload.promptProfileJson?.creatorName
    ?? existing?.profile_json?.creatorName
    ?? existing?.prompt_profile_json?.creatorName
    ?? ''
  ).trim();
  if (create || hasOwn(payload, 'profileJson') || hasOwn(payload, 'creatorName')) {
    output.profile_json = {
      ...(create ? { personality: payload.summary, relationship: '처음 대화를 시작하는 거리감' } : {}),
      ...(existing?.profile_json || {}),
      ...(payload.profileJson || {}),
      creatorName,
    };
  }
  if (create || hasOwn(payload, 'speechStyleJson')) {
    output.speech_style_json = {
      ...(create ? { voice: payload.headline || payload.summary } : {}),
      ...(existing?.speech_style_json || {}),
      ...(payload.speechStyleJson || {}),
    };
  }
  if (create || hasOwn(payload, 'promptProfileJson') || hasOwn(payload, 'creatorName')) {
    output.prompt_profile_json = {
      ...(create ? {
        persona: [payload.summary],
        speechStyle: [payload.headline || payload.summary],
        relationshipBaseline: '처음 대화를 시작하는 거리감',
      } : {}),
      ...(existing?.prompt_profile_json || {}),
      ...(payload.promptProfileJson || {}),
      creatorName,
    };
  }
  if (create || hasOwn(payload, 'visibility')) {
    output.display_status = payload.visibility === 'public' ? 'visible' : 'draft';
    output.published_at = payload.visibility === 'public' ? nowIso() : null;
  }
  if (payload.visibility === 'public' && payload.rightsConfirmed) output.rights_attested_at = nowIso();
  if (!create) output.updated_at = nowIso();
  return output;
};

export const buildWorldWritePayload = ({ payload, existing = null, create = false, userId }) => {
  const output = create ? {
    owner_user_id: userId,
    slug: payload.slug || createHash('sha1').update(`${userId}:${payload.name}:${Date.now()}`).digest('hex').slice(0, 10),
  } : {};
  const map = {
    name: 'name',
    headline: 'headline',
    summary: 'summary',
    coverImageUrl: 'cover_image_url',
    visibility: 'visibility',
    sourceType: 'source_type',
    sourceUrl: 'source_url',
    tags: 'tags',
    worldRulesMarkdown: 'world_rules_markdown',
  };
  for (const [source, target] of Object.entries(map)) {
    if (create || hasOwn(payload, source)) output[target] = source === 'sourceUrl' ? payload[source] || null : payload[source];
  }
  const creatorName = String(
    payload.creatorName
    ?? payload.promptProfileJson?.creatorName
    ?? existing?.prompt_profile_json?.creatorName
    ?? ''
  ).trim();
  if (create || hasOwn(payload, 'promptProfileJson') || hasOwn(payload, 'creatorName')) {
    output.prompt_profile_json = {
      ...(create ? {
        tone: payload.headline || payload.summary,
        rules: [payload.worldRulesMarkdown || payload.summary],
        starterLocations: ['첫 장면 위치'],
        worldTerms: payload.tags || [],
      } : {}),
      ...(existing?.prompt_profile_json || {}),
      ...(payload.promptProfileJson || {}),
      creatorName,
    };
  }
  if (create || hasOwn(payload, 'visibility')) {
    output.display_status = payload.visibility === 'public' ? 'visible' : 'draft';
    output.published_at = payload.visibility === 'public' ? nowIso() : null;
  }
  if (payload.visibility === 'public' && payload.rightsConfirmed) output.rights_attested_at = nowIso();
  if (!create) output.updated_at = nowIso();
  return output;
};

export const createCharacter = async ({ event = null, userId, payload, runtimeEnvironment = runtimeEnvironmentFromEvent(event) }) => {
  const client = await createSupabaseAdminClient(runtimeEnvironment);
  if (!client) return null;
  const insertPayload = buildCharacterWritePayload({ payload, create: true, userId });
  const { data, error } = await client.from('characters').insert(insertPayload).select(CHARACTER_BASE_SUMMARY_COLUMNS).single();
  if (error) throw error;
  if (Array.isArray(payload.assets) && payload.assets.length > 0) {
    const assetRows = payload.assets.map((asset) => ({ character_id: data.id, asset_kind: assetKindForRow(asset), url: asset.url, width: asset.width, height: asset.height }));
    const { error: assetError } = await client.from('character_assets').insert(assetRows);
    if (assetError) throw assetError;
  }
  return summarizeCharacter({ ...insertPayload, ...data });
};

export const updateCharacter = async ({ event = null, userId, slug, payload, runtimeEnvironment = runtimeEnvironmentFromEvent(event) }) => {
  const client = await createSupabaseAdminClient(runtimeEnvironment);
  if (!client) return null;
  const { data: existing, error: existingError } = await client
    .from('characters')
    .select('id, profile_json, speech_style_json, prompt_profile_json')
    .eq('owner_user_id', userId)
    .eq('slug', slug)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) return null;
  const updatePayload = buildCharacterWritePayload({ payload, existing, userId });
  const { data, error } = await client
    .from('characters')
    .update(updatePayload)
    .eq('owner_user_id', userId)
    .eq('slug', slug)
    .select(CHARACTER_BASE_SUMMARY_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (Array.isArray(payload.assets) && payload.assets.length > 0) {
    const assetRows = payload.assets.map((asset) => ({ character_id: data.id, asset_kind: assetKindForRow(asset), url: asset.url, width: asset.width, height: asset.height }));
    const { error: assetError } = await client.from('character_assets').insert(assetRows);
    if (assetError) throw assetError;
  }
  return summarizeCharacter({ ...existing, ...updatePayload, ...data });
};

export const createWorld = async ({ event = null, userId, payload, runtimeEnvironment = runtimeEnvironmentFromEvent(event) }) => {
  const client = await createSupabaseAdminClient(runtimeEnvironment);
  if (!client) return null;
  const insertPayload = buildWorldWritePayload({ payload, create: true, userId });
  const { data, error } = await client.from('worlds').insert(insertPayload).select(WORLD_BASE_SUMMARY_COLUMNS).single();
  if (error) throw error;
  if (Array.isArray(payload.assets) && payload.assets.length > 0) {
    const assetRows = payload.assets.map((asset) => ({ world_id: data.id, asset_kind: assetKindForRow(asset), url: asset.url, width: asset.width, height: asset.height }));
    const { error: assetError } = await client.from('world_assets').insert(assetRows);
    if (assetError) throw assetError;
  }
  return summarizeWorld({ ...insertPayload, ...data });
};

export const updateWorld = async ({ event = null, userId, slug, payload, runtimeEnvironment = runtimeEnvironmentFromEvent(event) }) => {
  const client = await createSupabaseAdminClient(runtimeEnvironment);
  if (!client) return null;
  const { data: existing, error: existingError } = await client
    .from('worlds')
    .select('id, prompt_profile_json')
    .eq('owner_user_id', userId)
    .eq('slug', slug)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) return null;
  const updatePayload = buildWorldWritePayload({ payload, existing, userId });
  const { data, error } = await client
    .from('worlds')
    .update(updatePayload)
    .eq('owner_user_id', userId)
    .eq('slug', slug)
    .select(WORLD_BASE_SUMMARY_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (Array.isArray(payload.assets) && payload.assets.length > 0) {
    const assetRows = payload.assets.map((asset) => ({ world_id: data.id, asset_kind: assetKindForRow(asset), url: asset.url, width: asset.width, height: asset.height }));
    const { error: assetError } = await client.from('world_assets').insert(assetRows);
    if (assetError) throw assetError;
  }
  return summarizeWorld({ ...existing, ...updatePayload, ...data });
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

export const createRoom = async ({ event, userId, characterSlug, worldSlug = null, userAlias = '나' }) => {
  const client = await createSupabaseAdminClient(runtimeEnvironmentFromEvent(event));
  if (!client) return null;
  const { data: character, error: characterError } = await client
    .from('characters')
    .select(CHARACTER_ROOM_CONTEXT_COLUMNS)
    .eq('slug', characterSlug)
    .maybeSingle();
  if (characterError) throw characterError;
  const { data: world, error: worldError } = worldSlug
    ? await client.from('worlds').select(WORLD_ROOM_CONTEXT_COLUMNS).eq('slug', worldSlug).maybeSingle()
    : { data: null, error: null };
  if (worldError) throw worldError;
  if (!character || (worldSlug && !world)) {
    const error = new Error('ROOM_TARGET_NOT_FOUND');
    error.code = 'ROOM_TARGET_NOT_FOUND';
    throw error;
  }
  const targetRows = [{ entityType: 'character', row: character }, ...(world ? [{ entityType: 'world', row: world }] : [])];
  for (const target of targetRows) {
    const isOwner = target.row.owner_user_id === userId;
    const publiclyStartable = target.row.visibility === 'public' && target.row.display_status === 'visible';
    if (!isOwner && !publiclyStartable) {
      const error = new Error('ROOM_TARGET_NOT_FOUND');
      error.code = 'ROOM_TARGET_NOT_FOUND';
      throw error;
    }
    const { data: moderation, error: moderationError } = await client
      .from('content_moderation')
      .select('status')
      .eq('entity_type', target.entityType)
      .eq('entity_id', target.row.id)
      .maybeSingle();
    if (moderationError) throw moderationError;
    if (target.row.display_status === 'hidden' || ['quarantined', 'blocked'].includes(moderation?.status)) {
      const error = new Error('ROOM_TARGET_NOT_STARTABLE');
      error.code = 'ROOM_TARGET_NOT_STARTABLE';
      throw error;
    }
  }
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
  } : null });
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
  const storedPromptSnapshot = buildStoredPromptSnapshot({ basePromptSnapshot: promptSnapshot });
  const greeting = buildGreetingMessage({ userAlias, characterName: character.name, bridgeProfile });
  const { data, error } = await client.rpc('create_room_v2', {
    p_user_id: userId,
    p_character_slug: characterSlug,
    p_world_slug: worldSlug,
    p_user_alias: userAlias,
    p_title: world ? `${character.name} · ${world.name}` : character.name,
    p_bridge_profile: bridgeProfile,
    p_prompt_snapshot: storedPromptSnapshot,
    p_state: state,
    p_greeting: greeting.content_json,
  });
  if (error) throw error;
  const roomId = data?.room_id || data?.roomId || data;
  return getRoom({ event, roomId, userId });
};

export const getRoom = async ({ event, roomId, userId }) => {
  const client = await userClient(event);
  const publicReadClient = await publicClient(runtimeEnvironmentFromEvent(event));
  if (!client || !publicReadClient) return null;
  let query = client.from(OWNED_ROOM_SUMMARY_VIEW).select(ROOM_SAFE_VIEW_COLUMNS).eq('id', roomId);
  if (userId) query = query.eq('user_id', userId);
  const { data: row, error } = await query.maybeSingle();
  if (error) throw error;
  if (!row) return null;
  return hydrateRoom({ client, publicClientInstance: publicReadClient, row });
};

export const getRoomHistoryForModel = async ({ event, roomId, userId }) => {
  const client = await userClient(event);
  if (!client) return [];
  if (userId) {
    const { data: ownedRoom, error: roomError } = await client.from(OWNED_ROOM_SUMMARY_VIEW).select('id').eq('id', roomId).eq('user_id', userId).maybeSingle();
    if (roomError) throw roomError;
    if (!ownedRoom) return [];
  }
  const { data, error } = await client
    .from('room_messages')
    .select('role, content_json, sequence_no, created_at')
    .eq('room_id', roomId)
    .order('sequence_no', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(12);
  if (error) throw error;
  const history = [...(data || [])].reverse().map((item) => ({
    role: item.role,
    content: item.role === 'user' ? String(item.content_json?.text || '') : String(item.content_json?.response || ''),
  })).filter((item) => item.content);
  return buildRecentRawHistory(history);
};

export const getRoomPromptContext = async ({ event, roomId, userId }) => {
  if (!userId) return null;
  const client = await createSupabaseAdminClient(runtimeEnvironmentFromEvent(event));
  if (!client) return null;
  // The prompt snapshot never crosses the authenticated client grant. The
  // service-role read still proves room ownership in the same DB query.
  const roomResult = await client
    .from('rooms')
    .select('resolved_prompt_snapshot_json')
    .eq('id', roomId)
    .eq('user_id', userId)
    .maybeSingle();
  if (roomResult.error) throw roomResult.error;
  if (!roomResult.data) return null;
  const stateResult = await client.from('room_state_summaries').select('*').eq('room_id', roomId).maybeSingle();
  if (stateResult.error) throw stateResult.error;

  const state = toRoomStateSummary(stateResult.data || {});
  return {
    promptSnapshot: buildRuntimePromptSnapshot({
      storedPromptSnapshot: roomResult.data.resolved_prompt_snapshot_json,
      state,
    }),
    storedPromptSnapshot: roomResult.data.resolved_prompt_snapshot_json,
    state,
  };
};

export const appendRoomMessages = async ({ event, userId, roomId, userMessage, assistantMessage }) => {
  if (!userId) return null;
  const client = await userClient(event);
  const admin = await createSupabaseAdminClient(runtimeEnvironmentFromEvent(event));
  if (!client || !admin) return null;
  const room = await getRoom({ event, roomId, userId });
  if (!room) return null;
  const { data: roomRow, error: roomRowError } = await admin
    .from('rooms')
    .select('resolved_prompt_snapshot_json')
    .eq('id', roomId)
    .eq('user_id', userId)
    .maybeSingle();
  if (roomRowError) throw roomRowError;
  if (!roomRow) return null;
  const nextState = updateRoomStateFromMessages({ state: clone(room.state), assistantMessage, userMessage });
  const nextMessages = [
    ...room.messages,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: assistantMessage },
  ];
  const turns = buildConversationTurns(nextMessages);
  const storedPromptSnapshot = normalizeStoredPromptSnapshot(roomRow.resolved_prompt_snapshot_json);
  const shouldRefreshSummary = shouldRefreshRunningSummary({
    totalUserTurns: turns.length,
    compactedUserTurns: storedPromptSnapshot.compactedUserTurns,
  });
  const compactedTurns = turns.slice(0, Math.max(0, turns.length - ROOM_MEMORY_CONFIG.recentRawTurns));
  const nextStoredPromptSnapshot = shouldRefreshSummary
    ? buildStoredPromptSnapshot({
        basePromptSnapshot: storedPromptSnapshot.basePromptSnapshot,
        runningSummary: buildRunningSummary({ turns: compactedTurns, state: nextState }),
        compactedUserTurns: turns.length,
      })
    : storedPromptSnapshot;
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
  const { error: roomUpdateError } = await admin
    .from('rooms')
    .update({
      updated_at: nowIso(),
      last_message_at: nowIso(),
      resolved_prompt_snapshot_json: nextStoredPromptSnapshot,
    })
    .eq('id', roomId)
    .eq('user_id', userId);
  if (roomUpdateError) throw roomUpdateError;
  return getRoom({ event, roomId, userId });
};

export const commitRoomTurn = async ({
  event,
  userId,
  roomId,
  requestId,
  requestFingerprint,
  expectedVersion,
  userMessage,
  assistantMessage,
  response,
  room: providedRoom = null,
  promptContext: providedPromptContext = null,
}) => {
  const normalizedExpectedVersion = Number(expectedVersion);
  const canReuseSnapshot = Boolean(providedRoom)
    && String(providedRoom.id || '') === String(roomId || '')
    && Number.isFinite(normalizedExpectedVersion)
    && Number(providedRoom.version) === normalizedExpectedVersion;
  const room = canReuseSnapshot
    ? providedRoom
    : await getRoom({ event, roomId, userId });
  if (!room) return null;
  const admin = await createSupabaseAdminClient(runtimeEnvironmentFromEvent(event));
  if (!admin) return null;
  const promptContext = canReuseSnapshot && providedPromptContext
    ? providedPromptContext
    : await getRoomPromptContext({ event, roomId, userId });
  const nextState = updateRoomStateFromMessages({
    state: clone(promptContext?.state || room.state),
    assistantMessage,
    userMessage,
  });
  const nextMessages = [
    ...room.messages,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: assistantMessage },
  ];
  const turns = buildConversationTurns(nextMessages);
  const storedPromptSnapshot = normalizeStoredPromptSnapshot(
    promptContext?.storedPromptSnapshot || room.resolvedPromptSnapshotJson || {}
  );
  const compactedTurns = turns.slice(0, Math.max(0, turns.length - ROOM_MEMORY_CONFIG.recentRawTurns));
  const nextStoredPromptSnapshot = shouldRefreshRunningSummary({
    totalUserTurns: turns.length,
    compactedUserTurns: storedPromptSnapshot.compactedUserTurns,
  })
    ? buildStoredPromptSnapshot({
        basePromptSnapshot: storedPromptSnapshot.basePromptSnapshot,
        runningSummary: buildRunningSummary({ turns: compactedTurns, state: nextState }),
        compactedUserTurns: turns.length,
      })
    : storedPromptSnapshot;
  const { data, error } = await admin.rpc('commit_room_turn_v2', {
    p_user_id: userId,
    p_room_id: roomId,
    p_request_id: requestId,
    p_request_fingerprint: requestFingerprint,
    p_expected_version: Number(expectedVersion || 0),
    p_user_content: { text: userMessage },
    p_assistant_content: assistantMessage,
    p_next_state: nextState,
    p_next_prompt_snapshot: nextStoredPromptSnapshot,
    p_response_json: response || {},
  });
  if (error) throw error;
  const committedAt = nowIso();
  const commitResult = Array.isArray(data) ? data[0] : data;
  const rpcVersion = Number(commitResult?.version);
  const nextVersion = Number.isFinite(rpcVersion)
    ? rpcVersion
    : Number(expectedVersion ?? room.version ?? 0) + 1;
  const messageId = (role) => `${role}-${createHash('sha256')
    .update(`${requestId}:${role}`)
    .digest('hex')
    .slice(0, 24)}`;
  return {
    ...room,
    state: nextState,
    messages: [
      ...room.messages,
      { id: messageId('user'), role: 'user', createdAt: committedAt, content: userMessage },
      { id: messageId('assistant'), role: 'assistant', createdAt: committedAt, content: assistantMessage },
    ],
    updatedAt: committedAt,
    lastMessageAt: committedAt,
    version: nextVersion,
  };
};

export const getOpsDashboard = async ({ event, userId, ownerPrechecked = false }) => {
  const client = await userClient(event);
  const unavailable = (cause) => {
    logServerWarn('[V-MATE] Operations dashboard read failed', {
      ...toSafeErrorMeta(cause),
    });
    const error = new Error('OPS_DASHBOARD_UNAVAILABLE');
    error.code = 'OPS_DASHBOARD_UNAVAILABLE';
    error.cause = cause;
    return error;
  };
  if (!client) throw unavailable(new Error('Authenticated database client is unavailable'));

  try {
    let ownerMode = ownerPrechecked;
    if (!ownerPrechecked) {
      const ownerResult = await client.rpc('is_owner_user');
      if (ownerResult?.error) throw ownerResult.error;
      ownerMode = ownerResult?.data === true;
    }
    const admin = ownerMode
      ? await createSupabaseAdminClient(runtimeEnvironmentFromEvent(event))
      : null;
    if (ownerMode && !admin) throw new Error('Owner read capability is unavailable');
    // Platform owners may inspect global moderation rows through service_role,
    // but even that projection is limited to the public summary columns. Regular
    // creators stay on the auth.uid()-scoped owner views.
    const characterReadClient = ownerMode ? admin : client;
    const worldReadClient = ownerMode ? admin : client;
    const characterTable = ownerMode ? 'characters' : OWNED_CONTENT_VIEWS.character;
    const worldTable = ownerMode ? 'worlds' : OWNED_CONTENT_VIEWS.world;
    const characterColumns = ownerMode ? CHARACTER_BASE_SUMMARY_COLUMNS : CHARACTER_SAFE_VIEW_COLUMNS;
    const worldColumns = ownerMode ? WORLD_BASE_SUMMARY_COLUMNS : WORLD_SAFE_VIEW_COLUMNS;
    const characterVisibleQuery = ownerMode
      ? characterReadClient.from(characterTable).select(characterColumns).eq('display_status', 'visible')
      : characterReadClient.from(characterTable).select(characterColumns).eq('owner_user_id', userId).eq('display_status', 'visible');
    const characterHiddenQuery = ownerMode
      ? characterReadClient.from(characterTable).select(characterColumns).eq('display_status', 'hidden')
      : characterReadClient.from(characterTable).select(characterColumns).eq('owner_user_id', userId).eq('display_status', 'hidden');
    const worldVisibleQuery = ownerMode
      ? worldReadClient.from(worldTable).select(worldColumns).eq('display_status', 'visible')
      : worldReadClient.from(worldTable).select(worldColumns).eq('owner_user_id', userId).eq('display_status', 'visible');
    const worldHiddenQuery = ownerMode
      ? worldReadClient.from(worldTable).select(worldColumns).eq('display_status', 'hidden')
      : worldReadClient.from(worldTable).select(worldColumns).eq('owner_user_id', userId).eq('display_status', 'hidden');
    const heroSettingQuery = client.from('app_settings').select('value_json').eq('key', 'home.hero').maybeSingle();
    const [charactersVisible, charactersHidden, worldsVisible, worldsHidden, heroSettingResult] = await Promise.all([
      characterVisibleQuery,
      characterHiddenQuery,
      worldVisibleQuery,
      worldHiddenQuery,
      heroSettingQuery,
    ]);
    for (const result of [charactersVisible, charactersHidden, worldsVisible, worldsHidden, heroSettingResult]) {
      if (result?.error) throw result.error;
    }
    const heroSetting = heroSettingResult.data?.value_json || null;
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
  } catch (error) {
    if (error?.code === 'OPS_DASHBOARD_UNAVAILABLE') throw error;
    throw unavailable(error);
  }
};

export const setContentVisibility = async ({ event, userId, entityType, id, status, ownerPrechecked = false }) => {
  if (!ownerPrechecked && !await isOwnerUser({ event, userId })) return false;
  const client = await createSupabaseAdminClient(runtimeEnvironmentFromEvent(event));
  if (!client) return false;
  const table = entityType === 'character' ? 'characters' : 'worlds';
  const { error } = await matchContentIdOrSlug(
    client.from(table).update({ display_status: status, updated_at: nowIso() }),
    id,
  );
  if (error) throw error;
  return true;
};

// Content rows can intentionally reuse a canonical object owned by the same
// user. Resolve live references at cleanup time so deleting one row never
// turns a remaining row into a broken image. This runs for retries too; a
// reference lookup failure therefore defers cleanup rather than risking data.
const resolveUnsharedContentStoragePaths = async ({ client, job, paths, runtimeEnvironment = null }) => {
  if (job?.operation_kind !== 'content' || !['character', 'world'].includes(job.entity_type)) {
    return paths;
  }
  const entityType = job.entity_type;
  const table = entityType === 'character' ? 'characters' : 'worlds';
  const assetTable = entityType === 'character' ? 'character_assets' : 'world_assets';
  const fkColumn = entityType === 'character' ? 'character_id' : 'world_id';
  const selectFields = entityType === 'character'
    ? 'id, owner_user_id, cover_image_url, avatar_image_url, prompt_profile_json'
    : 'id, owner_user_id, cover_image_url, prompt_profile_json';
  const allOwnedRows = [];
  for (let offset = 0; ; offset += CONTENT_REFERENCE_SCAN_LIMITS.pageSize) {
    const rowsResult = await client
      .from(table)
      .select(selectFields)
      .eq('owner_user_id', job.subject_user_id)
      .range(offset, offset + CONTENT_REFERENCE_SCAN_LIMITS.pageSize - 1);
    if (rowsResult?.error) throw rowsResult.error;
    const page = Array.isArray(rowsResult?.data)
      ? rowsResult.data
      : rowsResult?.data ? [rowsResult.data] : [];
    allOwnedRows.push(...page);
    if (allOwnedRows.length > CONTENT_REFERENCE_SCAN_LIMITS.maxRows) {
      const error = new Error('Content reference scan exceeds the safe row limit.');
      error.code = 'CONTENT_REFERENCE_SCAN_LIMIT_EXCEEDED';
      throw error;
    }
    if (page.length < CONTENT_REFERENCE_SCAN_LIMITS.pageSize) break;
  }
  const remainingRows = allOwnedRows.filter((row) => row?.id && row.id !== job.entity_id);
  if (!remainingRows.length) return paths;

  const referencedAssets = [];
  const remainingIds = remainingRows.map((row) => row.id);
  for (let start = 0; start < remainingIds.length; start += CONTENT_REFERENCE_SCAN_LIMITS.idBatchSize) {
    const ids = remainingIds.slice(start, start + CONTENT_REFERENCE_SCAN_LIMITS.idBatchSize);
    for (let offset = 0; ; offset += CONTENT_REFERENCE_SCAN_LIMITS.pageSize) {
      const assetsResult = await client
        .from(assetTable)
        .select(`${fkColumn}, url`)
        .in(fkColumn, ids)
        .range(offset, offset + CONTENT_REFERENCE_SCAN_LIMITS.pageSize - 1);
      if (assetsResult?.error) throw assetsResult.error;
      const page = Array.isArray(assetsResult?.data)
        ? assetsResult.data
        : assetsResult?.data ? [assetsResult.data] : [];
      referencedAssets.push(...page);
      if (referencedAssets.length > CONTENT_REFERENCE_SCAN_LIMITS.maxAssets) {
        const error = new Error('Content asset reference scan exceeds the safe row limit.');
        error.code = 'CONTENT_REFERENCE_SCAN_LIMIT_EXCEEDED';
        throw error;
      }
      if (page.length < CONTENT_REFERENCE_SCAN_LIMITS.pageSize) break;
    }
  }
  const assetsByEntityId = new Map();
  for (const asset of referencedAssets) {
    const entityId = asset?.[fkColumn];
    if (!entityId) continue;
    if (!assetsByEntityId.has(entityId)) assetsByEntityId.set(entityId, []);
    assetsByEntityId.get(entityId).push(asset);
  }
  const referencedPaths = new Set(remainingRows.flatMap((row) => (
    resolveContentAssetStoragePaths({
      entityType,
      row,
      assets: assetsByEntityId.get(row.id) || [],
      runtimeEnvironment,
    })
  )));
  return paths.filter((path) => !referencedPaths.has(path));
};

const deleteContentWithStorageSaga = async ({
  client,
  userId,
  entityType,
  id,
  ownerOnly,
  runtimeEnvironment = null,
}) => {
  if (!['character', 'world'].includes(entityType)) return false;
  const bucket = resolveStorageBucket(runtimeEnvironment);
  const resolveRemovablePaths = (input) => resolveUnsharedContentStoragePaths({
    ...input,
    runtimeEnvironment,
  });
  const table = entityType === 'character' ? 'characters' : 'worlds';
  const assetTable = entityType === 'character' ? 'character_assets' : 'world_assets';
  const fkColumn = entityType === 'character' ? 'character_id' : 'world_id';
  const selectFields = entityType === 'character'
    ? 'id, owner_user_id, cover_image_url, avatar_image_url, prompt_profile_json'
    : 'id, owner_user_id, cover_image_url, prompt_profile_json';
  await drainStorageDeletionOutbox({
    client,
    bucket,
    limit: 3,
    resolveRemovablePaths,
  });
  const rowQuery = ownerOnly
    ? client.from(table).select(selectFields).eq('owner_user_id', userId)
    : client.from(table).select(selectFields);
  const { data: row, error: rowError } = await matchContentIdOrSlug(
    rowQuery,
    id,
  ).maybeSingle();
  if (rowError) throw rowError;
  if (!row?.id) return false;
  const { data: assets, error: assetError } = await client.from(assetTable).select('url').eq(fkColumn, row.id);
  if (assetError) throw assetError;
  const paths = resolveContentAssetStoragePaths({
    entityType,
    row,
    assets: assets || [],
    runtimeEnvironment,
  });
  const job = await prepareStorageDeletionJob({
    client,
    operationKey: `content:${entityType}:${row.id}`,
    operationKind: 'content',
    subjectUserId: row.owner_user_id,
    entityType,
    entityId: row.id,
    paths,
  });
  let deleteQuery = client.from(table).delete().eq('id', row.id);
  if (ownerOnly) deleteQuery = deleteQuery.eq('owner_user_id', userId);
  let deleteError = null;
  try {
    const result = await deleteQuery;
    deleteError = result?.error || null;
  } catch (error) {
    deleteError = error;
  }
  if (deleteError) {
    let verification;
    try {
      verification = await client.from(table).select('id').eq('id', row.id).maybeSingle();
    } catch (error) {
      verification = { data: null, error };
    }
    if (verification?.error) {
      const error = new Error('Content deletion state could not be confirmed.');
      error.code = 'CONTENT_DELETE_STATE_UNKNOWN';
      error.cause = deleteError;
      throw error;
    }
    if (verification?.data) throw deleteError;
  }
  if (job) {
    const claimedJob = await claimStorageDeletionJob({ client, job });
    if (claimedJob) {
      await processStorageDeletionJob({
        client,
        job: claimedJob,
        bucket,
        destructiveStateConfirmed: true,
        resolveRemovablePaths,
      });
    }
  }
  return true;
};

export const deleteContent = async ({ event, userId, entityType, id, ownerPrechecked = false }) => {
  const runtimeEnvironment = runtimeEnvironmentFromEvent(event);
  if (!ownerPrechecked && !await isOwnerUser({ event, userId })) return false;
  const client = await createSupabaseAdminClient(runtimeEnvironment);
  if (!client) return false;
  return deleteContentWithStorageSaga({
    client,
    userId,
    entityType,
    id,
    ownerOnly: false,
    runtimeEnvironment,
  });
};

export const deleteOwnedContent = async ({ event = null, userId, entityType, id, runtimeEnvironment = runtimeEnvironmentFromEvent(event) }) => {
  const client = await createSupabaseAdminClient(runtimeEnvironment);
  if (!client) return false;
  return deleteContentWithStorageSaga({
    client,
    userId,
    entityType,
    id,
    ownerOnly: true,
    runtimeEnvironment,
  });
};

export const deleteAccount = async ({ event = null, userId, runtimeEnvironment = runtimeEnvironmentFromEvent(event) }) => {
  const client = await createSupabaseAdminClient(runtimeEnvironment);
  if (!client) {
    return {
      ok: false,
      reason: 'admin_not_configured',
    };
  }

  await beginAccountStorageCleanup({ client, userId });

  const [
    characterResult,
    worldResult,
    roomResult,
  ] = await Promise.all([
    client.from('characters').select('id, cover_image_url, avatar_image_url, prompt_profile_json').eq('owner_user_id', userId),
    client.from('worlds').select('id, cover_image_url, prompt_profile_json').eq('owner_user_id', userId),
    client.from('rooms').select('id').eq('user_id', userId),
  ]);
  throwIfSupabaseError('characters.select', characterResult);
  throwIfSupabaseError('worlds.select', worldResult);
  throwIfSupabaseError('rooms.select', roomResult);

  const characterRows = characterResult.data || [];
  const worldRows = worldResult.data || [];
  const roomRows = roomResult.data || [];
  const characterIds = characterRows.map((row) => row.id).filter(Boolean);
  const worldIds = worldRows.map((row) => row.id).filter(Boolean);
  const roomIds = roomRows.map((row) => row.id).filter(Boolean);

  // The durable fence blocks new upload responses first. Existing signed URLs
  // can still upload without auth, so cleanup runs before and immediately after
  // Auth deletion and the scheduled reconciler keeps scanning through expiry.
  let removedAssets = await removeAccountStorageObjectsByPrefix({ client, userId, runtimeEnvironment });

  let authDeleteError = null;
  try {
    const result = await client.auth.admin.deleteUser(userId);
    authDeleteError = result?.error || null;
  } catch (error) {
    authDeleteError = error;
  }
  if (authDeleteError) {
    const deletionState = await confirmAuthUserAbsent({ client, userId });
    if (deletionState !== 'absent') {
      const error = new Error('Account deletion did not reach a confirmed final state.');
      error.code = deletionState === 'present'
        ? 'ACCOUNT_DELETE_PARTIAL_STORAGE_REMOVED'
        : 'ACCOUNT_DELETE_STATE_UNKNOWN';
      error.cause = authDeleteError;
      throw error;
    }
  }

  try {
    removedAssets += await removeAccountStorageObjectsByPrefix({ client, userId, runtimeEnvironment });
  } catch (error) {
    // Auth deletion is already final. Keep the durable fence so scheduled
    // maintenance can remove any late upload without exposing raw provider data.
    logServerWarn('[V-MATE] Account storage cleanup remains queued', toSafeErrorMeta(error));
  }

  return {
    ok: true,
    deleted: true,
    removedAssets,
    deletedCharacters: characterIds.length,
    deletedWorlds: worldIds.length,
    deletedRooms: roomIds.length,
  };
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

const mapReportRow = (row) => ({
  id: row.id,
  reporterUserId: row.reporter_user_id,
  entityType: row.entity_type,
  entityId: row.entity_id,
  entityName: row.entity_name || '',
  reason: row.reason,
  details: row.details || '',
  status: row.status,
  createdAt: row.created_at,
});

export const createContentReport = async ({ event, userId, payload }) => {
  const client = await userClient(event);
  if (!client) return null;
  const row = payload.entityType === 'character'
    ? await getCharacterRowBySlug(client, payload.entityId) || await getCharacterRowById(client, payload.entityId)
    : await getWorldRowBySlug(client, payload.entityId) || await getWorldRowById(client, payload.entityId);
  if (!row) return null;
  const { data, error } = await client.from('content_reports').insert({
    reporter_user_id: userId,
    entity_type: payload.entityType,
    entity_id: row.id,
    entity_name: row.name,
    reason: payload.reason,
    details: String(payload.details || '').trim().slice(0, 1000),
  }).select('*').single();
  if (error) throw error;
  return mapReportRow(data);
};

export const listContentReports = async ({ event, status = 'open' }) => {
  const client = await userClient(event);
  if (!client) return [];
  let query = client.from('content_reports').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(mapReportRow);
};

export const applyReportAction = async ({ event, reportId, action, note }) => {
  const client = await userClient(event);
  if (!client) return null;
  const { data, error } = await client.rpc('apply_content_report_action', {
    p_report_id: reportId,
    p_action: action,
    p_note: note || '',
  });
  if (error) throw error;
  return data || null;
};

export const getChatQuota = async ({ event, limit = 30 }) => {
  const client = await userClient(event);
  if (!client) return { limit, remaining: 0, resetAt: '' };
  const { data, error } = await client.rpc('get_daily_chat_quota', { p_limit: limit });
  if (error) throw error;
  return normalizeQuotaResult(data, limit);
};

export const reserveChatQuota = async ({ event = null, userId, route = 'room', roomId = null, requestId, requestFingerprint, limit = 30, runtimeEnvironment = runtimeEnvironmentFromEvent(event) }) => {
  const client = await createSupabaseAdminClient(runtimeEnvironment);
  if (!client) return { allowed: false, limit, remaining: 0, resetAt: '' };
  const { data, error } = await client.rpc('reserve_chat_message_v2', {
    p_user_id: userId,
    p_route: route,
    p_room_id: roomId,
    p_request_id: requestId,
    p_request_fingerprint: requestFingerprint,
    p_limit: limit,
    p_lease_seconds: 120,
  });
  if (error) throw error;
  return normalizeQuotaResult(data, limit, { requireDisposition: true });
};

export const completeChatQuota = async ({ event = null, userId, requestId, requestFingerprint, response, runtimeEnvironment = runtimeEnvironmentFromEvent(event) }) => {
  const client = await createSupabaseAdminClient(runtimeEnvironment);
  if (!client) return false;
  const { data, error } = await client.rpc('complete_legacy_chat_message_v2', {
    p_user_id: userId,
    p_request_id: requestId,
    p_request_fingerprint: requestFingerprint,
    p_response_json: response || {},
  });
  if (error) throw error;
  return data === true;
};

export const refundChatQuota = async ({ event = null, userId, requestId, requestFingerprint, limit = 30, runtimeEnvironment = runtimeEnvironmentFromEvent(event) }) => {
  const client = await createSupabaseAdminClient(runtimeEnvironment);
  if (!client) return { limit, remaining: 0, resetAt: '' };
  const { data, error } = await client.rpc('refund_chat_message_v2', {
    p_user_id: userId,
    p_request_id: requestId,
    p_request_fingerprint: requestFingerprint,
    p_limit: limit,
  });
  if (error) throw error;
  return normalizeQuotaResult(data, limit);
};

export const reconcileExpiredChatReservations = async ({ limit = 100, runtimeEnvironment = null } = {}) => {
  const client = await createSupabaseAdminClient(runtimeEnvironment);
  if (!client) return { skipped: true, reason: 'admin_not_configured', reconciled: 0 };
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 100)));
  const { data, error } = await client.rpc('reconcile_expired_chat_reservations_v2', { p_limit: safeLimit });
  if (error) throw error;
  return {
    skipped: false,
    reconciled: Number(data?.reconciled ?? data?.refunded ?? data ?? 0),
  };
};

export const reconcileStorageDeletionOutbox = async ({ limit = 5, runtimeEnvironment = null } = {}) => {
  const client = await createSupabaseAdminClient(runtimeEnvironment);
  if (!client) return { skipped: true, reason: 'admin_not_configured', inspected: 0, completed: 0 };
  return drainStorageDeletionOutbox({
    client,
    bucket: resolveStorageBucket(runtimeEnvironment),
    limit,
    strict: true,
    resolveRemovablePaths: (input) => resolveUnsharedContentStoragePaths({
      ...input,
      runtimeEnvironment,
    }),
  });
};

export const reconcileAccountStorageCleanupFences = async ({ limit = 5, runtimeEnvironment = null } = {}) => {
  const client = await createSupabaseAdminClient(runtimeEnvironment);
  if (!client) return { skipped: true, reason: 'admin_not_configured', inspected: 0, completed: 0 };
  const boundedLimit = Math.max(1, Math.min(20, Math.floor(Number(limit) || 5)));
  const dueAt = new Date().toISOString();
  const fencesResult = await client
    .from(ACCOUNT_STORAGE_CLEANUP_TABLE)
    .select('*')
    .lte('cleanup_until', dueAt)
    .order('last_scan_at', { ascending: true, nullsFirst: true })
    .order('cleanup_until', { ascending: true })
    .limit(boundedLimit);
  throwIfSupabaseError('account_storage_cleanup_fences.select', fencesResult);

  let completed = 0;
  let firstError = null;
  for (const fence of fencesResult.data || []) {
    try {
      const authState = await confirmAuthUserAbsent({ client, userId: fence.user_id });
      if (authState === 'unknown') {
        const error = new Error('Account deletion state could not be confirmed.');
        error.code = 'ACCOUNT_DELETE_STATE_UNKNOWN';
        throw error;
      }
      if (authState === 'absent') {
        await removeAccountStorageObjectsByPrefix({
          client,
          userId: fence.user_id,
          runtimeEnvironment,
        });
        const remainingPaths = [
          ...(await listOwnedStoragePaths({
            client,
            userId: fence.user_id,
            entityType: 'character',
            runtimeEnvironment,
          })),
          ...(await listOwnedStoragePaths({
            client,
            userId: fence.user_id,
            entityType: 'world',
            runtimeEnvironment,
          })),
        ];
        if (remainingPaths.length > 0) {
          const error = new Error('Account storage cleanup remains incomplete.');
          error.code = 'ACCOUNT_DELETE_STORAGE_STATE_UNKNOWN';
          throw error;
        }
      }
      // A present user means the account deletion was stopped. Do not remove
      // their prefix; only release the expired fence after checking Auth.
      const deletion = await client
        .from(ACCOUNT_STORAGE_CLEANUP_TABLE)
        .delete()
        .eq('user_id', fence.user_id)
        .eq('cleanup_until', fence.cleanup_until);
      throwIfSupabaseError('account_storage_cleanup_fences.delete', deletion);
      completed += 1;
    } catch (error) {
      firstError ||= error;
      const failedAt = new Date().toISOString();
      try {
        await client
          .from(ACCOUNT_STORAGE_CLEANUP_TABLE)
          .update({
            attempt_count: Math.max(0, Number(fence.attempt_count) || 0) + 1,
            last_error_code: String(toSafeErrorMeta(error).errorClass || 'unknown').slice(0, 64),
            last_scan_at: failedAt,
            updated_at: failedAt,
          })
          .eq('user_id', fence.user_id)
          .eq('cleanup_until', fence.cleanup_until);
      } catch {
        // Preserve the original cleanup failure for the scheduled gate.
      }
    }
  }
  if (firstError) throw firstError;
  return { skipped: false, inspected: (fencesResult.data || []).length, completed };
};

export const prepareAssetUploads = async ({ event = null, userId, entityType, variants, runtimeEnvironment = runtimeEnvironmentFromEvent(event) }) => {
  const client = await createSupabaseAdminClient(runtimeEnvironment);
  if (!client) return null;
  await assertAssetUploadsAllowed({ client, userId });
  const bucket = resolveStorageBucket(runtimeEnvironment);
  const uploadId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const uploads = [];
  for (const variant of variants) {
    const path = buildAssetStoragePath({ userId, entityType, uploadId, slot: variant.slot, variant: variant.variant });
    if (!path) throw new Error('INVALID_UPLOAD_PATH');
    const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(path, { upsert: false });
    if (error) throw error;
    const { data: publicUrlData } = client.storage.from(bucket).getPublicUrl(path);
    uploads.push({
      kind: variant.kind,
      width: variant.width,
      height: variant.height,
      path: data.path,
      token: data.token,
      signedUrl: data.signedUrl,
      publicUrl: publicUrlData.publicUrl,
      bucket,
    });
  }
  // Close the check/sign race: a fence that appeared while URLs were being
  // issued prevents those URLs from ever reaching the browser.
  await assertAssetUploadsAllowed({ client, userId });
  return { bucket, expiresAt: new Date(Date.now() + SIGNED_UPLOAD_URL_TTL_MS).toISOString(), uploads };
};
