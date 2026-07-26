import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  buildAssetStoragePath,
  buildCharacterWritePayload,
  buildWorldWritePayload,
  collectContentAssetUrls,
  commitRoomTurn,
  deleteAccount,
  deleteOwnedContent,
  incrementChatStartCountsBestEffort,
  listOwnedStoragePaths,
  mapLibraryEntriesToResolvedItems,
  persistRecentView,
  prepareAssetUploads,
  reconcileAccountStorageCleanupFences,
  resolveAsyncOrFallback,
  resolveDataOrFallback,
  resolveEntityById,
  resolveEntityByRef,
  resolveStoragePathFromPublicUrl,
  reconcileExpiredChatReservations,
  reconcileStorageDeletionOutbox,
} from './supabase-platform-repository.js';

const ORIGINAL_FETCH = globalThis.fetch;

const ORIGINAL_SUPABASE_ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
  VITE_PUBLIC_SUPABASE_URL: process.env.VITE_PUBLIC_SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_SUPABASE_ENV)) {
    if (typeof value === 'undefined') delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = ORIGINAL_FETCH;
});

const createMockClient = ({ characterError = null, worldError = null } = {}) => ({
  from(table) {
    return {
      update() {
        return {
          async eq() {
            if (table === 'characters') {
              return { error: characterError };
            }
            if (table === 'worlds') {
              return { error: worldError };
            }
            return { error: null };
          },
        };
      },
    };
  },
});

test('incrementChatStartCountsBestEffort swallows update errors so room creation can continue', async () => {
  const client = createMockClient({
    characterError: new Error('new row violates row-level security policy for table "characters"'),
    worldError: new Error('new row violates row-level security policy for table "worlds"'),
  });

  await assert.doesNotReject(() =>
    incrementChatStartCountsBestEffort({
      client,
      character: { id: 'character-id', chat_start_count: 1 },
      world: { id: 'world-id', chat_start_count: 2 },
    })
  );
});

test('commitRoomTurn returns the committed local snapshot without a post-RPC read', async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  const userId = '11111111-1111-4111-8111-111111111111';
  const roomId = '22222222-2222-4222-8222-222222222222';
  const characterId = '33333333-3333-4333-8333-333333333333';
  const requestId = `room:${roomId}:request-12345678`;
  const storedSnapshot = { basePromptSnapshot: 'base prompt', runningSummary: '', compactedUserTurns: 0 };
  const roomRow = {
    id: roomId,
    user_id: userId,
    character_id: characterId,
    world_id: null,
    title: 'Snapshot room',
    user_alias: '나',
    bridge_profile_json: {},
    resolved_prompt_snapshot_json: storedSnapshot,
    created_at: '2026-07-27T00:00:00.000Z',
    updated_at: '2026-07-27T00:00:00.000Z',
    last_message_at: '2026-07-27T00:00:00.000Z',
    version: 7,
  };
  const characterRow = {
    id: characterId,
    owner_user_id: userId,
    slug: 'snapshot-character',
    name: 'Snapshot Character',
    summary: '',
    visibility: 'private',
    display_status: 'visible',
    source_type: 'original',
    tags: [],
    profile_json: {},
    prompt_profile_json: {},
  };
  const stateRow = {
    current_situation: 'before',
    location: 'room',
    relationship_state: 'neutral',
    inventory_json: [],
    appearance_json: [],
    pose_json: [],
    future_promises_json: [],
    world_notes_json: [],
  };
  const greetingRow = {
    id: '44444444-4444-4444-8444-444444444444',
    role: 'assistant',
    created_at: '2026-07-27T00:00:00.000Z',
    content_json: { emotion: 'normal', inner_heart: '', response: 'hello' },
  };
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const request = { url: decodeURIComponent(String(url)), method: String(options.method || 'GET').toUpperCase(), body: String(options.body || '') };
    requests.push(request);
    if (request.url.includes('/rest/v1/rpc/commit_room_turn_v2') && request.method === 'POST') {
      return new Response(JSON.stringify({ room_id: roomId, version: 8 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/rooms') && request.method === 'GET') {
      const data = request.url.includes('resolved_prompt_snapshot_json')
        ? { resolved_prompt_snapshot_json: storedSnapshot, bridge_profile_json: {} }
        : roomRow;
      return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/characters') && request.method === 'GET') {
      return new Response(JSON.stringify([characterRow]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/room_state_summaries') && request.method === 'GET') {
      return new Response(JSON.stringify(stateRow), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/room_messages') && request.method === 'GET') {
      return new Response(JSON.stringify([greetingRow]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  };

  const assistantMessage = { emotion: 'normal', inner_heart: '', response: 'done', narration: 'after' };
  const room = await commitRoomTurn({
    event: { headers: { authorization: 'Bearer user-token' } },
    userId,
    roomId,
    requestId,
    requestFingerprint: 'a'.repeat(64),
    expectedVersion: 7,
    userMessage: 'continue',
    assistantMessage,
    response: { message: assistantMessage, trace_id: 'trace-1' },
  });

  const commitIndex = requests.findIndex((request) => request.url.includes('/rest/v1/rpc/commit_room_turn_v2'));
  assert.ok(commitIndex >= 0);
  assert.equal(requests.length, commitIndex + 1);
  assert.equal(room.id, roomId);
  assert.equal(room.title, roomRow.title);
  assert.equal(room.version, 8);
  assert.equal(room.state.currentSituation, 'after');
  assert.equal(room.messages.length, 3);
  assert.deepEqual(room.messages.at(-2), {
    id: room.messages.at(-2).id,
    role: 'user',
    createdAt: room.updatedAt,
    content: 'continue',
  });
  assert.match(room.messages.at(-2).id, /^user-[0-9a-f]{24}$/);
  assert.deepEqual(room.messages.at(-1), {
    id: room.messages.at(-1).id,
    role: 'assistant',
    createdAt: room.updatedAt,
    content: assistantMessage,
  });
  assert.match(room.messages.at(-1).id, /^assistant-[0-9a-f]{24}$/);
  assert.equal(room.lastMessageAt, room.updatedAt);
  assert.equal(Number.isNaN(Date.parse(room.updatedAt)), false);
});

test('collectContentAssetUrls gathers cover and slot urls for storage cleanup', () => {
  const urls = collectContentAssetUrls({
    entityType: 'character',
    row: {
      cover_image_url: 'https://example.com/object/public/vmate-assets/user/character/main-detail.webp',
      avatar_image_url: 'https://example.com/object/public/vmate-assets/user/character/main-card.webp',
      prompt_profile_json: {
        imageSlots: [
          {
            thumbUrl: 'https://example.com/object/public/vmate-assets/user/character/main-thumb.webp',
            cardUrl: 'https://example.com/object/public/vmate-assets/user/character/main-card.webp',
            detailUrl: 'https://example.com/object/public/vmate-assets/user/character/main-detail.webp',
          },
          {
            detailUrl: 'https://example.com/object/public/vmate-assets/user/character/angry-detail.webp',
          },
        ],
      },
    },
    assets: [
      { url: 'https://example.com/object/public/vmate-assets/user/character/main-detail.webp' },
      { url: 'https://example.com/object/public/vmate-assets/user/character/angry-detail.webp' },
    ],
  });

  assert.deepEqual(urls, [
    'https://example.com/object/public/vmate-assets/user/character/main-detail.webp',
    'https://example.com/object/public/vmate-assets/user/character/main-card.webp',
    'https://example.com/object/public/vmate-assets/user/character/main-thumb.webp',
    'https://example.com/object/public/vmate-assets/user/character/angry-detail.webp',
  ]);
});

test('resolveStoragePathFromPublicUrl rejects foreign hosts, users, entities, and traversal', () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  const userId = '11111111-1111-4111-8111-111111111111';
  const valid = `https://project.supabase.co/storage/v1/object/public/vmate-assets/${userId}/character/1721971200000-a1b2c3d4/slot-main/detail.webp`;
  assert.equal(resolveStoragePathFromPublicUrl(valid, { ownerUserId: userId, entityType: 'character' }), `${userId}/character/1721971200000-a1b2c3d4/slot-main/detail.webp`);
  for (const url of [
    valid.replace('project.supabase.co', 'foreign.example'),
    valid.replace(userId, '22222222-2222-4222-8222-222222222222'),
    valid.replace('/character/', '/world/'),
    valid.replace(`${userId}/character`, `${userId}/character/%2E%2E/world`),
    valid.replace('/slot-main/detail.webp', '/slot-main%2Fdetail.webp'),
    valid.replace('/slot-main/detail.webp', '/slot-main:detail.webp'),
  ]) {
    assert.equal(resolveStoragePathFromPublicUrl(url, { ownerUserId: userId, entityType: 'character' }), null);
  }
});

test('buildAssetStoragePath uses isolated upload and slot directories', () => {
  assert.equal(buildAssetStoragePath({
    userId: '11111111-1111-4111-8111-111111111111',
    entityType: 'world',
    uploadId: '1721971200000-a1b2c3d4',
    slot: 'scene-night',
    variant: 'hero',
  }), '11111111-1111-4111-8111-111111111111/world/1721971200000-a1b2c3d4/scene-night/hero.webp');
  assert.equal(buildAssetStoragePath({
    userId: '../foreign',
    entityType: 'world',
    uploadId: '1721971200000-a1b2c3d4',
    slot: 'main',
    variant: 'hero',
  }), null);
});

test('PATCH write payloads shallow-merge JSON and preserve omitted image slots', () => {
  const existing = {
    profile_json: { existingProfile: true },
    speech_style_json: { existingVoice: true },
    prompt_profile_json: {
      existingPrompt: true,
      creatorName: '기존 제작자',
      imageSlots: [{ id: 'main', detailUrl: 'https://legacy.example/main.webp' }],
    },
  };
  const characterPatch = buildCharacterWritePayload({
    userId: 'user-1',
    existing,
    payload: { promptProfileJson: { masterPrompt: '새 프롬프트' } },
  });
  assert.deepEqual(characterPatch.prompt_profile_json.imageSlots, existing.prompt_profile_json.imageSlots);
  assert.equal(characterPatch.prompt_profile_json.existingPrompt, true);
  assert.equal(characterPatch.prompt_profile_json.masterPrompt, '새 프롬프트');

  const worldPatch = buildWorldWritePayload({
    userId: 'user-1',
    existing,
    payload: { promptProfileJson: { imageSlots: [] } },
  });
  assert.deepEqual(worldPatch.prompt_profile_json.imageSlots, []);
  assert.equal(worldPatch.prompt_profile_json.existingPrompt, true);
});

test('listOwnedStoragePaths walks only the exact account prefix with bounded pages', async () => {
  const calls = [];
  const pages = new Map([
    ['user-1/character:0', [{ name: 'batch-a', id: null, metadata: null }, { name: '../escape', id: null, metadata: null }]],
    ['user-1/character:2', []],
    ['user-1/character/batch-a:0', [
      { name: 'main:card.webp', id: 'file-1', metadata: {} },
      { name: 'main:detail.webp', id: 'file-2', metadata: {} },
    ]],
    ['user-1/character/batch-a:2', []],
  ]);
  const client = {
    storage: {
      from(bucket) {
        assert.equal(bucket, 'vmate-assets');
        return {
          async list(prefix, options) {
            calls.push({ prefix, options });
            return { data: pages.get(`${prefix}:${options.offset}`) || [], error: null };
          },
        };
      },
    },
  };
  const paths = await listOwnedStoragePaths({ client, userId: 'user-1', entityType: 'character', pageSize: 2 });
  assert.deepEqual(paths, [
    'user-1/character/batch-a/main:card.webp',
    'user-1/character/batch-a/main:detail.webp',
  ]);
  assert.ok(calls.every((call) => call.prefix === 'user-1/character' || call.prefix.startsWith('user-1/character/')));
});

test('reconcileExpiredChatReservations skips safely when the admin client is not configured', async () => {
  for (const key of Object.keys(ORIGINAL_SUPABASE_ENV)) delete process.env[key];
  assert.deepEqual(await reconcileExpiredChatReservations({ limit: 100 }), {
    skipped: true,
    reason: 'admin_not_configured',
    reconciled: 0,
  });
});

test('reconcileStorageDeletionOutbox exposes a bounded admin retry hook', async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  const userId = '11111111-1111-4111-8111-111111111111';
  const entityId = '33333333-3333-4333-8333-333333333333';
  const path = `${userId}/character/1721971200000-a1b2c3d4/main/detail.webp`;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const request = { url: String(url), method: String(options.method || 'GET').toUpperCase(), body: String(options.body || '') };
    requests.push(request);
    if (request.url.includes('/rest/v1/storage_deletion_outbox') && request.method === 'GET') {
      return new Response(JSON.stringify([{
        id: '44444444-4444-4444-8444-444444444444',
        operation_kind: 'content', subject_user_id: userId, entity_type: 'character', entity_id: entityId,
        object_paths: [path], status: 'prepared', attempt_count: 0,
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/characters') && request.method === 'GET') {
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/storage/v1/object/') && request.method === 'DELETE') {
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/storage_deletion_outbox') && request.method === 'PATCH') {
      if (request.body.includes('"status":"processing"')) {
        return new Response(JSON.stringify({
          id: '44444444-4444-4444-8444-444444444444',
          operation_kind: 'content', subject_user_id: userId, entity_type: 'character', entity_id: entityId,
          object_paths: [path], status: 'processing', attempt_count: 0,
          lease_expires_at: new Date(Date.now() + 120_000).toISOString(),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (request.body.includes('"status":"completed"')) {
        return new Response(JSON.stringify({ id: '44444444-4444-4444-8444-444444444444' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(null, { status: 204 });
    }
    return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  };

  assert.deepEqual(await reconcileStorageDeletionOutbox({ limit: 999 }), {
    skipped: false,
    inspected: 1,
    completed: 1,
  });
  assert.ok(requests[0].url.includes('limit=20'));
  assert.ok(requests.some((request) => request.url.includes('/storage/v1/object/') && request.method === 'DELETE'));
});

test('deleteAccount aborts database and auth deletion when owner-prefix storage cleanup fails', async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const request = { url: String(url), method: String(options.method || 'GET').toUpperCase(), body: String(options.body || '') };
    requests.push(request);
    if (request.url.includes('/rest/v1/rpc/begin_account_storage_cleanup_v1') && request.method === 'POST') {
      return new Response(JSON.stringify(new Date(Date.now() + 60_000).toISOString()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (request.url.includes('/storage/v1/object/list/')) {
      return new Response(JSON.stringify({ message: 'storage unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (request.method === 'GET' && request.url.includes('/rest/v1/')) {
      return new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  };

  await assert.rejects(deleteAccount({ userId: '11111111-1111-4111-8111-111111111111' }));
  const fenceIndex = requests.findIndex((request) => request.url.includes('/rest/v1/rpc/begin_account_storage_cleanup_v1'));
  const storageListIndex = requests.findIndex((request) => request.url.includes('/storage/v1/object/list/'));
  assert.ok(fenceIndex >= 0 && storageListIndex > fenceIndex);
  assert.equal(requests.some((request) => request.method === 'DELETE'), false);
  assert.equal(requests.some((request) => request.url.includes('/auth/v1/admin/users/')), false);
});

test('asset upload preparation checks the account cleanup fence before and after signing URLs', async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  const userId = '11111111-1111-4111-8111-111111111111';
  const variant = { kind: 'thumb', slot: 'main', variant: 'thumb', width: 300, height: 400 };

  for (const scenario of ['before', 'after']) {
    let fenceChecks = 0;
    let signedRequests = 0;
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = String(url);
      const method = String(options.method || 'GET').toUpperCase();
      if (requestUrl.includes('/rest/v1/account_storage_cleanup_fences') && method === 'GET') {
        fenceChecks += 1;
        const fenced = scenario === 'before' || fenceChecks >= 2;
        return new Response(fenced ? JSON.stringify({ user_id: userId, cleanup_until: '2099-01-01T00:00:00.000Z' }) : '[]', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (requestUrl.includes('/storage/v1/object/upload/sign/') && method === 'POST') {
        signedRequests += 1;
        return new Response(JSON.stringify({ url: `/object/upload/sign/vmate-assets/${userId}/character/upload/main/thumb.webp?token=signed-token` }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
    };

    await assert.rejects(
      prepareAssetUploads({ userId, entityType: 'character', variants: [variant] }),
      (error) => error?.code === 'ACCOUNT_DELETE_IN_PROGRESS',
      scenario,
    );
    assert.equal(signedRequests, scenario === 'before' ? 0 : 1, scenario);
    assert.equal(fenceChecks, scenario === 'before' ? 1 : 2, scenario);
  }
});

test('due cleanup fences remove Storage only after Auth confirms the account is absent', async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  const userId = '11111111-1111-4111-8111-111111111111';
  const fence = { user_id: userId, cleanup_until: '2000-01-01T00:00:00.000Z', attempt_count: 0 };
  const requests = [];
  let characterLists = 0;
  globalThis.fetch = async (url, options = {}) => {
    const request = { url: String(url), method: String(options.method || 'GET').toUpperCase(), body: String(options.body || '') };
    requests.push(request);
    if (request.url.includes('/rest/v1/account_storage_cleanup_fences') && request.method === 'GET') {
      return new Response(JSON.stringify([fence]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/auth/v1/admin/users/') && request.method === 'GET') {
      return new Response(JSON.stringify({ code: 'user_not_found' }), { status: 404, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/storage/v1/object/list/') && request.method === 'POST') {
      const isCharacter = request.body.includes(`${userId}/character`);
      if (isCharacter) characterLists += 1;
      const entries = isCharacter && characterLists === 1 ? [{ name: 'late.webp', id: 'file-1', metadata: {} }] : [];
      return new Response(JSON.stringify(entries), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/storage/v1/object/') && request.method === 'DELETE') {
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/account_storage_cleanup_fences') && request.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  };

  assert.deepEqual(await reconcileAccountStorageCleanupFences({ limit: 99 }), {
    skipped: false,
    inspected: 1,
    completed: 1,
  });
  assert.ok(requests[0].url.includes('cleanup_until=lte.'));
  const authIndex = requests.findIndex((request) => request.url.includes('/auth/v1/admin/users/') && request.method === 'GET');
  const storageIndex = requests.findIndex((request) => request.url.includes('/storage/v1/object/list/') && request.method === 'POST');
  assert.ok(authIndex >= 0 && storageIndex > authIndex);
  assert.ok(requests.some((request) => request.url.includes('/rest/v1/account_storage_cleanup_fences') && request.method === 'DELETE'));
});

test('due cleanup fences preserve objects for a present or unconfirmed Auth user', async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  const userId = '11111111-1111-4111-8111-111111111111';
  const fence = { user_id: userId, cleanup_until: '2000-01-01T00:00:00.000Z', attempt_count: 0 };

  for (const authState of ['present', 'unknown']) {
    const requests = [];
    globalThis.fetch = async (url, options = {}) => {
      const request = { url: String(url), method: String(options.method || 'GET').toUpperCase(), body: String(options.body || '') };
      requests.push(request);
      if (request.url.includes('/rest/v1/account_storage_cleanup_fences') && request.method === 'GET') {
        return new Response(JSON.stringify([fence]), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (request.url.includes('/auth/v1/admin/users/') && request.method === 'GET') {
        return authState === 'present'
          ? new Response(JSON.stringify({ user: { id: userId } }), { status: 200, headers: { 'content-type': 'application/json' } })
          : new Response(JSON.stringify({ message: 'temporary failure' }), { status: 503, headers: { 'content-type': 'application/json' } });
      }
      if (request.url.includes('/rest/v1/account_storage_cleanup_fences') && request.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      if (request.url.includes('/rest/v1/account_storage_cleanup_fences') && request.method === 'PATCH') {
        return new Response(null, { status: 204 });
      }
      return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
    };

    if (authState === 'present') {
      assert.deepEqual(await reconcileAccountStorageCleanupFences(), { skipped: false, inspected: 1, completed: 1 });
      assert.ok(requests.some((request) => request.url.includes('/rest/v1/account_storage_cleanup_fences') && request.method === 'DELETE'));
    } else {
      await assert.rejects(reconcileAccountStorageCleanupFences(), (error) => error?.code === 'ACCOUNT_DELETE_STATE_UNKNOWN');
      const retryUpdate = requests.find((request) => request.url.includes('/rest/v1/account_storage_cleanup_fences') && request.method === 'PATCH');
      assert.ok(retryUpdate);
      assert.match(retryUpdate.body, /"last_scan_at":/);
      assert.equal(requests.some((request) => request.url.includes('/rest/v1/account_storage_cleanup_fences') && request.method === 'DELETE'), false);
    }
    const selection = requests.find((request) => request.url.includes('/rest/v1/account_storage_cleanup_fences') && request.method === 'GET');
    assert.match(decodeURIComponent(selection.url), /order=last_scan_at\.asc\.nullsfirst,cleanup_until\.asc/);
    assert.equal(requests.some((request) => request.url.includes('/storage/v1/object/')), false, authState);
  }
});

test('owned content deletion never removes storage when the database delete fails', async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  const userId = '11111111-1111-4111-8111-111111111111';
  const entityId = '33333333-3333-4333-8333-333333333333';
  const publicUrl = `https://project.supabase.co/storage/v1/object/public/vmate-assets/${userId}/character/1721971200000-a1b2c3d4/main/detail.webp`;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const request = { url: String(url), method: String(options.method || 'GET').toUpperCase(), body: String(options.body || '') };
    requests.push(request);
    if (request.url.includes('/rest/v1/storage_deletion_outbox') && request.method === 'GET') {
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/characters') && request.method === 'GET') {
      return new Response(JSON.stringify({
        id: entityId,
        owner_user_id: userId,
        cover_image_url: publicUrl,
        avatar_image_url: null,
        prompt_profile_json: {},
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/character_assets') && request.method === 'GET') {
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/storage_deletion_outbox') && request.method === 'POST') {
      return new Response(JSON.stringify({
        id: '44444444-4444-4444-8444-444444444444',
        operation_key: `content:character:${entityId}`,
        operation_kind: 'content',
        subject_user_id: userId,
        entity_type: 'character',
        entity_id: entityId,
        object_paths: [`${userId}/character/1721971200000-a1b2c3d4/main/detail.webp`],
        status: 'prepared',
        attempt_count: 0,
      }), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/characters') && request.method === 'DELETE') {
      return new Response(JSON.stringify({ message: 'database unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  };

  await assert.rejects(deleteOwnedContent({ userId, entityType: 'character', id: entityId }));
  const outboxIndex = requests.findIndex((request) => request.url.includes('/rest/v1/storage_deletion_outbox') && request.method === 'POST');
  const databaseDeleteIndex = requests.findIndex((request) => request.url.includes('/rest/v1/characters') && request.method === 'DELETE');
  assert.ok(outboxIndex >= 0 && databaseDeleteIndex > outboxIndex);
  assert.equal(requests.some((request) => request.url.includes('/storage/v1/object/') && request.method === 'DELETE'), false);
});

test('owned content deletion succeeds with durable cleanup pending after storage failure', async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  const userId = '11111111-1111-4111-8111-111111111111';
  const entityId = '33333333-3333-4333-8333-333333333333';
  const path = `${userId}/character/1721971200000-a1b2c3d4/main/detail.webp`;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const request = { url: String(url), method: String(options.method || 'GET').toUpperCase(), body: String(options.body || '') };
    requests.push(request);
    if (request.url.includes('/rest/v1/storage_deletion_outbox') && request.method === 'GET') {
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/characters') && request.method === 'GET') {
      return new Response(JSON.stringify({
        id: entityId,
        owner_user_id: userId,
        cover_image_url: `https://project.supabase.co/storage/v1/object/public/vmate-assets/${path}`,
        avatar_image_url: null,
        prompt_profile_json: {},
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/character_assets') && request.method === 'GET') {
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/storage_deletion_outbox') && request.method === 'POST') {
      return new Response(JSON.stringify({
        id: '44444444-4444-4444-8444-444444444444',
        operation_kind: 'content', subject_user_id: userId, entity_type: 'character', entity_id: entityId,
        object_paths: [path], status: 'prepared', attempt_count: 0,
      }), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/characters') && request.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    if (request.url.includes('/rest/v1/storage_deletion_outbox') && request.method === 'PATCH') {
      if (request.body.includes('"status":"processing"')) {
        return new Response(JSON.stringify({
          id: '44444444-4444-4444-8444-444444444444',
          operation_kind: 'content', subject_user_id: userId, entity_type: 'character', entity_id: entityId,
          object_paths: [path], status: 'processing', attempt_count: 0,
          lease_expires_at: new Date(Date.now() + 120_000).toISOString(),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(null, { status: 204 });
    }
    if (request.url.includes('/storage/v1/object/') && request.method === 'DELETE') {
      return new Response(JSON.stringify({ message: 'storage unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  };

  assert.equal(await deleteOwnedContent({ userId, entityType: 'character', id: entityId }), true);
  const databaseDeleteIndex = requests.findIndex((request) => request.url.includes('/rest/v1/characters') && request.method === 'DELETE');
  const storageDeleteIndex = requests.findIndex((request) => request.url.includes('/storage/v1/object/') && request.method === 'DELETE');
  assert.ok(databaseDeleteIndex >= 0 && storageDeleteIndex > databaseDeleteIndex);
  assert.ok(requests.filter((request) => request.url.includes('/rest/v1/storage_deletion_outbox') && request.method === 'PATCH').length >= 2);
});

test('deleting content preserves canonical Storage objects still referenced by another owned row', async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  const userId = '11111111-1111-4111-8111-111111111111';
  const deletedId = '33333333-3333-4333-8333-333333333333';
  const remainingId = '55555555-5555-4555-8555-555555555555';
  const sharedPath = `${userId}/character/1721971200000-a1b2c3d4/main/detail.webp`;
  const exclusivePath = `${userId}/character/1721971200000-a1b2c3d4/main/card.webp`;
  const toPublicUrl = (path) => `https://project.supabase.co/storage/v1/object/public/vmate-assets/${path}`;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const request = { url: String(url), method: String(options.method || 'GET').toUpperCase(), body: String(options.body || '') };
    requests.push(request);
    if (request.url.includes('/rest/v1/storage_deletion_outbox') && request.method === 'GET') {
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/characters') && request.method === 'GET') {
      const rows = request.url.includes(`id=eq.${deletedId}`)
        ? [{
          id: deletedId,
          owner_user_id: userId,
          cover_image_url: toPublicUrl(sharedPath),
          avatar_image_url: toPublicUrl(exclusivePath),
          prompt_profile_json: {},
        }]
        : [{
          id: remainingId,
          owner_user_id: userId,
          cover_image_url: toPublicUrl(sharedPath),
          avatar_image_url: null,
          prompt_profile_json: {},
        }];
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/character_assets') && request.method === 'GET') {
      const assets = request.url.includes('character_id=in.')
        ? [{ url: toPublicUrl(sharedPath) }]
        : [];
      return new Response(JSON.stringify(assets), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/storage_deletion_outbox') && request.method === 'POST') {
      return new Response(JSON.stringify({
        id: '44444444-4444-4444-8444-444444444444',
        operation_kind: 'content',
        subject_user_id: userId,
        entity_type: 'character',
        entity_id: deletedId,
        object_paths: [sharedPath, exclusivePath],
        status: 'prepared',
        attempt_count: 0,
      }), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/characters') && request.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    if (request.url.includes('/rest/v1/storage_deletion_outbox') && request.method === 'PATCH') {
      if (request.body.includes('"status":"processing"')) {
        return new Response(JSON.stringify({
          id: '44444444-4444-4444-8444-444444444444',
          operation_kind: 'content', subject_user_id: userId, entity_type: 'character', entity_id: deletedId,
          object_paths: [sharedPath, exclusivePath], status: 'processing', attempt_count: 0,
          lease_expires_at: new Date(Date.now() + 120_000).toISOString(),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ id: '44444444-4444-4444-8444-444444444444' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (request.url.includes('/storage/v1/object/') && request.method === 'DELETE') {
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  };

  assert.equal(await deleteOwnedContent({ userId, entityType: 'character', id: deletedId }), true);
  const storageDelete = requests.find((request) => request.url.includes('/storage/v1/object/') && request.method === 'DELETE');
  assert.ok(storageDelete);
  assert.match(storageDelete.body, new RegExp(exclusivePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(storageDelete.body, new RegExp(sharedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(requests.some((request) => request.url.includes('/rest/v1/character_assets') && request.url.includes('character_id=in.')));
});

test('account deletion keeps Storage before Auth and removes no application rows outside the Auth transaction', async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  const userId = '11111111-1111-4111-8111-111111111111';
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const request = { url: String(url), method: String(options.method || 'GET').toUpperCase(), body: String(options.body || '') };
    requests.push(request);
    if (request.url.includes('/rest/v1/rpc/begin_account_storage_cleanup_v1') && request.method === 'POST') {
      return new Response(JSON.stringify(new Date(Date.now() + 60_000).toISOString()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (request.url.includes('/rest/v1/') && request.method === 'GET') {
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/storage/v1/object/list/') && request.method === 'POST') {
      const entries = request.body.includes(`${userId}/character`)
        ? [{ name: 'orphan.webp', id: 'file-1', metadata: {} }]
        : [];
      return new Response(JSON.stringify(entries), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/storage/v1/object/') && request.method === 'DELETE') {
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/auth/v1/admin/users/') && request.method === 'DELETE') {
      return new Response(JSON.stringify({ message: 'auth unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/auth/v1/admin/users/') && request.method === 'GET') {
      return new Response(JSON.stringify({ user: { id: userId } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  };

  await assert.rejects(
    deleteAccount({ userId }),
    (error) => error?.code === 'ACCOUNT_DELETE_PARTIAL_STORAGE_REMOVED',
  );
  const storageDeleteIndex = requests.findIndex((request) => request.url.includes('/storage/v1/object/') && request.method === 'DELETE');
  const authDeleteIndex = requests.findIndex((request) => request.url.includes('/auth/v1/admin/users/') && request.method === 'DELETE');
  assert.ok(storageDeleteIndex >= 0 && authDeleteIndex > storageDeleteIndex);
  assert.equal(requests.some((request) => request.url.includes('/rest/v1/') && request.method === 'DELETE'), false);
});

test('resolveEntityByRef can resolve owner content even when it is not public', async () => {
  const publicClientInstance = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: null, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  const userClientInstance = {
    from(table) {
      return {
        select() {
          return {
            eq(column) {
              return {
                eq(nextColumn, slug) {
                  void column;
                  void nextColumn;
                  return {
                    async maybeSingle() {
                      return {
                        data: table === 'characters'
                          ? {
                              id: 'character-1',
                              owner_user_id: 'user-1',
                              slug,
                              name: '비공개 캐릭터',
                              headline: '',
                              summary: '요약',
                              cover_image_url: '',
                              avatar_image_url: '',
                              tags: [],
                              visibility: 'private',
                              display_status: 'draft',
                              source_type: 'original',
                              favorite_count: 0,
                              chat_start_count: 0,
                              updated_at: new Date().toISOString(),
                              prompt_profile_json: {},
                            }
                          : null,
                        error: null,
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  const resolved = await resolveEntityByRef({
    publicClientInstance,
    userClientInstance,
    userId: 'user-1',
    entityType: 'character',
    ref: 'hidden-character',
  });

  assert.equal(resolved?.summary?.slug, 'hidden-character');
  assert.equal(resolved?.summary?.visibility, 'private');
});

test('resolveEntityById can resolve owner content even when it is not public', async () => {
  const publicClientInstance = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: null, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  const userClientInstance = {
    from(table) {
      return {
        select() {
          return {
            eq() {
              return {
                eq(nextColumn, id) {
                  void nextColumn;
                  return {
                    async maybeSingle() {
                      return {
                        data: table === 'worlds'
                          ? {
                              id,
                              owner_user_id: 'user-1',
                              slug: 'hidden-world',
                              name: '비공개 월드',
                              headline: '',
                              summary: '요약',
                              cover_image_url: '',
                              tags: [],
                              visibility: 'private',
                              display_status: 'draft',
                              source_type: 'original',
                              favorite_count: 0,
                              chat_start_count: 0,
                              updated_at: new Date().toISOString(),
                              prompt_profile_json: {},
                            }
                          : null,
                        error: null,
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  const resolved = await resolveEntityById({
    publicClientInstance,
    userClientInstance,
    userId: 'user-1',
    entityType: 'world',
    id: 'world-id-1',
  });

  assert.equal(resolved?.summary?.id, 'world-id-1');
  assert.equal(resolved?.summary?.visibility, 'private');
});

test('resolveDataOrFallback returns fallback on rejected or errored query', async () => {
  const fallbackRows = [];

  const rejected = await resolveDataOrFallback({
    label: 'library.bookmarks',
    queryPromise: Promise.reject(new Error('relation bookmarks does not exist')),
    fallback: fallbackRows,
  });
  assert.deepEqual(rejected, fallbackRows);

  const errored = await resolveDataOrFallback({
    label: 'library.recent_views',
    queryPromise: Promise.resolve({ data: null, error: new Error('bad query') }),
    fallback: fallbackRows,
  });
  assert.deepEqual(errored, fallbackRows);
});

test('resolveAsyncOrFallback returns fallback when async task throws', async () => {
  const value = await resolveAsyncOrFallback({
    label: 'library.recentRooms',
    promise: Promise.reject(new Error('hydrate failed')),
    fallback: [],
  });

  assert.deepEqual(value, []);
});

test('persistRecentView falls back to replace flow when upsert conflict target is unavailable', async () => {
  const calls = [];
  const client = {
    from() {
      return {
        upsert(payload) {
          calls.push({ kind: 'upsert', payload });
          return Promise.resolve({
            error: new Error('there is no unique or exclusion constraint matching the ON CONFLICT specification'),
          });
        },
        delete() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    eq() {
                      calls.push({ kind: 'delete' });
                      return Promise.resolve({ error: null });
                    },
                  };
                },
              };
            },
          };
        },
        insert(payload) {
          calls.push({ kind: 'insert', payload });
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  await persistRecentView({
    client,
    userId: 'user-1',
    entityType: 'character',
    targetId: 'character-1',
    viewedAt: '2026-03-09T00:00:00.000Z',
  });

  assert.deepEqual(calls.map((item) => item.kind), ['upsert', 'delete', 'insert']);
});

test('mapLibraryEntriesToResolvedItems prefers owned entities before public entities', () => {
  const entries = [
    { id: 'bookmark-1', target_type: 'character', target_id: 'character-owned', created_at: '2026-03-09T00:00:00.000Z' },
    { id: 'bookmark-2', target_type: 'world', target_id: 'world-public', created_at: '2026-03-09T00:00:01.000Z' },
  ];

  const resolved = mapLibraryEntriesToResolvedItems({
    entries,
    timestampKey: 'created_at',
    ownedCharacters: [{ id: 'character-owned', entityType: 'character', slug: 'owned-character', name: '내 캐릭터' }],
    ownedWorlds: [],
    publicCharacters: [],
    publicWorlds: [{ id: 'world-public', entityType: 'world', slug: 'public-world', name: '공개 월드' }],
  });

  assert.deepEqual(resolved, [
    {
      id: 'bookmark-1',
      entityType: 'character',
      item: { id: 'character-owned', entityType: 'character', slug: 'owned-character', name: '내 캐릭터' },
      createdAt: '2026-03-09T00:00:00.000Z',
    },
    {
      id: 'bookmark-2',
      entityType: 'world',
      item: { id: 'world-public', entityType: 'world', slug: 'public-world', name: '공개 월드' },
      createdAt: '2026-03-09T00:00:01.000Z',
    },
  ]);
});
