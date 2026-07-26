import { createHash } from 'node:crypto'

const TARGETS = new Set(['staging', 'production'])
const DENIED = new Set([401, 403, 404])
const STORAGE_WRITE_DENIED = new Set([400, 401, 403, 404])
const PROJECT_REF = /^[a-z0-9]{8,32}$/

export const helpText = 'Usage: node scripts/remote-privilege-smoke.mjs --project-ref <ref> --target <staging|production> --commit <sha> --worker-version-id <id> --output <file> --confirm-remote-writes\nUse --check-config for a network-free validation.'

export const parseArguments = (argv = []) => {
  const result = { help: false, checkConfig: false, confirmRemoteWrites: false }
  const names = new Map([['--project-ref', 'projectRef'], ['--target', 'target'], ['--commit', 'commit'], ['--worker-version-id', 'workerVersionId'], ['--output', 'output']])
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help') { result.help = true; continue }
    if (arg === '--check-config') { result.checkConfig = true; continue }
    if (arg === '--confirm-remote-writes') { result.confirmRemoteWrites = true; continue }
    const key = names.get(arg)
    if (!key || index + 1 >= argv.length || String(argv[index + 1]).startsWith('--')) throw new Error('INVALID_ARGUMENTS')
    if (result[key]) throw new Error('DUPLICATE_ARGUMENT')
    result[key] = String(argv[index + 1]); index += 1
  }
  return result
}

export const hashProjectRef = (projectRef) => createHash('sha256').update(String(projectRef)).digest('hex')
export const isDeniedStatus = (status) => DENIED.has(status)
export const isStorageWriteDeniedStatus = (status) => STORAGE_WRITE_DENIED.has(status)

export const validateRemoteConfig = ({ options, env }) => {
  for (const key of ['projectRef', 'target', 'commit', 'workerVersionId', 'output']) if (!String(options[key] || '').trim()) throw new Error('MISSING_REQUIRED_OPTION')
  if (!TARGETS.has(options.target) || !PROJECT_REF.test(options.projectRef)) throw new Error('INVALID_TARGET_OR_PROJECT')
  if (!/^[0-9a-f]{7,64}$/i.test(options.commit) || !/^[A-Za-z0-9._-]{4,160}$/.test(options.workerVersionId)) throw new Error('INVALID_RELEASE_BINDING')
  for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'PRODUCTION_SUPABASE_PROJECT_REF']) if (!String(env[key] || '').trim()) throw new Error('MISSING_REMOTE_ENV')
  const productionRef = String(env.PRODUCTION_SUPABASE_PROJECT_REF).trim()
  if (!PROJECT_REF.test(productionRef)) throw new Error('INVALID_PRODUCTION_PROJECT_REF')
  if (options.target === 'production' && options.projectRef !== productionRef) throw new Error('PRODUCTION_PROJECT_MISMATCH')
  if (options.target === 'staging' && options.projectRef === productionRef) throw new Error('STAGING_PROJECT_MISMATCH')
  let url
  try { url = new URL(env.SUPABASE_URL) } catch { throw new Error('INVALID_SUPABASE_URL') }
  if (url.protocol !== 'https:' || url.hostname !== `${options.projectRef}.supabase.co`) throw new Error('PROJECT_URL_MISMATCH')
  if (!options.checkConfig && !options.confirmRemoteWrites) throw new Error('REMOTE_WRITES_NOT_CONFIRMED')
  return { ...options, url: url.origin }
}

export const buildArtifact = ({ target, commit, projectRef, workerVersionId, startedAt, finishedAt, scenarios }) => ({
  schemaVersion: 1,
  target,
  commit,
  projectRefHash: hashProjectRef(projectRef),
  workerVersionId,
  scenarios,
  timestamps: { startedAt, finishedAt },
})
