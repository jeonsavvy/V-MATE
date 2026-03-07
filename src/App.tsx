import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import type { User } from '@supabase/supabase-js'
import { Toaster } from '@/components/ui/sonner'
import { devError } from '@/lib/logger'
import { getStoredKeys } from '@/lib/browserStorage'

const Home = lazy(() => import('@/components/Home').then((module) => ({ default: module.Home })))
const AuthDialog = lazy(() => import('@/components/AuthDialog').then((module) => ({ default: module.AuthDialog })))
const CharacterDetailPage = lazy(() => import('@/components/platform/Pages').then((module) => ({ default: module.CharacterDetailPage })))
const WorldDetailPage = lazy(() => import('@/components/platform/Pages').then((module) => ({ default: module.WorldDetailPage })))
const StartCharacterPage = lazy(() => import('@/components/platform/Pages').then((module) => ({ default: module.StartCharacterPage })))
const StartWorldPage = lazy(() => import('@/components/platform/Pages').then((module) => ({ default: module.StartWorldPage })))
const RoomPage = lazy(() => import('@/components/platform/Pages').then((module) => ({ default: module.RoomPage })))
const CreateCharacterPage = lazy(() => import('@/components/platform/Pages').then((module) => ({ default: module.CreateCharacterPage })))
const CreateWorldPage = lazy(() => import('@/components/platform/Pages').then((module) => ({ default: module.CreateWorldPage })))
const RecentRoomsPage = lazy(() => import('@/components/platform/Pages').then((module) => ({ default: module.RecentRoomsPage })))
const LibraryPage = lazy(() => import('@/components/platform/Pages').then((module) => ({ default: module.LibraryPage })))
const OpsPage = lazy(() => import('@/components/platform/Pages').then((module) => ({ default: module.OpsPage })))

type RouteState =
  | { view: 'home' }
  | { view: 'character'; slug: string }
  | { view: 'world'; slug: string }
  | { view: 'startCharacter'; slug: string }
  | { view: 'startWorld'; slug: string }
  | { view: 'room'; roomId: string }
  | { view: 'createCharacter' }
  | { view: 'createWorld' }
  | { view: 'recent' }
  | { view: 'library' }
  | { view: 'ops' }

const normalizePathname = (pathname: string) => {
  if (!pathname || pathname === '/') return '/'
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

const parseRouteFromPathname = (pathname: string): RouteState => {
  const normalizedPath = normalizePathname(pathname)
  const segments = normalizedPath.split('/').filter(Boolean)
  if (segments.length === 0) return { view: 'home' }
  if (segments[0] === 'characters' && segments[1]) return { view: 'character', slug: segments[1] }
  if (segments[0] === 'worlds' && segments[1]) return { view: 'world', slug: segments[1] }
  if (segments[0] === 'start' && segments[1] === 'character' && segments[2]) return { view: 'startCharacter', slug: segments[2] }
  if (segments[0] === 'start' && segments[1] === 'world' && segments[2]) return { view: 'startWorld', slug: segments[2] }
  if (segments[0] === 'rooms' && segments[1]) return { view: 'room', roomId: segments[1] }
  if (segments[0] === 'create' && segments[1] === 'character') return { view: 'createCharacter' }
  if (segments[0] === 'create' && segments[1] === 'world') return { view: 'createWorld' }
  if (segments[0] === 'recent') return { view: 'recent' }
  if (segments[0] === 'library') return { view: 'library' }
  if (segments[0] === 'ops') return { view: 'ops' }
  if (segments[0] === 'chat' && segments[1]) return { view: 'startCharacter', slug: segments[1] }
  return { view: 'home' }
}

const toPathname = (route: RouteState) => {
  switch (route.view) {
    case 'home':
      return '/'
    case 'character':
      return `/characters/${route.slug}`
    case 'world':
      return `/worlds/${route.slug}`
    case 'startCharacter':
      return `/start/character/${route.slug}`
    case 'startWorld':
      return `/start/world/${route.slug}`
    case 'room':
      return `/rooms/${route.roomId}`
    case 'createCharacter':
      return '/create/character'
    case 'createWorld':
      return '/create/world'
    case 'recent':
      return '/recent'
    case 'library':
      return '/library'
    case 'ops':
      return '/ops'
    default:
      return '/'
  }
}

const resolveInitialRoute = (): RouteState => {
  if (typeof window === 'undefined') return { view: 'home' }
  return parseRouteFromPathname(window.location.pathname)
}

const hasPersistedSupabaseSession = (): boolean => {
  if (typeof window === 'undefined') return false
  return getStoredKeys().some((key) => key.startsWith('sb-') && key.endsWith('-auth-token'))
}

const PageFallback = () => (
  <div className="flex min-h-dvh items-center justify-center bg-[#15171b] px-6 text-center">
    <div className="space-y-3 rounded-[2rem] border border-white/10 bg-[#20242b] px-8 py-7 text-white shadow-[0_20px_80px_-50px_rgba(0,0,0,0.8)]">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-white/42">V-MATE</p>
      <p className="text-[clamp(1.5rem,3vw,2rem)] font-semibold tracking-[-0.03em]">화면을 준비하는 중</p>
      <p className="text-sm text-white/56">캐릭터와 월드를 불러오고 있어요.</p>
    </div>
  </div>
)

const toAvatarInitial = (user: User | null) => {
  const candidate = String(user?.user_metadata?.name || user?.email || 'V').trim()
  return candidate ? candidate[0].toUpperCase() : 'V'
}

function App() {
  const [route, setRoute] = useState<RouteState>(resolveInitialRoute)
  const [user, setUser] = useState<User | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false)
  const [shouldInitializeAuth, setShouldInitializeAuth] = useState<boolean>(hasPersistedSupabaseSession)

  useEffect(() => {
    const handlePopState = () => setRoute(parseRouteFromPathname(window.location.pathname))
    const initialRoute = parseRouteFromPathname(window.location.pathname)
    const normalizedPath = toPathname(initialRoute)
    if (window.location.pathname !== normalizedPath) {
      window.history.replaceState({}, '', normalizedPath)
    }
    setRoute(initialRoute)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (!shouldInitializeAuth) return

    let mounted = true
    let unsubscribe: (() => void) | null = null
    const bindAuthListener = async () => {
      const module = await import('@/lib/supabase')
      if (!module.isSupabaseConfigured()) {
        return
      }
      const supabase = await module.resolveSupabaseClient()
      if (!supabase) return
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (mounted) setUser(session?.user ?? null)
      } catch (error) {
        devError('Failed to get session:', error)
      }
      try {
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
          if (mounted) setUser(session?.user ?? null)
        })
        unsubscribe = () => subscription.unsubscribe()
      } catch (error) {
        devError('Failed to set up auth state change listener:', error)
      }
    }
    void bindAuthListener()
    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [shouldInitializeAuth])

  const navigateTo = (nextRoute: RouteState, options?: { replace?: boolean }) => {
    const nextPath = toPathname(nextRoute)
    const currentPath = normalizePathname(window.location.pathname)
    if (currentPath !== nextPath) {
      if (options?.replace) {
        window.history.replaceState({}, '', nextPath)
      } else {
        window.history.pushState({}, '', nextPath)
      }
    }
    setRoute(nextRoute)
  }

  const openAuthDialog = () => {
    setShouldInitializeAuth(true)
    setIsAuthDialogOpen(true)
  }

  const handleSignOut = async () => {
    const supabaseModule = await import('@/lib/supabase')
    if (!supabaseModule.isSupabaseConfigured()) return
    const supabase = await supabaseModule.resolveSupabaseClient()
    if (!supabase) return
    try {
      await supabase.auth.signOut()
      setUser(null)
      navigateTo({ view: 'home' }, { replace: true })
    } catch (error) {
      devError('Sign out error:', error)
    }
  }

  const chrome = useMemo(() => ({
    user,
    userAvatarInitial: toAvatarInitial(user),
    searchQuery,
    onSearchChange: setSearchQuery,
    onNavigate: (path: string) => navigateTo(parseRouteFromPathname(path)),
    onAuthRequest: openAuthDialog,
    onSignOut: handleSignOut,
  }), [user, searchQuery])

  const routeKey = route.view === 'room' ? `room-${route.roomId}` : route.view === 'character' ? `character-${route.slug}` : route.view === 'world' ? `world-${route.slug}` : route.view === 'startCharacter' ? `start-character-${route.slug}` : route.view === 'startWorld' ? `start-world-${route.slug}` : route.view

  return (
    <MotionConfig transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
      <div className="relative min-h-dvh w-full overflow-x-hidden bg-[#15171b]">
        <Suspense fallback={<PageFallback />}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={routeKey} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="relative">
              {route.view === 'home' && <Home {...chrome} />}
              {route.view === 'character' && <CharacterDetailPage chrome={chrome} slug={route.slug} />}
              {route.view === 'world' && <WorldDetailPage chrome={chrome} slug={route.slug} />}
              {route.view === 'startCharacter' && <StartCharacterPage chrome={chrome} slug={route.slug} />}
              {route.view === 'startWorld' && <StartWorldPage chrome={chrome} slug={route.slug} />}
              {route.view === 'room' && <RoomPage chrome={chrome} roomId={route.roomId} />}
              {route.view === 'createCharacter' && <CreateCharacterPage chrome={chrome} />}
              {route.view === 'createWorld' && <CreateWorldPage chrome={chrome} />}
              {route.view === 'recent' && <RecentRoomsPage chrome={chrome} />}
              {route.view === 'library' && <LibraryPage chrome={chrome} />}
              {route.view === 'ops' && <OpsPage chrome={chrome} />}
            </motion.div>
          </AnimatePresence>
        </Suspense>

        {isAuthDialogOpen && (
          <Suspense fallback={null}>
            <AuthDialog open={isAuthDialogOpen} onOpenChange={setIsAuthDialogOpen} onSuccess={() => setIsAuthDialogOpen(false)} />
          </Suspense>
        )}
        <Toaster />
      </div>
    </MotionConfig>
  )
}

export default App
