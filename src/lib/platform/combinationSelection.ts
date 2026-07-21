import type { CharacterSummary, WorldSummary } from '@/lib/platform/types'

const STORAGE_KEY = 'v-mate:combination-selection:v1'

export interface CombinationSelection {
  character: CharacterSummary | null
  world: WorldSummary | null
}

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

export const readCombinationSelection = (): CombinationSelection => {
  const storage = resolveSessionStorage()
  if (!storage) return EMPTY_COMBINATION_SELECTION
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '{}') as Partial<CombinationSelection>
    return {
      character: parsed.character?.entityType === 'character' ? parsed.character : null,
      world: parsed.world?.entityType === 'world' ? parsed.world : null,
    }
  } catch {
    return EMPTY_COMBINATION_SELECTION
  }
}

export const writeCombinationSelection = (selection: CombinationSelection) => {
  const storage = resolveSessionStorage()
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(selection))
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
