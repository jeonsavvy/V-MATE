import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..')
export const prohibited = [
  /\bai-generated\b/i,
  /\bassistant-generated\b/i,
  /\bmade with (?:ai|codex|chatgpt)\b/i,
  /\[codex\]/i,
  /\bready for submission\b/i,
  /\boperator todo\b/i,
  /\btask breakdown\b/i,
  /\bopen questions\b/i,
  /\bTODO\b/i,
  /이번\s+(?:작업|스프린트|패스)/,
  /(?:이번|현재)\s*(?:작업|스프린트|패스)\s*(?:은|이)?\s*(?:준비|진행|완료)/,
  /(?:작업|제출)\s*준비\s*완료/,
  /(?:운영|내부)\s*(?:할\s*일|todo|작업\s*목록)/i,
  /(?:AI|인공지능)\s*(?:(?:로|를\s*(?:사용|이용)해?)\s*)?(?:생성|제작|작성)(?:됨|된|했습니다|함)?/i,
  /(?:ChatGPT|Codex|Claude)\s*(?:(?:로|를\s*(?:사용|이용)해?)\s*)?(?:생성|제작|작성)(?:됨|된|했습니다|함)?/i,
  /(?:기본\s*호스트명|플랫폼이).{0,40}자동\s*(?:발급|생성|제공)/,
  /도메인을\s+보유하면.{0,80}(?:연결|주소)/,
]

export const isPublicTextSurfaceFile = (name) => /\.(?:html?|md|txt|svg)$/i.test(name)

const collectFiles = async (directory, accepts) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectFiles(target, accepts)
    return entry.isFile() && accepts(entry.name) ? [target] : []
  }))
  return nested.flat()
}

const files = [
  path.join(repositoryRoot, 'README.md'),
  path.join(repositoryRoot, 'index.html'),
  path.join(repositoryRoot, 'worker.js'),
  path.join(repositoryRoot, 'wrangler.jsonc'),
  ...(await collectFiles(path.join(repositoryRoot, 'docs'), (name) => name.endsWith('.md'))),
  ...(await collectFiles(path.join(repositoryRoot, 'supabase'), (name) => name.endsWith('.md'))),
  ...(await collectFiles(path.join(repositoryRoot, '.github', 'workflows'), (name) => /\.ya?ml$/i.test(name))),
  ...(await collectFiles(path.join(repositoryRoot, 'src'), (name) => /\.tsx?$/i.test(name) && !/\.(?:test|spec)\.tsx?$/i.test(name))),
  ...(await collectFiles(path.join(repositoryRoot, 'server'), (name) => name.endsWith('.js') && !/\.(?:test|spec)\.js$/i.test(name))),
  ...(await collectFiles(path.join(repositoryRoot, 'public'), isPublicTextSurfaceFile)),
]
const failures = []
for (const file of files) {
  const source = await readFile(file, 'utf8')
  for (const pattern of prohibited) {
    if (pattern.test(source)) failures.push(`${path.relative(repositoryRoot, file)} matches prohibited public-surface provenance or process text`)
  }
}

if (failures.length) throw new Error(failures.join('\n'))
process.stdout.write(`Validated ${files.length} public text surface files.\n`)
