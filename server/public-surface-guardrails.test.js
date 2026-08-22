import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { isPublicTextSurfaceFile, prohibited } from '../scripts/validate-public-surface.mjs'

const isProhibited = (text) => prohibited.some((pattern) => pattern.test(text))

test('public-surface guard blocks Korean provenance and internal progress variants', () => {
  for (const text of [
    'AI로 제작한 서비스입니다.',
    '인공지능 생성 콘텐츠입니다.',
    'ChatGPT로 작성했습니다.',
    'Codex로 생성됨',
    '현재 스프린트 진행 중',
    '제출 준비 완료',
    '운영 할 일: 승인 대기',
  ]) {
    assert.equal(isProhibited(text), true, text)
  }

  assert.equal(isProhibited('계정 복구 링크가 만료되면 새 링크를 요청할 수 있습니다.'), false)
})

test('public-surface guard includes SVG text surfaces', () => {
  assert.equal(isPublicTextSurfaceFile('favicon.svg'), true)
  assert.equal(isPublicTextSurfaceFile('icon.SVG'), true)
  assert.equal(isPublicTextSurfaceFile('starter.webp'), false)
})

test('public discovery surfaces remain useful without JavaScript', () => {
  const index = readFileSync('index.html', 'utf8')
  const body = index.match(/<body>([\s\S]*?)<\/body>/i)?.[1] ?? ''
  const readableBody = body
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const jsonLdSource = index.match(
    /<script\s+type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/i,
  )?.[1]

  assert.equal((body.match(/<h1\b/gi) ?? []).length, 1)
  assert.ok(readableBody.length >= 500, `expected at least 500 readable characters, received ${readableBody.length}`)
  assert.ok(jsonLdSource, 'expected homepage JSON-LD')
  assert.deepEqual(JSON.parse(jsonLdSource), {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'V-MATE',
    url: 'https://v-mate.satinode.com/',
    description: '캐릭터와 월드를 조합해 대화하고, 장면과 기억을 이어가는 캐릭터챗 플랫폼',
    inLanguage: 'ko',
  })
  assert.match(index, /<meta\s+property="og:image"\s+content="https:\/\/v-mate\.satinode\.com\/starter\/[^"\s]+\.webp"/i)

  const robots = readFileSync('public/robots.txt', 'utf8')
  const sitemap = readFileSync('public/sitemap.xml', 'utf8')
  const llms = readFileSync('public/llms.txt', 'utf8')
  const wrangler = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'))

  assert.match(robots, /^Sitemap: https:\/\/v-mate\.satinode\.com\/sitemap\.xml$/m)
  assert.match(sitemap, /<loc>https:\/\/v-mate\.satinode\.com\/<\/loc>/)
  assert.match(sitemap, /<loc>https:\/\/v-mate\.satinode\.com\/privacy<\/loc>/)
  assert.match(llms, /^# V-MATE$/m)
  assert.match(llms, /^## When to use$/m)
  assert.ok(llms.length >= 500, `expected useful llms.txt content, received ${llms.length} characters`)
  assert.equal(wrangler.assets.html_handling, 'none')
  assert.equal(wrangler.assets.not_found_handling, 'none')
})
