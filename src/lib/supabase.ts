import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

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

if (supabaseAnonKey && supabaseKeyIsSecret) {
  console.error('[V-MATE] ERROR: Service role key detected! Use anon public key instead.')
  console.error('[V-MATE] Service role keys cannot be used in browser for security reasons.')
  console.error('[V-MATE] Please set VITE_SUPABASE_ANON_KEY to the anon public key from Supabase dashboard.')
}

export const supabase = supabaseUrl && supabaseAnonKey && !supabaseKeyIsSecret
  ? createClient(supabaseUrl, supabaseAnonKey)
  : createClient('https://placeholder.supabase.co', 'placeholder-key')

export const isSupabaseConfigured = () => {
  return !!(supabaseUrl && supabaseAnonKey && 
    supabaseUrl !== 'https://placeholder.supabase.co' && 
    supabaseAnonKey !== 'placeholder-key' &&
    !supabaseKeyIsSecret)
}
