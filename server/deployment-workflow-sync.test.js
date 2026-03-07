import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '..');

const readUtf8 = async (relativePath) =>
  readFile(path.join(repoRoot, relativePath), 'utf8');

test('github ci workflow deploys worker only after quality succeeds on main pushes', async () => {
  const workflow = await readUtf8('.github/workflows/ci.yml');

  assert.match(workflow, /deploy_worker:/);
  assert.match(workflow, /needs:\s*quality/);
  assert.match(workflow, /github\.event_name\s*==\s*'push'/);
  assert.match(workflow, /github\.ref\s*==\s*'refs\/heads\/main'/);
  assert.match(workflow, /environment:\s*\n\s*name:\s*production/);
  assert.match(workflow, /https:\/\/v-mate\.jeonsavvy\.workers\.dev/);
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /group:\s*production-worker/);
  assert.match(workflow, /npm run cf:deploy/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID/);
});


test('wrangler config preserves dashboard vars during deploy', async () => {
  const wranglerConfig = await readUtf8('wrangler.jsonc');

  assert.match(wranglerConfig, /"keep_vars"\s*:\s*true/);
});

test('README documents worker auto-deploy, required secrets, runtime prerequisites, and rollback', async () => {
  const readme = await readUtf8('README.md');

  assert.match(readme, /main.*push/i);
  assert.match(readme, /CLOUDFLARE_API_TOKEN/);
  assert.match(readme, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(readme, /VITE_SUPABASE_URL/);
  assert.match(readme, /VITE_SUPABASE_ANON_KEY|VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(readme, /VITE_CHAT_API_BASE_URL/);
  assert.match(readme, /wrangler rollback/);
});
