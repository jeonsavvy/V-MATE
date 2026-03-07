import { createHash, randomUUID } from 'node:crypto';
import { platformCharacters, platformCharacterWorldLinks, platformSeed, platformWorlds } from './catalog.js';
import { buildRoomPromptSnapshot, createInitialRoomState, generateBridgeProfile, updateRoomStateFromMessages } from './prompt-builder.js';

const clone = (value) => structuredClone(value);

const seedCharacterMap = new Map(platformCharacters.map((item) => [item.id, clone(item)]));
const seedCharacterSlugMap = new Map(platformCharacters.map((item) => [item.slug, seedCharacterMap.get(item.id)]));
const seedWorldMap = new Map(platformWorlds.map((item) => [item.id, clone(item)]));
const seedWorldSlugMap = new Map(platformWorlds.map((item) => [item.slug, seedWorldMap.get(item.id)]));
const seedLinkMap = new Map(platformCharacterWorldLinks.map((item) => [item.id, clone(item)]));

const createdCharacters = new Map();
const createdWorlds = new Map();
const createdLinks = new Map();
const rooms = new Map();
const recentViewsByUser = new Map();
const bookmarksByUser = new Map();
const featuredHomeState = { heroTargetPath: `/characters/${platformCharacters[0].slug}` };

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
});

const allCharacters = () => [...seedCharacterMap.values(), ...createdCharacters.values()];
const allWorlds = () => [...seedWorldMap.values(), ...createdWorlds.values()];
const allLinks = () => [...seedLinkMap.values(), ...createdLinks.values()];

const findCharacter = (ref) => {
  if (!ref) return null;
  return clone(seedCharacterMap.get(ref) || seedCharacterSlugMap.get(ref) || [...createdCharacters.values()].find((item) => item.id === ref || item.slug === ref) || null);
};

const findWorld = (ref) => {
  if (!ref) return null;
  return clone(seedWorldMap.get(ref) || seedWorldSlugMap.get(ref) || [...createdWorlds.values()].find((item) => item.id === ref || item.slug === ref) || null);
};

const findLink = ({ characterSlug, worldSlug }) => clone(allLinks().find((item) => item.characterSlug === characterSlug && item.worldSlug === worldSlug) || null);

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
  return items.sort((a, b) => b.chatStartCount - a.chatStartCount);
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
  return items.sort((a, b) => b.chatStartCount - a.chatStartCount);
};

export const getHomePayload = ({ tab = 'characters', search = '' } = {}) => {
  const characters = listCharacters({ search });
  const worlds = listWorlds({ search });
  const heroPath = featuredHomeState.heroTargetPath;
  const heroCharacter = characters[0];
  const heroWorld = worlds[0];
  const hero = heroPath.startsWith('/worlds/') ? heroWorld : heroCharacter;

  return {
    home: {
      defaultTab: 'characters',
      filterChips: ['신작', '태그'],
      hero: {
        title: hero?.name || '지금 많이 보는 캐릭터',
        subtitle: hero?.headline || hero?.summary || '',
        coverImageUrl: hero?.coverImageUrl || '/world_tokyo.svg',
        targetPath: heroPath,
      },
      characterFeed: { items: characters },
      worldFeed: { items: worlds },
    },
  };
};

export const getCharacterDetail = (slug) => {
  const item = findCharacter(slug);
  if (!item) return null;
  const worlds = allLinks()
    .filter((link) => link.characterSlug === item.slug)
    .map((link) => ({
      id: link.id,
      characterSlug: link.characterSlug,
      worldSlug: link.worldSlug,
      world: summarizeWorld(findWorld(link.worldSlug)),
      linkReason: link.linkReason,
      defaultOpeningContext: link.defaultOpeningContext,
      defaultRelationshipContext: link.defaultRelationshipContext,
    }));

  return {
    ...summarizeCharacter(item),
    profileSections: item.profileSections,
    gallery: item.gallery,
    worlds,
  };
};

export const getCharacterWorldLinks = (slug) => {
  const item = findCharacter(slug);
  if (!item) return [];
  return allLinks()
    .filter((link) => link.characterSlug === item.slug)
    .map((link) => ({
      id: link.id,
      characterSlug: link.characterSlug,
      worldSlug: link.worldSlug,
      world: summarizeWorld(findWorld(link.worldSlug)),
      linkReason: link.linkReason,
      defaultOpeningContext: link.defaultOpeningContext,
      defaultRelationshipContext: link.defaultRelationshipContext,
    }));
};

export const getWorldDetail = (slug) => {
  const item = findWorld(slug);
  if (!item) return null;
  const characters = allLinks()
    .filter((link) => link.worldSlug === item.slug)
    .map((link) => summarizeCharacter(findCharacter(link.characterSlug)));

  return {
    ...summarizeWorld(item),
    worldSections: item.worldSections,
    gallery: item.gallery,
    characters,
  };
};

export const getWorldCharacters = (slug) => {
  const item = findWorld(slug);
  if (!item) return [];
  return allLinks()
    .filter((link) => link.worldSlug === item.slug)
    .map((link) => summarizeCharacter(findCharacter(link.characterSlug)));
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
  const item = {
    id: `character-${randomUUID()}`,
    entityType: 'character',
    slug: slugify(payload.name, `character-${Date.now()}`),
    name: payload.name,
    headline: payload.headline || payload.summary,
    summary: payload.summary,
    coverImageUrl: payload.coverImageUrl || '/mika_normal.webp',
    avatarImageUrl: payload.avatarImageUrl || payload.coverImageUrl || '/mika_happy.webp',
    tags: payload.tags || [],
    creator: { id: userId, slug: userId, name: '내 스튜디오' },
    ownerUserId: userId,
    visibility: payload.visibility || 'private',
    displayStatus: payload.visibility === 'public' ? 'visible' : 'draft',
    sourceType: payload.sourceType || 'original',
    favoriteCount: 0,
    chatStartCount: 0,
    updatedAt: nowIso(),
    profileSections: [
      { title: '성격', body: payload.summary },
      { title: '말투', body: payload.headline || payload.summary },
    ],
    gallery: [payload.coverImageUrl || '/mika_normal.webp'],
    promptProfile: {
      persona: [payload.summary],
      speechStyle: [payload.headline || payload.summary],
      relationshipBaseline: '처음 대화를 시작하는 거리감',
      roleTendency: 'support',
      conflictStyle: 'emotion-first',
      worldFitTags: [],
    },
  };
  createdCharacters.set(item.id, item);
  return summarizeCharacter(item);
};

export const createWorld = ({ userId, payload }) => {
  const item = {
    id: `world-${randomUUID()}`,
    entityType: 'world',
    slug: slugify(payload.name, `world-${Date.now()}`),
    name: payload.name,
    headline: payload.headline || payload.summary,
    summary: payload.summary,
    coverImageUrl: payload.coverImageUrl || '/world_tokyo.svg',
    tags: payload.tags || [],
    creator: { id: userId, slug: userId, name: '내 스튜디오' },
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
    gallery: [payload.coverImageUrl || '/world_tokyo.svg'],
    promptProfile: {
      genreKey: 'city',
      rules: [payload.worldRulesMarkdown || payload.summary],
      tone: payload.headline || payload.summary,
      starterLocations: ['첫 장면 위치'],
      worldTerms: payload.tags || [],
    },
  };
  createdWorlds.set(item.id, item);
  return summarizeWorld(item);
};

export const createCharacterWorldLink = ({ userId, payload }) => {
  const character = findCharacter(payload.characterSlug);
  const world = findWorld(payload.worldSlug);
  if (!character || !world) return null;
  const item = {
    id: `link-${randomUUID()}`,
    characterSlug: character.slug,
    worldSlug: world.slug,
    ownerUserId: userId,
    isRecommended: payload.isRecommended ?? true,
    linkReason: payload.linkReason,
    defaultOpeningContext: payload.defaultOpeningContext || '',
    defaultRelationshipContext: payload.defaultRelationshipContext || '',
  };
  createdLinks.set(item.id, item);
  return {
    id: item.id,
    characterSlug: item.characterSlug,
    worldSlug: item.worldSlug,
    world: summarizeWorld(world),
    linkReason: item.linkReason,
    defaultOpeningContext: item.defaultOpeningContext,
    defaultRelationshipContext: item.defaultRelationshipContext,
  };
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
  const link = world ? findLink({ characterSlug: character.slug, worldSlug: world.slug }) : null;
  const bridgeProfile = generateBridgeProfile({ character, world, link });
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
    resolvedPromptSnapshotJson: buildRoomPromptSnapshot({ character, world, bridgeProfile, state }),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastMessageAt: nowIso(),
  };
  rooms.set(room.id, room);

  const characterStore = seedCharacterMap.get(character.id) || createdCharacters.get(character.id);
  if (characterStore) characterStore.chatStartCount += 1;
  if (world) {
    const worldStore = seedWorldMap.get(world.id) || createdWorlds.get(world.id);
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
  return room.messages.slice(1).map((message) => ({
    role: message.role,
    content: typeof message.content === 'string' ? message.content : message.content.response,
  }));
};

export const getRoomPromptContext = (input) => {
  const roomId = typeof input === 'string' ? input : input?.roomId
  const room = rooms.get(roomId);
  if (!room) return null;
  const character = findCharacter(room.character.slug);
  const world = room.world ? findWorld(room.world.slug) : null;
  return {
    promptSnapshot: room.resolvedPromptSnapshotJson,
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
  home: { heroTargetPath: featuredHomeState.heroTargetPath },
});

export const setContentVisibility = ({ entityType, id, status }) => {
  const collection = entityType === 'character'
    ? [...seedCharacterMap.values(), ...createdCharacters.values()]
    : [...seedWorldMap.values(), ...createdWorlds.values()];
  const item = collection.find((entry) => entry.id === id || entry.slug === id);
  if (!item) return null;
  item.displayStatus = status;
  item.updatedAt = nowIso();
  return true;
};

export const setHomeHeroTarget = (input) => {
  const path = typeof input === 'string' ? input : input?.targetPath
  featuredHomeState.heroTargetPath = String(path || featuredHomeState.heroTargetPath);
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
  createdLinks.clear();
  rooms.clear();
  recentViewsByUser.clear();
  bookmarksByUser.clear();
  featuredHomeState.heroTargetPath = `/characters/${platformSeed.characters[0].slug}`;
  for (const character of seedCharacterMap.values()) {
    const seed = platformCharacters.find((item) => item.id === character.id);
    Object.assign(character, clone(seed));
  }
  for (const world of seedWorldMap.values()) {
    const seed = platformWorlds.find((item) => item.id === world.id);
    Object.assign(world, clone(seed));
  }
  for (const link of seedLinkMap.values()) {
    const seed = platformCharacterWorldLinks.find((item) => item.id === link.id);
    Object.assign(link, clone(seed));
  }
};
