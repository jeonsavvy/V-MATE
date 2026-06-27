# Account deletion

## Background
- V-MATE uses Supabase Auth plus platform tables for profiles, characters, worlds, rooms, room messages, bookmarks, recent views, and uploaded image assets.
- Most account-owned tables are keyed by `auth.users(id)` and can cascade when the auth user is deleted.
- The deployed Worker currently has `SUPABASE_URL` and `SUPABASE_ANON_KEY`; account deletion also needs `SUPABASE_SERVICE_ROLE_KEY` server-side.

## Goal
- Let a logged-in user withdraw their own account from the UI.
- Remove linked uploaded assets best-effort before deleting account-owned rows/auth user.
- Keep the deletion API disabled with a clear 503 if the service role secret is missing.

## Non-goals
- No public admin deletion of other users.
- No schema migration in this pass.
- No exposure of service role keys to the browser.

## Scope
- `DELETE /api/account`
- Persistent Supabase repository account deletion helper.
- Memory-store fallback cleanup for local/demo mode.
- Platform nav account deletion UI.

## Constraints
- API must require the caller's bearer token when persistent Supabase is configured.
- Service role key stays in the Worker environment only.
- Browser must not use `alert`, `confirm`, or `prompt`.

## Affected contracts
- API: new authenticated `DELETE /api/account` returning `{ ok, deleted }` or a structured error.
- DB/storage: best-effort storage deletion by known public URLs, explicit deletes for legacy/current account-owned rows, Admin Auth deletion.
- Frontend state: on success signs out and navigates home.

## Core logic
1. Resolve authenticated user ID.
2. Use service role client if configured; otherwise return `ACCOUNT_DELETE_NOT_CONFIGURED`.
3. Collect known character/world asset URLs for that user and remove storage objects.
4. Delete legacy messages and owned platform rows; delete auth user last.
5. Return counts.

## Pseudocode
```text
user = resolveAuthenticatedUser(event)
if !user: 401
result = store.deleteAccount(event, user.id)
if result.reason == admin_not_configured: 503
return { ok: true, deleted: true, data: result }
```

## Breadboard / shaped flow
- Sidebar profile card shows `계정 탈퇴`.
- Clicking opens a non-blocking dialog.
- User types `탈퇴` to enable deletion.
- Success signs out and navigates to `/`.
- Failure stays in the dialog and explains whether the server is not configured.

## Edge cases
- Missing token -> 401.
- Missing service role secret -> 503; no partial DB deletion.
- Storage cleanup failure should fail the operation before account deletion so orphan scope is visible.

## Task breakdown
- Add service-role-aware repository helpers.
- Add API route and memory fallback.
- Add API client and UI dialog.
- Add tests/guardrails.

## Verification plan
- `npm run verify`
- `npx wrangler secret list` to confirm whether `SUPABASE_SERVICE_ROLE_KEY` is present before production smoke.

## Open questions / assumptions
- Cloudflare secret `SUPABASE_SERVICE_ROLE_KEY` must be added separately for production deletion to complete; code returns 503 until then.
