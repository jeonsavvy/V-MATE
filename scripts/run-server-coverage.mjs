import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.dirname(scriptDirectory)

const result = spawnSync(process.execPath, ['server/run-tests.js'], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    TEST_COVERAGE: 'true',
  },
  stdio: 'inherit',
})

if (result.error) throw result.error
process.exitCode = result.status ?? 1
