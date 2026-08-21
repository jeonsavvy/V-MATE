# Auth release catalog drift recovery

## Goal

- Complete the frontend-only authentication release without changing production database objects.
- Keep the release fail-closed when application-owned database state differs from the current repository contract.
- Separate repository-owned schema evidence from Supabase-managed `auth` and `storage` catalog drift.

## Confirmed facts

- The current commit changes no file under `supabase/migrations/**`.
- Same-commit CI quality and disposable local database contracts pass.
- The read-only production baseline reports the expected migration-row fingerprint and all existing privilege invariants as passing.
- The legacy catalog fingerprint differs from the previous baseline because it combines `public`, `vmate_private`, `auth`, and `storage` objects.
- Cloudflare uploaded the current V-MATE version at zero traffic; the protected release workflow has not cut it over.

## Consequential assumption

- The drift is safe only when the unchanged migration fingerprint and every existing privilege/view invariant pass, same-commit disposable fresh and upgrade contracts pass, and the production application fingerprint is canonical.
- Schema 3 evidence has no application fingerprint, so the first schema 4 baseline establishes it. Every later schema 4 renewal must match that production fingerprint exactly.

## Non-goals

- Applying or inventing a production migration.
- Accepting a mismatch in `public` or `vmate_private`.
- Removing migration, privilege, lineage, freshness, shadow, smoke, or rollback gates.
- Treating Supabase-managed schema drift as proof that password-recovery mail is operational.

## Affected contracts

### Application catalog fingerprint

- `scripts/capture-application-release-state.sql` includes only `public` and `vmate_private`.
- Object identities do not contain database-local OIDs.
- ACLs and policy roles are normalized to role names before hashing.
- The query returns exactly one lowercase 32-character fingerprint.

### Disposable database evidence

- The DB harness calculates the application fingerprint after both fresh-schema and upgrade paths.
- Fresh and upgrade fingerprints may differ because upgrade-only recovery tables and their immutable manifest are intentionally absent from `schema.sql`.
- CI writes a sanitized artifact only when an explicit output path is supplied. The artifact contains the commit, both fingerprints, and `allPassed`; it contains no connection data or row content.

### Production baseline

- The baseline workflow downloads the database artifact from the successful same-commit CI run it already validates.
- It runs the same application fingerprint query through the existing read-only Supabase query surface.
- The fresh and upgrade fingerprints prove both disposable paths were measured after their independent contract suites. Cross-environment equality is not used because PostgreSQL catalog deparsing and ACL defaults can vary by platform/runtime.
- If the previous baseline is schema 4, production must match its `applicationStateFingerprint`. A schema 2/3 renewal may establish the initial schema 4 fingerprint only after the unchanged migration fingerprint and every existing invariant pass.
- The existing full catalog fingerprint remains observational evidence. A difference from the previous baseline is recorded as provider-catalog drift only after the application fingerprint, migration fingerprint, and existing invariants pass.
- Baseline evidence schema 4 adds `applicationStateFingerprint`, `databaseContractEvidenceRunId`, and `providerCatalogDriftObserved`. Previous schema 3 evidence remains valid only as renewal lineage input.

### Worker release

- Shadow, smoke, and cutover accept only fresh schema 4 baseline evidence for the current commit.
- Missing artifacts, unexpected keys, noncanonical fingerprints, commit mismatch, or any false invariant stop before traffic mutation.

## Validation order

```text
same-commit CI succeeds
  -> disposable fresh application fingerprint
  -> disposable upgrade application fingerprint
  -> require both fingerprints are canonical and both contract paths passed
  -> upload sanitized DB-contract artifact

read-only production baseline
  -> validate previous lockdown/baseline lineage
  -> require migration rows and existing privilege invariants
  -> download exact same-commit CI DB-contract artifact
  -> calculate production application fingerprint
  -> require canonical production fingerprint
  -> when previous baseline is schema 4, require exact fingerprint continuity
  -> record current full catalog fingerprint and provider-drift boolean
  -> upload schema 4 baseline evidence

release
  -> shadow upload evidence
  -> selected-version smoke
  -> cutover with automatic rollback contract unchanged
```

## Rollback

- Before cutover, discard the uploaded candidate and keep the current serving version.
- After cutover, the existing release workflow restores the evidence-bound previous stable version if live verification fails.
- Revert the repository commit to restore the prior catalog gate implementation. No database rollback is required because this recovery performs read-only database queries only.

## Proving checks

- Static workflow contract tests fail first for missing same-commit DB artifact and schema 4 validation.
- `npm run verify` passes locally.
- GitHub CI publishes matching fresh/upgrade application fingerprints for the release commit.
- The protected read-only production baseline publishes schema 4 evidence with all checks passing.
- Protected `shadow`, `smoke`, and `cutover` runs succeed in order.
- The production bundle contains the immediate-signup copy and the live dialog renders the signup heading and description.
