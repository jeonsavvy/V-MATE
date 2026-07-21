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
const reports = new Map();
const moderationByEntity = new Map();
const moderationActions = [];
const chatQuotaByUserDate = new Map();
const chatQuotaEvents = new Map();
const featuredHomeState = {
  heroMode: 'auto',
  heroTargetPath: '',
};

const nowIso = () => new Date().toISOString();

const seedStarterContent = () => {
  const updatedAt = '2026-07-21T00:00:00.000Z';
  const creator = { id: 'v-mate-official', slug: 'v-mate', name: 'V-MATE' };
  createdCharacters.set('character-starter-a', {
    id: 'character-starter-a',
    entityType: 'character',
    slug: 'character-a',
    name: '캐릭터A',
    headline: '테스트 캐릭터',
    summary: '밝고 자신감 있는 테스트 캐릭터.',
    coverImageUrl: '/starter/character-a.webp',
    avatarImageUrl: '/starter/character-a.webp',
    tags: ['서브컬처', 'SF', '밝은성격'],
    creator,
    ownerUserId: creator.id,
    visibility: 'public',
    displayStatus: 'visible',
    sourceType: 'original',
    sourceUrl: '',
    rightsAttestedAt: updatedAt,
    moderationStatus: 'clear',
    favoriteCount: 0,
    chatStartCount: 0,
    updatedAt,
    profileJson: { creatorName: 'V-MATE', occupation: '아카데미 기술부' },
    speechStyleJson: { tempo: 'fast', tone: 'playful', address: '너' },
    profileSections: [
      { title: '성격', body: '밝고 자신감이 있으며 먼저 말을 건다.' },
      { title: '말투', body: '밝고 빠른 반말을 쓰며, 상대의 말에서 핵심 단어를 잡아 구체적인 질문으로 이어간다.' },
    ],
    gallery: ['/starter/character-a.webp'],
    promptProfile: {
      persona: ['밝고 자신감이 있다', '관찰한 내용을 바로 대화 소재로 바꾼다'],
      speechStyle: ['짧고 생동감 있는 반말', '과장된 밈이나 이모지는 남발하지 않는다'],
      relationshipBaseline: '처음 만난 두 사람이 테스트 대화를 시작한다',
      roleTendency: 'lead',
      conflictStyle: 'ask-then-clarify',
      worldFitTags: ['city', 'campus', 'romance'],
      creatorName: 'V-MATE',
      imageSlots: [],
    },
  });
  createdCharacters.set('character-starter-b', {
    id: 'character-starter-b',
    entityType: 'character',
    slug: 'character-b',
    name: '캐릭터B',
    headline: '테스트 캐릭터',
    summary: '차분하고 냉정한 테스트 캐릭터.',
    coverImageUrl: '/starter/character-b.webp',
    avatarImageUrl: '/starter/character-b.webp',
    tags: ['서브컬처', 'SF판타지', '냉정'],
    creator,
    ownerUserId: creator.id,
    visibility: 'public',
    displayStatus: 'visible',
    sourceType: 'original',
    sourceUrl: '',
    rightsAttestedAt: updatedAt,
    moderationStatus: 'clear',
    favoriteCount: 0,
    chatStartCount: 0,
    updatedAt,
    profileJson: { creatorName: 'V-MATE', occupation: '성간 항로 안내인' },
    speechStyleJson: { tempo: 'measured', tone: 'restrained', address: '당신' },
    profileSections: [
      { title: '성격', body: '차분하고 냉정하며 상황을 먼저 정리한다.' },
      { title: '말투', body: '낮고 단정한 존댓말을 쓴다. 결론을 서두르기보다 확인 질문을 한 뒤 자신의 판단을 말한다.' },
    ],
    gallery: ['/starter/character-b.webp'],
    promptProfile: {
      persona: ['침착하고 관찰력이 좋다', '약속과 사실관계를 정확히 기억한다'],
      speechStyle: ['짧고 단정한 존댓말', '압박보다 확인 질문으로 긴장을 만든다'],
      relationshipBaseline: '비가 오는 저녁 처음 협력하게 된 두 사람',
      roleTendency: 'balanced',
      conflictStyle: 'verify-then-commit',
      worldFitTags: ['city', 'mystery', 'fantasy'],
      creatorName: 'V-MATE',
      imageSlots: [],
    },
  });
  createdWorlds.set('world-starter-a', {
    id: 'world-starter-a',
    entityType: 'world',
    slug: 'world-a',
    name: '월드A',
    headline: '현대 도시 월드',
    summary: '비가 갠 밤의 현대 도시.',
    coverImageUrl: '/starter/world-a.webp',
    tags: ['현대', '도시', '일상'],
    creator,
    ownerUserId: creator.id,
    visibility: 'public',
    displayStatus: 'visible',
    sourceType: 'original',
    sourceUrl: '',
    rightsAttestedAt: updatedAt,
    moderationStatus: 'clear',
    favoriteCount: 0,
    chatStartCount: 0,
    updatedAt,
    worldSections: [
      { title: '장소', body: '지하철 입구, 편의점, 젖은 교차로.' },
      { title: '월드 규칙', body: '현실적인 시간과 이동 거리를 지킨다. 초자연적 해결 없이 대화와 생활의 선택으로 장면이 변한다.' },
    ],
    gallery: ['/starter/world-a.webp'],
    promptProfile: {
      genreKey: 'modern-city',
      rules: ['현실적인 시간과 이동을 지킨다', '날씨와 장소의 감각을 다음 장면에 이어간다', '생활 속 선택이 관계를 바꾼다'],
      tone: '비가 갠 도시의 밝고 차분한 관계극',
      starterLocations: ['지하철 입구', '24시간 편의점', '젖은 교차로'],
      worldTerms: ['막차', '우산', '편의점', '반사된 불빛'],
      creatorName: 'V-MATE',
      imageSlots: [],
    },
  });
  createdWorlds.set('world-starter-b', {
    id: 'world-starter-b',
    entityType: 'world',
    slug: 'world-b',
    name: '월드B',
    headline: '판타지 하늘섬 월드',
    summary: '구름 바다 위의 판타지 하늘섬.',
    coverImageUrl: '/starter/world-b.webp',
    tags: ['판타지', '하늘섬', '모험'],
    creator,
    ownerUserId: creator.id,
    visibility: 'public',
    displayStatus: 'visible',
    sourceType: 'original',
    sourceUrl: '',
    rightsAttestedAt: updatedAt,
    moderationStatus: 'clear',
    favoriteCount: 0,
    chatStartCount: 0,
    updatedAt,
    worldSections: [
      { title: '장소', body: '부유 성채, 연결교, 구름 항구.' },
      { title: '월드 규칙', body: '하늘섬은 정해진 항로로만 오갈 수 있다. 마법은 기억을 대가로 하며, 모든 선택은 성채의 상태를 바꾼다.' },
    ],
    gallery: ['/starter/world-b.webp'],
    promptProfile: {
      genreKey: 'sky-fantasy',
      rules: ['하늘섬은 정해진 항로로만 오간다', '마법은 기억을 대가로 사용한다', '선택의 결과는 세계 상태와 관계에 남는다'],
      tone: '밝은 하늘과 긴장이 공존하는 모험 판타지',
      starterLocations: ['부유 성채 전망대', '하늘섬 연결교', '구름 항구'],
      worldTerms: ['부유 성채', '하늘 항로', '기억석', '구름 바다'],
      creatorName: 'V-MATE',
      imageSlots: [],
    },
  });
  featuredHomeState.heroMode = 'auto';
  featuredHomeState.heroTargetPath = '';
};

seedStarterContent();

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
  sourceUrl: item.sourceUrl || '',
  rightsAttestedAt: item.rightsAttestedAt || '',
  moderationStatus: item.moderationStatus || moderationByEntity.get(`character:${item.id}`)?.status || 'clear',
  favoriteCount: item.favoriteCount,
  chatStartCount: item.chatStartCount,
  updatedAt: item.updatedAt,
  heroImageUrl: item.promptProfile?.heroImageUrl || '',
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
  sourceUrl: item.sourceUrl || '',
  rightsAttestedAt: item.rightsAttestedAt || '',
  moderationStatus: item.moderationStatus || moderationByEntity.get(`world:${item.id}`)?.status || 'clear',
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
    .filter((item) => item.displayStatus !== 'hidden' && !['quarantined', 'blocked'].includes(moderationByEntity.get(`character:${item.id}`)?.status))
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
    .filter((item) => item.displayStatus !== 'hidden' && !['quarantined', 'blocked'].includes(moderationByEntity.get(`world:${item.id}`)?.status))
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
  const manualHero = featuredHomeState.heroTargetPath.startsWith('/worlds/')
    ? worlds.find((item) => featuredHomeState.heroTargetPath.endsWith(`/${item.slug}`))
    : characters.find((item) => featuredHomeState.heroTargetPath.endsWith(`/${item.slug}`));
  const hero = featuredHomeState.heroMode === 'manual' ? manualHero : null;

  return {
    home: {
      defaultTab: 'characters',
      filterChips: ['신작', '인기'],
      hero: hero ? {
        title: hero.name,
        subtitle: hero.headline || hero.summary || '',
        coverImageUrl: hero.heroImageUrl || hero.coverImageUrl || '',
        targetPath: hero.entityType === 'world' ? `/worlds/${hero.slug}` : `/characters/${hero.slug}`,
      } : null,
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
    sourceUrl: payload.sourceUrl || '',
    rightsAttestedAt: payload.visibility === 'public' ? nowIso() : '',
    moderationStatus: 'clear',
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
  item.name = payload.name ?? item.name;
  item.headline = payload.headline ?? payload.summary ?? item.headline;
  item.summary = payload.summary ?? item.summary;
  item.tags = payload.tags ?? item.tags;
  if (payload.visibility) {
    item.visibility = payload.visibility;
    item.displayStatus = payload.visibility === 'public' ? 'visible' : 'draft';
  }
  item.sourceType = payload.sourceType || item.sourceType;
  if (Object.prototype.hasOwnProperty.call(payload, 'sourceUrl')) item.sourceUrl = payload.sourceUrl || '';
  if (payload.visibility === 'public' && payload.rightsConfirmed) item.rightsAttestedAt = nowIso();
  item.coverImageUrl = payload.coverImageUrl || item.coverImageUrl;
  item.avatarImageUrl = payload.avatarImageUrl || payload.coverImageUrl || item.avatarImageUrl;
  item.creator = { ...item.creator, name: creatorName };
  item.profileJson = payload.profileJson || item.profileJson || {};
  item.speechStyleJson = payload.speechStyleJson || item.speechStyleJson || {};
  if (payload.summary) item.profileSections = [{ title: '설정', body: payload.summary }];
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
    sourceUrl: payload.sourceUrl || '',
    rightsAttestedAt: payload.visibility === 'public' ? nowIso() : '',
    moderationStatus: 'clear',
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
  item.name = payload.name ?? item.name;
  item.headline = payload.headline ?? payload.summary ?? item.headline;
  item.summary = payload.summary ?? item.summary;
  item.tags = payload.tags ?? item.tags;
  if (payload.visibility) {
    item.visibility = payload.visibility;
    item.displayStatus = payload.visibility === 'public' ? 'visible' : 'draft';
  }
  item.sourceType = payload.sourceType || item.sourceType;
  if (Object.prototype.hasOwnProperty.call(payload, 'sourceUrl')) item.sourceUrl = payload.sourceUrl || '';
  if (payload.visibility === 'public' && payload.rightsConfirmed) item.rightsAttestedAt = nowIso();
  item.coverImageUrl = payload.coverImageUrl || item.coverImageUrl;
  item.creator = { ...item.creator, name: creatorName };
  if (payload.summary || payload.worldRulesMarkdown) {
    item.worldSections = [
      { title: '월드 소개', body: payload.summary || item.summary },
      { title: '월드 규칙', body: payload.worldRulesMarkdown || payload.summary || item.worldSections?.[1]?.body || item.summary },
    ];
  }
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

export const deleteAccount = async ({ userId }) => {
  let deletedCharacters = 0;
  let deletedWorlds = 0;

  for (const [key, item] of createdCharacters.entries()) {
    if (item.ownerUserId === userId) {
      createdCharacters.delete(key);
      deletedCharacters += 1;
    }
  }

  for (const [key, item] of createdWorlds.entries()) {
    if (item.ownerUserId === userId) {
      createdWorlds.delete(key);
      deletedWorlds += 1;
    }
  }

  let deletedRooms = 0;
  for (const [key, room] of rooms.entries()) {
    if (room.userId === userId) {
      rooms.delete(key);
      deletedRooms += 1;
    }
  }

  recentViewsByUser.delete(userId);
  bookmarksByUser.delete(userId);

  return {
    ok: true,
    deleted: true,
    removedAssets: 0,
    deletedCharacters,
    deletedWorlds,
    deletedRooms,
  };
};

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

const REPORT_REASONS = new Set(['sexual_content', 'minor_safety', 'hate_or_harassment', 'copyright', 'spam', 'other']);

const resolveContentForReport = (entityType, entityId) => {
  const collection = entityType === 'character' ? allCharacters() : entityType === 'world' ? allWorlds() : [];
  return collection.find((item) => item.id === entityId || item.slug === entityId) || null;
};

export const createContentReport = ({ userId, payload }) => {
  const entity = resolveContentForReport(payload.entityType, payload.entityId);
  if (!entity) return null;
  const duplicate = [...reports.values()].find((report) => report.reporterUserId === userId && report.entityType === payload.entityType && report.entityId === entity.id && report.status === 'open');
  if (duplicate) {
    const error = new Error('이미 검토 중인 신고가 있습니다.');
    error.code = 'REPORT_ALREADY_OPEN';
    throw error;
  }
  const report = {
    id: `report-${randomUUID()}`,
    reporterUserId: userId,
    entityType: payload.entityType,
    entityId: entity.id,
    entityName: entity.name,
    reason: REPORT_REASONS.has(payload.reason) ? payload.reason : 'other',
    details: String(payload.details || '').trim().slice(0, 1000),
    status: 'open',
    createdAt: nowIso(),
  };
  reports.set(report.id, report);
  const uniqueReporters = new Set([...reports.values()].filter((item) => item.entityType === report.entityType && item.entityId === report.entityId && item.status === 'open').map((item) => item.reporterUserId));
  const moderationKey = `${report.entityType}:${report.entityId}`;
  const currentModeration = moderationByEntity.get(moderationKey);
  if (uniqueReporters.size >= 3 && currentModeration?.status !== 'blocked' && currentModeration?.status !== 'quarantined') {
    const createdAt = nowIso();
    moderationByEntity.set(moderationKey, { status: 'quarantined', reason: 'report_threshold', updatedAt: createdAt });
    moderationActions.push({ id: `moderation-action-${randomUUID()}`, reportId: report.id, entityType: report.entityType, entityId: report.entityId, action: 'auto_quarantine', note: 'report_threshold', actionedBy: null, createdAt });
  }
  return clone(report);
};

export const listContentReports = ({ status = 'open' } = {}) => [...reports.values()]
  .filter((report) => !status || report.status === status)
  .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  .map(clone);

export const listContentModerationActions = () => moderationActions.map(clone);

export const applyReportAction = ({ reportId, action, note = '', userId = 'memory-owner' }) => {
  const report = reports.get(reportId);
  if (!report) return null;
  const key = `${report.entityType}:${report.entityId}`;
  if (action === 'dismiss') {
    report.status = 'dismissed';
  } else if (action === 'restore') {
    moderationByEntity.set(key, { status: 'clear', reason: 'owner_restore', updatedAt: nowIso() });
    for (const item of reports.values()) if (item.entityType === report.entityType && item.entityId === report.entityId && item.status === 'open') item.status = 'dismissed';
  } else if (action === 'quarantine' || action === 'remove') {
    moderationByEntity.set(key, { status: action === 'remove' ? 'blocked' : 'quarantined', reason: `owner_${action}`, updatedAt: nowIso() });
    report.status = 'actioned';
  } else {
    return null;
  }
  moderationActions.push({
    id: `moderation-action-${randomUUID()}`,
    reportId: report.id,
    entityType: report.entityType,
    entityId: report.entityId,
    action,
    note: String(note || '').slice(0, 1000),
    actionedBy: userId,
    createdAt: nowIso(),
  });
  return { report: clone(report), moderationStatus: moderationByEntity.get(key)?.status || 'clear' };
};

const getKstDateKey = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const getChatQuotaEventKey = (userId, requestId) => `${userId}:${requestId}`;
const getKstResetAt = (dateKey) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1, -9, 0, 0)).toISOString();
};

export const getChatQuota = ({ userId, limit = 30, now = new Date() }) => {
  const dateKey = getKstDateKey(now);
  const used = Number(chatQuotaByUserDate.get(`${userId}:${dateKey}`) || 0);
  return { limit, remaining: Math.max(0, limit - used), resetAt: getKstResetAt(dateKey) };
};

export const reserveChatQuota = ({ userId, requestId, limit = 30, now = new Date() }) => {
  const eventKey = getChatQuotaEventKey(userId, requestId);
  const existing = chatQuotaEvents.get(eventKey);
  if (existing && existing.status !== 'refunded') return { allowed: false, duplicate: true, response: existing.response ? clone(existing.response) : null, ...getChatQuota({ userId, limit, now }) };
  const dateKey = getKstDateKey(now);
  const key = `${userId}:${dateKey}`;
  const used = Number(chatQuotaByUserDate.get(key) || 0);
  if (used >= limit) return { allowed: false, duplicate: false, ...getChatQuota({ userId, limit, now }) };
  chatQuotaByUserDate.set(key, used + 1);
  chatQuotaEvents.set(eventKey, { userId, dateKey, status: 'reserved', response: null });
  return { allowed: true, duplicate: false, ...getChatQuota({ userId, limit, now }) };
};

export const completeChatQuota = ({ userId, requestId, response }) => {
  const event = chatQuotaEvents.get(getChatQuotaEventKey(userId, requestId));
  if (!event || event.userId !== userId || !['reserved', 'completed'].includes(event.status)) return false;
  event.status = 'completed';
  event.response = clone(response || {});
  event.completedAt = nowIso();
  return true;
};

export const refundChatQuota = ({ userId, requestId, limit = 30 }) => {
  const event = chatQuotaEvents.get(getChatQuotaEventKey(userId, requestId));
  if (event?.userId === userId && event.status === 'reserved') {
    const key = `${userId}:${event.dateKey}`;
    chatQuotaByUserDate.set(key, Math.max(0, Number(chatQuotaByUserDate.get(key) || 0) - 1));
    event.status = 'refunded';
  }
  const dateKey = event?.dateKey || getKstDateKey();
  const used = Number(chatQuotaByUserDate.get(`${userId}:${dateKey}`) || 0);
  return { limit, remaining: Math.max(0, limit - used), resetAt: getKstResetAt(dateKey) };
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

export const resetPlatformStoreForTests = ({ includeStarterContent = false } = {}) => {
  createdCharacters.clear();
  createdWorlds.clear();
  rooms.clear();
  recentViewsByUser.clear();
  bookmarksByUser.clear();
  reports.clear();
  moderationByEntity.clear();
  moderationActions.length = 0;
  chatQuotaByUserDate.clear();
  chatQuotaEvents.clear();
  featuredHomeState.heroMode = 'auto';
  featuredHomeState.heroTargetPath = '';
  if (includeStarterContent) seedStarterContent();
};
