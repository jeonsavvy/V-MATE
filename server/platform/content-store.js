import { createHash, randomUUID } from 'node:crypto';
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

const clone = (value) => structuredClone(value);

const createdCharacters = new Map();
const createdWorlds = new Map();
const rooms = new Map();
const recentViewsByUser = new Map();
const bookmarksByUser = new Map();
const featuredHomeState = {
  heroMode: 'auto',
  heroTargetPath: '',
};

const nowIso = () => new Date().toISOString();

const slugify = (value, fallback) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return normalized || fallback;
};

const summarizeCharacter = (item) => ({
  id: item.id,
  entityType: 'character',
  slug: item.slug,
  name: item.name,
  headline: item.headline,
  summary: item.summary,
  coverImageUrl: item.coverImageUrl,
  avatarImageUrl: item.avatarImageUrl,
  tags: item.tags,
  creator: item.creator,
  visibility: item.visibility,
  displayStatus: item.displayStatus,
  sourceType: item.sourceType,
  favoriteCount: item.favoriteCount,
  chatStartCount: item.chatStartCount,
  updatedAt: item.updatedAt,
  imageSlots: Array.isArray(item.promptProfile?.imageSlots) ? clone(item.promptProfile.imageSlots) : [],
});

const summarizeWorld = (item) => ({
  id: item.id,
  entityType: 'world',
  slug: item.slug,
  name: item.name,
  headline: item.headline,
  summary: item.summary,
  coverImageUrl: item.coverImageUrl,
  tags: item.tags,
  creator: item.creator,
  visibility: item.visibility,
  displayStatus: item.displayStatus,
  sourceType: item.sourceType,
  favoriteCount: item.favoriteCount,
  chatStartCount: item.chatStartCount,
  updatedAt: item.updatedAt,
  imageSlots: Array.isArray(item.promptProfile?.imageSlots) ? clone(item.promptProfile.imageSlots) : [],
});

const allCharacters = () => [...createdCharacters.values()];
const allWorlds = () => [...createdWorlds.values()];

const findCharacter = (ref) => {
  if (!ref) return null;
  return clone([...createdCharacters.values()].find((item) => item.id === ref || item.slug === ref) || null);
};

const findWorld = (ref) => {
  if (!ref) return null;
  return clone([...createdWorlds.values()].find((item) => item.id === ref || item.slug === ref) || null);
};

const ensureRecentBucket = (userId) => {
  if (!recentViewsByUser.has(userId)) recentViewsByUser.set(userId, []);
  return recentViewsByUser.get(userId);
};

const ensureBookmarkBucket = (userId) => {
  if (!bookmarksByUser.has(userId)) bookmarksByUser.set(userId, new Map());
  return bookmarksByUser.get(userId);
};

export const listCharacters = ({ search = '', filter = '' } = {}) => {
  const query = String(search || '').trim().toLowerCase();
  const items = allCharacters()
    .filter((item) => item.displayStatus !== 'hidden')
    .map(summarizeCharacter)
    .filter((item) => !query || JSON.stringify(item).toLowerCase().includes(query));

  if (filter === 'new') {
    return items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }
  return items.sort((a, b) => b.chatStartCount - a.chatStartCount || b.favoriteCount - a.favoriteCount || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
};

export const listWorlds = ({ search = '', filter = '' } = {}) => {
  const query = String(search || '').trim().toLowerCase();
  const items = allWorlds()
    .filter((item) => item.displayStatus !== 'hidden')
    .map(summarizeWorld)
    .filter((item) => !query || JSON.stringify(item).toLowerCase().includes(query));

  if (filter === 'new') {
    return items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }
  return items.sort((a, b) => b.chatStartCount - a.chatStartCount || b.favoriteCount - a.favoriteCount || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
};

export const getHomePayload = ({ tab = 'characters', search = '', filter = '' } = {}) => {
  const characters = listCharacters({ search, filter });
  const worlds = listWorlds({ search, filter });
  const autoHero = [...characters, ...worlds].sort((a, b) => b.chatStartCount - a.chatStartCount || b.favoriteCount - a.favoriteCount || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  const manualHero = featuredHomeState.heroTargetPath.startsWith('/worlds/')
    ? worlds.find((item) => featuredHomeState.heroTargetPath.endsWith(`/${item.slug}`))
    : characters.find((item) => featuredHomeState.heroTargetPath.endsWith(`/${item.slug}`));
  const hero = featuredHomeState.heroMode === 'manual' && manualHero ? manualHero : autoHero;

  return {
    home: {
      defaultTab: 'characters',
      filterChips: ['신작', '인기'],
      hero: {
        title: hero?.name || '새 콘텐츠를 공개해보세요',
        subtitle: hero?.headline || hero?.summary || '',
        coverImageUrl: hero?.coverImageUrl || '',
        targetPath: hero?.entityType === 'world' ? `/worlds/${hero.slug}` : hero?.slug ? `/characters/${hero.slug}` : '/create/character',
      },
      characterFeed: { items: characters },
      worldFeed: { items: worlds },
    },
  };
};

export const getCharacterDetail = (slug) => {
  const item = findCharacter(slug);
  if (!item) return null;

  return {
    ...summarizeCharacter(item),
    profileSections: item.profileSections,
    gallery: item.gallery,
    profileJson: item.profileJson || {},
    speechStyleJson: item.speechStyleJson || {},
    promptProfileJson: item.promptProfile || {},
  };
};

export const getWorldDetail = (slug) => {
  const item = findWorld(slug);
  if (!item) return null;

  return {
    ...summarizeWorld(item),
    worldSections: item.worldSections.filter((section) => section.title === '월드 소개').slice(0, 1),
    gallery: item.gallery,
    characters: [],
    promptProfileJson: item.promptProfile || {},
  };
};

export const addRecentView = ({ userId, entityType, ref }) => {
  const entity = entityType === 'character' ? findCharacter(ref) : findWorld(ref);
  if (!entity) return null;
  const bucket = ensureRecentBucket(userId);
  const fingerprint = `${entityType}:${entity.slug}`;
  const next = {
    id: createHash('sha1').update(`${userId}:${fingerprint}`).digest('hex').slice(0, 18),
    entityType,
    item: entityType === 'character' ? summarizeCharacter(entity) : summarizeWorld(entity),
    viewedAt: nowIso(),
  };
  recentViewsByUser.set(userId, [next, ...bucket.filter((item) => `${item.entityType}:${item.item.slug}` !== fingerprint)].slice(0, 24));
  return clone(next);
};

export const toggleBookmark = ({ userId, entityType, ref }) => {
  const entity = entityType === 'character' ? findCharacter(ref) : findWorld(ref);
  if (!entity) return null;
  const bucket = ensureBookmarkBucket(userId);
  const id = `${entityType}:${entity.slug}`;
  if (bucket.has(id)) {
    bucket.delete(id);
    return { active: false, id };
  }
  bucket.set(id, {
    id,
    entityType,
    item: entityType === 'character' ? summarizeCharacter(entity) : summarizeWorld(entity),
    createdAt: nowIso(),
  });
  return { active: true, id };
};

export const removeBookmark = ({ userId, bookmarkId }) => {
  ensureBookmarkBucket(userId).delete(bookmarkId);
};

export const listRecentRooms = (input) => {
  const userId = typeof input === 'string' ? input : input?.userId
  return Array.from(rooms.values()).filter((room) => room.userId === userId).map(clone).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
};

export const getLibraryPayload = (input) => {
  const userId = typeof input === 'string' ? input : input?.userId
  return {
    bookmarks: Array.from(ensureBookmarkBucket(userId).values()).map(clone),
    recentViews: clone(ensureRecentBucket(userId)),
    recentRooms: listRecentRooms(userId),
    owned: {
      characters: allCharacters().filter((item) => item.ownerUserId === userId).map(summarizeCharacter),
      worlds: allWorlds().filter((item) => item.ownerUserId === userId).map(summarizeWorld),
    },
  };
};

export const createCharacter = ({ userId, payload }) => {
  const creatorName = String(payload.creatorName || payload.profileJson?.creatorName || payload.promptProfileJson?.creatorName || '').trim() || '내 스튜디오';
  const item = {
    id: `character-${randomUUID()}`,
    entityType: 'character',
    slug: slugify(payload.name, `character-${Date.now()}`),
    name: payload.name,
    headline: payload.headline || payload.summary,
    summary: payload.summary,
    coverImageUrl: payload.coverImageUrl || '',
    avatarImageUrl: payload.avatarImageUrl || payload.coverImageUrl || '',
    tags: payload.tags || [],
    creator: { id: userId, slug: userId, name: creatorName },
    ownerUserId: userId,
    visibility: payload.visibility || 'private',
    displayStatus: payload.visibility === 'public' ? 'visible' : 'draft',
    sourceType: payload.sourceType || 'original',
    favoriteCount: 0,
    chatStartCount: 0,
    updatedAt: nowIso(),
    profileJson: payload.profileJson || {},
    speechStyleJson: payload.speechStyleJson || {},
    profileSections: [
      { title: '성격', body: payload.summary },
      { title: '말투', body: payload.headline || payload.summary },
    ],
    gallery: payload.coverImageUrl ? [payload.coverImageUrl] : [],
    promptProfile: {
      persona: [payload.summary],
      speechStyle: [payload.headline || payload.summary],
      relationshipBaseline: '처음 대화를 시작하는 거리감',
      roleTendency: 'support',
      conflictStyle: 'emotion-first',
      worldFitTags: [],
      creatorName,
      ...(payload.promptProfileJson || {}),
    },
  };
  createdCharacters.set(item.id, item);
  return summarizeCharacter(item);
};

export const updateCharacter = ({ userId, slug, payload }) => {
  const item = [...createdCharacters.values()].find((entry) => entry.slug === slug && entry.ownerUserId === userId);
  if (!item) return null;
  const creatorName = String(payload.creatorName || payload.profileJson?.creatorName || payload.promptProfileJson?.creatorName || '').trim() || item.creator.name;
  item.name = payload.name;
  item.headline = payload.headline || payload.summary;
  item.summary = payload.summary;
  item.tags = payload.tags || [];
  item.visibility = payload.visibility || item.visibility;
  item.displayStatus = payload.visibility === 'public' ? 'visible' : 'draft';
  item.sourceType = payload.sourceType || item.sourceType;
  item.coverImageUrl = payload.coverImageUrl || item.coverImageUrl;
  item.avatarImageUrl = payload.avatarImageUrl || payload.coverImageUrl || item.avatarImageUrl;
  item.creator = { ...item.creator, name: creatorName };
  item.profileJson = payload.profileJson || item.profileJson || {};
  item.speechStyleJson = payload.speechStyleJson || item.speechStyleJson || {};
  item.profileSections = [{ title: '설정', body: payload.summary }];
  item.promptProfile = { ...item.promptProfile, ...(payload.promptProfileJson || {}), creatorName };
  if (Array.isArray(payload.assets) && payload.assets.length > 0) {
    item.gallery = payload.assets.map((asset) => asset.url);
  }
  item.updatedAt = nowIso();
  return summarizeCharacter(item);
};

export const createWorld = ({ userId, payload }) => {
  const creatorName = String(payload.creatorName || payload.promptProfileJson?.creatorName || '').trim() || '내 스튜디오';
  const item = {
    id: `world-${randomUUID()}`,
    entityType: 'world',
    slug: slugify(payload.name, `world-${Date.now()}`),
    name: payload.name,
    headline: payload.headline || payload.summary,
    summary: payload.summary,
    coverImageUrl: payload.coverImageUrl || '',
    tags: payload.tags || [],
    creator: { id: userId, slug: userId, name: creatorName },
    ownerUserId: userId,
    visibility: payload.visibility || 'private',
    displayStatus: payload.visibility === 'public' ? 'visible' : 'draft',
    sourceType: payload.sourceType || 'original',
    favoriteCount: 0,
    chatStartCount: 0,
    updatedAt: nowIso(),
    worldSections: [
      { title: '월드 소개', body: payload.summary },
      { title: '월드 규칙', body: payload.worldRulesMarkdown || payload.summary },
    ],
    gallery: payload.coverImageUrl ? [payload.coverImageUrl] : [],
    promptProfile: {
      genreKey: 'city',
      rules: [payload.worldRulesMarkdown || payload.summary],
      tone: payload.headline || payload.summary,
      starterLocations: ['첫 장면 위치'],
      worldTerms: payload.tags || [],
      creatorName,
      ...(payload.promptProfileJson || {}),
    },
  };
  createdWorlds.set(item.id, item);
  return summarizeWorld(item);
};

export const updateWorld = ({ userId, slug, payload }) => {
  const item = [...createdWorlds.values()].find((entry) => entry.slug === slug && entry.ownerUserId === userId);
  if (!item) return null;
  const creatorName = String(payload.creatorName || payload.promptProfileJson?.creatorName || '').trim() || item.creator.name;
  item.name = payload.name;
  item.headline = payload.headline || payload.summary;
  item.summary = payload.summary;
  item.tags = payload.tags || [];
  item.visibility = payload.visibility || item.visibility;
  item.displayStatus = payload.visibility === 'public' ? 'visible' : 'draft';
  item.sourceType = payload.sourceType || item.sourceType;
  item.coverImageUrl = payload.coverImageUrl || item.coverImageUrl;
  item.creator = { ...item.creator, name: creatorName };
  item.worldSections = [
    { title: '월드 소개', body: payload.summary },
    { title: '월드 규칙', body: payload.worldRulesMarkdown || payload.summary },
  ];
  item.promptProfile = { ...item.promptProfile, ...(payload.promptProfileJson || {}), creatorName };
  if (Array.isArray(payload.assets) && payload.assets.length > 0) {
    item.gallery = payload.assets.map((asset) => asset.url);
  }
  item.updatedAt = nowIso();
  return summarizeWorld(item);
};

const createGreetingMessage = ({ userAlias, character, bridgeProfile }) => ({
  id: `greeting-${randomUUID()}`,
  role: 'assistant',
  createdAt: nowIso(),
  content: {
    emotion: 'normal',
    inner_heart: '',
    response: bridgeProfile.entryMode === 'direct_character'
      ? `${userAlias || '너'}, 왔네. 어디부터 이야기할래?`
      : `${bridgeProfile.meetingTrigger} ${character.name}이 먼저 시선을 보냈다.`,
    narration: bridgeProfile.entryMode === 'direct_character' ? undefined : `${bridgeProfile.startingLocation}에서 장면이 시작됩니다.`,
  },
});

export const createRoom = ({ userId, characterRef, characterSlug, worldRef, worldSlug, userAlias }) => {
  const character = findCharacter(characterRef || characterSlug);
  const world = worldRef || worldSlug ? findWorld(worldRef || worldSlug) : null;
  if (!character) return null;
  const bridgeProfile = generateBridgeProfile({ character, world });
  const state = createInitialRoomState({ bridgeProfile, world });
  const room = {
    id: `room-${randomUUID()}`,
    userId,
    userAlias: userAlias || '나',
    title: world ? `${character.name} · ${world.name}` : `${character.name}`,
    character: summarizeCharacter(character),
    world: world ? summarizeWorld(world) : null,
    bridgeProfile,
    state,
    messages: [createGreetingMessage({ userAlias: userAlias || '나', character, bridgeProfile })],
    resolvedPromptSnapshotJson: buildStoredPromptSnapshot({
      basePromptSnapshot: buildRoomPromptSnapshot({ character, world, bridgeProfile, state }),
    }),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastMessageAt: nowIso(),
  };
  rooms.set(room.id, room);

  const characterStore = createdCharacters.get(character.id);
  if (characterStore) characterStore.chatStartCount += 1;
  if (world) {
    const worldStore = createdWorlds.get(world.id);
    if (worldStore) worldStore.chatStartCount += 1;
  }
  return clone(room);
};

export const getRoom = (input) => {
  const roomId = typeof input === 'string' ? input : input?.roomId
  return clone(rooms.get(roomId) || null);
};

export const getRoomHistoryForModel = (input) => {
  const roomId = typeof input === 'string' ? input : input?.roomId
  const room = rooms.get(roomId);
  if (!room) return [];
  const history = room.messages.map((message) => ({
    role: message.role,
    content: typeof message.content === 'string' ? message.content : message.content.response,
  }));
  return buildRecentRawHistory(history);
};

export const getRoomPromptContext = (input) => {
  const roomId = typeof input === 'string' ? input : input?.roomId
  const room = rooms.get(roomId);
  if (!room) return null;
  const character = findCharacter(room.character.slug);
  const world = room.world ? findWorld(room.world.slug) : null;
  return {
    promptSnapshot: buildRuntimePromptSnapshot({
      storedPromptSnapshot: room.resolvedPromptSnapshotJson,
      state: room.state,
    }),
    bridgeProfile: clone(room.bridgeProfile),
    state: clone(room.state),
    character,
    world,
  };
};

export const appendRoomMessages = ({ roomId, userMessage, assistantMessage }) => {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.messages.push({ id: `user-${randomUUID()}`, role: 'user', createdAt: nowIso(), content: userMessage });
  room.messages.push({ id: `assistant-${randomUUID()}`, role: 'assistant', createdAt: nowIso(), content: assistantMessage });
  room.state = updateRoomStateFromMessages({ state: room.state, assistantMessage, userMessage });
  const turns = buildConversationTurns(room.messages);
  const storedPromptSnapshot = normalizeStoredPromptSnapshot(room.resolvedPromptSnapshotJson);
  if (shouldRefreshRunningSummary({
    totalUserTurns: turns.length,
    compactedUserTurns: storedPromptSnapshot.compactedUserTurns,
  })) {
    room.resolvedPromptSnapshotJson = buildStoredPromptSnapshot({
      basePromptSnapshot: storedPromptSnapshot.basePromptSnapshot,
      runningSummary: buildRunningSummary({
        turns: turns.slice(0, Math.max(0, turns.length - ROOM_MEMORY_CONFIG.recentRawTurns)),
        state: room.state,
      }),
      compactedUserTurns: turns.length,
    });
  }
  room.updatedAt = nowIso();
  room.lastMessageAt = nowIso();
  return clone(room);
};

export const getOpsDashboard = () => ({
  items: {
    visibleCharacters: allCharacters().filter((item) => item.displayStatus !== 'hidden').map(summarizeCharacter),
    hiddenCharacters: allCharacters().filter((item) => item.displayStatus === 'hidden').map(summarizeCharacter),
    visibleWorlds: allWorlds().filter((item) => item.displayStatus !== 'hidden').map(summarizeWorld),
    hiddenWorlds: allWorlds().filter((item) => item.displayStatus === 'hidden').map(summarizeWorld),
  },
  home: { heroMode: featuredHomeState.heroMode, heroTargetPath: featuredHomeState.heroTargetPath },
});

export const setContentVisibility = ({ entityType, id, status }) => {
  const collection = entityType === 'character'
    ? [...createdCharacters.values()]
    : [...createdWorlds.values()];
  const item = collection.find((entry) => entry.id === id || entry.slug === id);
  if (!item) return null;
  item.displayStatus = status;
  item.updatedAt = nowIso();
  return true;
};

export const deleteContent = async ({ entityType, id }) => {
  const collections = entityType === 'character'
    ? [createdCharacters]
    : [createdWorlds];

  for (const collection of collections) {
    for (const [key, item] of collection.entries()) {
      if (item.id === id || item.slug === id) {
        collection.delete(key);
        return true;
      }
    }
  }
  return false;
};

export const deleteOwnedContent = async ({ entityType, id }) => deleteContent({ entityType, id });

export const isOwnerUser = async () => true;

export const setHomeHeroTarget = (input) => {
  const path = typeof input === 'string' ? input : input?.targetPath
  featuredHomeState.heroTargetPath = String(path || featuredHomeState.heroTargetPath);
  return clone(featuredHomeState);
};

export const setHomeHeroMode = (input) => {
  const mode = typeof input === 'string' ? input : input?.mode;
  featuredHomeState.heroMode = mode === 'manual' ? 'manual' : 'auto';
  return clone(featuredHomeState);
};

export const prepareAssetUploads = async ({ userId, entityType, variants }) => ({
  bucket: 'vmate-assets',
  uploads: variants.map((variant) => ({
    kind: variant.kind,
    width: variant.width,
    height: variant.height,
    path: `${userId || 'demo-user'}/${entityType}/${Date.now()}-${variant.kind}.webp`,
    token: `demo-${variant.kind}`,
    signedUrl: '',
    publicUrl: '',
    bucket: 'vmate-assets',
  })),
});

export const resetPlatformStoreForTests = () => {
  createdCharacters.clear();
  createdWorlds.clear();
  rooms.clear();
  recentViewsByUser.clear();
  bookmarksByUser.clear();
  featuredHomeState.heroMode = 'auto';
  featuredHomeState.heroTargetPath = '';
};
