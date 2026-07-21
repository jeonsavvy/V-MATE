import { spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.dirname(serverDirectory)

const collectTests = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectTests(absolutePath)
    return entry.isFile() && entry.name.endsWith('.test.js') ? [absolutePath] : []
  }))
  return nested.flat()
}

const testFiles = [
  ...(await collectTests(serverDirectory)),
  path.join(repositoryRoot, 'worker.test.js'),
].sort()

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: repositoryRoot,
  stdio: 'inherit',
})

if (result.error) throw result.error
process.exitCode = result.status ?? 1
