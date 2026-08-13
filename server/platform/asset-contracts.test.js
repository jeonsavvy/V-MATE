import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ASSET_LIMITS,
  hasCompleteVariantSets,
  parseVariantKind,
  resolveCanonicalAssetPath,
  resolveCanonicalAssetPathsFromRows,
  validateUploadVariants,
} from './asset-contracts.js'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const ORIGIN = 'https://project.supabase.co'
const baseVariants = [
  { kind: 'main:thumb', width: 300, height: 400 },
  { kind: 'main:card', width: 600, height: 800 },
  { kind: 'main:detail', width: 768, height: 1024 },
]
const canonicalUrl = `${ORIGIN}/storage/v1/object/public/vmate-assets/${USER_ID}/character/1721971200000-a1b2c3d4/main/detail.webp`

test('asset kind parser covers slotted and legacy asset forms', () => {
  assert.deepEqual(parseVariantKind(' main:detail '), { slot: 'main', variant: 'detail', kind: 'main:detail' })
  assert.deepEqual(parseVariantKind('thumb', { requireSlot: false }), { slot: 'main', variant: 'thumb', kind: 'main:thumb' })
  assert.equal(parseVariantKind('thumb'), null)
  assert.equal(parseVariantKind('bad value', { requireSlot: false }), null)
  assert.equal(parseVariantKind(':thumb'), null)
  assert.equal(parseVariantKind('main:'), null)
  assert.equal(parseVariantKind(undefined, { requireSlot: false }), null)
})

test('complete variant-set helper rejects empty, oversized, unknown, and incomplete sets', () => {
  const normalized = baseVariants.map(({ kind, width, height }) => ({
    ...parseVariantKind(kind), width, height,
  }))
  assert.equal(hasCompleteVariantSets({ entityType: 'character', variants: normalized }), true)
  assert.equal(hasCompleteVariantSets({ entityType: 'character', variants: [] }), false)
  assert.equal(hasCompleteVariantSets({ entityType: 'unknown', variants: normalized }), false)
  assert.equal(hasCompleteVariantSets({ entityType: 'character', variants: normalized.slice(0, 2) }), false)
  assert.equal(hasCompleteVariantSets({ entityType: 'character', variants: [
    { slot: 'main', variant: 'thumb' },
    { slot: 'main', variant: 'card' },
    { slot: 'main', variant: 'unknown' },
  ] }), false)
  assert.equal(hasCompleteVariantSets({
    entityType: 'character',
    variants: Array.from({ length: ASSET_LIMITS.slots + 1 }, (_, index) => ({ slot: `s${index}`, variant: 'thumb' })),
  }), false)
})

test('upload validator rejects every malformed input axis before issuing storage calls', () => {
  const expectInvalid = (variants, entityType = 'character') => {
    assert.equal(validateUploadVariants({ entityType, variants }).ok, false)
  }
  expectInvalid(baseVariants, 'unknown')
  expectInvalid(null)
  expectInvalid(baseVariants.slice(0, 2))
  expectInvalid([...baseVariants, ...Array.from({ length: 16 }, (_, index) => ({ ...baseVariants[0], kind: `s${index}:thumb` }))])
  expectInvalid([null, ...baseVariants.slice(1)])
  expectInvalid(['invalid', ...baseVariants.slice(1)])
  expectInvalid([[], ...baseVariants.slice(1)])
  assert.equal(validateUploadVariants({
    entityType: 'character',
    variants: [Object.assign(Object.create(null), baseVariants[0]), ...baseVariants.slice(1)],
  }).ok, true)
  expectInvalid([{ ...baseVariants[0], kind: 'no-slot' }, ...baseVariants.slice(1)])
  expectInvalid([{ ...baseVariants[0], kind: 'main:unknown' }, ...baseVariants.slice(1)])
  expectInvalid([{ ...baseVariants[0], width: 300.5 }, ...baseVariants.slice(1)])
  expectInvalid([{ ...baseVariants[0], height: 400.5 }, ...baseVariants.slice(1)])
  expectInvalid([{ ...baseVariants[0], width: 301 }, ...baseVariants.slice(1)])
  expectInvalid([{ ...baseVariants[0], height: 401 }, ...baseVariants.slice(1)])
  expectInvalid([baseVariants[0], { ...baseVariants[0] }, baseVariants[2]])
  expectInvalid([baseVariants[0], baseVariants[1], { ...baseVariants[2], kind: 'main:thumb' }])

  const sevenSlotsInEighteenVariants = Array.from({ length: ASSET_LIMITS.assets }, (_, index) => {
    const variant = ['thumb', 'card', 'detail'][index % 3]
    const dimensions = { thumb: [300, 400], card: [600, 800], detail: [768, 1024] }[variant]
    return { kind: `s${index % 7}:${variant}`, width: dimensions[0], height: dimensions[1] }
  })
  expectInvalid(sevenSlotsInEighteenVariants)
  assert.equal(validateUploadVariants({ entityType: 'character', variants: baseVariants }).ok, true)
})

test('canonical asset resolver rejects each ownership and URL ambiguity axis', () => {
  const resolve = (overrides = {}) => resolveCanonicalAssetPath({
    url: canonicalUrl,
    userId: USER_ID,
    entityType: 'character',
    supabaseUrl: `${ORIGIN}/`,
    ...overrides,
  })
  assert.equal(resolve(), `${USER_ID}/character/1721971200000-a1b2c3d4/main/detail.webp`)
  for (const overrides of [
    { url: '' },
    { supabaseUrl: '' },
    { userId: '' },
    { entityType: 'unknown' },
    { url: 'not a URL' },
    { supabaseUrl: 'not a URL' },
    { url: canonicalUrl.replace(ORIGIN, 'https://evil.example') },
    { url: canonicalUrl.replace('https://', 'https://user@') },
    { url: canonicalUrl.replace('https://', 'https://:secret@') },
    { url: canonicalUrl.replace('https://', 'https://user:secret@') },
    { url: `${canonicalUrl}?download=1` },
    { url: `${canonicalUrl}#fragment` },
    { url: canonicalUrl.replace('/storage/v1/object/public/', '/storage/v1/object/sign/') },
    { url: canonicalUrl.replace('/main/detail.webp', '/main%2Fdetail.webp') },
    { url: canonicalUrl.replace('/main/detail.webp', '/main\\detail.webp') },
    { url: canonicalUrl.replace('/main/detail.webp', '//detail.webp') },
    { url: canonicalUrl.replace('/main/detail.webp', '/main/detail.png') },
  ]) assert.equal(resolve(overrides), null)
})

test('canonical asset rows resolve to deduplicated owned storage paths', () => {
  const path = `${USER_ID}/character/1721971200000-a1b2c3d4/main/detail.webp`
  assert.deepEqual(resolveCanonicalAssetPathsFromRows({
    assets: [
      { url: canonicalUrl },
      { url: canonicalUrl },
      { url: canonicalUrl.replace(ORIGIN, 'https://foreign.example') },
      { path: `${USER_ID}/character/1721971200000-a1b2c3d4/main/card.webp` },
    ],
    userId: USER_ID,
    entityType: 'character',
    supabaseUrl: ORIGIN,
  }), [path])
  assert.deepEqual(resolveCanonicalAssetPathsFromRows({
    assets: null,
    userId: USER_ID,
    entityType: 'character',
    supabaseUrl: ORIGIN,
  }), [])
})
