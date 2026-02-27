import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '..');
const srcRoot = path.join(repoRoot, 'src');

const walkFiles = async (rootDir) => {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const resolved = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return walkFiles(resolved);
      }
      return [resolved];
    })
  );
  return files.flat();
};

test('frontend localStorage access is centralized in browserStorage module', async () => {
  const files = await walkFiles(srcRoot);
  const localStorageHits = [];

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8');
    if (content.includes('localStorage')) {
      localStorageHits.push(path.relative(repoRoot, filePath));
    }
  }

  assert.deepEqual(localStorageHits, ['src/lib/browserStorage.ts']);
});

test('frontend source avoids blocking alert() usage', async () => {
  const files = await walkFiles(srcRoot);
  const alertHits = [];

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8');
    if (/\balert\(/.test(content)) {
      alertHits.push(path.relative(repoRoot, filePath));
    }
  }

  assert.deepEqual(alertHits, []);
});

test('frontend source avoids blocking confirm() usage', async () => {
  const files = await walkFiles(srcRoot);
  const confirmHits = [];

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8');
    if (/\bconfirm\(/.test(content)) {
      confirmHits.push(path.relative(repoRoot, filePath));
    }
  }

  assert.deepEqual(confirmHits, []);
});

test('frontend source avoids blocking prompt() usage', async () => {
  const files = await walkFiles(srcRoot);
  const promptHits = [];

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8');
    if (/\bprompt\(/.test(content)) {
      promptHits.push(path.relative(repoRoot, filePath));
    }
  }

  assert.deepEqual(promptHits, []);
});

test('frontend window.location.origin access is centralized in browserRuntime module', async () => {
  const files = await walkFiles(srcRoot);
  const locationOriginHits = [];

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8');
    if (content.includes('location.origin')) {
      locationOriginHits.push(path.relative(repoRoot, filePath));
    }
  }

  assert.deepEqual(locationOriginHits, ['src/lib/browserRuntime.ts']);
});

test('Button component keeps default type=button safety guard', async () => {
  const buttonPath = path.join(srcRoot, 'components/ui/button.tsx');
  const source = await readFile(buttonPath, 'utf8');

  assert.ok(source.includes('type = "button"'));
  assert.ok(source.includes('type={type}'));
});

test('Avatar component falls back to non-empty alt text when alt prop is missing', async () => {
  const avatarPath = path.join(srcRoot, 'components/ui/avatar.tsx');
  const source = await readFile(avatarPath, 'utf8');

  assert.ok(source.includes('const normalizedAlt ='));
  assert.ok(source.includes('alt={normalizedAlt}'));
});

test('all img elements include alt and decoding attributes', async () => {
  const files = await walkFiles(srcRoot);
  const imgTagsMissingAlt = [];
  const imgTagsMissingDecoding = [];

  for (const filePath of files) {
    if (!filePath.endsWith('.tsx')) {
      continue;
    }

    const content = await readFile(filePath, 'utf8');
    const imgTags = content.match(/<img\b[\s\S]*?>/g) || [];
    for (const imgTag of imgTags) {
      if (!/\balt=/.test(imgTag)) {
        imgTagsMissingAlt.push(path.relative(repoRoot, filePath));
      }
      if (!/\bdecoding=/.test(imgTag)) {
        imgTagsMissingDecoding.push(path.relative(repoRoot, filePath));
      }
    }
  }

  assert.deepEqual(imgTagsMissingAlt, []);
  assert.deepEqual(imgTagsMissingDecoding, []);
});

test('supabase client initialization stays lazy via dynamic import', async () => {
  const supabaseModulePath = path.join(srcRoot, 'lib/supabase.ts');
  const source = await readFile(supabaseModulePath, 'utf8');

  assert.ok(source.includes('import("@supabase/supabase-js")'));
  assert.equal(/import\s+\{[^}]+\}\s+from\s+["']@supabase\/supabase-js["']/.test(source), false);
  assert.ok(source.includes('resolveSupabaseClient'));
});

test('supabase history queries are bounded for preview/recent lists', async () => {
  const historyStorePath = path.join(srcRoot, 'lib/chat/historySupabaseStore.ts');
  const source = await readFile(historyStorePath, 'utf8');

  assert.ok(source.includes('const PREVIEW_SCAN_LIMIT = 500'));
  assert.ok(source.includes('const RECENT_SCAN_LIMIT = 500'));
  assert.ok(source.includes('.order("created_at", { ascending: false })'));
  assert.ok(source.includes('.limit(PREVIEW_SCAN_LIMIT)'));
  assert.ok(source.includes('.limit(RECENT_SCAN_LIMIT)'));
  assert.ok(source.includes('if (map.size >= TARGET_RECENT_CHAT_COUNT)'));
});

test('supabase history repository keeps supabase store loading lazy via dynamic import', async () => {
  const historyRepositoryPath = path.join(srcRoot, 'lib/chat/historyRepository.ts');
  const source = await readFile(historyRepositoryPath, 'utf8');

  assert.ok(source.includes('import("@/lib/chat/historySupabaseStore")'));
  assert.equal(
    /from\s+["']@\/lib\/chat\/historySupabaseStore["']/.test(source),
    false
  );
});

test('profile menu masks user email before rendering', async () => {
  const privacyUtilPath = path.join(srcRoot, 'lib/privacy.ts');
  const privacySource = await readFile(privacyUtilPath, 'utf8');
  assert.ok(privacySource.includes('export const maskEmailAddress'));

  const headerBarPath = path.join(srcRoot, 'components/home/HomeHeaderBar.tsx');
  const headerSource = await readFile(headerBarPath, 'utf8');
  assert.ok(headerSource.includes('maskEmailAddress(user.email)'));
  assert.equal(headerSource.includes('{user.email}'), false);
});

test('character image metadata uses webp assets for lower payloads', async () => {
  const dataModulePath = path.join(srcRoot, 'lib/data.ts');
  const dataSource = await readFile(dataModulePath, 'utf8');

  assert.ok(dataSource.includes('/mika_normal.webp'));
  assert.ok(dataSource.includes('/alice_normal.webp'));
  assert.ok(dataSource.includes('/kael_normal.webp'));
  assert.equal(dataSource.includes('.png'), false);
});

test('chat api client only forwards trusted cachedContent format', async () => {
  const apiClientPath = path.join(srcRoot, 'lib/chat/apiClient.ts');
  const source = await readFile(apiClientPath, 'utf8');

  assert.ok(source.includes('const CACHED_CONTENT_PATTERN = /^cachedContents\\/'));
  assert.ok(source.includes('CACHED_CONTENT_PATTERN.test(normalizedCachedContent)'));
});
