import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  addRecentView,
  applyReportAction,
  appendRoomMessages,
  completeChatQuota,
  createCharacter,
  createContentReport,
  createRoom,
  createWorld,
  deleteOwnedContent,
  getChatQuota,
  getCharacterDetail,
  getHomePayload,
  getLibraryPayload,
  getBookmarkStatus,
  getRoom,
  getRoomHistoryForModel,
  getRoomPromptContext,
  getWorldDetail,
  listCharacters,
  listContentModerationActions,
  listRecentRooms,
  listWorlds,
  reserveChatQuota,
  refundChatQuota,
  resetPlatformStoreForTests,
  setContentVisibility,
  toggleBookmark,
  updateCharacter,
  updateWorld,
} from './content-store.js';

beforeEach(() => {
  resetPlatformStoreForTests();
});

test('official starter catalog is exactly two characters and two worlds', () => {
  resetPlatformStoreForTests({ includeStarterContent: true });

  const characters = listCharacters();
  const worlds = listWorlds();
  const home = getHomePayload();

  assert.deepEqual(characters.map((item) => item.name), ['캐릭터A', '캐릭터B']);
  assert.deepEqual(worlds.map((item) => item.name), ['월드A', '월드B']);
  assert.equal(characters.find((item) => item.slug === 'character-a')?.coverImageUrl, '/starter/character-a.webp');
  assert.deepEqual(characters.map((item) => item.headline), ['테스트 캐릭터', '테스트 캐릭터']);
  assert.equal(worlds.find((item) => item.slug === 'world-a')?.coverImageUrl, '/starter/world-a.webp');
  assert.equal(worlds.find((item) => item.slug === 'world-b')?.coverImageUrl, '/starter/world-b.webp');
  assert.equal(home.home.hero, null);
});

test('created content exposes creator nickname from payload', () => {
  createCharacter({
    userId: 'user-1',
    payload: {
      name: '테스트 캐릭터',
      headline: '한 줄 소개',
      summary: '요약',
      tags: [],
      visibility: 'public',
      sourceType: 'original',
      profileJson: { creatorName: '닉네임' },
    },
  });

  createWorld({
    userId: 'user-1',
    payload: {
      name: '테스트 월드',
      headline: '한 줄 설명',
      summary: '요약',
      tags: [],
      visibility: 'public',
      sourceType: 'original',
      promptProfileJson: { creatorName: '닉네임' },
    },
  });

  const payload = getHomePayload();
  assert.equal(payload.home.characterFeed.items.find((item) => item.name === '테스트 캐릭터')?.creator.name, '닉네임');
  assert.equal(payload.home.worldFeed.items.find((item) => item.name === '테스트 월드')?.creator.name, '닉네임');
});

test('catalog search and limits are bounded while home filters remain independent', async () => {
  const owner = 'catalog-owner';
  const popularCharacter = createCharacter({
    userId: owner,
    payload: { name: 'Popular character', headline: 'Old', summary: 'Old character', tags: [], visibility: 'public', sourceType: 'original', profileJson: {} },
  });
  const popularWorld = createWorld({
    userId: owner,
    payload: { name: 'Popular world', headline: 'Old', summary: 'Old world', tags: [], visibility: 'public', sourceType: 'original', promptProfileJson: {} },
  });
  createRoom({ userId: 'viewer', characterSlug: popularCharacter.slug, worldSlug: popularWorld.slug });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const newestCharacter = createCharacter({
    userId: owner,
    payload: {
      name: 'Newest character', headline: 'New', summary: 'New character', tags: ['needle-tag'], visibility: 'public', sourceType: 'original',
      profileJson: { creatorName: 'Needle Creator' }, promptProfileJson: { masterPrompt: 'private-search-secret' },
    },
  });
  createWorld({
    userId: owner,
    payload: { name: 'Newest world', headline: 'New', summary: 'New world', tags: [], visibility: 'public', sourceType: 'original', promptProfileJson: {} },
  });
  for (let index = 0; index < 205; index += 1) {
    createCharacter({
      userId: owner,
      payload: { name: `Catalog ${index}`, headline: '', summary: `Item ${index}`, tags: [], visibility: 'public', sourceType: 'original', profileJson: {} },
    });
  }

  assert.equal(listCharacters().length, 200);
  assert.equal(listCharacters({ search: 'Needle Creator' })[0]?.id, newestCharacter.id);
  assert.equal(listCharacters({ search: 'private-search-secret' }).length, 0);
  const home = getHomePayload({ characterFilter: 'new', worldFilter: 'popular' });
  assert.notEqual(home.home.characterFeed.items[0]?.id, popularCharacter.id);
  assert.equal(home.home.worldFeed.items[0]?.id, popularWorld.id);
});

test('recent room summaries, library omission, bookmark status, and model history stay bounded', () => {
  const userId = 'bounded-user';
  const character = createCharacter({
    userId: 'creator',
    payload: { name: 'Bounded character', headline: '', summary: 'Room target', tags: [], visibility: 'public', sourceType: 'original', profileJson: {} },
  });
  const createdRooms = Array.from({ length: 25 }, () => createRoom({ userId, characterSlug: character.slug }));
  const activeRoom = createdRooms[0];
  for (let index = 0; index < 7; index += 1) {
    appendRoomMessages({
      roomId: activeRoom.id,
      userId,
      userMessage: `message-${index}`,
      assistantMessage: { emotion: 'normal', inner_heart: '', response: `response-${index}` },
    });
  }

  assert.equal(listRecentRooms({ userId, limit: 100 }).length, 20);
  const summaries = listRecentRooms({ userId, limit: 3, includeMessages: false });
  assert.equal(summaries.length, 3);
  assert.ok(summaries.every((room) => room.messages.length === 0));
  assert.deepEqual(getLibraryPayload({ userId, includeRecentRooms: false }).recentRooms, []);

  assert.equal(getBookmarkStatus({ userId, entityType: 'character', targetId: character.id }), false);
  toggleBookmark({ userId, entityType: 'character', ref: character.slug });
  assert.equal(getBookmarkStatus({ userId, entityType: 'character', targetId: character.id }), true);

  const history = getRoomHistoryForModel({ roomId: activeRoom.id, userId });
  assert.equal(history.length, 12);
  assert.equal(history[0].content, 'message-1');
  assert.equal(history.at(-1).content, 'response-6');
});

test('three distinct open reports quarantine content and owner restore makes it public again', () => {
  const character = createCharacter({
    userId: 'creator-1',
    payload: {
      name: '신고 테스트 캐릭터',
      headline: '공개 캐릭터',
      summary: '신고 임계값 테스트',
      tags: [],
      visibility: 'public',
      sourceType: 'original',
      profileJson: {},
    },
  });

  const first = createContentReport({ userId: 'reporter-1', payload: { entityType: 'character', entityId: character.id, reason: 'spam' } });
  assert.throws(
    () => createContentReport({ userId: 'reporter-1', payload: { entityType: 'character', entityId: character.id, reason: 'other' } }),
    (error) => error?.code === 'REPORT_ALREADY_OPEN',
  );
  createContentReport({ userId: 'reporter-2', payload: { entityType: 'character', entityId: character.id, reason: 'spam' } });
  assert.ok(listCharacters().some((item) => item.id === character.id));
  createContentReport({ userId: 'reporter-3', payload: { entityType: 'character', entityId: character.id, reason: 'spam' } });
  assert.ok(!listCharacters().some((item) => item.id === character.id));
  assert.equal(listContentModerationActions().at(-1)?.action, 'auto_quarantine');
  assert.ok(getCharacterDetail({ slug: character.slug, userId: 'creator-1' }), 'owner retains moderated detail access');
  assert.equal(getCharacterDetail({ slug: character.slug, userId: 'other-user' }), null);
  assert.throws(
    () => createRoom({ userId: 'creator-1', characterSlug: character.slug }),
    (error) => error?.code === 'ROOM_TARGET_NOT_STARTABLE',
  );

  updateCharacter({ userId: 'creator-1', slug: character.slug, payload: { visibility: 'public' } });
  assert.ok(!listCharacters().some((item) => item.id === character.id), 'creator cannot republish quarantined content');

  const restored = applyReportAction({ reportId: first.id, action: 'restore', userId: 'owner-1', note: '검토 완료' });
  assert.equal(restored.moderationStatus, 'clear');
  assert.ok(listCharacters().some((item) => item.id === character.id));
  const restoreAudit = listContentModerationActions().at(-1);
  assert.equal(restoreAudit?.action, 'restore');
  assert.equal(restoreAudit?.actionedBy, 'owner-1');
  assert.equal(restoreAudit?.note, '검토 완료');
});

test('daily quota is idempotent, refunds failures, caps at 30, and resets at KST midnight', () => {
  const userId = 'quota-user';
  const beforeMidnight = new Date('2026-07-18T14:59:59.000Z');

  const first = reserveChatQuota({ userId, requestId: 'request-01', limit: 30, now: beforeMidnight });
  assert.deepEqual(first, { allowed: true, duplicate: false, disposition: 'reserved', roomVersion: 0, limit: 30, remaining: 29, resetAt: '2026-07-18T15:00:00.000Z' });
  assert.deepEqual(reserveChatQuota({ userId, requestId: 'request-01', limit: 30, now: beforeMidnight }), {
    allowed: false,
    duplicate: true,
    disposition: 'in_progress',
    response: null,
    roomVersion: 0,
    limit: 30,
    remaining: 29,
    resetAt: '2026-07-18T15:00:00.000Z',
  });
  assert.equal(completeChatQuota({ userId, requestId: 'request-01', response: { message: { response: 'cached' }, trace_id: 'trace-1' } }), true);
  assert.deepEqual(reserveChatQuota({ userId, requestId: 'request-01', limit: 30, now: beforeMidnight }).response, { message: { response: 'cached' }, trace_id: 'trace-1' });
  assert.equal(reserveChatQuota({ userId: 'another-user', requestId: 'request-01', limit: 30, now: beforeMidnight }).remaining, 29);

  for (let index = 2; index <= 30; index += 1) {
    assert.equal(reserveChatQuota({ userId, requestId: `request-${String(index).padStart(2, '0')}`, limit: 30, now: beforeMidnight }).allowed, true);
  }
  assert.deepEqual(reserveChatQuota({ userId, requestId: 'request-31', limit: 30, now: beforeMidnight }), {
    allowed: false,
    duplicate: false,
    disposition: 'limit_exceeded',
    limit: 30,
    remaining: 0,
    resetAt: '2026-07-18T15:00:00.000Z',
  });

  const refunded = refundChatQuota({ userId, requestId: 'request-30', limit: 30 });
  assert.equal(refunded.remaining, 1);
  assert.deepEqual(reserveChatQuota({ userId, requestId: 'request-30', limit: 30, now: beforeMidnight }), {
    allowed: true,
    duplicate: false,
    disposition: 'reserved',
    roomVersion: 0,
    limit: 30,
    remaining: 0,
    resetAt: '2026-07-18T15:00:00.000Z',
  });
  assert.equal(getChatQuota({ userId, limit: 30, now: new Date('2026-07-18T15:00:00.000Z') }).remaining, 30);
});

test('private content detail is owner-only and supplied private worlds never downgrade silently', () => {
  const character = createCharacter({
    userId: 'owner-1',
    payload: {
      name: '비공개 캐릭터',
      headline: '비공개',
      summary: '소유자 전용',
      tags: [],
      visibility: 'private',
      sourceType: 'original',
      profileJson: {},
    },
  });
  const world = createWorld({
    userId: 'owner-1',
    payload: {
      name: '비공개 월드',
      headline: '비공개',
      summary: '소유자 전용',
      tags: [],
      visibility: 'unlisted',
      sourceType: 'original',
      promptProfileJson: {},
    },
  });

  assert.ok(getCharacterDetail({ slug: character.slug, userId: 'owner-1' }));
  assert.equal(getCharacterDetail({ slug: character.slug, userId: 'other-user' }), null);
  assert.ok(getWorldDetail({ slug: world.slug, userId: 'owner-1' }));
  assert.equal(getWorldDetail({ slug: world.slug, userId: 'other-user' }), null);
  assert.ok(createRoom({ userId: 'owner-1', characterSlug: character.slug, worldSlug: world.slug }));
  assert.equal(createRoom({ userId: 'other-user', characterSlug: character.slug, worldSlug: world.slug }), null);
  assert.equal(createRoom({ userId: 'owner-1', characterSlug: character.slug, worldSlug: 'missing-world' }), null);
});

test('public feeds exclude private and draft content in both entity modes', () => {
  const privateCharacter = createCharacter({
    userId: 'feed-owner',
    payload: {
      name: 'Private feed character', summary: '', tags: [], visibility: 'private', sourceType: 'original', profileJson: {},
    },
  });
  const draftCharacter = createCharacter({
    userId: 'feed-owner',
    payload: {
      name: 'Draft feed character', summary: '', tags: [], visibility: 'public', sourceType: 'original', profileJson: {},
    },
  });
  setContentVisibility({ entityType: 'character', id: draftCharacter.id, status: 'draft' });
  const privateWorld = createWorld({
    userId: 'feed-owner',
    payload: {
      name: 'Private feed world', summary: '', tags: [], visibility: 'private', sourceType: 'original', promptProfileJson: {},
    },
  });
  const draftWorld = createWorld({
    userId: 'feed-owner',
    payload: {
      name: 'Draft feed world', summary: '', tags: [], visibility: 'public', sourceType: 'original', promptProfileJson: {},
    },
  });
  setContentVisibility({ entityType: 'world', id: draftWorld.id, status: 'draft' });

  assert.equal(listCharacters().some((item) => [privateCharacter.id, draftCharacter.id].includes(item.id)), false);
  assert.equal(listWorlds().some((item) => [privateWorld.id, draftWorld.id].includes(item.id)), false);
});

test('public detail hides authoring JSON while owner edit hydration retains it', () => {
  const character = createCharacter({
    userId: 'authoring-owner',
    payload: {
      name: 'Prompt private character', summary: 'Public summary', tags: [], visibility: 'public', sourceType: 'original',
      profileJson: { personality: 'Public derived personality', privateNote: 'profile secret' },
      speechStyleJson: { voice: 'Public derived voice', privateNote: 'speech secret' },
      promptProfileJson: { masterPrompt: 'character secret', characterIntro: 'intro secret', imageSlots: [] },
    },
  });
  const world = createWorld({
    userId: 'authoring-owner',
    payload: {
      name: 'Prompt private world', summary: 'Public world summary', tags: [], visibility: 'public', sourceType: 'original',
      worldRulesMarkdown: 'world rules secret',
      promptProfileJson: { masterPrompt: 'world secret', worldIntro: 'world intro secret', imageSlots: [] },
    },
  });

  const publicCharacter = getCharacterDetail({ slug: character.slug, userId: '' });
  const ownerCharacter = getCharacterDetail({ slug: character.slug, userId: 'authoring-owner' });
  assert.equal(Object.hasOwn(publicCharacter, 'profileJson'), false);
  assert.equal(Object.hasOwn(publicCharacter, 'speechStyleJson'), false);
  assert.equal(Object.hasOwn(publicCharacter, 'promptProfileJson'), false);
  assert.equal(ownerCharacter.promptProfileJson.masterPrompt, 'character secret');
  assert.equal(ownerCharacter.profileJson.privateNote, 'profile secret');

  const publicWorld = getWorldDetail({ slug: world.slug, userId: '' });
  const ownerWorld = getWorldDetail({ slug: world.slug, userId: 'authoring-owner' });
  assert.equal(Object.hasOwn(publicWorld, 'promptProfileJson'), false);
  assert.equal(Object.hasOwn(publicWorld, 'worldRulesMarkdown'), false);
  assert.doesNotMatch(JSON.stringify(publicWorld), /world rules secret|world secret|world intro secret/);
  assert.equal(ownerWorld.promptProfileJson.masterPrompt, 'world secret');
  assert.equal(ownerWorld.worldRulesMarkdown, 'world rules secret');

  updateCharacter({ userId: 'authoring-owner', slug: character.slug, payload: { promptProfileJson: { masterPrompt: 'changed character secret' } } });
  updateWorld({ userId: 'authoring-owner', slug: world.slug, payload: { promptProfileJson: { masterPrompt: 'changed world secret' } } });
  assert.equal(getCharacterDetail({ slug: character.slug, userId: 'authoring-owner' }).promptProfileJson.masterPrompt, 'changed character secret');
  assert.equal(getWorldDetail({ slug: world.slug, userId: 'authoring-owner' }).promptProfileJson.masterPrompt, 'changed world secret');
});

test('memory summaries expose only renderable image slot fields while owner detail retains authoring metadata', () => {
  const ownerId = 'slot-author';
  const viewerId = 'slot-viewer';
  const characterSlot = {
    id: 'character-main',
    slot: 'main',
    usage: 'character-usage-secret',
    trigger: 'character-trigger-secret',
    priority: 999,
    thumbUrl: 'https://example.test/character-thumb.webp',
    thumbWidth: 300,
    feedUrl: 'https://example.test/character-feed.webp',
    feedWidth: 400,
    cardUrl: 'https://example.test/character-card.webp',
    detailUrl: 'https://example.test/character-detail.webp',
    arbitraryPromptKey: 'character-slot-arbitrary-secret',
  };
  const worldSlot = {
    id: 'world-main',
    slot: 'main',
    usage: 'world-usage-secret',
    trigger: 'world-trigger-secret',
    priority: 888,
    thumbUrl: 'https://example.test/world-thumb.webp',
    cardUrl: 'https://example.test/world-card.webp',
    heroUrl: 'https://example.test/world-hero.webp',
    detailHeight: 720,
    arbitraryPromptKey: 'world-slot-arbitrary-secret',
  };
  const character = createCharacter({
    userId: ownerId,
    payload: {
      name: 'Slot character', headline: 'Public headline', summary: 'Public summary', tags: [],
      visibility: 'public', sourceType: 'original', profileJson: {},
      promptProfileJson: {
        masterPrompt: 'character-room-master-secret',
        characterIntro: 'character-intro-room-secret',
        relationshipBaseline: 'character-relationship-room-secret',
        heroImageUrl: { masterPrompt: 'character-hero-object-secret' },
        imageSlots: [characterSlot],
      },
    },
  });
  const world = createWorld({
    userId: ownerId,
    payload: {
      name: 'Slot world', headline: 'Public world headline', summary: 'Public world summary', tags: [],
      visibility: 'public', sourceType: 'original', worldRulesMarkdown: 'private world rules',
      promptProfileJson: {
        masterPrompt: 'world-room-master-secret',
        worldIntro: 'world-intro-room-secret',
        starterLocations: ['world-location-room-secret'],
        worldTerms: ['world-term-room-secret'],
        imageSlots: [worldSlot],
      },
    },
  });

  toggleBookmark({ userId: viewerId, entityType: 'character', ref: character.slug });
  toggleBookmark({ userId: viewerId, entityType: 'world', ref: world.slug });
  addRecentView({ userId: viewerId, entityType: 'character', ref: character.slug });
  addRecentView({ userId: viewerId, entityType: 'world', ref: world.slug });
  const createdRoom = createRoom({
    userId: viewerId,
    characterSlug: character.slug,
    worldSlug: world.slug,
  });
  const appendedRoom = appendRoomMessages({
    roomId: createdRoom.id,
    userId: viewerId,
    userMessage: 'hello',
    assistantMessage: { emotion: 'normal', inner_heart: '', response: 'hello back' },
  });

  const publicCharacter = getCharacterDetail({ slug: character.slug, userId: viewerId });
  const publicWorld = getWorldDetail({ slug: world.slug, userId: viewerId });
  const ownerCharacter = getCharacterDetail({ slug: character.slug, userId: ownerId });
  const ownerWorld = getWorldDetail({ slug: world.slug, userId: ownerId });
  const viewerLibrary = getLibraryPayload({ userId: viewerId });
  const ownerLibrary = getLibraryPayload({ userId: ownerId, includeRecentRooms: false });
  const recentRooms = listRecentRooms({ userId: viewerId });
  const fetchedRoom = getRoom({ roomId: createdRoom.id, userId: viewerId });
  const serializedSummaries = JSON.stringify({
    character,
    world,
    characters: listCharacters(),
    worlds: listWorlds(),
    home: getHomePayload(),
    publicCharacter,
    publicWorld,
    viewerLibrary,
    ownerLibrary,
    createdRoom,
    appendedRoom,
    recentRooms,
    fetchedRoom,
  });

  for (const secret of [
    'character-usage-secret',
    'character-trigger-secret',
    'character-slot-arbitrary-secret',
    'world-usage-secret',
    'world-trigger-secret',
    'world-slot-arbitrary-secret',
    'character-room-master-secret',
    'character-hero-object-secret',
    'world-room-master-secret',
    'character-intro-room-secret',
    'character-relationship-room-secret',
    'world-intro-room-secret',
    'world-location-room-secret',
    'world-term-room-secret',
  ]) {
    assert.doesNotMatch(serializedSummaries, new RegExp(secret));
  }
  assert.doesNotMatch(serializedSummaries, /resolvedPromptSnapshotJson/);
  assert.deepEqual(publicCharacter.imageSlots, [{
    id: 'character-main',
    slot: 'main',
    thumbUrl: 'https://example.test/character-thumb.webp',
    feedUrl: 'https://example.test/character-feed.webp',
    cardUrl: 'https://example.test/character-card.webp',
    detailUrl: 'https://example.test/character-detail.webp',
    thumbWidth: 300,
    feedWidth: 400,
  }]);
  assert.deepEqual(publicWorld.imageSlots, [{
    id: 'world-main',
    slot: 'main',
    thumbUrl: 'https://example.test/world-thumb.webp',
    cardUrl: 'https://example.test/world-card.webp',
    detailUrl: 'https://example.test/world-hero.webp',
    detailHeight: 720,
  }]);
  for (const room of [createdRoom, appendedRoom, ...recentRooms, fetchedRoom]) {
    assert.equal(Object.hasOwn(room, 'resolvedPromptSnapshotJson'), false);
    assert.equal(Object.hasOwn(room, 'bridgeProfile'), false);
    assert.equal(Object.hasOwn(room.character.imageSlots[0], 'usage'), false);
    assert.equal(Object.hasOwn(room.character.imageSlots[0], 'trigger'), false);
    assert.equal(Object.hasOwn(room.character.imageSlots[0], 'priority'), false);
  }

  assert.equal(ownerCharacter.imageSlots[0].usage, 'character-usage-secret');
  assert.equal(ownerCharacter.imageSlots[0].trigger, 'character-trigger-secret');
  assert.equal(ownerCharacter.imageSlots[0].priority, 999);
  assert.equal(ownerCharacter.imageSlots[0].arbitraryPromptKey, 'character-slot-arbitrary-secret');
  assert.equal(ownerCharacter.promptProfileJson.imageSlots[0].arbitraryPromptKey, 'character-slot-arbitrary-secret');
  assert.equal(ownerWorld.imageSlots[0].usage, 'world-usage-secret');
  assert.equal(ownerWorld.imageSlots[0].trigger, 'world-trigger-secret');
  assert.equal(ownerWorld.imageSlots[0].priority, 888);
  assert.equal(ownerWorld.imageSlots[0].arbitraryPromptKey, 'world-slot-arbitrary-secret');
  assert.equal(ownerWorld.promptProfileJson.imageSlots[0].arbitraryPromptKey, 'world-slot-arbitrary-secret');
  assert.match(getRoomPromptContext({ roomId: createdRoom.id, userId: viewerId }).promptSnapshot, /character-room-master-secret/);
  assert.match(getRoomPromptContext({ roomId: createdRoom.id, userId: viewerId }).promptSnapshot, /world-room-master-secret/);
});

test('hidden targets cannot start rooms and room data stays isolated to its owner', () => {
  const character = createCharacter({
    userId: 'owner-1',
    payload: {
      name: '숨김 캐릭터',
      headline: '숨김',
      summary: '숨김 테스트',
      tags: [],
      visibility: 'private',
      sourceType: 'original',
      profileJson: {},
    },
  });
  setContentVisibility({ entityType: 'character', id: character.id, status: 'hidden' });
  assert.throws(
    () => createRoom({ userId: 'owner-1', characterSlug: character.slug }),
    (error) => error?.code === 'ROOM_TARGET_NOT_STARTABLE',
  );

  setContentVisibility({ entityType: 'character', id: character.id, status: 'draft' });
  const room = createRoom({ userId: 'owner-1', characterSlug: character.slug });
  assert.ok(getRoom({ roomId: room.id, userId: 'owner-1' }));
  assert.equal(getRoom({ roomId: room.id, userId: 'other-user' }), null);
  assert.deepEqual(getRoomHistoryForModel({ roomId: room.id, userId: 'other-user' }), []);
  assert.equal(getRoomPromptContext({ roomId: room.id, userId: 'other-user' }), null);
});

test('owned content deletion refuses cross-owner identifiers', async () => {
  const character = createCharacter({
    userId: 'owner-1',
    payload: {
      name: '삭제 보호 캐릭터',
      headline: '보호',
      summary: '교차 소유자 삭제 방지',
      tags: [],
      visibility: 'private',
      sourceType: 'original',
      profileJson: {},
    },
  });

  assert.equal(await deleteOwnedContent({ userId: 'other-user', entityType: 'character', id: character.id }), false);
  assert.ok(getCharacterDetail({ slug: character.slug, userId: 'owner-1' }));
  assert.equal(await deleteOwnedContent({ userId: 'owner-1', entityType: 'character', id: character.id }), true);
  assert.equal(getCharacterDetail({ slug: character.slug, userId: 'owner-1' }), null);
});
