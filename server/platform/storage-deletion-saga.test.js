import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimStorageDeletionJob,
  isStoragePathOwnedByDeletionJob,
  prepareStorageDeletionJob,
  processStorageDeletionJob,
} from './storage-deletion-saga.js';

const userId = '11111111-1111-4111-8111-111111111111';
const entityId = '33333333-3333-4333-8333-333333333333';
const ownedPath = `${userId}/character/1721971200000-a1b2c3d4/main/detail.webp`;
const job = {
  id: '44444444-4444-4444-8444-444444444444',
  operation_kind: 'content',
  subject_user_id: userId,
  entity_type: 'character',
  entity_id: entityId,
  object_paths: [ownedPath],
  status: 'prepared',
  attempt_count: 0,
};
const claimedJob = {
  ...job,
  status: 'processing',
  lease_expires_at: new Date(Date.now() + 120_000).toISOString(),
};

const createRetryClient = ({ contentExists }) => {
  const calls = [];
  return {
    calls,
    from(table) {
      if (table === 'characters') {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    calls.push({ kind: 'verify-content' });
                    return { data: contentExists ? { id: entityId } : null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'storage_deletion_outbox') {
        return {
          update(payload) {
            let recorded = false;
            const record = () => {
              if (!recorded) calls.push({ kind: 'update-outbox', payload });
              recorded = true;
            };
            const builder = {
              eq() { return builder; },
              select() { return builder; },
              async maybeSingle() {
                record();
                return { data: { id: job.id }, error: null };
              },
              then(resolve, reject) {
                record();
                return Promise.resolve({ error: null }).then(resolve, reject);
              },
            };
            return builder;
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'vmate-assets');
        return {
          async remove(paths) {
            calls.push({ kind: 'remove-storage', paths });
            return { error: null };
          },
        };
      },
    },
  };
};

test('content cleanup paths stay inside the exact owner and entity prefix', () => {
  assert.equal(isStoragePathOwnedByDeletionJob({ path: ownedPath, job }), true);
  for (const path of [
    ownedPath.replace(userId, '22222222-2222-4222-8222-222222222222'),
    ownedPath.replace('/character/', '/world/'),
    `${userId}/character/../world/file.webp`,
    `${userId}/character/free-form.webp`,
  ]) {
    assert.equal(isStoragePathOwnedByDeletionJob({ path, job }), false);
  }
});

test('only one concurrent worker can claim a prepared deletion job', async () => {
  let stored = { ...job };
  const client = {
    from(table) {
      assert.equal(table, 'storage_deletion_outbox');
      return {
        update(payload) {
          const filters = [];
          const builder = {
            eq(column, value) { filters.push(['eq', column, value]); return builder; },
            lte(column, value) { filters.push(['lte', column, value]); return builder; },
            select() { return builder; },
            async maybeSingle() {
              const matches = filters.every(([operator, column, value]) => (
                operator === 'eq' ? stored[column] === value : String(stored[column] || '') <= String(value)
              ));
              if (!matches) return { data: null, error: null };
              stored = { ...stored, ...payload };
              return { data: { ...stored }, error: null };
            },
          };
          return builder;
        },
      };
    },
  };

  const claims = await Promise.all([
    claimStorageDeletionJob({ client, job }),
    claimStorageDeletionJob({ client, job }),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(stored.status, 'processing');
  assert.ok(Date.parse(stored.lease_expires_at) > Date.now());
});

test('duplicate prepare preserves an active lease instead of reopening the job', async () => {
  const activeJob = { ...claimedJob };
  let inserted = false;
  const client = {
    from(table) {
      assert.equal(table, 'storage_deletion_outbox');
      return {
        insert(payload) {
          assert.equal(payload.status, 'prepared');
          inserted = true;
          return {
            select() { return this; },
            async single() { return { data: null, error: { code: '23505' } }; },
          };
        },
        select() {
          return {
            eq(column, value) {
              assert.equal(column, 'operation_key');
              assert.equal(value, 'content:character:delete');
              return this;
            },
            async maybeSingle() { return { data: activeJob, error: null }; },
          };
        },
      };
    },
  };

  const prepared = await prepareStorageDeletionJob({
    client,
    operationKey: 'content:character:delete',
    operationKind: 'content',
    subjectUserId: userId,
    entityType: 'character',
    entityId,
    paths: [ownedPath],
  });
  assert.equal(inserted, true);
  assert.equal(prepared.status, 'processing');
  assert.equal(prepared.lease_expires_at, activeJob.lease_expires_at);
});

test('prepared cleanup retry fails closed while the content row still exists', async () => {
  const client = createRetryClient({ contentExists: true });
  assert.deepEqual(await processStorageDeletionJob({ client, job: claimedJob, bucket: 'vmate-assets' }), {
    completed: false,
    deferred: true,
    removedAssets: 0,
  });
  assert.deepEqual(client.calls.map((call) => call.kind), ['verify-content', 'update-outbox']);
  assert.equal(client.calls[1].payload.attempt_count, 1);
});

test('prepared cleanup retry removes objects only after the content row is absent', async () => {
  const client = createRetryClient({ contentExists: false });
  assert.deepEqual(await processStorageDeletionJob({ client, job: claimedJob, bucket: 'vmate-assets' }), {
    completed: true,
    removedAssets: 1,
  });
  assert.deepEqual(client.calls.map((call) => call.kind), [
    'verify-content',
    'remove-storage',
    'update-outbox',
  ]);
  assert.deepEqual(client.calls[1].paths, [ownedPath]);
  assert.equal(client.calls[2].payload.status, 'completed');
  assert.deepEqual(client.calls[2].payload.object_paths, []);
});

test('an expired worker cannot complete over a newer cleanup lease', async () => {
  const client = createRetryClient({ contentExists: false });
  const originalFrom = client.from.bind(client);
  client.from = (table) => {
    if (table !== 'storage_deletion_outbox') return originalFrom(table);
    return {
      update(payload) {
        const builder = {
          eq() { return builder; },
          select() { return builder; },
          async maybeSingle() {
            client.calls.push({ kind: 'update-outbox', payload });
            return { data: null, error: null };
          },
          then(resolve, reject) {
            client.calls.push({ kind: 'update-outbox', payload });
            return Promise.resolve({ error: null }).then(resolve, reject);
          },
        };
        return builder;
      },
    };
  };

  assert.deepEqual(await processStorageDeletionJob({ client, job: claimedJob, bucket: 'vmate-assets' }), {
    completed: false,
    deferred: true,
    removedAssets: 0,
  });
  assert.equal(client.calls.filter((call) => call.kind === 'remove-storage').length, 1);
  assert.equal(client.calls.filter((call) => call.kind === 'update-outbox').length, 2);
});
