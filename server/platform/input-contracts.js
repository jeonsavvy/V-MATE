import {
  ASSET_LIMITS,
  VARIANT_CONTRACTS,
  hasCompleteVariantSets,
  parseVariantKind,
  resolveCanonicalAssetPath,
  validateUploadVariants,
} from './asset-contracts.js'

export { resolveCanonicalAssetPath, validateUploadVariants } from './asset-contracts.js'

const CONTENT_LIMITS = Object.freeze({
  name: 80,
  headline: 160,
  summary: 4000,
  creatorName: 80,
  worldRulesMarkdown: 8000,
  sourceUrl: 2048,
  tags: 12,
  tag: 32,
  jsonBytes: 16 * 1024,
  assets: ASSET_LIMITS.assets,
  slots: ASSET_LIMITS.slots,
});

const JSON_FIELDS = Object.freeze({
  character: ['profileJson', 'speechStyleJson', 'promptProfileJson'],
  world: ['promptProfileJson'],
});

const COMMON_FIELDS = Object.freeze([
  'name',
  'headline',
  'summary',
  'tags',
  'visibility',
  'sourceType',
  'sourceUrl',
  'rightsConfirmed',
  'creatorName',
  'coverImageUrl',
  'assets',
]);

const ENTITY_FIELDS = Object.freeze({
  character: [...COMMON_FIELDS, 'avatarImageUrl', ...JSON_FIELDS.character],
  world: [...COMMON_FIELDS, 'worldRulesMarkdown', ...JSON_FIELDS.world],
});

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const jsonByteLength = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

const invalid = (errorCode, error, details) => ({ ok: false, errorCode, error, ...(details ? { details } : {}) });
const valid = (value) => ({ ok: true, value });

const normalizeString = (value) => String(value ?? '').trim();

const jsonSemanticallyEqual = (left, right) => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => jsonSemanticallyEqual(value, right[index]));
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index]
        && jsonSemanticallyEqual(left[key], right[key]));
  }
  return false;
};

const existingJsonField = (existing, key) => {
  if (isPlainObject(existing?.[key])) return existing[key];
  if (key === 'promptProfileJson' && isPlainObject(existing?.promptProfile)) return existing.promptProfile;
  return {};
};

const existingWorldRules = (existing) => {
  if (typeof existing?.worldRulesMarkdown !== 'undefined') return normalizeString(existing.worldRulesMarkdown);
  const section = Array.isArray(existing?.worldSections)
    ? existing.worldSections.find((candidate) => normalizeString(candidate?.title) === '월드 규칙')
    : null;
  return normalizeString(section?.body);
};

const existingCreatorName = (existing) => normalizeString(
  existing?.creatorName
    ?? existing?.promptProfileJson?.creatorName
    ?? existing?.promptProfile?.creatorName
    ?? existing?.profileJson?.creatorName
    ?? existing?.creator?.name,
);

const isSemanticNoopPatch = ({ entityType, output, existing }) => {
  if (Object.keys(output).length === 0) return true;
  if (!existing || typeof existing !== 'object') return false;

  for (const [key, value] of Object.entries(output)) {
    if (JSON_FIELDS[entityType].includes(key)) {
      const prior = existingJsonField(existing, key);
      if (!jsonSemanticallyEqual({ ...prior, ...value }, prior)) return false;
      continue;
    }
    if (key === 'creatorName') {
      if (normalizeString(value) !== existingCreatorName(existing)) return false;
      continue;
    }
    if (key === 'worldRulesMarkdown') {
      if (normalizeString(value) !== existingWorldRules(existing)) return false;
      continue;
    }
    if (key === 'tags') {
      const prior = Array.isArray(existing.tags)
        ? Array.from(new Set(existing.tags.map(normalizeString).filter(Boolean)))
        : [];
      if (!jsonSemanticallyEqual(value, prior)) return false;
      continue;
    }
    if (key === 'assets') {
      // The current write adapters treat an empty list as no mutation. When
      // current typed assets are available compare them; otherwise a nonempty
      // list is conservatively considered a write.
      if (value.length === 0) continue;
      if (!Array.isArray(existing.assets) || !jsonSemanticallyEqual(value, existing.assets)) return false;
      continue;
    }
    if (key === 'rightsConfirmed') {
      // This attestation flag is persisted only with an explicit public
      // transition. On its own it must not turn an updated_at-only write into
      // an accepted PATCH.
      if (value === true && output.visibility === 'public' && !existing.rightsAttestedAt) return false;
      continue;
    }
    if (normalizeString(value) !== normalizeString(existing[key])) return false;
  }
  return true;
};


const normalizeHttpsUrl = (value) => {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.toString() : null;
  } catch {
    return null;
  }
};

const validateText = ({ payload, output, key, max, required = false, mode }) => {
  if (mode === 'patch' && !hasOwn(payload, key)) return null;
  const value = normalizeString(payload[key]);
  if ((required && !value) || value.length > max) return invalid('INVALID_REQUEST_BODY', '입력값의 길이 또는 형식을 확인해주세요.', { field: key });
  output[key] = value;
  return null;
};

const validateJsonFields = ({ entityType, payload, output, mode }) => {
  for (const key of JSON_FIELDS[entityType]) {
    if (mode === 'patch' && !hasOwn(payload, key)) continue;
    const value = hasOwn(payload, key) ? payload[key] : {};
    if (!isPlainObject(value) || jsonByteLength(value) > CONTENT_LIMITS.jsonBytes) {
      return invalid('INVALID_REQUEST_BODY', 'JSON 입력 형식을 확인해주세요.', { field: key });
    }
    output[key] = value;
  }
  return null;
};

const validateTags = ({ payload, output, mode }) => {
  if (mode === 'patch' && !hasOwn(payload, 'tags')) return null;
  const tags = hasOwn(payload, 'tags') ? payload.tags : [];
  if (!Array.isArray(tags) || tags.length > CONTENT_LIMITS.tags) return invalid('INVALID_REQUEST_BODY', '태그는 최대 12개까지 입력할 수 있습니다.', { field: 'tags' });
  const normalized = tags.map(normalizeString);
  if (normalized.some((tag) => !tag || tag.length > CONTENT_LIMITS.tag)) return invalid('INVALID_REQUEST_BODY', '태그 형식을 확인해주세요.', { field: 'tags' });
  output.tags = Array.from(new Set(normalized));
  return null;
};

const validateAssets = ({ entityType, payload, output, mode }) => {
  if (mode === 'patch' && !hasOwn(payload, 'assets')) return null;
  const assets = hasOwn(payload, 'assets') ? payload.assets : [];
  if (!Array.isArray(assets) || assets.length > CONTENT_LIMITS.assets) return invalid('INVALID_REQUEST_BODY', '이미지 자산 형식을 확인해주세요.', { field: 'assets' });
  const contract = VARIANT_CONTRACTS[entityType];
  const normalized = [];
  const kinds = new Set();
  for (const asset of assets) {
    const parsedKind = isPlainObject(asset) ? parseVariantKind(asset.kind, { requireSlot: false }) : null;
    const expected = parsedKind ? contract[parsedKind.variant] : null;
    const width = Number(asset?.width);
    const height = Number(asset?.height);
    const url = normalizeString(asset?.url);
    if (!parsedKind || !expected || !url || width !== expected.width || height !== expected.height || kinds.has(parsedKind.kind)) {
      return invalid('INVALID_REQUEST_BODY', '이미지 자산 형식을 확인해주세요.', { field: 'assets' });
    }
    kinds.add(parsedKind.kind);
    normalized.push({ kind: parsedKind.kind, variant: parsedKind.variant, slot: parsedKind.slot, url, width, height });
  }
  if (normalized.length > 0 && !hasCompleteVariantSets({ entityType, variants: normalized })) {
    return invalid('INVALID_REQUEST_BODY', '각 이미지 슬롯에는 정확한 3개 규격이 모두 필요합니다.', { field: 'assets' });
  }
  output.assets = normalized;
  return null;
};

const validateImageSlots = ({ entityType, promptProfileJson }) => {
  if (!hasOwn(promptProfileJson, 'imageSlots')) return null;
  const slots = promptProfileJson.imageSlots;
  if (!Array.isArray(slots) || slots.length > CONTENT_LIMITS.slots) {
    return invalid('INVALID_REQUEST_BODY', '이미지 슬롯은 최대 6개까지 사용할 수 있습니다.', { field: 'promptProfileJson.imageSlots' });
  }

  const ids = new Set();
  for (const slot of slots) {
    const id = isPlainObject(slot) ? normalizeString(slot.id) : '';
    if (!id || !/^[A-Za-z0-9_-]{1,32}$/.test(id) || ids.has(id)) {
      return invalid('INVALID_REQUEST_BODY', '이미지 슬롯 형식을 확인해주세요.', { field: 'promptProfileJson.imageSlots' });
    }
    ids.add(id);

    const rawUrls = entityType === 'character'
      ? [slot.thumbUrl, slot.cardUrl, slot.detailUrl]
      : [slot.thumbUrl, slot.cardUrl, slot.heroUrl || slot.detailUrl];
    if (entityType === 'character' && normalizeString(slot.heroUrl)) {
      return invalid('INVALID_REQUEST_BODY', '이미지 슬롯 규격을 확인해주세요.', { field: 'promptProfileJson.imageSlots' });
    }
    if (entityType === 'world' && normalizeString(slot.heroUrl) && normalizeString(slot.detailUrl)
      && normalizeString(slot.heroUrl) !== normalizeString(slot.detailUrl)) {
      return invalid('INVALID_REQUEST_BODY', '이미지 슬롯 규격을 확인해주세요.', { field: 'promptProfileJson.imageSlots' });
    }
    if (rawUrls.some((url) => typeof url !== 'undefined' && typeof url !== 'string')) {
      return invalid('INVALID_REQUEST_BODY', '이미지 슬롯 URL 형식을 확인해주세요.', { field: 'promptProfileJson.imageSlots' });
    }
    const present = rawUrls.map((url) => Boolean(normalizeString(url)));
    if (present.some(Boolean) && !present.every(Boolean)) {
      return invalid('INVALID_REQUEST_BODY', '각 이미지 슬롯에는 정확한 3개 규격이 모두 필요합니다.', { field: 'promptProfileJson.imageSlots' });
    }
  }
  return null;
};

export const collectContentAssetUrls = (payload = {}) => {
  const urls = new Set();
  const add = (value) => {
    const normalized = normalizeString(value);
    if (normalized) urls.add(normalized);
  };
  add(payload.coverImageUrl);
  add(payload.avatarImageUrl);
  for (const asset of Array.isArray(payload.assets) ? payload.assets : []) add(asset?.url);
  const slots = Array.isArray(payload.promptProfileJson?.imageSlots) ? payload.promptProfileJson.imageSlots : [];
  for (const slot of slots) {
    add(slot?.thumbUrl);
    add(slot?.cardUrl);
    add(slot?.detailUrl);
    add(slot?.heroUrl);
  }
  return Array.from(urls);
};


export const validateContentAssetReferences = ({
  payload,
  existingPayload,
  userId,
  entityType,
  supabaseUrl,
  bucket,
  enforceCanonical = true,
}) => {
  if (!enforceCanonical) return valid(payload);
  const uploadIdsBySlot = new Map();
  const validateReference = ({ url, slot = '', variant = '' }) => {
    const path = resolveCanonicalAssetPath({ url, userId, entityType, supabaseUrl, bucket });
    if (!path) return false;
    if (!slot && !variant) return true;
    const parts = path.split('/');
    const uploadId = parts.at(-3);
    const pathSlot = parts.at(-2);
    const pathVariant = parts.at(-1)?.replace(/\.webp$/, '');
    if (pathSlot !== slot || pathVariant !== variant) return false;
    const priorUploadId = uploadIdsBySlot.get(slot);
    if (priorUploadId && priorUploadId !== uploadId) return false;
    uploadIdsBySlot.set(slot, uploadId);
    return true;
  };

  for (const url of [payload.coverImageUrl, payload.avatarImageUrl].filter((value) => normalizeString(value))) {
    if (!validateReference({ url })) {
      return invalid('INVALID_ASSET_REFERENCE', '업로드가 확인된 본인 이미지 자산만 사용할 수 있습니다.');
    }
  }

  for (const asset of Array.isArray(payload.assets) ? payload.assets : []) {
    if (!validateReference({ url: asset.url, slot: asset.slot, variant: asset.variant })) {
      return invalid('INVALID_ASSET_REFERENCE', '업로드가 확인된 본인 이미지 자산만 사용할 수 있습니다.');
    }
  }

  const imageSlots = Array.isArray(payload.promptProfileJson?.imageSlots) ? payload.promptProfileJson.imageSlots : [];
  for (const slot of imageSlots) {
    const expected = entityType === 'character'
      ? [['thumbUrl', 'thumb'], ['cardUrl', 'card'], ['detailUrl', 'detail']]
      : [['thumbUrl', 'thumb'], ['cardUrl', 'card'], [normalizeString(slot.heroUrl) ? 'heroUrl' : 'detailUrl', 'hero']];
    for (const [field, variant] of expected) {
      const url = normalizeString(slot[field]);
      if (url && !validateReference({ url, slot: normalizeString(slot.id), variant })) {
        return invalid('INVALID_ASSET_REFERENCE', '업로드가 확인된 본인 이미지 자산만 사용할 수 있습니다.');
      }
    }
  }
  return valid(payload);
};

export const validateContentPayload = ({ entityType, payload, mode = 'create', existing = null }) => {
  if (!VARIANT_CONTRACTS[entityType] || !isPlainObject(payload) || !['create', 'patch'].includes(mode)) {
    return invalid('INVALID_REQUEST_BODY', '요청 본문을 확인해주세요.');
  }
  const allowedFields = new Set(ENTITY_FIELDS[entityType]);
  if (Object.keys(payload).some((key) => !allowedFields.has(key))) {
    return invalid('INVALID_REQUEST_BODY', '지원하지 않는 입력 필드가 있습니다.');
  }

  const output = {};
  let issue = validateText({ payload, output, key: 'name', max: CONTENT_LIMITS.name, required: true, mode });
  if (issue) return issue;
  for (const [key, max] of [['headline', CONTENT_LIMITS.headline], ['summary', CONTENT_LIMITS.summary], ['creatorName', CONTENT_LIMITS.creatorName]]) {
    issue = validateText({ payload, output, key, max, mode });
    if (issue) return issue;
  }
  if (entityType === 'world') {
    issue = validateText({ payload, output, key: 'worldRulesMarkdown', max: CONTENT_LIMITS.worldRulesMarkdown, mode });
    if (issue) return issue;
  }
  for (const key of entityType === 'character' ? ['coverImageUrl', 'avatarImageUrl'] : ['coverImageUrl']) {
    if (mode === 'patch' && !hasOwn(payload, key)) continue;
    output[key] = normalizeString(payload[key]);
  }
  issue = validateTags({ payload, output, mode });
  if (issue) return issue;
  issue = validateJsonFields({ entityType, payload, output, mode });
  if (issue) return issue;
  if (mode === 'create' && !hasOwn(output.promptProfileJson, 'imageSlots')) {
    output.promptProfileJson = { ...output.promptProfileJson, imageSlots: [] };
  }
  issue = validateImageSlots({ entityType, promptProfileJson: output.promptProfileJson || {} });
  if (issue) return issue;
  issue = validateAssets({ entityType, payload, output, mode });
  if (issue) return issue;

  if (mode === 'create' || hasOwn(payload, 'visibility')) {
    const visibility = normalizeString(payload.visibility || 'private');
    if (!['private', 'unlisted', 'public'].includes(visibility)) return invalid('INVALID_REQUEST_BODY', '공개 범위를 확인해주세요.', { field: 'visibility' });
    output.visibility = visibility;
  }
  if (mode === 'create' || hasOwn(payload, 'sourceType')) {
    const sourceType = normalizeString(payload.sourceType || 'original');
    if (!['original', 'derivative'].includes(sourceType)) return invalid('INVALID_REQUEST_BODY', '출처 유형을 확인해주세요.', { field: 'sourceType' });
    output.sourceType = sourceType;
  }
  if (mode === 'create' || hasOwn(payload, 'rightsConfirmed')) {
    if (hasOwn(payload, 'rightsConfirmed') && typeof payload.rightsConfirmed !== 'boolean') return invalid('INVALID_REQUEST_BODY', '권리 확인 값을 확인해주세요.', { field: 'rightsConfirmed' });
    output.rightsConfirmed = payload.rightsConfirmed === true;
  }
  if (mode === 'create' || hasOwn(payload, 'sourceUrl')) output.sourceUrl = normalizeString(payload.sourceUrl);

  const effective = { ...(existing || {}), ...output };
  if (effective.sourceType === 'derivative') {
    const normalizedSourceUrl = normalizeHttpsUrl(effective.sourceUrl);
    if (!normalizedSourceUrl || normalizedSourceUrl.length > CONTENT_LIMITS.sourceUrl) return invalid('INVALID_REQUEST_BODY', '2차 창작 출처는 HTTPS 주소로 입력해주세요.', { field: 'sourceUrl' });
    if (hasOwn(output, 'sourceUrl')) output.sourceUrl = normalizedSourceUrl;
  } else if (hasOwn(output, 'sourceUrl') && output.sourceUrl) {
    const normalizedSourceUrl = normalizeHttpsUrl(output.sourceUrl);
    if (!normalizedSourceUrl || normalizedSourceUrl.length > CONTENT_LIMITS.sourceUrl) return invalid('INVALID_REQUEST_BODY', '출처 주소를 확인해주세요.', { field: 'sourceUrl' });
    output.sourceUrl = normalizedSourceUrl;
  }

  if (effective.visibility === 'public') {
    const hasAttestation = output.rightsConfirmed === true || Boolean(existing?.rightsAttestedAt);
    if (!hasAttestation) return invalid('RIGHTS_ATTESTATION_REQUIRED', '공개하려면 콘텐츠 권리 보유를 확인해야 합니다.');
    if (!normalizeString(effective.coverImageUrl)) return invalid('INVALID_REQUEST_BODY', '공개 콘텐츠에는 대표 이미지가 필요합니다.', { field: 'coverImageUrl' });
  }

  if (mode === 'patch' && isSemanticNoopPatch({ entityType, output, existing })) {
    return invalid('INVALID_REQUEST_BODY', '변경할 콘텐츠를 입력해주세요.');
  }

  return valid(output);
};

export const getVariantContracts = () => VARIANT_CONTRACTS;
