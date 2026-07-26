export const ASSET_LIMITS = Object.freeze({ assets: 18, slots: 6 })

export const VARIANT_CONTRACTS = Object.freeze({
  character: Object.freeze({
    thumb: Object.freeze({ width: 300, height: 400 }),
    card: Object.freeze({ width: 600, height: 800 }),
    detail: Object.freeze({ width: 768, height: 1024 }),
  }),
  world: Object.freeze({
    thumb: Object.freeze({ width: 320, height: 180 }),
    card: Object.freeze({ width: 640, height: 360 }),
    hero: Object.freeze({ width: 1280, height: 720 }),
  }),
})

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
const normalizeString = (value) => String(value ?? '').trim()
const invalid = (error) => ({ ok: false, errorCode: 'INVALID_UPLOAD_VARIANTS', error })

export const parseVariantKind = (kind, { requireSlot = true } = {}) => {
  const normalized = normalizeString(kind)
  const separator = normalized.lastIndexOf(':')
  if (separator === -1) {
    if (requireSlot) return null
    return /^[A-Za-z0-9_-]{1,32}$/.test(normalized)
      ? { slot: 'main', variant: normalized, kind: `main:${normalized}` }
      : null
  }
  const slot = normalized.slice(0, separator)
  const variant = normalized.slice(separator + 1)
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(slot) || !/^[A-Za-z0-9_-]{1,32}$/.test(variant)) return null
  return { slot, variant, kind: `${slot}:${variant}` }
}

export const hasCompleteVariantSets = ({ entityType, variants }) => {
  const required = Object.keys(VARIANT_CONTRACTS[entityType] || {})
  const bySlot = new Map()
  for (const item of variants) {
    if (!bySlot.has(item.slot)) bySlot.set(item.slot, new Set())
    bySlot.get(item.slot).add(item.variant)
  }
  if (bySlot.size < 1 || bySlot.size > ASSET_LIMITS.slots) return false
  return Array.from(bySlot.values()).every((present) => (
    present.size === required.length && required.every((variant) => present.has(variant))
  ))
}

export const validateUploadVariants = ({ entityType, variants }) => {
  const contract = VARIANT_CONTRACTS[entityType]
  if (!contract || !Array.isArray(variants) || variants.length < 3 || variants.length > ASSET_LIMITS.assets) {
    return invalid('업로드 이미지 규격을 확인해주세요.')
  }

  const normalized = []
  const kinds = new Set()
  const slots = new Set()
  for (const candidate of variants) {
    if (!isPlainObject(candidate)) return invalid('업로드 이미지 규격을 확인해주세요.')
    const parsedKind = parseVariantKind(candidate.kind)
    const expected = parsedKind ? contract[parsedKind.variant] : null
    const width = Number(candidate.width)
    const height = Number(candidate.height)
    if (!parsedKind || !expected || !Number.isInteger(width) || !Number.isInteger(height)
      || width !== expected.width || height !== expected.height || kinds.has(parsedKind.kind)) {
      return invalid('업로드 이미지 규격을 확인해주세요.')
    }
    kinds.add(parsedKind.kind)
    slots.add(parsedKind.slot)
    normalized.push({ ...parsedKind, width, height })
  }
  if (slots.size > ASSET_LIMITS.slots || !hasCompleteVariantSets({ entityType, variants: normalized })) {
    return invalid('각 이미지 슬롯에는 정확한 3개 규격이 모두 필요합니다.')
  }
  return { ok: true, value: normalized }
}

export const resolveCanonicalAssetPath = ({ url, userId, entityType, supabaseUrl, bucket = 'vmate-assets' }) => {
  const normalizedUrl = normalizeString(url)
  const normalizedOrigin = normalizeString(supabaseUrl).replace(/\/+$/, '')
  if (!normalizedUrl || !normalizedOrigin || !userId || !VARIANT_CONTRACTS[entityType]) return null
  if (normalizedUrl.includes('\\')) return null
  try {
    const parsed = new URL(normalizedUrl)
    const configured = new URL(normalizedOrigin)
    if (parsed.origin !== configured.origin || parsed.username || parsed.password || parsed.search || parsed.hash) return null
    const marker = `/storage/v1/object/public/${encodeURIComponent(bucket)}/`
    if (!parsed.pathname.startsWith(marker)) return null
    const rawPath = parsed.pathname.slice(marker.length)
    if (rawPath.includes('%')) return null
    const decodedPath = decodeURIComponent(rawPath)
    if (decodedPath.split('/').some((part) => !part)) return null
    const escapedUserId = String(userId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`^${escapedUserId}/${entityType}/[0-9]{10,}-[A-Za-z0-9]{8}/[A-Za-z0-9_-]{1,32}/[A-Za-z0-9_-]{1,32}\\.webp$`)
    return pattern.test(decodedPath) ? decodedPath : null
  } catch {
    return null
  }
}
