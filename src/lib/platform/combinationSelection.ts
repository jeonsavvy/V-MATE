import type { CharacterSummary, WorldSummary } from '@/lib/platform/types'

const STORAGE_KEY = 'v-mate:combination-selection:v1'

export interface CombinationSelection {
  character: CharacterSummary | null
  world: WorldSummary | null
}

type StoredCombinationSelection = Partial<CombinationSelection> & { privateOwnerUserId?: string | null; userId?: string | null }

export const EMPTY_COMBINATION_SELECTION: CombinationSelection = {
  character: null,
  world: null,
}

const resolveSessionStorage = () => {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export const readCombinationSelection = (userId?: string | null): CombinationSelection => {
  const storage = resolveSessionStorage()
  if (!storage) return EMPTY_COMBINATION_SELECTION
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '{}') as StoredCombinationSelection
    const hasPrivateItem = parsed.character?.visibility === 'private' || parsed.world?.visibility === 'private'
    // v1 private selections had no owner binding: discard rather than carrying them across accounts.
    if (hasPrivateItem && (!parsed.privateOwnerUserId || parsed.privateOwnerUserId !== userId)) return EMPTY_COMBINATION_SELECTION
    return {
      character: parsed.character?.entityType === 'character' ? parsed.character : null,
      world: parsed.world?.entityType === 'world' ? parsed.world : null,
    }
  } catch {
    return EMPTY_COMBINATION_SELECTION
  }
}

export const writeCombinationSelection = (selection: CombinationSelection, userId?: string | null) => {
  const storage = resolveSessionStorage()
  if (!storage) return
  try {
    const character = selection.character?.visibility === 'private' && !userId ? null : selection.character
    const world = selection.world?.visibility === 'private' && !userId ? null : selection.world
    storage.setItem(STORAGE_KEY, JSON.stringify({ character, world, userId: userId || null, privateOwnerUserId: character?.visibility === 'private' || world?.visibility === 'private' ? userId : null }))
  } catch {
    // 선택 상태는 편의 기능이므로 저장 실패가 탐색을 막아서는 안 된다.
  }
}

export const clearCombinationSelection = () => {
  const storage = resolveSessionStorage()
  if (!storage) return
  try {
    storage.removeItem(STORAGE_KEY)
  } catch {
    // 선택 상태는 편의 기능이므로 저장 실패가 탐색을 막아서는 안 된다.
  }
}
