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
  assert.ok(viteConfig.includes("!dependency.includes('historySupabaseStore')"));
});
