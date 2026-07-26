import { toSafeErrorMeta } from '../modules/safe-error-meta.js';
import { logServerWarn } from '../modules/server-logger.js';

export const STORAGE_DELETION_OUTBOX_TABLE = 'storage_deletion_outbox';
const MAX_OUTBOX_PATHS = 10_000;
const STORAGE_REMOVE_BATCH_SIZE = 100;

const normalizePaths = (paths) => Array.from(new Set(
  (Array.isArray(paths) ? paths : [])
    .map((path) => String(path || '').trim())
    .filter(Boolean),
));

const throwResultError = (label, result) => {
  if (!result?.error) return result;
  const error = new Error(label);
  error.code = 'STORAGE_DELETION_SAGA_FAILED';
  error.cause = result.error;
  throw error;
};

const safeFailureCode = (error) => String(
  toSafeErrorMeta(error).errorClass || 'unknown',
).slice(0, 64);

const isUniqueViolation = (error) => String(error?.code || '') === '23505';

const samePaths = (left, right) => {
  const normalizedLeft = normalizePaths(left).sort();
  const normalizedRight = normalizePaths(right).sort();
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((path, index) => path === normalizedRight[index]);
};

const isSafeSegment = (segment) => Boolean(
  segment && segment !== '.' && segment !== '..' && !segment.includes('\\'),
);

export const isStoragePathOwnedByDeletionJob = ({ path, job }) => {
  const normalizedPath = String(path || '').trim();
  const userId = String(job?.subject_user_id || '').trim();
  const segments = normalizedPath.split('/');
  if (!userId || normalizedPath.length > 1024 || segments.some((segment) => !isSafeSegment(segment))) return false;
  if (segments[0] !== userId || !['character', 'world'].includes(segments[1])) return false;

  if (job?.operation_kind !== 'content' || segments[1] !== job?.entity_type) return false;
  return new RegExp(`^[^/]+/${job.entity_type}/[0-9]{10,}-[A-Za-z0-9]{8}/[A-Za-z0-9_-]{1,32}/[A-Za-z0-9_-]{1,32}\\.webp$`).test(normalizedPath);
};

export const prepareStorageDeletionJob = async ({
  client,
  operationKey,
  operationKind,
  subjectUserId,
  entityType = null,
  entityId = null,
  paths,
}) => {
  const objectPaths = normalizePaths(paths);
  if (!objectPaths.length) return null;
  if (!client || !operationKey || operationKind !== 'content' || !subjectUserId) {
    const error = new Error('Invalid storage deletion job.');
    error.code = 'INVALID_STORAGE_DELETION_JOB';
    throw error;
  }
  if (objectPaths.length > MAX_OUTBOX_PATHS) {
    const error = new Error('Storage deletion job exceeds the path limit.');
    error.code = 'STORAGE_DELETION_PATH_LIMIT_EXCEEDED';
    throw error;
  }
  const candidate = {
    operation_kind: operationKind,
    subject_user_id: subjectUserId,
    entity_type: entityType,
  };
  if (!objectPaths.every((path) => isStoragePathOwnedByDeletionJob({ path, job: candidate }))) {
    const error = new Error('Storage deletion job contains an unsafe path.');
    error.code = 'UNSAFE_STORAGE_DELETION_PATH';
    throw error;
  }

  const payload = {
    operation_key: operationKey,
    operation_kind: operationKind,
    subject_user_id: subjectUserId,
    entity_type: entityType,
    entity_id: entityId,
    object_paths: objectPaths,
    status: 'prepared',
    updated_at: new Date().toISOString(),
  };
  const result = await client
    .from(STORAGE_DELETION_OUTBOX_TABLE)
    .insert(payload)
    .select('*')
    .single();
  if (!result?.error) return result.data;
  if (!isUniqueViolation(result.error)) {
    throwResultError('Unable to prepare storage cleanup.', result);
  }

  // A deterministic operation key makes duplicate delete requests converge on
  // the same intent without resetting an active lease or completed cleanup.
  const existing = await client
    .from(STORAGE_DELETION_OUTBOX_TABLE)
    .select('*')
    .eq('operation_key', operationKey)
    .maybeSingle();
  throwResultError('Unable to load existing storage cleanup.', existing);
  const existingJob = existing.data;
  const sameIntent = existingJob
    && existingJob.operation_kind === operationKind
    && existingJob.subject_user_id === subjectUserId
    && existingJob.entity_type === entityType
    && existingJob.entity_id === entityId
    && samePaths(existingJob.object_paths, objectPaths);
  if (!sameIntent) {
    const error = new Error('Storage deletion operation key is already in use.');
    error.code = 'STORAGE_DELETION_JOB_CONFLICT';
    throw error;
  }
  return existingJob;
};

export const claimStorageDeletionJob = async ({ client, job, leaseSeconds = 120 }) => {
  if (!client || !job?.id || !['prepared', 'processing'].includes(job.status)) return null;
  const now = new Date();
  const boundedLeaseSeconds = Math.max(30, Math.min(300, Math.floor(Number(leaseSeconds) || 120)));
  const leaseExpiresAt = new Date(now.getTime() + boundedLeaseSeconds * 1000).toISOString();
  let query = client
    .from(STORAGE_DELETION_OUTBOX_TABLE)
    .update({
      status: 'processing',
      lease_expires_at: leaseExpiresAt,
      updated_at: now.toISOString(),
    })
    .eq('id', job.id);
  query = job.status === 'processing'
    ? query.eq('status', 'processing').lte('lease_expires_at', now.toISOString())
    : query.eq('status', 'prepared');
  const result = await query.select('*').maybeSingle();
  throwResultError('Unable to claim storage cleanup.', result);
  return result.data || null;
};

const isAuthUserNotFound = (error) => Number(error?.status) === 404
  || String(error?.code || '').toLowerCase() === 'user_not_found';

export const confirmAuthUserAbsent = async ({ client, userId }) => {
  if (typeof client?.auth?.admin?.getUserById !== 'function') return 'unknown';
  try {
    const result = await client.auth.admin.getUserById(userId);
    if (!result?.error) return result?.data?.user ? 'present' : 'absent';
    return isAuthUserNotFound(result.error) ? 'absent' : 'unknown';
  } catch {
    return 'unknown';
  }
};

const confirmJobIsSafeToProcess = async ({ client, job }) => {
  if (job?.operation_kind !== 'content' || !['character', 'world'].includes(job.entity_type) || !job.entity_id) return false;
  const table = job.entity_type === 'character' ? 'characters' : 'worlds';
  const result = await client.from(table).select('id').eq('id', job.entity_id).maybeSingle();
  throwResultError('Unable to verify content deletion state.', result);
  return !result.data;
};

const recordStorageDeletionFailureBestEffort = async ({ client, job, error }) => {
  if (!job?.id || !job?.lease_expires_at) return;
  try {
    await client
      .from(STORAGE_DELETION_OUTBOX_TABLE)
      .update({
        attempt_count: Math.max(0, Number(job.attempt_count) || 0) + 1,
        last_error_code: safeFailureCode(error),
        status: 'prepared',
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('status', 'processing')
      .eq('lease_expires_at', job.lease_expires_at);
  } catch {
    // The prepared row still retains the paths for a later retry.
  }
};

export const processStorageDeletionJob = async ({
  client,
  job,
  bucket,
  destructiveStateConfirmed = false,
  // Callers that know their content-reference model can remove paths that
  // are still referenced by another row. The callback may only narrow this
  // job's already-validated paths; it must never add a deletion target.
  resolveRemovablePaths = null,
}) => {
  if (!job || job.status === 'completed') return { completed: true, removedAssets: 0 };
  if (job.status !== 'processing') return { completed: false, deferred: true, removedAssets: 0 };
  const paths = normalizePaths(job.object_paths);
  try {
    if (!paths.every((path) => isStoragePathOwnedByDeletionJob({ path, job }))) {
      const error = new Error('Storage cleanup path validation failed.');
      error.code = 'UNSAFE_STORAGE_DELETION_PATH';
      throw error;
    }
    const safeToProcess = destructiveStateConfirmed || await confirmJobIsSafeToProcess({ client, job });
    if (!safeToProcess) {
      const pendingError = new Error('Content still exists.');
      pendingError.code = 'CONTENT_STILL_PRESENT';
      await recordStorageDeletionFailureBestEffort({ client, job, error: pendingError });
      return { completed: false, deferred: true, removedAssets: 0 };
    }

    let removablePaths = paths;
    if (typeof resolveRemovablePaths === 'function') {
      const resolvedPaths = await resolveRemovablePaths({ client, job, paths: [...paths] });
      removablePaths = normalizePaths(resolvedPaths);
      if (!removablePaths.every((path) => paths.includes(path))
        || !removablePaths.every((path) => isStoragePathOwnedByDeletionJob({ path, job }))) {
        const error = new Error('Storage cleanup path filter returned an unsafe path.');
        error.code = 'UNSAFE_STORAGE_DELETION_PATH';
        throw error;
      }
    }

    for (let index = 0; index < removablePaths.length; index += STORAGE_REMOVE_BATCH_SIZE) {
      const result = await client.storage.from(bucket).remove(removablePaths.slice(index, index + STORAGE_REMOVE_BATCH_SIZE));
      throwResultError('Unable to remove storage objects.', result);
    }
    const completion = await client
      .from(STORAGE_DELETION_OUTBOX_TABLE)
      .update({
        status: 'completed',
        object_paths: [],
        last_error_code: null,
        lease_expires_at: null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('status', 'processing')
      .eq('lease_expires_at', job.lease_expires_at)
      .select('id')
      .maybeSingle();
    throwResultError('Unable to complete storage cleanup.', completion);
    if (!completion.data) {
      const error = new Error('Storage cleanup lease is no longer current.');
      error.code = 'STORAGE_DELETION_LEASE_LOST';
      throw error;
    }
    return { completed: true, removedAssets: removablePaths.length };
  } catch (error) {
    await recordStorageDeletionFailureBestEffort({ client, job, error });
    logServerWarn('[V-MATE] Storage deletion remains queued for retry', toSafeErrorMeta(error));
    return { completed: false, deferred: true, removedAssets: 0 };
  }
};

export const drainStorageDeletionOutbox = async ({
  client,
  bucket,
  limit = 5,
  strict = false,
  resolveRemovablePaths = null,
}) => {
  const boundedLimit = Math.max(1, Math.min(20, Math.floor(Number(limit) || 5)));
  try {
    const result = await client
      .from(STORAGE_DELETION_OUTBOX_TABLE)
      .select('*')
      .neq('status', 'completed')
      // Deferrals update updated_at so an undeleted row cannot permanently
      // starve newer cleanup jobs from the bounded batch.
      .order('updated_at', { ascending: true })
      .limit(boundedLimit);
    throwResultError('Unable to load pending storage cleanup.', result);
    let completed = 0;
    for (const job of result.data || []) {
      const claimedJob = await claimStorageDeletionJob({ client, job });
      if (!claimedJob) continue;
      const outcome = await processStorageDeletionJob({
        client,
        job: claimedJob,
        bucket,
        resolveRemovablePaths,
      });
      if (outcome.completed) completed += 1;
    }
    return { skipped: false, inspected: (result.data || []).length, completed };
  } catch (error) {
    if (strict) throw error;
    logServerWarn('[V-MATE] Storage deletion retry scan skipped', toSafeErrorMeta(error));
    return { skipped: true, inspected: 0, completed: 0 };
  }
};
