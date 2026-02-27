import type { SupabaseClient } from "@supabase/supabase-js"
import { devError } from "@/lib/logger"

const runtimeEnv = (globalThis as { __V_MATE_RUNTIME_ENV__?: Record<string, string | undefined> })
  .__V_MATE_RUNTIME_ENV__ ?? {}

const resolveEnvValue = (...candidates: Array<string | undefined>) => {
  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim()
    if (normalized) {
      return normalized
    }
  }
  return ''
}

const supabaseUrl = resolveEnvValue(
  runtimeEnv.VITE_SUPABASE_URL,
  runtimeEnv.VITE_PUBLIC_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_PUBLIC_SUPABASE_URL,
)

const supabaseAnonKey = resolveEnvValue(
  runtimeEnv.VITE_SUPABASE_ANON_KEY,
  runtimeEnv.VITE_SUPABASE_PUBLISHABLE_KEY,
  runtimeEnv.VITE_PUBLIC_SUPABASE_ANON_KEY,
  runtimeEnv.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY,
  import.meta.env.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
)

const decodeBase64 = (value: string): string => {
  if (typeof atob === 'function') {
    return atob(value)
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'base64').toString('utf-8')
  }

  throw new Error('Base64 decoder is not available')
}

const parseJwtPayload = (token: string): Record<string, unknown> | null => {
  const parts = token.split('.')
  if (parts.length !== 3) {
    return null
  }

  const normalizedPayload = parts[1]
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(parts[1].length / 4) * 4, '=')

  try {
    const payload = JSON.parse(decodeBase64(normalizedPayload))
    return payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
  } catch {
    return null
  }
}

const isSecretKey = (key: string): boolean => {
  const normalizedKey = key.trim()

  if (!normalizedKey) {
    return false
  }

  if (normalizedKey.startsWith('sb_publishable_')) {
    return false
  }

  if (normalizedKey.startsWith('sb_secret_')) {
    return true
  }

  const payload = parseJwtPayload(normalizedKey)
  return payload?.role === 'service_role'
}

const supabaseKeyIsSecret = isSecretKey(supabaseAnonKey)
let hasWarnedSecretKey = false
let supabaseClientPromise: Promise<SupabaseClient | null> | null = null

const reportSupabaseConfigError = (...messages: string[]) => {
  for (const message of messages) {
    console.error(message)
  }
}

const warnSecretKeyMisconfiguration = () => {
  if (!supabaseAnonKey || !supabaseKeyIsSecret || hasWarnedSecretKey) {
    return
  }

  hasWarnedSecretKey = true
  reportSupabaseConfigError(
    "[V-MATE] ERROR: Service role key detected. Use anon public key instead.",
    "[V-MATE] Service role keys cannot be used in browser for security reasons.",
    "[V-MATE] Please set VITE_SUPABASE_ANON_KEY to the anon public key from Supabase dashboard.",
  )
}

export const isSupabaseConfigured = () => {
  return !!(supabaseUrl && supabaseAnonKey &&
    !supabaseKeyIsSecret)
}

export const resolveSupabaseClient = async (): Promise<SupabaseClient | null> => {
  if (!isSupabaseConfigured()) {
    warnSecretKeyMisconfiguration()
    return null
  }

  if (!supabaseClientPromise) {
    supabaseClientPromise = import("@supabase/supabase-js")
      .then(({ createClient }) => createClient(supabaseUrl, supabaseAnonKey))
      .catch((error) => {
        reportSupabaseConfigError("[V-MATE] Failed to initialize Supabase client.")
        devError("[V-MATE] Failed to initialize Supabase client:", error)
        supabaseClientPromise = null
        return null
      })
  }

  return supabaseClientPromise
}
