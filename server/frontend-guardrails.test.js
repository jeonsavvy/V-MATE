import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '..');
const srcRoot = path.join(repoRoot, 'src');
const toRepoPath = (filePath) => path.relative(repoRoot, filePath).split(path.sep).join('/');

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
      localStorageHits.push(toRepoPath(filePath));
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
      locationOriginHits.push(toRepoPath(filePath));
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

test('app source exposes platform routes while product copy stays in the product shell', async () => {
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
  assert.ok(appSource.includes('/privacy'));

  const homePath = path.join(srcRoot, 'components', 'Home.tsx');
  const homeSource = await readFile(homePath, 'utf8');
  assert.equal(homeSource.includes('© V-MATE'), false);
  assert.equal(homeSource.includes('금주의 추천'), false);
  assert.ok(homeSource.includes('캐릭터와 월드를 골라'));
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

test('edit pages expose creator-owned delete actions through non-blocking dialogs', async () => {
  const pagesPath = path.join(srcRoot, 'components', 'platform', 'Pages.tsx');
  const source = await readFile(pagesPath, 'utf8');

  assert.ok(source.includes('OwnedContentDeleteDialog'));
  assert.ok(source.includes('캐릭터 삭제'));
  assert.ok(source.includes('월드 삭제'));
});

test('room page keeps retry guidance scoped to failed sends only', async () => {
  const pagesPath = path.join(srcRoot, 'components', 'platform', 'Pages.tsx');
  const source = await readFile(pagesPath, 'utf8');

  assert.ok(source.includes('일시적으로 응답이 비어 다시 시도가 필요합니다. 입력 내용은 유지되어 바로 다시 보낼 수 있습니다.'));
  assert.ok(source.includes("message.includes('Gemini returned an empty response')"));
  assert.ok(source.includes("needsRetry ? '다시 시도' : '보내기'"));
});

test('platform types and api client are character-world only', async () => {
  const typesPath = path.join(srcRoot, 'lib/platform/types.ts');
  const typesSource = await readFile(typesPath, 'utf8');
  assert.equal(typesSource.includes("'preset'"), false);
  assert.equal(typesSource.includes('PresetSummary'), false);
  assert.equal(typesSource.includes('CharacterWorldLinkSummary'), false);
  assert.equal(typesSource.includes('defaultOpeningContext'), false);
  assert.equal(typesSource.includes('defaultRelationshipContext'), false);

  const apiPath = path.join(srcRoot, 'lib/platform/apiClient.ts');
  const apiSource = await readFile(apiPath, 'utf8');
  assert.equal(apiSource.includes('/presets'), false);
  assert.equal(apiSource.includes('/rankings'), false);
  assert.equal(apiSource.includes('createPreset'), false);
  assert.equal(apiSource.includes('demoPlatform'), false);
  assert.equal(apiSource.includes('fallback:'), false);
  assert.equal(apiSource.includes('/world-links'), false);
  assert.equal(apiSource.includes('/character-world-links'), false);
  assert.equal(apiSource.includes('fetchCharacterWorldLinks'), false);
  assert.equal(apiSource.includes('createCharacterWorldLink'), false);
  assert.ok(apiSource.includes('/api/ops') || apiSource.includes('/ops'));
  assert.ok(apiSource.includes('deleteCharacter'));
  assert.ok(apiSource.includes('deleteWorld'));
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
  assert.equal(pagesSource.includes('fetchCharacterWorldLinks'), false);
  assert.equal(pagesSource.includes('linkReason'), false);
  assert.equal(pagesSource.includes('현재 상황'), false);
  assert.equal(pagesSource.includes('월드 메모'), false);
  assert.equal(pagesSource.includes('소지품'), false);
  assert.equal(pagesSource.includes('의상/자세'), false);
  assert.equal(pagesSource.includes('미래 일정/약속'), false);
  assert.ok(pagesSource.includes("platformApi.addRecentView('character', item.slug)"));
  assert.ok(pagesSource.includes("platformApi.addRecentView('world', item.slug)"));
  assert.ok(pagesSource.includes("platformApi.toggleBookmark('character', item.slug)"));
  assert.ok(pagesSource.includes("platformApi.toggleBookmark('world', item.slug)"));
  assert.ok(pagesSource.includes('즐겨찾기 저장'));
  assert.ok(pagesSource.includes('즐겨찾기 해제'));
});

test('platform shell keeps ops outside the four primary navigation items', async () => {
  const scaffoldPath = path.join(srcRoot, 'components/platform/PlatformScaffold.tsx');
  const source = await readFile(scaffoldPath, 'utf8');

  assert.ok(source.includes("{ label: '홈', path: '/', icon: Home }"));
  assert.ok(source.includes("{ label: '대화', path: '/recent', icon: MessageSquareMore }"));
  assert.ok(source.includes("onNavigate('/ops')"));
  assert.equal(source.includes("label: '운영실', path: '/ops'"), false);
});

test('home uses functional catalog headings with latest and popular filters', async () => {
  const homePath = path.join(srcRoot, 'components/Home.tsx');
  const source = await readFile(homePath, 'utf8');

  assert.ok(source.includes('신작'));
  assert.ok(source.includes('인기'));
  assert.ok(source.includes('대화할 인물을 선택하세요'));
  assert.ok(source.includes('대화가 벌어질 장면을 선택하세요'));
  assert.equal(source.includes('PageSection title="둘러보기"'), false);
  assert.equal(source.includes('tagFilter'), false);
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

test('public-facing ui displays creator attribution without exposing emails', async () => {
  const homePath = path.join(srcRoot, 'components/Home.tsx');
  const homeSource = await readFile(homePath, 'utf8');
  assert.equal(homeSource.includes('meta={item.creator.name}'), false);

  const scaffoldPath = path.join(srcRoot, 'components/platform/PlatformScaffold.tsx');
  const scaffoldSource = await readFile(scaffoldPath, 'utf8');
  assert.ok(scaffoldSource.includes('item.creator.name'));

  const pagesPath = path.join(srcRoot, 'components/platform/Pages.tsx');
  const pagesSource = await readFile(pagesPath, 'utf8');
  assert.ok(pagesSource.includes('item.creator.name'));
  assert.equal(pagesSource.includes('item.creator.email'), false);
  assert.equal(pagesSource.includes('item.imageSlots.slice(0, 6)'), false);
  assert.ok(pagesSource.includes('이미지 {item.imageSlots.length}장'));
});

test('creator flows keep practical prompt editors and require public publishing attestations', async () => {
  const pagesPath = path.join(srcRoot, 'components/platform/Pages.tsx');
  const source = await readFile(pagesPath, 'utf8');

  assert.ok(source.includes('캐릭터 프롬프트'));
  assert.ok(source.includes('캐릭터 도입부'));
  assert.ok(source.includes('월드 프롬프트'));
  assert.ok(source.includes('월드 도입부'));
  assert.ok(source.includes('상황별 이미지 추가'));
  assert.ok(source.includes('권장 3:4 · 최소 768×1024'));
  assert.ok(source.includes('권장 16:9 · 최소 1280×720'));
  assert.ok(source.includes('공개 범위'));
  assert.ok(source.includes('공개 전 확인'));
  assert.ok(source.includes('rightsConfirmed'));
  assert.ok(source.includes('ageConfirmed'));
  assert.equal(source.includes('월드 설명'), false);
  assert.equal(source.includes('캐릭터 설정'), false);
});

test('editing prompt content preserves existing image urls when no new upload happens', async () => {
  const pagesPath = path.join(srcRoot, 'components/platform/Pages.tsx');
  const source = await readFile(pagesPath, 'utf8');

  assert.ok(source.includes('existingThumbUrl'));
  assert.ok(source.includes('existingCardUrl'));
  assert.ok(source.includes('existingDetailUrl'));
  assert.ok(source.includes("findVariant('thumb') || slot.existingThumbUrl || ''"));
  assert.ok(source.includes("findVariant('card') || slot.existingCardUrl || ''"));
  assert.ok(source.includes("findVariant('detail') || findVariant('hero') || slot.existingDetailUrl || ''"));
});

test('edit pages clearly label editing mode separately from public detail pages', async () => {
  const pagesPath = path.join(srcRoot, 'components/platform/Pages.tsx');
  const source = await readFile(pagesPath, 'utf8');

  assert.ok(source.includes("slug ? '캐릭터 수정' : '캐릭터 저장'"));
  assert.ok(source.includes("slug ? '월드 수정' : '월드 저장'"));
  assert.equal(source.includes('공개 상세 화면과 별개로 프롬프트, 도입부, 이미지를 편집하는 화면입니다.'), false);
});

test('ops page exposes banner auto/manual controls and delete actions', async () => {
  const pagesPath = path.join(srcRoot, 'components/platform/Pages.tsx');
  const source = await readFile(pagesPath, 'utf8');

  assert.equal(source.includes('메인 배너'), false);
  assert.equal(source.includes('배너 지정'), false);
  assert.ok(source.includes('삭제'));
});

test('footer exposes privacy policy link and 17+ service notice', async () => {
  const scaffoldPath = path.join(srcRoot, 'components/platform/PlatformScaffold.tsx');
  const source = await readFile(scaffoldPath, 'utf8');

  assert.ok(source.includes('<footer className={cn(\'border-t'));
  assert.ok(source.includes('© V-MATE'));
  assert.ok(source.includes('17+'));
  assert.ok(source.includes('개인정보처리방침'));
  assert.ok(source.includes("onNavigate('/privacy')"));
});

test('privacy page renders operator contact and service-specific processing items', async () => {
  const privacyPath = path.join(srcRoot, 'components', 'PrivacyPage.tsx');
  const source = await readFile(privacyPath, 'utf8');

  assert.ok(source.includes('개인정보처리자'));
  assert.ok(source.includes('전찬혁'));
  assert.ok(source.includes('jeonsavvy@gmail.com'));
  assert.ok(source.includes('2026년 3월 1일'));
  assert.ok(source.includes('캐릭터·월드 생성 내용'));
  assert.ok(source.includes('rate-limit 식별정보'));
});

test('platform shell uses mobile bottom navigation, compact top tabs, and a conversation rail', async () => {
  const scaffoldPath = path.join(srcRoot, 'components/platform/PlatformScaffold.tsx');
  const source = await readFile(scaffoldPath, 'utf8');

  assert.ok(source.includes('w-[232px]'));
  assert.ok(source.includes('lg:pl-[232px]'));
  assert.ok(source.includes('대화 기록'));
  assert.ok(source.includes('주요 메뉴'));
  assert.ok(source.includes('grid h-[66px] grid-cols-4'));
  assert.ok(source.includes('max-w-[1280px]'));
  assert.ok(source.includes('lg:hidden'));
  assert.equal(source.includes('isMobileNavOpen'), false);
});

test('home keeps the exact two-column starter catalog while library grids remain responsive', async () => {
  const homePath = path.join(srcRoot, 'components/Home.tsx');
  const homeSource = await readFile(homePath, 'utf8');
  assert.equal((homeSource.match(/data-catalog-grid=/g) || []).length, 2);
  assert.ok(homeSource.includes('className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5"'));
  assert.ok(homeSource.includes("type === 'character' ? 'aspect-[4/5]' : 'aspect-[16/9]'"));

  const pagesPath = path.join(srcRoot, 'components/platform/Pages.tsx');
  const pagesSource = await readFile(pagesPath, 'utf8');
  assert.match(pagesSource, /grid-cols-1[\s\S]*md:grid-cols-2[\s\S]*xl:grid-cols-3/);
  assert.match(pagesSource, /grid-cols-1[\s\S]*sm:grid-cols-2[\s\S]*lg:grid-cols-3[\s\S]*2xl:grid-cols-4/);
});

test('detail layouts switch at laptop widths while chat stays in one focused column', async () => {
  const pagesPath = path.join(srcRoot, 'components/platform/Pages.tsx');
  const source = await readFile(pagesPath, 'utf8');

  assert.ok(source.includes('lg:grid-cols-[minmax(0,0.84fr)_minmax(0,1.16fr)]'));
  assert.ok(source.includes('lg:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)]'));
  assert.equal(source.includes('lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]'), false);
  assert.ok(source.includes('mx-auto max-w-[860px] space-y-6'));
  assert.ok(source.includes('max-w-[28rem] rounded-lg'));
  assert.ok(source.includes('absolute bottom-3 right-3 z-10 w-24'));
  assert.ok(source.includes('sm:w-32'));
  assert.ok(source.includes('mx-auto w-full max-w-[34rem]'));
  assert.equal(source.includes('xl:grid-cols-[0.84fr_1.16fr]'), false);
  assert.equal(source.includes('xl:grid-cols-[1.02fr_0.98fr]'), false);
  assert.equal(source.includes('xl:grid-cols-[0.92fr_1.08fr]'), false);
});
