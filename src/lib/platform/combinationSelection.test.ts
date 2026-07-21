import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearCombinationSelection,
  readCombinationSelection,
  writeCombinationSelection,
} from '@/lib/platform/combinationSelection'
import type { CharacterSummary, WorldSummary } from '@/lib/platform/types'

const baseEntity = {
  headline: '',
  summary: '',
  coverImageUrl: '',
  tags: [],
  creator: { id: 'creator-1', slug: 'creator', name: '제작자' },
  visibility: 'public' as const,
  displayStatus: 'visible' as const,
  sourceType: 'original',
  favoriteCount: 0,
  chatStartCount: 0,
  updatedAt: '2026-07-18T00:00:00.000Z',
}

const character: CharacterSummary = {
  ...baseEntity,
  id: 'character-1',
  entityType: 'character',
  slug: 'character-a',
  name: '캐릭터A',
  avatarImageUrl: '/starter/character-a.webp',
}

const world: WorldSummary = {
  ...baseEntity,
  id: 'world-1',
  entityType: 'world',
  slug: 'world-a',
  name: '월드A',
}

describe('combination selection session state', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('keeps exactly one character and one optional world in the browser session', () => {
    writeCombinationSelection({ character, world })
    expect(readCombinationSelection()).toEqual({ character, world })
  })

  it('clears after a room has been created', () => {
    writeCombinationSelection({ character, world })
    clearCombinationSelection()
    expect(readCombinationSelection()).toEqual({ character: null, world: null })
  })

  it('rejects malformed entity types from session storage', () => {
    window.sessionStorage.setItem('v-mate:combination-selection:v1', JSON.stringify({ character: world, world: character }))
    expect(readCombinationSelection()).toEqual({ character: null, world: null })
  })
})
