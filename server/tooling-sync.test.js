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

test('b2c migration keeps owner authority private and user profile writes column-scoped', async () => {
  const migration = await readUtf8('supabase/migrations/20260718_b2c_platform.sql');
  const schema = await readUtf8('supabase/schema.sql');
  const repository = await readUtf8('server/platform/supabase-platform-repository.js');

  assert.ok(migration.includes('create table if not exists public.owner_users'));
  assert.ok(migration.includes('revoke insert, update on public.profiles from anon, authenticated'));
  assert.ok(schema.includes('grant update (handle, display_name, avatar_url, bio, updated_at)'));
  assert.ok(migration.includes("key <> 'owner_user_ids'"));
  assert.equal(repository.includes(".eq('is_owner', true)"), false);
  assert.equal(repository.includes("owner_user_ids"), false);
  assert.ok(repository.includes("rpc('is_owner_user')"));
});

test('b2c migration defines report quarantine and atomic KST chat quota contracts', async () => {
  const migration = await readUtf8('supabase/migrations/20260718_b2c_platform.sql');

  assert.ok(migration.includes('create table if not exists public.content_reports'));
  assert.ok(migration.includes('create table if not exists public.content_moderation'));
  assert.ok(migration.includes('create table if not exists public.content_moderation_actions'));
  assert.ok(migration.includes("unique index if not exists content_reports_one_open_per_reporter"));
  assert.ok(migration.includes('count(distinct reporter_user_id) into reporter_count'));
  assert.ok(migration.includes('if reporter_count >= 3 and'));
  assert.ok(migration.includes("'quarantined'"));
  assert.ok(migration.includes('create table if not exists public.chat_usage_daily'));
  assert.ok(migration.includes('create table if not exists public.chat_usage_events'));
  assert.ok(migration.includes('primary key (user_id, request_id)'));
  assert.ok(migration.includes("existing_status <> 'refunded'"));
  assert.ok(migration.includes('on conflict (user_id, request_id) do update'));
  assert.ok(migration.includes('create or replace function public.reserve_daily_chat_message'));
  assert.ok(migration.includes("timezone('Asia/Seoul', now())::date"));
  assert.ok(migration.includes('pg_advisory_xact_lock'));
  assert.ok(migration.includes('create or replace function public.complete_daily_chat_message'));
  assert.ok(migration.includes("status in ('reserved', 'completed', 'refunded')"));
  assert.ok(migration.includes('create or replace function public.refund_daily_chat_message'));
});

test('function privilege migration exposes only intentional RPC contracts', async () => {
  const migration = await readUtf8('supabase/migrations/20260721_function_privileges.sql');
  const schema = await readUtf8('supabase/schema.sql');
  const restrictedRpcSignatures = [
    'public.apply_content_report_action(uuid, text, text)',
    'public.get_daily_chat_quota(integer)',
    'public.reserve_daily_chat_message(text, integer)',
    'public.complete_daily_chat_message(text, jsonb)',
    'public.refund_daily_chat_message(text, integer)',
  ];
  const triggerSignatures = [
    'public.handle_new_profile()',
    'public.validate_content_report_target()',
    'public.quarantine_content_after_reports()',
  ];

  for (const signature of restrictedRpcSignatures) {
    const statement = `revoke all on function ${signature} from public, anon;`;
    assert.ok(migration.includes(statement));
    assert.ok(schema.includes(statement));
  }

  for (const signature of triggerSignatures) {
    const statement = `revoke all on function ${signature} from public, anon, authenticated;`;
    assert.ok(migration.includes(statement));
    assert.ok(schema.includes(statement));
  }

  assert.equal(migration.includes('public.is_owner_user() from public, anon'), false);
  assert.equal(migration.includes('public.is_content_publicly_allowed(text, uuid) from public, anon'), false);
});

test('age restriction removal keeps only rights attestation as the public publishing gate', async () => {
  const migration = await readUtf8('supabase/migrations/20260721_remove_age_restrictions.sql');
  const schema = await readUtf8('supabase/schema.sql');
  const runtimeSources = await Promise.all([
    readUtf8('server/platform/api.js'),
    readUtf8('server/platform/supabase-platform-repository.js'),
    readUtf8('src/components/AuthDialog.tsx'),
    readUtf8('src/components/platform/Pages.tsx'),
    readUtf8('src/components/platform/PlatformScaffold.tsx'),
    readUtf8('src/lib/platform/apiClient.ts'),
  ]);

  assert.ok(migration.includes('drop function if exists public.has_confirmed_age()'));
  assert.ok(migration.includes('alter table public.profiles drop column if exists age_confirmed_at'));
  assert.ok(migration.includes("raw_user_meta_data, '{}'::jsonb) - 'ageConfirmed'"));
  assert.ok(migration.includes("visibility <> 'public' or rights_attested_at is not null"));
  assert.ok(schema.includes('alter table public.profiles drop column if exists age_confirmed_at'));
  assert.ok(schema.includes("visibility <> 'public' or rights_attested_at is not null"));
  assert.equal(schema.includes('create or replace function public.has_confirmed_age()'), false);
  assert.equal(schema.includes('17+'), false);
  for (const source of runtimeSources) {
    assert.equal(source.includes('ageConfirmed'), false);
    assert.equal(source.includes('AGE_CONFIRMATION_REQUIRED'), false);
    assert.equal(source.includes('17+'), false);
  }
});

test('production security cleanup keeps internal helpers and public bucket listings private', async () => {
  const migration = await readUtf8('supabase/migrations/20260721_production_security_cleanup.sql');
  const schema = await readUtf8('supabase/schema.sql');
  const internalFunctionGuard = "to_regprocedure('public.rls_auto_enable()') is not null";
  const internalFunctionRevoke =
    "revoke all on function public.rls_auto_enable() from public, anon, authenticated";
  const bucketPolicyDrop =
    'drop policy if exists "Public can read vmate assets" on storage.objects;';

  assert.ok(migration.includes(internalFunctionGuard));
  assert.ok(migration.includes(internalFunctionRevoke));
  assert.ok(migration.includes(bucketPolicyDrop));
  assert.ok(schema.includes(internalFunctionGuard));
  assert.ok(schema.includes(internalFunctionRevoke));
  assert.ok(schema.includes(bucketPolicyDrop));
  assert.equal(schema.includes('create policy "Public can read vmate assets"'), false);
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
