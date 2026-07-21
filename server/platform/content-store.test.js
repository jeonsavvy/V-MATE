import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  applyReportAction,
  completeChatQuota,
  createCharacter,
  createContentReport,
  createWorld,
  getChatQuota,
  getHomePayload,
  listCharacters,
  listContentModerationActions,
  listWorlds,
  reserveChatQuota,
  refundChatQuota,
  resetPlatformStoreForTests,
  updateCharacter,
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
  assert.deepEqual(first, { allowed: true, duplicate: false, limit: 30, remaining: 29, resetAt: '2026-07-18T15:00:00.000Z' });
  assert.deepEqual(reserveChatQuota({ userId, requestId: 'request-01', limit: 30, now: beforeMidnight }), {
    allowed: false,
    duplicate: true,
    response: null,
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
    limit: 30,
    remaining: 0,
    resetAt: '2026-07-18T15:00:00.000Z',
  });

  const refunded = refundChatQuota({ userId, requestId: 'request-30', limit: 30 });
  assert.equal(refunded.remaining, 1);
  assert.deepEqual(reserveChatQuota({ userId, requestId: 'request-30', limit: 30, now: beforeMidnight }), {
    allowed: true,
    duplicate: false,
    limit: 30,
    remaining: 0,
    resetAt: '2026-07-18T15:00:00.000Z',
  });
  assert.equal(getChatQuota({ userId, limit: 30, now: new Date('2026-07-18T15:00:00.000Z') }).remaining, 30);
});
