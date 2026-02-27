import { devWarn } from "@/lib/logger"

const STORAGE_KIND = "localStorage"

const resolveLocalStorage = (): Storage | null => {
  if (typeof window === "undefined") {
    return null
  }

  try {
    return window.localStorage
  } catch (error) {
    devWarn(`[V-MATE] ${STORAGE_KIND} is unavailable`, error)
    return null
  }
}

export const getStoredItem = (key: string): string | null => {
  const storage = resolveLocalStorage()
  if (!storage) {
    return null
  }

  try {
    return storage.getItem(key)
  } catch (error) {
    devWarn(`[V-MATE] Failed to read ${STORAGE_KIND} key: ${key}`, error)
    return null
  }
}

export const setStoredItem = (key: string, value: string) => {
  const storage = resolveLocalStorage()
  if (!storage) {
    return
  }

  try {
    storage.setItem(key, value)
  } catch (error) {
    devWarn(`[V-MATE] Failed to write ${STORAGE_KIND} key: ${key}`, error)
  }
}

export const removeStoredItem = (key: string) => {
  const storage = resolveLocalStorage()
  if (!storage) {
    return
  }

  try {
    storage.removeItem(key)
  } catch (error) {
    devWarn(`[V-MATE] Failed to remove ${STORAGE_KIND} key: ${key}`, error)
  }
}

export const getStoredKeys = (): string[] => {
  const storage = resolveLocalStorage()
  if (!storage) {
    return []
  }

  try {
    return Object.keys(storage)
  } catch (error) {
    devWarn(`[V-MATE] Failed to enumerate ${STORAGE_KIND} keys`, error)
    return []
  }
}
