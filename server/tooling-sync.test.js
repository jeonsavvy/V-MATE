import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '..');

const readUtf8 = async (relativePath) =>
  readFile(path.join(repoRoot, relativePath), 'utf8');

test('package verify script and node engine are pinned for CI/runtime consistency', async () => {
  const packageJson = JSON.parse(await readUtf8('package.json'));

  assert.equal(packageJson?.scripts?.verify, 'npm run typecheck && npm test && npm run build');
  assert.equal(packageJson?.engines?.node, '>=20.0.0');
});

test('.nvmrc is aligned with node 20 runtime policy', async () => {
  const nvmrc = (await readUtf8('.nvmrc')).trim();
  assert.equal(nvmrc, '20');
});

test('github ci workflow executes verify script on node 20', async () => {
  const workflow = await readUtf8('.github/workflows/ci.yml');

  assert.ok(workflow.includes('node-version: "20"'));
  assert.ok(workflow.includes('npm run verify'));
});

test('README includes verify command and node 20 runtime requirement', async () => {
  const readme = await readUtf8('README.md');

  assert.ok(readme.includes('npm run verify'));
  assert.ok(readme.includes('Node.js 20 이상'));
  assert.ok(readme.includes('nvm use'));
});

test('vite config keeps supabase-related chunks out of html modulepreload list', async () => {
  const viteConfig = await readUtf8('vite.config.ts');

  assert.ok(viteConfig.includes('modulePreload'));
  assert.ok(viteConfig.includes("context.hostType === 'html'"));
  assert.ok(viteConfig.includes("!dependency.includes('vendor-supabase')"));
});

test('.gitignore no longer ignores tracked sql migrations globally', async () => {
  const gitignore = await readUtf8('.gitignore');

  assert.equal(gitignore.includes('*.sql'), false);
});

test('platform migration upgrades existing schemas via alter-table steps', async () => {
  const migration = await readUtf8('supabase/schema.sql');

  assert.ok(migration.includes('alter table public.characters add column if not exists display_status'));
  assert.ok(migration.includes('alter table public.worlds add column if not exists display_status'));
  assert.ok(migration.includes('alter table public.profiles add column if not exists is_owner'));
  assert.ok(migration.includes('alter table public.rooms add column if not exists bridge_profile_json'));
  assert.ok(migration.includes('alter table public.rooms add column if not exists user_alias'));
  assert.ok(migration.includes('alter table public.rooms alter column world_id drop not null'));
  assert.ok(migration.includes("column_name = 'preset_id'"));
  assert.ok(migration.includes('alter table public.room_messages add column if not exists content_json'));
  assert.ok(migration.includes('alter table public.room_state_summaries add column if not exists world_notes_json'));
  assert.ok(migration.includes('create table if not exists public.app_settings'));
  assert.ok(migration.includes('create or replace function public.is_owner_user()'));
  assert.ok(migration.includes('create policy "Owner users can write app settings"'));
  assert.ok(migration.includes('create policy "Users can insert their own character assets"'));
  assert.ok(migration.includes('create policy "Users can insert their own world assets"'));
});

test('schema no longer depends on character-world link tables for room creation', async () => {
  const migration = await readUtf8('supabase/schema.sql');

  assert.equal(migration.includes('create table if not exists public.character_world_links'), false);
  assert.equal(migration.includes('character_world_link_id'), false);
  assert.equal(migration.includes('default_opening_context'), false);
  assert.equal(migration.includes('default_relationship_context'), false);
});

test('server source no longer references legacy local demo asset filenames', async () => {
  const repoFiles = [
    'server/platform/supabase-platform-repository.js',
    'src/components/Home.tsx',
    'src/lib/platform/apiClient.ts',
  ];
  const joined = (await Promise.all(repoFiles.map(readUtf8))).join('\n');

  assert.equal(joined.includes('/mika_normal.webp'), false);
  assert.equal(joined.includes('/world_tokyo.svg'), false);
  assert.equal(joined.includes('/world_sao.svg'), false);
});

test('unused form helpers and direct dependencies are removed from the repo', async () => {
  const packageJson = JSON.parse(await readUtf8('package.json'));

  await assert.rejects(readUtf8('src/components/ui/dropdown-menu.tsx'));
  await assert.rejects(readUtf8('src/components/ui/form.tsx'));
  assert.equal(packageJson?.dependencies?.['@radix-ui/react-dropdown-menu'], undefined);
  assert.equal(packageJson?.dependencies?.['react-hook-form'], undefined);
});
