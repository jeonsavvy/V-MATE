import { getStoredItem, removeStoredItem, setStoredItem } from "@/lib/browserStorage"

export const readPromptCache = (cacheKey: string): string | undefined => {
  const value = getStoredItem(cacheKey)
  return value?.trim() || undefined
}

export const writePromptCache = (cacheKey: string, cachedContent: string) => {
  setStoredItem(cacheKey, cachedContent)
}

export const removePromptCache = (cacheKey: string) => {
  removeStoredItem(cacheKey)
}
