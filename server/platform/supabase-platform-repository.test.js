import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, test } from 'node:test';
import {
  buildAssetStoragePath,
  buildCharacterWritePayload,
  buildWorldWritePayload,
  collectLegacyContentAssetUrls,
  commitRoomTurn,
  createCharacter as createPersistentCharacter,
  createWorld as createPersistentWorld,
  deleteAccount,
  deleteOwnedContent,
  getBookmarkStatus,
  getCharacterDetail,
  getLibraryPayload,
  getOpsDashboard,
  getPlatformPersistenceConfig,
  getRoomHistoryForModel,
  getRoomPromptContext,
  getWorldDetail,
  incrementChatStartCountsBestEffort,
  isPersistentMutationAvailable,
  isPersistentPlatformAvailable,
  isPersistentPlatformRequired,
  listCharacters,
  listOwnedStoragePaths,
  listRecentRooms,
  listWorlds,
  mapLibraryEntriesToResolvedItems,
  persistRecentView,
  prepareAssetUploads,
  reconcileAccountStorageCleanupFences,
  resolveAsyncOrFallback,
  resolveDataOrFallback,
  resolveEntityById,
  resolveEntityByRef,
  resolveContentAssetStoragePaths,
  resolveStoragePathFromPublicUrl,
  reconcileExpiredChatReservations,
  reconcileStorageDeletionOutbox,
  updateCharacter as updatePersistentCharacter,
  updateWorld as updatePersistentWorld,
} from './supabase-platform-repository.js';

const ORIGINAL_FETCH = globalThis.fetch;

const ORIGINAL_SUPABASE_ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
  VITE_PUBLIC_SUPABASE_URL: process.env.VITE_PUBLIC_SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

test('persistence availability reads an explicit runtime environment before process.env fallback', () => {
  const runtimeEnvironment = {
    SUPABASE_URL: 'https://runtime-project.supabase.co/',
    SUPABASE_ANON_KEY: 'runtime-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'runtime-service-key',
    PUBLIC_ASSETS_BUCKET: 'runtime-assets',
    APP_ENV: 'production',
  };

  assert.equal(isPersistentPlatformAvailable(runtimeEnvironment), true);
  assert.equal(isPersistentMutationAvailable(runtimeEnvironment), true);
  assert.equal(isPersistentPlatformRequired(runtimeEnvironment), true);
  assert.deepEqual(getPlatformPersistenceConfig(runtimeEnvironment), {
    supabaseUrl: 'https://runtime-project.supabase.co',
    storageBucket: 'runtime-assets',
    configured: true,
    mutationConfigured: true,
  });
  assert.equal(isPersistentPlatformAvailable({}), false);
  assert.equal(isPersistentMutationAvailable({}), false);
  assert.equal(isPersistentPlatformRequired({ APP_ENV: 'test' }), false);
});

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
    if (request.url.includes('/rest/v1/owned_room_summaries') && request.method === 'GET') {
      return new Response(JSON.stringify(roomRow), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/rooms') && request.method === 'GET') {
      const data = { resolved_prompt_snapshot_json: storedSnapshot, bridge_profile_json: {} };
      return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if ((request.url.includes('/rest/v1/public_character_catalog') || request.url.includes('/rest/v1/owned_character_details')) && request.method === 'GET') {
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
    room: { id: roomId, version: 6 },
    promptContext: { storedPromptSnapshot: { basePromptSnapshot: 'stale prompt' } },
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
  assert.equal(Object.hasOwn(room, 'resolvedPromptSnapshotJson'), false);
});

test('commitRoomTurn reuses matching room and prompt snapshots without pre-commit reads', async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  const userId = '11111111-1111-4111-8111-111111111111';
  const roomId = '22222222-2222-4222-8222-222222222222';
  const requestId = `room:${roomId}:matching-snapshot`;
  const storedPromptSnapshot = { basePromptSnapshot: 'base prompt', runningSummary: '', compactedUserTurns: 0 };
  const roomSnapshot = {
    id: roomId,
    title: 'Matching snapshot room',
    userAlias: '나',
    character: { id: 'character-1', entityType: 'character', slug: 'snapshot-character', name: 'Snapshot Character' },
    world: null,
    bridgeProfile: {},
    state: {
      currentSituation: 'before', location: 'room', relationshipState: 'neutral',
      inventory: [], appearance: [], pose: [], futurePromises: [], worldNotes: [],
    },
    messages: [{
      id: 'greeting-1', role: 'assistant', createdAt: '2026-07-27T00:00:00.000Z',
      content: { emotion: 'normal', inner_heart: '', response: 'hello' },
    }],
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
    lastMessageAt: '2026-07-27T00:00:00.000Z',
    version: 7,
  };
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const request = { url: decodeURIComponent(String(url)), method: String(options.method || 'GET').toUpperCase() };
    requests.push(request);
    if (request.url.includes('/rest/v1/rpc/commit_room_turn_v2') && request.method === 'POST') {
      return new Response(JSON.stringify({ room_id: roomId, version: 8 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  };
  const assistantMessage = { emotion: 'normal', inner_heart: '', response: 'done', narration: 'after' };

  const room = await commitRoomTurn({
    event: { headers: { authorization: 'Bearer user-token' } },
    userId,
    roomId,
    requestId,
    requestFingerprint: 'b'.repeat(64),
    expectedVersion: 7,
    userMessage: 'continue',
    assistantMessage,
    response: { message: assistantMessage, trace_id: 'trace-matching' },
    room: roomSnapshot,
    promptContext: { storedPromptSnapshot },
  });

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/rest\/v1\/rpc\/commit_room_turn_v2/);
  assert.equal(room.version, 8);
  assert.equal(room.messages.length, 3);
});

test('public details use safe catalog views while owner details retain private authoring fields', async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test-key';
  const ownerId = '11111111-1111-4111-8111-111111111111';
  const publicCharacter = {
    id: '22222222-2222-4222-8222-222222222222', owner_user_id: ownerId,
    slug: 'safe-public-character', name: 'Safe character', headline: 'Safe headline', summary: 'Safe summary',
    cover_image_url: '', avatar_image_url: '', visibility: 'public', display_status: 'visible',
    source_type: 'original', tags: [], favorite_count: 0, chat_start_count: 0,
    creator_name: 'Safe creator', personality: 'Safe personality', voice: 'Safe voice', relationship: 'Safe relationship',
    hero_image_url: '', image_slots: [{ id: 'main', slot: 'main', detailUrl: 'https://safe.example/character.webp' }],
  };
  const publicWorld = {
    id: '33333333-3333-4333-8333-333333333333', owner_user_id: ownerId,
    slug: 'safe-public-world', name: 'Safe world', headline: 'Safe headline', summary: 'Safe summary',
    cover_image_url: '', visibility: 'public', display_status: 'visible', source_type: 'original', tags: [],
    favorite_count: 0, chat_start_count: 0, creator_name: 'Safe creator', image_slots: [{ id: 'main', slot: 'main', detailUrl: 'https://safe.example/world.webp' }],
  };
  const ownerCharacter = {
    ...publicCharacter,
    profile_json: { personality: 'Safe personality', privateNote: 'profile secret' },
    speech_style_json: { voice: 'Safe voice', privateNote: 'speech secret' },
    prompt_profile_json: {
      masterPrompt: 'character master secret',
      imageSlots: [{ id: 'main', slot: 'main', usage: 'owner character usage', trigger: 'owner character trigger', priority: 91, detailUrl: 'https://safe.example/character.webp' }],
    },
  };
  const ownerWorld = {
    ...publicWorld,
    world_rules_markdown: 'world rules secret',
    prompt_profile_json: {
      masterPrompt: 'world master secret',
      imageSlots: [{ id: 'main', slot: 'main', usage: 'owner world usage', trigger: 'owner world trigger', priority: 92, detailUrl: 'https://safe.example/world.webp' }],
    },
  };
  const requests = [];
  globalThis.fetch = async (url) => {
    const requestUrl = decodeURIComponent(String(url));
    requests.push(requestUrl);
    if (requestUrl.includes('/rest/v1/public_character_catalog')) return new Response(JSON.stringify(publicCharacter), { status: 200, headers: { 'content-type': 'application/json' } });
    if (requestUrl.includes('/rest/v1/public_world_catalog')) return new Response(JSON.stringify(publicWorld), { status: 200, headers: { 'content-type': 'application/json' } });
    if (requestUrl.includes('/rest/v1/owned_character_details')) return new Response(JSON.stringify(ownerCharacter), { status: 200, headers: { 'content-type': 'application/json' } });
    if (requestUrl.includes('/rest/v1/owned_world_details')) return new Response(JSON.stringify(ownerWorld), { status: 200, headers: { 'content-type': 'application/json' } });
    if (requestUrl.includes('/rest/v1/character_assets') || requestUrl.includes('/rest/v1/world_assets')) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  };

  const anonymousCharacter = await getCharacterDetail({ slug: publicCharacter.slug, userId: '' });
  const anonymousWorld = await getWorldDetail({ slug: publicWorld.slug, userId: '' });
  assert.equal(Object.hasOwn(anonymousCharacter, 'profileJson'), false);
  assert.equal(Object.hasOwn(anonymousCharacter, 'speechStyleJson'), false);
  assert.equal(Object.hasOwn(anonymousCharacter, 'promptProfileJson'), false);
  assert.equal(Object.hasOwn(anonymousCharacter.imageSlots[0], 'usage'), false);
  assert.deepEqual(
    anonymousCharacter.profileSections.map((section) => section.body),
    ['Safe personality', 'Safe voice', 'Safe relationship'],
    'personality, voice, and relationship are intentional public display fields, not raw authoring JSON',
  );
  assert.equal(Object.hasOwn(anonymousWorld, 'worldRulesMarkdown'), false);
  assert.equal(Object.hasOwn(anonymousWorld, 'promptProfileJson'), false);
  assert.equal(Object.hasOwn(anonymousWorld.imageSlots[0], 'usage'), false);

  const event = { headers: { authorization: 'Bearer owner-token' } };
  const editableCharacter = await getCharacterDetail({ event, slug: publicCharacter.slug, userId: ownerId });
  const editableWorld = await getWorldDetail({ event, slug: publicWorld.slug, userId: ownerId });
  assert.equal(editableCharacter.promptProfileJson.masterPrompt, 'character master secret');
  assert.equal(editableCharacter.imageSlots[0].usage, 'owner character usage');
  assert.equal(editableCharacter.imageSlots[0].trigger, 'owner character trigger');
  assert.equal(editableCharacter.imageSlots[0].priority, 91);
  assert.equal(editableCharacter.profileJson.privateNote, 'profile secret');
  assert.equal(editableWorld.promptProfileJson.masterPrompt, 'world master secret');
  assert.equal(editableWorld.imageSlots[0].usage, 'owner world usage');
  assert.equal(editableWorld.imageSlots[0].trigger, 'owner world trigger');
  assert.equal(editableWorld.imageSlots[0].priority, 92);
  assert.equal(editableWorld.worldRulesMarkdown, 'world rules secret');
  assert.equal(requests.some((url) => url.includes('/rest/v1/characters?') || url.includes('/rest/v1/worlds?')), false);
});

test('room prompt context uses service-role base reads with an explicit user ownership predicate', async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  const userId = '11111111-1111-4111-8111-111111111111';
  const roomId = '22222222-2222-4222-8222-222222222222';
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = decodeURIComponent(String(url));
    const headers = new Headers(options.headers || {});
    requests.push({ url: requestUrl, apikey: headers.get('apikey') });
    if (requestUrl.includes('/rest/v1/rooms')) {
      const owned = requestUrl.includes(`user_id=eq.${userId}`);
      return new Response(JSON.stringify(owned ? {
        resolved_prompt_snapshot_json: { basePromptSnapshot: 'private base prompt' },
        bridge_profile_json: {},
      } : null), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (requestUrl.includes('/rest/v1/room_state_summaries')) {
      return new Response(JSON.stringify({ current_situation: 'safe state' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  };

  const context = await getRoomPromptContext({ event: { headers: { authorization: 'Bearer user-token' } }, roomId, userId });
  assert.match(context.promptSnapshot, /private base prompt/);
  const roomRequest = requests.find((request) => request.url.includes('/rest/v1/rooms'));
  assert.equal(roomRequest.apikey, 'service-role-test-key');
  assert.match(roomRequest.url, new RegExp(`id=eq\\.${roomId}`));
  assert.match(roomRequest.url, new RegExp(`user_id=eq\\.${userId}`));

  const denied = await getRoomPromptContext({ roomId, userId: '33333333-3333-4333-8333-333333333333' });
  assert.equal(denied, null);
});

test('service-role content writes prove ownership and return only safe summary columns', async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  const userId = '11111111-1111-4111-8111-111111111111';
  const characterRow = {
    id: '22222222-2222-4222-8222-222222222222',
    owner_user_id: userId,
    slug: 'owned-character',
    name: 'Owned character',
    headline: 'Safe headline',
    summary: 'Safe summary',
    visibility: 'private',
    display_status: 'draft',
    tags: [],
  };
  const worldRow = {
    id: '33333333-3333-4333-8333-333333333333',
    owner_user_id: userId,
    slug: 'owned-world',
    name: 'Owned world',
    headline: 'Safe world headline',
    summary: 'Safe world summary',
    visibility: 'private',
    display_status: 'draft',
    tags: [],
  };
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = decodeURIComponent(String(url));
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    requests.push({ url: requestUrl, method, apikey: headers.get('apikey') });
    if (requestUrl.includes('/rest/v1/characters')) {
      if (method === 'GET') {
        return new Response(JSON.stringify({
          id: characterRow.id,
          profile_json: { creatorName: 'Character creator' },
          speech_style_json: { voice: 'Private voice note' },
          prompt_profile_json: { masterPrompt: 'character secret' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify(characterRow), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (requestUrl.includes('/rest/v1/worlds')) {
      if (method === 'GET') {
        return new Response(JSON.stringify({
          id: worldRow.id,
          prompt_profile_json: { creatorName: 'World creator', masterPrompt: 'world secret' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify(worldRow), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  };

  const createdCharacter = await createPersistentCharacter({
    userId,
    payload: {
      name: characterRow.name,
      headline: characterRow.headline,
      summary: characterRow.summary,
      tags: [],
      visibility: 'private',
      profileJson: { creatorName: 'Character creator' },
      promptProfileJson: { masterPrompt: 'character create secret' },
    },
  });
  const updatedCharacter = await updatePersistentCharacter({
    userId,
    slug: characterRow.slug,
    payload: { summary: 'Updated safe summary' },
  });
  const createdWorld = await createPersistentWorld({
    userId,
    payload: {
      name: worldRow.name,
      headline: worldRow.headline,
      summary: worldRow.summary,
      tags: [],
      visibility: 'private',
      worldRulesMarkdown: 'world rules secret',
      promptProfileJson: { creatorName: 'World creator', masterPrompt: 'world create secret' },
    },
  });
  const updatedWorld = await updatePersistentWorld({
    userId,
    slug: worldRow.slug,
    payload: { summary: 'Updated safe world summary' },
  });

  assert.equal(createdCharacter.creator.name, 'Character creator');
  assert.equal(updatedCharacter.creator.name, 'Character creator');
  assert.equal(createdWorld.creator.name, 'World creator');
  assert.equal(updatedWorld.creator.name, 'World creator');
  assert.equal(requests.every((request) => request.apikey === 'service-role-test-key'), true);

  const authoringReads = requests.filter((request) => request.method === 'GET');
  assert.equal(authoringReads.length, 2);
  for (const request of authoringReads) {
    assert.match(request.url, new RegExp(`owner_user_id=eq\\.${userId}`));
    assert.match(request.url, /slug=eq\.owned-(?:character|world)/);
  }
  const writeReturns = requests.filter((request) => ['POST', 'PATCH'].includes(request.method));
  assert.equal(writeReturns.length, 4);
  for (const request of writeReturns) {
    assert.doesNotMatch(
      request.url,
      /profile_json|speech_style_json|prompt_profile_json|world_rules_markdown/,
      'write responses must project only safe summary columns',
    );
  }
  for (const request of writeReturns.filter((request) => request.method === 'PATCH')) {
    assert.match(request.url, new RegExp(`owner_user_id=eq\\.${userId}`));
  }
});

test('legacy asset compatibility gathers cover and bounded slot URL projections', () => {
  const urls = collectLegacyContentAssetUrls({
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
  });

  assert.deepEqual(urls, [
    'https://example.com/object/public/vmate-assets/user/character/main-detail.webp',
    'https://example.com/object/public/vmate-assets/user/character/main-card.webp',
    'https://example.com/object/public/vmate-assets/user/character/main-thumb.webp',
    'https://example.com/object/public/vmate-assets/user/character/angry-detail.webp',
  ]);
});

test('content deletion paths prefer canonical asset relations over legacy URL projections', () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  const userId = '11111111-1111-4111-8111-111111111111';
  const canonicalPath = `${userId}/character/1721971200000-a1b2c3d4/main/detail.webp`;
  const legacyPath = `${userId}/character/1721971200000-a1b2c3d4/main/card.webp`;
  const toPublicUrl = (path) => `https://project.supabase.co/storage/v1/object/public/vmate-assets/${path}`;

  assert.deepEqual(resolveContentAssetStoragePaths({
    entityType: 'character',
    row: {
      owner_user_id: userId,
      cover_image_url: toPublicUrl(legacyPath),
      prompt_profile_json: { imageSlots: [{ detailUrl: toPublicUrl(legacyPath) }] },
    },
    assets: [{ url: toPublicUrl(canonicalPath) }],
  }), [canonicalPath]);

  assert.deepEqual(resolveContentAssetStoragePaths({
    entityType: 'character',
    row: { owner_user_id: userId, cover_image_url: toPublicUrl(legacyPath), prompt_profile_json: {} },
    assets: [],
  }), [legacyPath]);

  assert.deepEqual(resolveContentAssetStoragePaths({
    entityType: 'character',
    row: { owner_user_id: userId, cover_image_url: toPublicUrl(legacyPath), prompt_profile_json: {} },
    assets: [{ url: 'https://foreign.example/not-canonical.webp' }],
  }), [], 'an existing asset relation fails closed instead of widening into legacy projections');
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
  const userId = '11111111-1111-4111-8111-111111111111';
  const variant = { kind: 'thumb', slot: 'main', variant: 'thumb', width: 300, height: 400 };
  const event = {
    runtimeEnvironment: {
      SUPABASE_URL: 'https://runtime-project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'runtime-service-role-test-key',
      PUBLIC_ASSETS_BUCKET: 'runtime-assets',
    },
  };

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
        assert.match(requestUrl, /^https:\/\/runtime-project\.supabase\.co\/storage\/v1\/object\/upload\/sign\/runtime-assets\//);
        return new Response(JSON.stringify({ url: `/object/upload/sign/runtime-assets/${userId}/character/upload/main/thumb.webp?token=signed-token` }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
    };

    await assert.rejects(
      prepareAssetUploads({ event, userId, entityType: 'character', variants: [variant] }),
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
          cover_image_url: null,
          avatar_image_url: null,
          prompt_profile_json: {},
        }];
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.url.includes('/rest/v1/character_assets') && request.method === 'GET') {
      const assets = request.url.includes('character_id=in.')
        ? [{ character_id: remainingId, url: toPublicUrl(sharedPath) }]
        : request.url.includes(`character_id=eq.${deletedId}`)
          ? [{ url: toPublicUrl(sharedPath) }, { url: toPublicUrl(exclusivePath) }]
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
                        data: table === 'owned_character_details'
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
                        data: table === 'owned_world_details'
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

test('catalog queries push escaped search, deterministic ordering, and the row cap into PostgREST', async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test-key';
  const requests = [];
  const characterRows = [
    { id: 'character-2', slug: 'second', name: 'Second', summary: '', tags: [], favorite_count: 0, chat_start_count: 0 },
    { id: 'character-1', slug: 'first', name: 'First', summary: '', tags: [], favorite_count: 0, chat_start_count: 0 },
  ];
  globalThis.fetch = async (url) => {
    const requestUrl = decodeURIComponent(String(url));
    requests.push(requestUrl);
    const data = requestUrl.includes('/rest/v1/public_character_catalog') ? characterRows : [];
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const characters = await listCharacters({ search: '50%_off', filter: 'new' });
  await listWorlds({ search: '50%_off', filter: 'popular' });
  await listCharacters({ search: 'x'.repeat(300), filter: 'popular' });

  assert.deepEqual(characters.map((item) => item.id), ['character-2', 'character-1'], 'database order is preserved without a second JS sort');
  const characterRequest = requests.find((url) => url.includes('/rest/v1/public_character_catalog'));
  const worldRequest = requests.find((url) => url.includes('/rest/v1/public_world_catalog'));
  assert.match(characterRequest, /search_text=ilike\./);
  assert.ok(characterRequest.includes('\\%') && characterRequest.includes('\\_'), 'LIKE wildcards must be escaped');
  assert.match(characterRequest, /order=updated_at\.desc,id\.asc/);
  assert.match(worldRequest, /order=chat_start_count\.desc,favorite_count\.desc,updated_at\.desc,id\.asc/);
  assert.match(characterRequest, /limit=200/);
  assert.match(worldRequest, /limit=200/);
  const boundedSearchRequest = requests.filter((url) => url.includes('/rest/v1/public_character_catalog')).at(-1);
  assert.ok(boundedSearchRequest.includes('x'.repeat(160)));
  assert.equal(boundedSearchRequest.includes('x'.repeat(161)), false, 'catalog search work must stay bounded');
});

test('recent rooms batch hydrate in at most seven queries and omit message reads for summaries', async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test-key';
  const userId = '11111111-1111-4111-8111-111111111111';
  const characterId = '22222222-2222-4222-8222-222222222222';
  const worldId = '33333333-3333-4333-8333-333333333333';
  const roomRows = [1, 2].map((index) => ({
    id: `44444444-4444-4444-8444-44444444444${index}`,
    user_id: userId,
    character_id: characterId,
    world_id: worldId,
    title: `Room ${index}`,
    user_alias: '나',
    bridge_profile_json: {},
    created_at: `2026-07-2${index}T00:00:00.000Z`,
    updated_at: `2026-07-2${index}T00:00:00.000Z`,
    last_message_at: `2026-07-2${index}T00:00:00.000Z`,
    version: index,
  }));
  const characterRow = {
    id: characterId, owner_user_id: 'creator', slug: 'batch-character', name: 'Batch Character', summary: '',
    visibility: 'public', display_status: 'visible', source_type: 'original', tags: [], favorite_count: 0, chat_start_count: 0,
  };
  const worldRow = {
    id: worldId, owner_user_id: 'creator', slug: 'batch-world', name: 'Batch World', summary: '',
    visibility: 'public', display_status: 'visible', source_type: 'original', tags: [], favorite_count: 0, chat_start_count: 0,
  };
  let requests = [];
  globalThis.fetch = async (url) => {
    const requestUrl = decodeURIComponent(String(url));
    requests.push(requestUrl);
    let data = [];
    if (requestUrl.includes('/rest/v1/owned_room_summaries')) data = roomRows;
    else if (requestUrl.includes('/rest/v1/public_character_catalog')) data = [characterRow];
    else if (requestUrl.includes('/rest/v1/public_world_catalog')) data = [worldRow];
    else if (requestUrl.includes('/rest/v1/room_state_summaries')) data = roomRows.map((room) => ({ room_id: room.id, current_situation: room.title }));
    else if (requestUrl.includes('/rest/v1/room_messages')) data = roomRows.map((room, index) => ({
      id: `message-${index}`, room_id: room.id, role: 'assistant', sequence_no: 1,
      created_at: room.created_at, content_json: { emotion: 'normal', inner_heart: '', response: room.title },
    }));
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const hydrated = await listRecentRooms({ event: { headers: { authorization: 'Bearer user-token' } }, userId, limit: 2 });
  assert.equal(requests.length, 7);
  assert.equal(hydrated.length, 2);
  assert.equal(hydrated[0].messages[0].content.response, 'Room 1');
  assert.match(requests.find((url) => url.includes('/rest/v1/owned_room_summaries')), /limit=2/);

  requests = [];
  const summaries = await listRecentRooms({
    event: { headers: { authorization: 'Bearer user-token' } }, userId, limit: 200, includeMessages: false,
  });
  assert.equal(requests.length, 6);
  assert.equal(requests.some((url) => url.includes('/rest/v1/room_messages')), false);
  assert.ok(summaries.every((room) => room.messages.length === 0));
  assert.match(requests.find((url) => url.includes('/rest/v1/owned_room_summaries')), /limit=20/);

  globalThis.fetch = async (url) => {
    const requestUrl = decodeURIComponent(String(url));
    let data = [];
    if (requestUrl.includes('/rest/v1/owned_room_summaries')) data = roomRows;
    else if (requestUrl.includes('/rest/v1/public_character_catalog')) data = [characterRow];
    else if (requestUrl.includes('/rest/v1/public_world_catalog')) data = [worldRow];
    else if (requestUrl.includes('/rest/v1/room_state_summaries')) {
      return new Response(JSON.stringify({ message: 'state unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await assert.rejects(
    listRecentRooms({ event: { headers: { authorization: 'Bearer user-token' } }, userId, includeMessages: false }),
    (error) => error?.message === 'state unavailable',
    'a failed hydrate must not be presented to the user as an empty room list',
  );
});

test('model history reads only the newest twelve rows and restores chronological order', async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test-key';
  const requests = [];
  const descendingRows = Array.from({ length: 12 }, (_, offset) => {
    const sequence = 12 - offset;
    const role = sequence % 2 === 1 ? 'user' : 'assistant';
    return {
      role,
      sequence_no: sequence,
      created_at: `2026-07-27T00:00:${String(sequence).padStart(2, '0')}.000Z`,
      content_json: role === 'user' ? { text: `message-${sequence}` } : { response: `message-${sequence}` },
    };
  });
  globalThis.fetch = async (url) => {
    const requestUrl = decodeURIComponent(String(url));
    requests.push(requestUrl);
    const data = requestUrl.includes('/rest/v1/owned_room_summaries') ? { id: 'room-1' } : descendingRows;
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const history = await getRoomHistoryForModel({
    event: { headers: { authorization: 'Bearer user-token' } }, roomId: 'room-1', userId: 'user-1',
  });
  const messageRequest = requests.find((url) => url.includes('/rest/v1/room_messages'));
  assert.match(messageRequest, /order=sequence_no\.desc,created_at\.desc/);
  assert.match(messageRequest, /limit=12/);
  assert.deepEqual(history.map((item) => item.content), Array.from({ length: 12 }, (_, index) => `message-${index + 1}`));
});

test('bookmark status is query-free for anonymous users and library can omit recent rooms', async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test-key';
  let requests = [];
  globalThis.fetch = async (url) => {
    const requestUrl = decodeURIComponent(String(url));
    requests.push(requestUrl);
    const data = requestUrl.includes('/rest/v1/bookmarks') && requestUrl.includes('target_id=eq.character-1')
      ? { id: 'bookmark-1' }
      : [];
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  assert.equal(await getBookmarkStatus({ event: {}, userId: '', entityType: 'character', targetId: 'character-1' }), false);
  assert.equal(requests.length, 0);
  assert.equal(await getBookmarkStatus({
    event: { headers: { authorization: 'Bearer user-token' } }, userId: 'user-1', entityType: 'character', targetId: 'character-1',
  }), true);
  assert.equal(requests.length, 1);

  requests = [];
  const library = await getLibraryPayload({
    event: { headers: { authorization: 'Bearer user-token' } }, userId: 'user-1', includeRecentRooms: false,
  });
  assert.deepEqual(library.recentRooms, []);
  assert.equal(requests.some((url) => url.includes('/rest/v1/owned_room_summaries')), false);
  assert.equal(requests.length, 4);
});

test('library read failures reject instead of presenting user data as empty', async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test-key';
  globalThis.fetch = async (url) => {
    const requestUrl = decodeURIComponent(String(url));
    if (requestUrl.includes('/rest/v1/bookmarks')) {
      return new Response(JSON.stringify({ message: 'permission denied' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  await assert.rejects(getLibraryPayload({
    event: { headers: { authorization: 'Bearer user-token' } }, userId: 'user-1', includeRecentRooms: false,
  }));
});

test('operations dashboard rejects unavailable owner capability and query failures', async () => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  globalThis.fetch = async (url) => {
    const requestUrl = decodeURIComponent(String(url));
    if (requestUrl.includes('/rest/v1/rpc/is_owner_user')) {
      return new Response(JSON.stringify(true), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  await assert.rejects(
    getOpsDashboard({ event: { headers: { authorization: 'Bearer user-token' } }, userId: 'owner-1' }),
    (error) => error?.code === 'OPS_DASHBOARD_UNAVAILABLE',
    'an owner dashboard must not become a successful null payload without its global read capability',
  );

  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  globalThis.fetch = async (url) => {
    const requestUrl = decodeURIComponent(String(url));
    if (requestUrl.includes('/rest/v1/rpc/is_owner_user')) {
      return new Response(JSON.stringify(true), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (requestUrl.includes('/rest/v1/characters')) {
      return new Response(JSON.stringify({ message: 'permission denied' }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
    if (requestUrl.includes('/rest/v1/app_settings')) {
      return new Response(JSON.stringify(null), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  await assert.rejects(
    getOpsDashboard({ event: { headers: { authorization: 'Bearer user-token' } }, userId: 'owner-1' }),
    (error) => error?.code === 'OPS_DASHBOARD_UNAVAILABLE',
    'permission or network errors must not be presented as an empty operations dashboard',
  );
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

test('repository source keeps base prompt reads off authenticated wildcard queries', async () => {
  const source = await readFile(new URL('./supabase-platform-repository.js', import.meta.url), 'utf8');
  assert.doesNotMatch(
    source,
    /\.from\(['"](?:characters|worlds|rooms)['"]\)\s*\.select\(['"]\*['"]\)/,
    'lockdown-compatible code must not issue wildcard reads against protected base tables',
  );
  assert.match(source, /const ROOM_SAFE_VIEW_COLUMNS =/);
  const roomSafeColumnsSource = source.slice(
    source.indexOf('const ROOM_SAFE_VIEW_COLUMNS ='),
    source.indexOf('const CHARACTER_ROOM_CONTEXT_COLUMNS ='),
  );
  assert.doesNotMatch(roomSafeColumnsSource, /bridge_profile_json/);
  assert.doesNotMatch(
    source,
    /\.from\(OWNED_ROOM_SUMMARY_VIEW\)\s*\.select\(['"]\*['"]\)/,
    'room summaries must remain an explicit allowlist even if the view expands later',
  );

  const createRoomSource = source.slice(
    source.indexOf('export const createRoom ='),
    source.indexOf('export const getRoom ='),
  );
  assert.match(createRoomSource, /createSupabaseAdminClient\(runtimeEnvironmentFromEvent\(event\)\)/);
  assert.match(createRoomSource, /select\(CHARACTER_ROOM_CONTEXT_COLUMNS\)/);
  assert.match(createRoomSource, /target\.row\.owner_user_id === userId/);
  assert.match(createRoomSource, /content_moderation/);

  const appendSource = source.slice(
    source.indexOf('export const appendRoomMessages ='),
    source.indexOf('export const commitRoomTurn ='),
  );
  assert.match(appendSource, /const admin = await createSupabaseAdminClient\(runtimeEnvironmentFromEvent\(event\)\)/);
  assert.match(appendSource, /\.eq\('user_id', userId\)/);
  assert.doesNotMatch(appendSource, /client\.from\('rooms'\)/);

  const opsSource = source.slice(
    source.indexOf('export const getOpsDashboard ='),
    source.indexOf('export const setContentVisibility ='),
  );
  assert.match(opsSource, /createSupabaseAdminClient\(runtimeEnvironmentFromEvent\(event\)\)/);
  assert.match(opsSource, /OWNED_CONTENT_VIEWS\.character/);
  assert.match(opsSource, /CHARACTER_BASE_SUMMARY_COLUMNS/);
  assert.doesNotMatch(opsSource, /select\(['"]\*['"]\)/);
});

test('prompt privacy migrations and fresh schema preserve their separate contracts', async () => {
  const normalizeSql = (value) => value.replace(/\r\n/g, '\n').trim();
  const [schemaSource, expandSource, lockdownSource] = await Promise.all([
    readFile(new URL('../../supabase/schema.sql', import.meta.url), 'utf8'),
    readFile(
      new URL('../../supabase/migrations/20260729000000_prompt_read_views_expand.sql', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../../supabase/migrations/20260729010000_private_prompt_reads_lockdown.sql', import.meta.url),
      'utf8',
    ),
  ]);
  const schema = normalizeSql(schemaSource);
  const expand = normalizeSql(expandSource);
  const lockdown = normalizeSql(lockdownSource);

  for (const phase of [expand, lockdown]) {
    assert.match(phase, /set local lock_timeout = '[^']+'/i);
    assert.match(phase, /set local statement_timeout = '[^']+'/i);
  }
  assert.match(expand, /create view public\.public_character_catalog/i);
  assert.match(expand, /create view public\.owned_room_summaries/i);
  const ownedRoomView = expand.slice(
    expand.indexOf('create view public.owned_room_summaries'),
    expand.indexOf('revoke all on table', expand.indexOf('create view public.owned_room_summaries')),
  );
  assert.doesNotMatch(ownedRoomView, /bridge_profile_json/i);
  assert.match(expand, /create or replace function public\.to_public_image_slots/i);
  assert.match(expand, /public\.to_public_image_slots\(c\.prompt_profile_json\) as image_slots/i);
  assert.doesNotMatch(expand, /then c\.prompt_profile_json -> 'imageSlots'/i);
  assert.doesNotMatch(
    expand,
    /revoke select on table public\.(?:characters|worlds|rooms)/i,
    'expand must leave old Worker base-table reads intact',
  );
  assert.match(
    lockdown,
    /revoke select on table public\.characters, public\.worlds from public, anon, authenticated/i,
  );
  assert.match(lockdown, /revoke select \(bridge_profile_json, resolved_prompt_snapshot_json\)/i);
  assert.match(lockdown, /update public\.room_state_summaries[\s\S]*world_notes_json = '\[\]'::jsonb/i);
  assert.match(
    lockdown,
    /update public\.room_messages[\s\S]*where role = 'assistant' and sequence_no = 1/i,
  );
  const roomGrant = lockdown.match(/grant select \([\s\S]*?\) on public\.rooms to authenticated;/i)?.[0] || '';
  assert.doesNotMatch(roomGrant, /bridge_profile_json/i);

  assert.match(schema, /create view public\.public_character_catalog/i);
  assert.match(schema, /create view public\.owned_room_summaries/i);
  assert.match(
    schema,
    /revoke select on table public\.characters, public\.worlds from public, anon, authenticated/i,
  );
  const schemaRoomGrant = schema.match(/grant select \([\s\S]*?\) on public\.rooms to authenticated;/i)?.[0] || '';
  assert.ok(schemaRoomGrant);
  assert.doesNotMatch(schemaRoomGrant, /bridge_profile_json|resolved_prompt_snapshot_json/i);
  assert.doesNotMatch(
    schema,
    /vmate_private|prompt_lockdown_.*20260729|manual (?:expand|privilege) rollback|conditional forward restore/i,
    'fresh schema must contain final objects and privileges, not rollout evidence or rollback procedures',
  );
  assert.doesNotMatch(
    schema,
    /update public\.room_state_summaries[\s\S]*current_situation = '대화를 이어가고 있습니다\.'/i,
  );
  assert.doesNotMatch(
    schema,
    /update public\.room_messages\s+set content_json = jsonb_build_object[\s\S]*sequence_no = 1/i,
  );
});
