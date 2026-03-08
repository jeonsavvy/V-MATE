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

test('profile menu masks user email before rendering', async () => {
  const privacyUtilPath = path.join(srcRoot, 'lib/privacy.ts');
  const privacySource = await readFile(privacyUtilPath, 'utf8');
  assert.ok(privacySource.includes('export const maskEmailAddress'));

  const shellPath = path.join(srcRoot, 'components/platform/PlatformScaffold.tsx');
  const shellSource = await readFile(shellPath, 'utf8');
  assert.ok(shellSource.includes('maskEmailAddress(user.email)'));
  assert.equal(shellSource.includes('{user.email}'), false);
});

test('app source exposes platform routes and simplified footer copy', async () => {
  const appPath = path.join(srcRoot, 'App.tsx');
  const appSource = await readFile(appPath, 'utf8');
  assert.equal(appSource.includes('/discover'), false);
  assert.equal(appSource.includes('/rankings'), false);
  assert.ok(appSource.includes('/characters/'));
  assert.ok(appSource.includes('/worlds/'));
  assert.ok(appSource.includes('/create/character'));
  assert.ok(appSource.includes('/create/world'));
  assert.ok(appSource.includes('/recent'));
  assert.ok(appSource.includes('/library'));
  assert.ok(appSource.includes('/ops'));
  assert.ok(appSource.includes('/rooms/'));

  const homePath = path.join(srcRoot, 'components', 'Home.tsx');
  const homeSource = await readFile(homePath, 'utf8');
  assert.ok(homeSource.includes('© V-MATE'));
  assert.equal(homeSource.includes('character · world platform'), false);
  assert.equal(homeSource.includes('하드코딩 챗봇처럼 보이지 않도록'), false);
  assert.equal(homeSource.includes('추천 조합'), false);
  assert.equal(homeSource.includes('시작 상황'), false);
});

test('platform source removes preset and rankings copy while exposing owner ops entry', async () => {
  const files = await walkFiles(path.join(srcRoot, 'components', 'platform'));
  const joined = (await Promise.all(files.map((filePath) => readFile(filePath, 'utf8')))).join('\n');

  assert.equal(joined.includes('추천 조합'), false);
  assert.equal(joined.includes('시작 상황'), false);
  assert.equal(joined.includes('preset'), false);
  assert.equal(joined.includes('랭킹'), false);
  assert.ok(joined.includes('운영실'));
  assert.ok(joined.includes('최근 대화'));
});

test('platform types and api client are character-world only', async () => {
  const typesPath = path.join(srcRoot, 'lib/platform/types.ts');
  const typesSource = await readFile(typesPath, 'utf8');
  assert.equal(typesSource.includes("'preset'"), false);
  assert.equal(typesSource.includes('PresetSummary'), false);

  const apiPath = path.join(srcRoot, 'lib/platform/apiClient.ts');
  const apiSource = await readFile(apiPath, 'utf8');
  assert.equal(apiSource.includes('/presets'), false);
  assert.equal(apiSource.includes('/rankings'), false);
  assert.equal(apiSource.includes('createPreset'), false);
  assert.ok(apiSource.includes('/api/ops') || apiSource.includes('/ops'));
});

test('auth dialog removes marketing banner copy and keeps form-only structure', async () => {
  const authDialogPath = path.join(srcRoot, 'components/AuthDialog.tsx');
  const source = await readFile(authDialogPath, 'utf8');

  assert.equal(source.includes('기록을 남기고, 장면을 이어가세요.'), false);
  assert.equal(source.includes('프롬프트 캐시'), false);
  assert.equal(source.includes('Member access'), false);
  assert.equal(source.includes('로그인 후 가능한 것'), false);
});

test('home and detail views avoid fake metrics and duplicated management sections', async () => {
  const homePath = path.join(srcRoot, 'components/Home.tsx');
  const homeSource = await readFile(homePath, 'utf8');
  assert.equal(homeSource.includes('최근 대화'), false);
  assert.equal(homeSource.includes('내가 만든 캐릭터'), false);
  assert.equal(homeSource.includes('내가 만든 월드'), false);
  assert.equal(homeSource.includes('chatStartCount.toLocaleString'), false);
  assert.equal(homeSource.includes('favoriteCount.toLocaleString'), false);

  const pagesPath = path.join(srcRoot, 'components/platform/Pages.tsx');
  const pagesSource = await readFile(pagesPath, 'utf8');
  assert.equal(pagesSource.includes('월드 고르고 시작'), false);
  assert.equal(pagesSource.includes('chatStartCount.toLocaleString'), false);
  assert.equal(pagesSource.includes('favoriteCount.toLocaleString'), false);
});

test('platform shell keeps ops inside create section instead of top-level nav', async () => {
  const scaffoldPath = path.join(srcRoot, 'components/platform/PlatformScaffold.tsx');
  const source = await readFile(scaffoldPath, 'utf8');

  assert.equal(source.includes("user ? [...baseNav, { label: '운영실'"), false);
  assert.ok(source.includes("{ label: '운영실', path: '/ops' }"));
});

test('home uses latest and popular filters only', async () => {
  const homePath = path.join(srcRoot, 'components/Home.tsx');
  const source = await readFile(homePath, 'utf8');

  assert.ok(source.includes('신작'));
  assert.ok(source.includes('인기'));
  assert.equal(source.includes('태그'), false);
});

test('character builder keeps a minimal authoring flow without world-link noise', async () => {
  const pagesPath = path.join(srcRoot, 'components/platform/Pages.tsx');
  const source = await readFile(pagesPath, 'utf8');

  assert.ok(source.includes('기본 정보'));
  assert.ok(source.includes('캐릭터 설정'));
  assert.ok(source.includes('캐릭터 이미지'));
  assert.ok(source.includes('성격 / 핵심 매력'));
  assert.ok(source.includes('말투'));
  assert.ok(source.includes('처음 관계 / 거리감'));
  assert.equal(source.includes('연결할 월드'), false);
  assert.equal(source.includes('추천 월드'), false);
  assert.equal(source.includes('월드 안 역할'), false);
  assert.equal(source.includes('로맨스 결'), false);
  assert.equal(source.includes('고급 옵션'), false);
});

test('world builder removes recommendation clutter and uses a custom image upload card', async () => {
  const pagesPath = path.join(srcRoot, 'components/platform/Pages.tsx');
  const source = await readFile(pagesPath, 'utf8');

  assert.ok(source.includes('월드 설명'));
  assert.ok(source.includes('월드 이미지'));
  assert.ok(source.includes('world-image-upload-input'));
  assert.ok(source.includes('이미지 선택'));
  assert.equal(source.includes('추천 캐릭터 연결'), false);
  assert.equal(source.includes('추천 캐릭터'), false);
  assert.equal(source.includes('사회 구조'), false);
  assert.equal(source.includes('어울리는 역할'), false);
  assert.equal(source.includes('깨지면 안 되는 월드 규칙 / 금지 전개'), false);
});

test('ops page exposes banner auto/manual controls and delete actions', async () => {
  const pagesPath = path.join(srcRoot, 'components/platform/Pages.tsx');
  const source = await readFile(pagesPath, 'utf8');

  assert.ok(source.includes('메인 배너'));
  assert.ok(source.includes('자동'));
  assert.ok(source.includes('수동'));
  assert.ok(source.includes('배너 지정'));
  assert.ok(source.includes('삭제'));
});

test('footer removes border divider and keeps copyright only', async () => {
  const scaffoldPath = path.join(srcRoot, 'components/platform/PlatformScaffold.tsx');
  const source = await readFile(scaffoldPath, 'utf8');

  assert.equal(source.includes('<footer className="border-t'), false);
  assert.ok(source.includes('© V-MATE'));
});
