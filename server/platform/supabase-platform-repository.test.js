import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  collectContentAssetUrls,
  incrementChatStartCountsBestEffort,
  persistRecentView,
  resolveAsyncOrFallback,
  resolveDataOrFallback,
  resolveEntityById,
  resolveEntityByRef,
} from './supabase-platform-repository.js';

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
