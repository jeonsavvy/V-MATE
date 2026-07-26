import { devWarn } from "@/lib/logger"

const STORAGE_KIND = "localStorage"

const resolveLocalStorage = (): Storage | null => {
  if (typeof window === "undefined") {
    return null
  }

  try {
    return window.localStorage
  } catch {
    devWarn(`[V-MATE] ${STORAGE_KIND} is unavailable`)
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
  } catch {
    devWarn(`[V-MATE] Failed to read ${STORAGE_KIND}`)
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
  } catch {
    devWarn(`[V-MATE] Failed to write ${STORAGE_KIND}`)
  }
}

export const removeStoredItem = (key: string) => {
  const storage = resolveLocalStorage()
  if (!storage) {
    return
  }

  try {
    storage.removeItem(key)
  } catch {
    devWarn(`[V-MATE] Failed to remove ${STORAGE_KIND} item`)
  }
}

export const getStoredKeys = (): string[] => {
  const storage = resolveLocalStorage()
  if (!storage) {
    return []
  }

  try {
    return Object.keys(storage)
  } catch {
    devWarn(`[V-MATE] Failed to enumerate ${STORAGE_KIND} keys`)
    return []
  }
}
