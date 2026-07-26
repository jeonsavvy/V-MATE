import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '..');
const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8');

test('expand migration preserves message order and bounds quota lease recovery', async () => {
  const migration = await readUtf8('supabase/migrations/20260726010000_backend_stabilization_expand.sql');

  assert.match(migration, /order by created_at, case role when 'user' then 0 when 'assistant' then 1 else 2 end, id/);
  assert.match(migration, /existing_event\.status = 'reserved' and existing_event\.attempt_count >= 2/);
  assert.doesNotMatch(migration, /retry_exhausted/);
  for (const disposition of ['reserved', 'replay', 'in_progress', 'conflict', 'limit_exceeded']) {
    assert.match(migration, new RegExp(`'${disposition}'::text`));
  }
  assert.match(migration, /events\.request_id <> p_request_id[\s\S]*limit 20[\s\S]*for update skip locked/);
  assert.match(migration, /next_count := null;[\s\S]*used_count < p_limit/);
});

test('storage deletion outbox has an exclusive lease and retry-order index', async () => {
  const migration = await readUtf8('supabase/migrations/20260726010000_backend_stabilization_expand.sql');

  assert.match(migration, /lease_expires_at timestamp with time zone/);
  assert.match(migration, /status in \('prepared', 'processing', 'completed'\)/);
  assert.match(migration, /\(status = 'processing'\) = \(lease_expires_at is not null\)/);
  assert.match(migration, /storage_deletion_outbox_pending_updated/);
  assert.match(migration, /on public\.storage_deletion_outbox \(updated_at, id\)/);
});

test('account storage cleanup fence is bounded and service-only', async () => {
  const migration = await readUtf8('supabase/migrations/20260726010000_backend_stabilization_expand.sql');

  assert.match(migration, /create table if not exists public\.account_storage_cleanup_fences/);
  assert.match(migration, /account_storage_cleanup_fences_due[\s\S]*\(cleanup_until, user_id\)/);
  assert.match(migration, /p_cleanup_until <= timezone\('utc'::text, now\(\)\)[\s\S]*p_cleanup_until > timezone\('utc'::text, now\(\)\) \+ interval '3 hours'/);
  assert.match(migration, /cleanup_until = greatest\([\s\S]*account_storage_cleanup_fences\.cleanup_until,[\s\S]*excluded\.cleanup_until/);
  assert.match(migration, /alter table public\.account_storage_cleanup_fences enable row level security;/);
  assert.match(migration, /revoke all on table public\.account_storage_cleanup_fences from public, anon, authenticated;/);
  assert.match(migration, /grant select, insert, update, delete on table public\.account_storage_cleanup_fences to service_role;/);
  assert.match(migration, /revoke all on function public\.begin_account_storage_cleanup_v1\(uuid, timestamp with time zone\)[\s\S]*from public, anon, authenticated;/);
  assert.match(migration, /grant execute on function public\.begin_account_storage_cleanup_v1\(uuid, timestamp with time zone\)[\s\S]*to service_role;/);
});

test('room commit and content constraints remain atomic and null-safe', async () => {
  const migration = await readUtf8('supabase/migrations/20260726010000_backend_stabilization_expand.sql');

  assert.match(migration, /alter table public\.rooms alter column character_id drop not null;/);
  assert.match(migration, /alter table public\.rooms alter column world_id drop not null;/);
  assert.match(migration, /foreign key \(character_id\) references public\.characters \(id\) on delete set null;/);
  assert.match(migration, /foreign key \(world_id\) references public\.worlds \(id\) on delete set null;/);
  assert.match(migration, /insert into public\.room_state_summaries[\s\S]*on conflict \(room_id\) do update set/);
  assert.match(migration, /commit_room_turn_v2[\s\S]*status = 'completed'/);
  assert.doesNotMatch(migration, /source_url ~ '\^https:\/\/'/);
  assert.equal((migration.match(/btrim\(coalesce\(source_url, ''\)\) ~ '\^https:\/\/'/g) || []).length, 2);
});

test('v2 mutation RPCs are service-only and lockdown removes direct mutation paths', async () => {
  const expand = await readUtf8('supabase/migrations/20260726010000_backend_stabilization_expand.sql');
  const lockdown = await readUtf8('supabase/migrations/20260726020000_backend_stabilization_lockdown.sql');
  const functions = [
    'reserve_chat_message_v2',
    'complete_legacy_chat_message_v2',
    'refund_chat_message_v2',
    'create_room_v2',
    'commit_room_turn_v2',
    'reconcile_expired_chat_reservations_v2',
  ];

  for (const functionName of functions) {
    assert.match(expand, new RegExp(`revoke all on function public\\.${functionName}\\([^)]+\\) from public, anon, authenticated;`));
    assert.match(expand, new RegExp(`grant execute on function public\\.${functionName}\\([^)]+\\) to service_role;`));
  }
  assert.match(lockdown, /revoke all on function public\.reserve_daily_chat_message\(text, integer\) from public, anon, authenticated;/);
  assert.match(lockdown, /revoke insert, update, delete on public\.characters from anon, authenticated;/);
  assert.match(lockdown, /drop policy if exists "Authenticated users can upload vmate assets to their own folder" on storage\.objects;/);
});

test('schema snapshot exactly carries the latest stabilization phases', async () => {
  const [schema, expand, lockdown] = await Promise.all([
    readUtf8('supabase/schema.sql'),
    readUtf8('supabase/migrations/20260726010000_backend_stabilization_expand.sql'),
    readUtf8('supabase/migrations/20260726020000_backend_stabilization_lockdown.sql'),
  ]);

  assert.ok(schema.endsWith(`${lockdown.trim()}\n`) || schema.endsWith(`${lockdown.trim()}\r\n`));
  assert.ok(schema.includes(expand.trim()));
  assert.equal(schema.indexOf(expand.trim()), schema.lastIndexOf(expand.trim()));
});

test('server coverage gate uses the agreed line, branch, and function thresholds', async () => {
  const runner = await readUtf8('server/run-tests.js');

  assert.match(runner, /--experimental-test-coverage/);
  assert.match(runner, /--test-coverage-lines=75/);
  assert.match(runner, /--test-coverage-branches=65/);
  assert.match(runner, /--test-coverage-functions=70/);
  assert.match(runner, /--test-coverage-include=server\/\*\*\/\*\.js/);
  assert.match(runner, /--test-coverage-include=worker\.js/);
});
