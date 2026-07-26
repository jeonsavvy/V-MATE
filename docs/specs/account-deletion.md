# Account deletion contract

`DELETE /api/account` lets an authenticated user remove only their own account.

## Behavior

- The request requires a valid bearer token.
- Account deletion is available only when the server has its administrative data-access configuration. Otherwise the API returns a safe `503` response and leaves account data unchanged.
- The server enumerates and removes only canonical Storage objects under the authenticated user’s owned prefixes. A Storage cleanup failure stops deletion before Auth removal; objects removed before a later batch failure cannot be restored automatically.
- Auth deletion is the database transaction boundary: foreign-key cascades remove owned rows and a trigger removes legacy chat rows.
- The browser signs out and returns home only after a successful response. On failure, the confirmation input and current screen remain available.

## Indeterminate outcomes

- `ACCOUNT_DELETE_STORAGE_STATE_UNKNOWN`: Auth and database rows remain, but some uploaded objects may already be gone.
- `ACCOUNT_DELETE_PARTIAL_STORAGE_REMOVED`: uploaded objects are gone while Auth deletion was confirmed not to have completed.
- `ACCOUNT_DELETE_STATE_UNKNOWN`: the Auth response and follow-up status check both failed; the user must verify the account state before retrying.

## Boundaries

- There is no public or cross-user account deletion API.
- Administrative credentials remain server-side and are never returned to the browser.
- Deployment configuration and external deletion smoke checks are handled in protected release environments, not through this endpoint.
