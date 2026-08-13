import type { Session, User } from '@supabase/supabase-js'
import { devError } from '@/lib/logger'

export type AuthSessionSnapshot =
  | { status: 'checking'; user: null; accessToken: null }
  | { status: 'authenticated'; user: User; accessToken: string }
  | { status: 'anonymous'; user: null; accessToken: null }
  | { status: 'unavailable'; user: null; accessToken: null }

let snapshot: AuthSessionSnapshot = { status: 'checking', user: null, accessToken: null }
let inFlight: Promise<AuthSessionSnapshot> | null = null
const listeners = new Set<(value: AuthSessionSnapshot) => void>()

const publish = (value: AuthSessionSnapshot) => {
  snapshot = value
  listeners.forEach((listener) => listener(value))
  return value
}

const fromSession = (session: Session | null): AuthSessionSnapshot => session?.user
  ? { status: 'authenticated', user: session.user, accessToken: session.access_token || '' }
  : { status: 'anonymous', user: null, accessToken: null }

export const loadAuthSession = async ({ force = false }: { force?: boolean } = {}): Promise<AuthSessionSnapshot> => {
  if (inFlight) return inFlight
  if (!force && snapshot.status !== 'checking') return snapshot
  publish({ status: 'checking', user: null, accessToken: null })
  inFlight = (async () => {
    try {
      const auth = await import('@/lib/supabase')
      if (!auth.isSupabaseConfigured()) return publish({ status: 'unavailable', user: null, accessToken: null })
      const client = await auth.resolveSupabaseClient()
      if (!client) return publish({ status: 'unavailable', user: null, accessToken: null })
      const { data, error } = await client.auth.getSession()
      if (error) throw error
      return publish(fromSession(data.session))
    } catch {
      devError('Failed to resolve authentication state.')
      return publish({ status: 'unavailable', user: null, accessToken: null })
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

export const observeAuthSession = async (
  listener: (value: AuthSessionSnapshot) => void,
  { force = false }: { force?: boolean } = {},
): Promise<() => void> => {
  listeners.add(listener)
  const current = await loadAuthSession({ force })
  listener(current)
  const auth = await import('@/lib/supabase')
  const client = auth.isSupabaseConfigured() ? await auth.resolveSupabaseClient() : null
  if (!client) return () => listeners.delete(listener)
  const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
    publish(fromSession(session))
  })
  return () => {
    listeners.delete(listener)
    subscription.unsubscribe()
  }
}

export const readAuthSessionSnapshot = () => snapshot
