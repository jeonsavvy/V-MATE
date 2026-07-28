import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const MANAGEMENT_API_ORIGIN = 'https://api.supabase.com'
const PROJECT_REF_PATTERN = /^[a-z0-9]{8,32}$/

export const runSupabaseReadOnlyQuery = async ({
  projectRef,
  accessToken,
  query,
  fetchImpl = fetch,
}) => {
  if (!PROJECT_REF_PATTERN.test(projectRef || '')) {
    throw new Error('Supabase project ref is invalid.')
  }
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    throw new Error('Supabase access token is unavailable.')
  }
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('Read-only SQL query is empty.')
  }

  const endpoint = `${MANAGEMENT_API_ORIGIN}/v1/projects/${projectRef}/database/query/read-only`
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  const responseText = await response.text()
  if (!response.ok) {
    throw new Error(`Supabase read-only query failed with status ${response.status}.`)
  }

  let payload
  try {
    payload = JSON.parse(responseText)
  } catch {
    throw new Error('Supabase read-only query returned invalid JSON.')
  }
  if (payload === null || typeof payload !== 'object') {
    throw new Error('Supabase read-only query returned an invalid result shape.')
  }
  return payload
}

const parseArguments = (argv) => {
  if (argv.length % 2 !== 0) throw new Error('Arguments must use --name value pairs.')
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || !value || values.has(name)) {
      throw new Error('Arguments must use unique --name value pairs.')
    }
    values.set(name, value)
  }
  return values
}

export const runFromCli = async (argv, environment = process.env) => {
  const argumentsByName = parseArguments(argv)
  const projectRef = argumentsByName.get('--project-ref')
  const sqlFile = argumentsByName.get('--sql-file')
  const output = argumentsByName.get('--output')
  if (argumentsByName.size !== 3 || !projectRef || !sqlFile || !output) {
    throw new Error('Usage: --project-ref <ref> --sql-file <path> --output <path>')
  }
  const query = await readFile(sqlFile, 'utf8')
  const payload = await runSupabaseReadOnlyQuery({
    projectRef,
    accessToken: environment.SUPABASE_ACCESS_TOKEN,
    query,
  })
  await writeFile(output, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', flag: 'wx' })
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  runFromCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Read-only baseline query failed: ${error.message}\n`)
    process.exitCode = 1
  })
}
