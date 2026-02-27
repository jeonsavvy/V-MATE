import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  buildRequestDedupeFingerprint,
  buildRequestDedupeKey,
  resetRequestDedupeStoresForTests,
  withRequestDedupe,
} from './request-dedupe.js';

afterEach(() => {
  resetRequestDedupeStoresForTests();
});

test('buildRequestDedupeFingerprint stays stable for same payload', () => {
  const payload = {
    normalizedCharacterId: 'mika',
    userMessage: 'hello',
    messageHistory: [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
    ],
    cachedContent: 'cachedContents/mika-1',
  };

  const first = buildRequestDedupeFingerprint(payload);
  const second = buildRequestDedupeFingerprint(payload);
  assert.equal(first, second);

  const third = buildRequestDedupeFingerprint({ ...payload, userMessage: 'changed' });
  assert.notEqual(first, third);
});

test('buildRequestDedupeKey requires all fields', () => {
  assert.equal(
    buildRequestDedupeKey({
      rateKey: 'ip:127.0.0.1',
      clientRequestId: 'web-123',
      requestFingerprint: 'abc',
    }),
    'ip:127.0.0.1:web-123:abc'
  );

  assert.equal(buildRequestDedupeKey({ rateKey: '', clientRequestId: 'x', requestFingerprint: 'y' }), null);
  assert.equal(buildRequestDedupeKey({ rateKey: 'k', clientRequestId: '', requestFingerprint: 'y' }), null);
  assert.equal(buildRequestDedupeKey({ rateKey: 'k', clientRequestId: 'x', requestFingerprint: '' }), null);
});

test('withRequestDedupe bypasses when key is missing', async () => {
  let callCount = 0;
  const result = await withRequestDedupe({
    dedupeKey: null,
    windowMs: 1000,
    run: async () => {
      callCount += 1;
      return { ok: true };
    },
  });

  assert.equal(result.status, 'bypass');
  assert.equal(callCount, 1);
  assert.deepEqual(result.value, { ok: true });
});

test('withRequestDedupe replays successful result within dedupe window', async () => {
  let callCount = 0;
  let nowMs = 10_000;

  const run = async () => {
    callCount += 1;
    return { ok: true, value: callCount };
  };

  const first = await withRequestDedupe({
    dedupeKey: 'dedupe:key',
    windowMs: 5000,
    now: () => nowMs,
    run,
    shouldReplayResult: (value) => Boolean(value?.ok),
  });
  assert.equal(first.status, 'fresh');
  assert.equal(first.value.value, 1);

  nowMs += 1000;
  const second = await withRequestDedupe({
    dedupeKey: 'dedupe:key',
    windowMs: 5000,
    now: () => nowMs,
    run,
    shouldReplayResult: (value) => Boolean(value?.ok),
  });
  assert.equal(second.status, 'replay');
  assert.equal(second.value.value, 1);
  assert.equal(callCount, 1);

  nowMs += 6000;
  const third = await withRequestDedupe({
    dedupeKey: 'dedupe:key',
    windowMs: 5000,
    now: () => nowMs,
    run,
    shouldReplayResult: (value) => Boolean(value?.ok),
  });
  assert.equal(third.status, 'fresh');
  assert.equal(third.value.value, 2);
  assert.equal(callCount, 2);
});

test('withRequestDedupe merges concurrent in-flight requests', async () => {
  let callCount = 0;

  const run = async () => {
    callCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { ok: true, value: callCount };
  };

  const [first, second] = await Promise.all([
    withRequestDedupe({
      dedupeKey: 'same:key',
      windowMs: 5000,
      run,
    }),
    withRequestDedupe({
      dedupeKey: 'same:key',
      windowMs: 5000,
      run,
    }),
  ]);

  assert.equal(callCount, 1);
  assert.deepEqual(first.value, { ok: true, value: 1 });
  assert.deepEqual(second.value, { ok: true, value: 1 });
  assert.ok(first.status === 'fresh' || first.status === 'inflight');
  assert.ok(second.status === 'fresh' || second.status === 'inflight');
});

test('withRequestDedupe skips replay cache when shouldReplayResult returns false', async () => {
  let callCount = 0;
  const run = async () => {
    callCount += 1;
    return { ok: false, value: callCount };
  };

  const first = await withRequestDedupe({
    dedupeKey: 'non-cacheable:key',
    windowMs: 5000,
    run,
    shouldReplayResult: (value) => Boolean(value?.ok),
  });
  const second = await withRequestDedupe({
    dedupeKey: 'non-cacheable:key',
    windowMs: 5000,
    run,
    shouldReplayResult: (value) => Boolean(value?.ok),
  });

  assert.equal(first.status, 'fresh');
  assert.equal(second.status, 'fresh');
  assert.equal(callCount, 2);
});

test('withRequestDedupe evicts oldest inflight key when inflight capacity is exceeded', async () => {
  let runCount = 0;
  const blockers = [];
  const inflightCapacity = 100;

  const createBlockedRun = (label) => async () => {
    runCount += 1;
    await new Promise((resolve) => {
      blockers.push(resolve);
    });
    return { ok: true, label, runCount };
  };

  const pending = [];
  for (let index = 0; index <= inflightCapacity; index += 1) {
    pending.push(
      withRequestDedupe({
        dedupeKey: `inflight:${index}`,
        windowMs: 5000,
        maxEntries: inflightCapacity,
        run: createBlockedRun(`run-${index}`),
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const oldestKeyRetry = withRequestDedupe({
    dedupeKey: 'inflight:0',
    windowMs: 5000,
    maxEntries: inflightCapacity,
    run: createBlockedRun('run-0-retry'),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(runCount, inflightCapacity + 2);

  while (blockers.length > 0) {
    const release = blockers.shift();
    release?.();
  }

  const results = await Promise.all([...pending, oldestKeyRetry]);
  assert.equal(results[0].status, 'fresh');
  assert.equal(results[results.length - 1].status, 'fresh');
  assert.equal(results[0].value.label, 'run-0');
  assert.equal(results[results.length - 1].value.label, 'run-0-retry');
});
