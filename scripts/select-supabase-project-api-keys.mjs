import { chmod, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const isEnabledLegacyKey = (entry, name) => entry
  && typeof entry === 'object'
  && entry.type === 'legacy'
  && entry.name === name
  && (entry.disabled === undefined || entry.disabled === false)
  && typeof entry.api_key === 'string'
  && entry.api_key.length > 0
  && entry.api_key.trim() === entry.api_key

const selectExactlyOne = (entries, name) => {
  const matches = entries.filter((entry) => isEnabledLegacyKey(entry, name))
  if (matches.length !== 1) throw new Error(`Expected exactly one enabled legacy ${name} key.`)
  return matches[0].api_key
}

export const selectSupabaseProjectApiKeys = (payload) => {
  if (!Array.isArray(payload)) throw new TypeError('Supabase project API key response must be an array.')
  const anonKey = selectExactlyOne(payload, 'anon')
  const serviceRoleKey = selectExactlyOne(payload, 'service_role')
  if (anonKey === serviceRoleKey) throw new Error('Supabase project API keys must be distinct.')
  return { anonKey, serviceRoleKey }
}

const parseArguments = (argv) => {
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!value || (flag !== '--input' && flag !== '--output') || Object.hasOwn(options, flag)) {
      throw new Error('Usage: node scripts/select-supabase-project-api-keys.mjs --input <path> --output <path>')
    }
    options[flag] = value
  }
  if (!options['--input'] || !options['--output']) {
    throw new Error('Usage: node scripts/select-supabase-project-api-keys.mjs --input <path> --output <path>')
  }
  return { inputPath: options['--input'], outputPath: options['--output'] }
}

const main = async () => {
  const { inputPath, outputPath } = parseArguments(process.argv.slice(2))
  const payload = JSON.parse(await readFile(inputPath, 'utf8'))
  const selected = selectSupabaseProjectApiKeys(payload)
  await writeFile(outputPath, `${JSON.stringify(selected)}\n`, { encoding: 'utf8', mode: 0o600 })
  await chmod(outputPath, 0o600)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stderr.write('Supabase project API key selection failed.\n')
    process.exitCode = 1
  })
}
