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
  assert.ok(appSource.includes('/edit/character'));
  assert.ok(appSource.includes('/edit/world'));
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
  assert.equal(apiSource.includes('demoPlatform'), false);
  assert.equal(apiSource.includes('fallback:'), false);
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
  assert.equal(homeSource.includes('대표 배너'), false);
  assert.equal(homeSource.includes('상세 보기'), false);

  const pagesPath = path.join(srcRoot, 'components/platform/Pages.tsx');
  const pagesSource = await readFile(pagesPath, 'utf8');
  assert.equal(pagesSource.includes('월드 고르고 시작'), false);
  assert.equal(pagesSource.includes('chatStartCount.toLocaleString'), false);
  assert.equal(pagesSource.includes('favoriteCount.toLocaleString'), false);
  assert.equal(pagesSource.includes('현재 상황'), false);
  assert.equal(pagesSource.includes('월드 메모'), false);
  assert.equal(pagesSource.includes('소지품'), false);
  assert.equal(pagesSource.includes('의상/자세'), false);
  assert.equal(pagesSource.includes('미래 일정/약속'), false);
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
  assert.ok(source.includes('캐릭터 둘러보기'));
  assert.ok(source.includes('월드 둘러보기'));
  assert.equal(source.includes('PageSection title="둘러보기"'), false);
  assert.equal(source.includes('태그'), false);
});

test('recent rooms page makes direct-vs-world conversations visually explicit', async () => {
  const pagesPath = path.join(srcRoot, 'components/platform/Pages.tsx');
  const source = await readFile(pagesPath, 'utf8');

  assert.ok(source.includes('직접 대화'));
  assert.ok(source.includes('월드 결합'));
  assert.ok(source.includes('마지막 장면'));
  assert.ok(source.includes('캐릭터 선택 후 시작'));
  assert.equal(source.includes('이 월드에서 잘 맞는 캐릭터'), false);
});

test('library page exposes owned character/world shelves below recent views', async () => {
  const pagesPath = path.join(srcRoot, 'components/platform/Pages.tsx');
  const source = await readFile(pagesPath, 'utf8');

  assert.ok(source.includes('내가 만든 캐릭터'));
  assert.ok(source.includes('내가 만든 월드'));
});

test('public-facing ui removes creator-name display across home, cards, and detail pages', async () => {
  const homePath = path.join(srcRoot, 'components/Home.tsx');
  const homeSource = await readFile(homePath, 'utf8');
  assert.equal(homeSource.includes('meta={item.creator.name}'), false);

  const scaffoldPath = path.join(srcRoot, 'components/platform/PlatformScaffold.tsx');
  const scaffoldSource = await readFile(scaffoldPath, 'utf8');
  assert.equal(scaffoldSource.includes('item.creator.name'), false);

  const pagesPath = path.join(srcRoot, 'components/platform/Pages.tsx');
  const pagesSource = await readFile(pagesPath, 'utf8');
  assert.equal(pagesSource.includes('item.creator.name'), false);
});

test('creator flows collapse description fields into practical prompt editors and remove public visibility control', async () => {
  const pagesPath = path.join(srcRoot, 'components/platform/Pages.tsx');
  const source = await readFile(pagesPath, 'utf8');

  assert.ok(source.includes('캐릭터 프롬프트'));
  assert.ok(source.includes('캐릭터 도입부'));
  assert.ok(source.includes('월드 프롬프트'));
  assert.ok(source.includes('월드 도입부'));
  assert.ok(source.includes('상황별 이미지 추가'));
  assert.ok(source.includes('권장 3:4 · 최소 768×1024'));
  assert.ok(source.includes('권장 16:9 · 최소 1280×720'));
  assert.equal(source.includes('공개 상태'), false);
  assert.equal(source.includes('월드 설명'), false);
  assert.equal(source.includes('캐릭터 설정'), false);
});

test('ops page exposes banner auto/manual controls and delete actions', async () => {
  const pagesPath = path.join(srcRoot, 'components/platform/Pages.tsx');
  const source = await readFile(pagesPath, 'utf8');

  assert.equal(source.includes('메인 배너'), false);
  assert.equal(source.includes('배너 지정'), false);
  assert.ok(source.includes('삭제'));
});

test('footer removes border divider and keeps copyright only', async () => {
  const scaffoldPath = path.join(srcRoot, 'components/platform/PlatformScaffold.tsx');
  const source = await readFile(scaffoldPath, 'utf8');

  assert.equal(source.includes('<footer className="border-t'), false);
  assert.ok(source.includes('© V-MATE'));
});
