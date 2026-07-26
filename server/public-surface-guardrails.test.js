import assert from 'node:assert/strict'
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
