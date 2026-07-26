import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  resolveCanonicalAssetPath,
  validateContentAssetReferences,
  validateContentPayload,
  validateUploadVariants,
} from './input-contracts.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SUPABASE_URL = 'https://project.supabase.co';
const ownAssetUrl = (entityType = 'character', file = 'slot-main/detail.webp') =>
  `${SUPABASE_URL}/storage/v1/object/public/vmate-assets/${USER_ID}/${entityType}/1721971200000-a1b2c3d4/${file}`;

test('upload variant contract accepts exact slot dimensions only', () => {
  const valid = validateUploadVariants({
    entityType: 'character',
    variants: [
      { kind: 'slot-main:thumb', width: 300, height: 400 },
      { kind: 'slot-main:card', width: 600, height: 800 },
      { kind: 'slot-main:detail', width: 768, height: 1024 },
    ],
  });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.value?.[2], {
    slot: 'slot-main',
    variant: 'detail',
    kind: 'slot-main:detail',
    width: 768,
    height: 1024,
  });

  for (const variants of [
    [
      { kind: 'slot-main:thumb', width: 300, height: 400 },
      { kind: 'slot-main:card', width: 600, height: 800 },
      { kind: 'slot-main:detail', width: 769, height: 1024 },
    ],
    [
      { kind: '../foreign:thumb', width: 300, height: 400 },
      { kind: '../foreign:card', width: 600, height: 800 },
      { kind: '../foreign:detail', width: 768, height: 1024 },
    ],
    [
      { kind: 'slot-main:thumb', width: 300, height: 400 },
      { kind: 'slot-main:detail', width: 768, height: 1024 },
      { kind: 'slot-main:detail', width: 768, height: 1024 },
    ],
    [
      { kind: 'slot-main:thumb', width: 300, height: 400 },
      { kind: 'slot-main:card', width: 600, height: 800 },
    ],
  ]) {
    const result = validateUploadVariants({ entityType: 'character', variants });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'INVALID_UPLOAD_VARIANTS');
  }
});

test('upload variant contract caps content at six complete slots and eighteen variants', () => {
  const variants = Array.from({ length: 6 }, (_, index) => [
    { kind: `slot-${index}:thumb`, width: 320, height: 180 },
    { kind: `slot-${index}:card`, width: 640, height: 360 },
    { kind: `slot-${index}:hero`, width: 1280, height: 720 },
  ]).flat();
  assert.equal(validateUploadVariants({ entityType: 'world', variants }).ok, true);
  const result = validateUploadVariants({
    entityType: 'world',
    variants: [...variants, ...variants.slice(0, 3).map((item) => ({ ...item, kind: item.kind.replace('slot-0', 'slot-6') }))],
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'INVALID_UPLOAD_VARIANTS');
});

test('canonical asset paths require the configured origin, bucket, owner, and entity prefix', () => {
  const validUrl = ownAssetUrl();
  assert.equal(resolveCanonicalAssetPath({
    url: validUrl,
    userId: USER_ID,
    entityType: 'character',
    supabaseUrl: SUPABASE_URL,
    bucket: 'vmate-assets',
  }), `${USER_ID}/character/1721971200000-a1b2c3d4/slot-main/detail.webp`);

  for (const url of [
    validUrl.replace('project.supabase.co', 'evil.example'),
    validUrl.replace(USER_ID, '22222222-2222-4222-8222-222222222222'),
    validUrl.replace('/character/', '/world/'),
    validUrl.replace(`${USER_ID}/character`, `${USER_ID}/character/%2E%2E/world`),
    validUrl.replace('/slot-main/detail.webp', '/slot-main%2Fdetail.webp'),
    validUrl.replace('/slot-main/detail.webp', '/slot-main:detail.webp'),
    `${validUrl}?download=foreign`,
  ]) {
    assert.equal(resolveCanonicalAssetPath({
      url,
      userId: USER_ID,
      entityType: 'character',
      supabaseUrl: SUPABASE_URL,
      bucket: 'vmate-assets',
    }), null);
  }
});

test('asset references retain omitted legacy fields but require canonical URLs for explicit image changes', () => {
  const legacyUrl = 'https://legacy.example/old.webp';
  assert.equal(validateContentAssetReferences({
    payload: { avatarImageUrl: ownAssetUrl('character', 'slot-main/card.webp') },
    existingPayload: { coverImageUrl: legacyUrl },
    userId: USER_ID,
    entityType: 'character',
    supabaseUrl: SUPABASE_URL,
    bucket: 'vmate-assets',
  }).ok, true);

  for (const coverImageUrl of [legacyUrl, 'https://foreign.example/new.webp']) {
    const foreign = validateContentAssetReferences({
      payload: { coverImageUrl },
      existingPayload: { coverImageUrl: legacyUrl },
      userId: USER_ID,
      entityType: 'character',
      supabaseUrl: SUPABASE_URL,
      bucket: 'vmate-assets',
    });
    assert.equal(foreign.ok, false);
    assert.equal(foreign.errorCode, 'INVALID_ASSET_REFERENCE');
  }
});

test('content validation keeps PATCH partial and enforces publish, source, and JSON contracts', () => {
  const privateDraft = validateContentPayload({
    entityType: 'character',
    payload: { name: '이미지 없는 비공개 초안', visibility: 'private' },
  });
  assert.equal(privateDraft.ok, true);
  assert.equal(privateDraft.value.coverImageUrl, '');

  const patch = validateContentPayload({
    entityType: 'character',
    mode: 'patch',
    payload: { headline: '새 헤드라인' },
    existing: {
      name: '기존 이름',
      visibility: 'private',
      coverImageUrl: '',
    },
  });
  assert.equal(patch.ok, true);
  assert.deepEqual(patch.value, { headline: '새 헤드라인' });

  const missingRights = validateContentPayload({
    entityType: 'world',
    payload: {
      name: '월드',
      visibility: 'public',
      coverImageUrl: ownAssetUrl('world', 'slot-main/hero.webp'),
    },
  });
  assert.equal(missingRights.errorCode, 'RIGHTS_ATTESTATION_REQUIRED');

  const missingPublicCover = validateContentPayload({
    entityType: 'character',
    payload: { name: '대표 이미지 없는 공개 콘텐츠', visibility: 'public', rightsConfirmed: true },
  });
  assert.equal(missingPublicCover.errorCode, 'INVALID_REQUEST_BODY');
  assert.equal(missingPublicCover.details?.field, 'coverImageUrl');

  const invalidSource = validateContentPayload({
    entityType: 'world',
    payload: { name: '월드', sourceType: 'derivative', sourceUrl: 'http://insecure.example/source' },
  });
  assert.equal(invalidSource.errorCode, 'INVALID_REQUEST_BODY');

  const oversizedJson = validateContentPayload({
    entityType: 'character',
    payload: { name: '캐릭터', profileJson: { prompt: 'x'.repeat(17 * 1024) } },
  });
  assert.equal(oversizedJson.errorCode, 'INVALID_REQUEST_BODY');
});

test('content PATCH rejects empty and normalized semantic no-op payloads', () => {
  const existing = {
    name: '기존 이름',
    headline: '같은 헤드라인',
    summary: '기존 요약',
    tags: ['판타지'],
    visibility: 'private',
    sourceType: 'original',
    sourceUrl: '',
    coverImageUrl: '',
    creator: { name: '기존 제작자' },
    promptProfileJson: {
      masterPrompt: '동일한 프롬프트',
      creatorName: '기존 제작자',
      imageSlots: [{ id: 'legacy-main' }],
    },
  };

  for (const payload of [
    {},
    { headline: '  같은 헤드라인  ' },
    { tags: [' 판타지 ', '판타지'] },
    { promptProfileJson: {} },
    { promptProfileJson: { masterPrompt: '동일한 프롬프트' } },
    { creatorName: ' 기존 제작자 ' },
    { rightsConfirmed: true },
    { assets: [] },
  ]) {
    const result = validateContentPayload({ entityType: 'character', mode: 'patch', payload, existing });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'INVALID_REQUEST_BODY');
  }

  const changedPrompt = validateContentPayload({
    entityType: 'character',
    mode: 'patch',
    payload: { promptProfileJson: { masterPrompt: '변경된 프롬프트' } },
    existing,
  });
  assert.equal(changedPrompt.ok, true);
  assert.deepEqual(changedPrompt.value, { promptProfileJson: { masterPrompt: '변경된 프롬프트' } });
});

test('content asset lists require complete non-duplicated variant sets per slot', () => {
  const complete = [
    { kind: 'main:thumb', url: ownAssetUrl('character', 'main/thumb.webp'), width: 300, height: 400 },
    { kind: 'main:card', url: ownAssetUrl('character', 'main/card.webp'), width: 600, height: 800 },
    { kind: 'main:detail', url: ownAssetUrl('character', 'main/detail.webp'), width: 768, height: 1024 },
  ];
  assert.equal(validateContentPayload({
    entityType: 'character',
    payload: { name: '캐릭터', assets: complete },
  }).ok, true);

  for (const assets of [
    complete.slice(0, 2),
    [...complete, { ...complete[2] }],
    complete.map((asset, index) => index === 2 ? { ...asset, width: 767 } : asset),
  ]) {
    const result = validateContentPayload({ entityType: 'character', payload: { name: '캐릭터', assets } });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'INVALID_REQUEST_BODY');
  }
});

test('nested image slots are bounded, complete, and tied to matching canonical variants', () => {
  const imageSlots = [{
    id: 'main',
    slot: 'main',
    usage: '대표',
    trigger: '기본',
    priority: 100,
    thumbUrl: ownAssetUrl('character', 'main/thumb.webp'),
    cardUrl: ownAssetUrl('character', 'main/card.webp'),
    detailUrl: ownAssetUrl('character', 'main/detail.webp'),
  }];
  const payload = { name: '캐릭터', promptProfileJson: { imageSlots } };
  const validated = validateContentPayload({ entityType: 'character', payload });
  assert.equal(validated.ok, true);
  assert.equal(validateContentAssetReferences({
    payload: validated.value,
    userId: USER_ID,
    entityType: 'character',
    supabaseUrl: SUPABASE_URL,
    bucket: 'vmate-assets',
  }).ok, true);

  const incomplete = validateContentPayload({
    entityType: 'character',
    payload: { name: '캐릭터', promptProfileJson: { imageSlots: [{ ...imageSlots[0], cardUrl: '' }] } },
  });
  assert.equal(incomplete.errorCode, 'INVALID_REQUEST_BODY');

  const tooMany = validateContentPayload({
    entityType: 'character',
    payload: {
      name: '캐릭터',
      promptProfileJson: { imageSlots: Array.from({ length: 7 }, (_, index) => ({ id: `slot-${index}` })) },
    },
  });
  assert.equal(tooMany.errorCode, 'INVALID_REQUEST_BODY');

  const mismatched = validateContentAssetReferences({
    payload: {
      promptProfileJson: {
        imageSlots: [{ ...imageSlots[0], cardUrl: ownAssetUrl('character', 'other/card.webp') }],
      },
    },
    userId: USER_ID,
    entityType: 'character',
    supabaseUrl: SUPABASE_URL,
    bucket: 'vmate-assets',
  });
  assert.equal(mismatched.errorCode, 'INVALID_ASSET_REFERENCE');

  const mixedUpload = validateContentAssetReferences({
    payload: {
      promptProfileJson: {
        imageSlots: [{
          ...imageSlots[0],
          cardUrl: imageSlots[0].cardUrl.replace('1721971200000-a1b2c3d4', '1721971200001-ffffffff'),
        }],
      },
    },
    userId: USER_ID,
    entityType: 'character',
    supabaseUrl: SUPABASE_URL,
    bucket: 'vmate-assets',
  });
  assert.equal(mixedUpload.errorCode, 'INVALID_ASSET_REFERENCE');
});

test('world nested detailUrl is validated against the hero storage variant', () => {
  const payload = validateContentPayload({
    entityType: 'world',
    payload: {
      name: '월드',
      promptProfileJson: {
        imageSlots: [{
          id: 'main',
          thumbUrl: ownAssetUrl('world', 'main/thumb.webp'),
          cardUrl: ownAssetUrl('world', 'main/card.webp'),
          detailUrl: ownAssetUrl('world', 'main/hero.webp'),
        }],
      },
    },
  });
  assert.equal(payload.ok, true);
  assert.equal(validateContentAssetReferences({
    payload: payload.value,
    userId: USER_ID,
    entityType: 'world',
    supabaseUrl: SUPABASE_URL,
    bucket: 'vmate-assets',
  }).ok, true);
});
