import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.dirname(scriptDirectory)
const distDirectory = path.resolve(repositoryRoot, process.argv[2] || 'dist')
const outputFile = path.resolve(repositoryRoot, process.argv[3] || 'artifacts/dist-manifest.json')

const collectFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectFiles(absolutePath)
    return entry.isFile() ? [absolutePath] : []
  }))
  return files.flat()
}

const files = (await collectFiles(distDirectory))
  .filter((file) => {
    const relativePath = path.relative(distDirectory, file).split(path.sep).join('/')
    // The Worker injects runtime configuration into index.html, so its deployed
    // bytes intentionally differ from Vite's local build output. Cloudflare
    // consumes _headers as deployment metadata and does not serve it as an asset.
    return relativePath !== 'index.html' && relativePath !== '_headers'
  })
const manifestFiles = await Promise.all(files.map(async (file) => {
  const contents = await readFile(file)
  return {
    path: path.relative(distDirectory, file).split(path.sep).join('/'),
    bytes: contents.byteLength,
    sha256: createHash('sha256').update(contents).digest('hex'),
  }
}))

manifestFiles.sort((left, right) => left.path.localeCompare(right.path))
await mkdir(path.dirname(outputFile), { recursive: true })
await writeFile(outputFile, `${JSON.stringify({ version: 1, files: manifestFiles }, null, 2)}\n`)
process.stdout.write(`Wrote ${manifestFiles.length} asset hashes to ${outputFile}\n`)
