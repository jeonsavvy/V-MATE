import { devWarn } from "@/lib/logger"

const resolveWindowLocation = (): Location | null => {
  if (typeof window === "undefined") {
    return null
  }

  try {
    return window.location
  } catch (error) {
    devWarn("[V-MATE] window.location is unavailable", error)
    return null
  }
}

export const getBrowserOrigin = (): string => {
  const location = resolveWindowLocation()
  if (!location) {
    return ""
  }

  return String(location.origin || "").trim()
}

export const buildBrowserRedirectUrl = (pathname = "/"): string => {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`
  const origin = getBrowserOrigin()
  if (!origin) {
    return normalizedPath
  }

  return `${origin}${normalizedPath}`
}
