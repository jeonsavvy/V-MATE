import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import type { User } from '@supabase/supabase-js'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { devError } from '@/lib/logger'
import { getStoredKeys } from '@/lib/browserStorage'
import type { CharacterSummary, EntitySummary, WorldSummary } from '@/lib/platform/types'
import {
  clearCombinationSelection,
  readCombinationSelection,
  writeCombinationSelection,
} from '@/lib/platform/combinationSelection'

// 외부 라우터 없이 pathname 기반 상태 머신과 lazy page 분할을 같이 관리한다.
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
const PrivacyPage = lazy(() => import('@/components/PrivacyPage').then((module) => ({ default: module.PrivacyPage })))

type RouteState =
  | { view: 'home' }
  | { view: 'character'; slug: string }
  | { view: 'world'; slug: string }
  | { view: 'startCharacter'; slug: string }
  | { view: 'startWorld'; slug: string }
  | { view: 'room'; roomId: string }
  | { view: 'createCharacter' }
  | { view: 'createWorld' }
  | { view: 'editCharacter'; slug: string }
  | { view: 'editWorld'; slug: string }
  | { view: 'recent' }
  | { view: 'library' }
  | { view: 'ops' }
  | { view: 'privacy' }

const normalizePathname = (pathname: string) => {
  if (!pathname || pathname === '/') return '/'
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

// 화면 구조가 route 타입 하나에 모이도록 URL 해석과 URL 생성 규칙을 같은 파일에서 유지한다.
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
  if (segments[0] === 'edit' && segments[1] === 'character' && segments[2]) return { view: 'editCharacter', slug: segments[2] }
  if (segments[0] === 'edit' && segments[1] === 'world' && segments[2]) return { view: 'editWorld', slug: segments[2] }
  if (segments[0] === 'recent') return { view: 'recent' }
  if (segments[0] === 'library') return { view: 'library' }
  if (segments[0] === 'ops') return { view: 'ops' }
  if (segments[0] === 'privacy') return { view: 'privacy' }
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
    case 'editCharacter':
      return `/edit/character/${route.slug}`
    case 'editWorld':
      return `/edit/world/${route.slug}`
    case 'recent':
      return '/recent'
    case 'library':
      return '/library'
    case 'ops':
      return '/ops'
    case 'privacy':
      return '/privacy'
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
  <div className="flex min-h-dvh items-center justify-center bg-[#ffffff] px-6 text-center">
    <div className="space-y-3 rounded-xl border border-[#e7e7e7] bg-white px-8 py-7 text-[#171717] shadow-[0_18px_55px_-36px_rgba(49,27,34,0.3)]">
      <p className="text-[0.7rem] font-bold uppercase tracking-[0.22em] text-[#ff5148]">V-MATE</p>
      <p className="text-[clamp(1.5rem,3vw,2rem)] font-semibold tracking-[-0.03em]">화면을 준비하는 중</p>
      <p className="text-sm text-[#756d69]">캐릭터와 월드를 불러오고 있어요.</p>
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
  const initialSelection = useMemo(readCombinationSelection, [])
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterSummary | null>(initialSelection.character)
  const [selectedWorld, setSelectedWorld] = useState<WorldSummary | null>(initialSelection.world)
  const [isStartingCombination, setIsStartingCombination] = useState(false)

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
    // 세션 흔적이 있는 경우에만 Supabase를 지연 초기화해 첫 진입 비용을 줄인다.
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
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
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

  const handleDeleteAccount = async () => {
    const { platformApi } = await import('@/lib/platform/apiClient')
    await platformApi.deleteAccount()
    const supabaseModule = await import('@/lib/supabase')
    if (supabaseModule.isSupabaseConfigured()) {
      const supabase = await supabaseModule.resolveSupabaseClient()
      await supabase?.auth.signOut().catch((error) => {
        devError('Sign out after account deletion failed:', error)
      })
    }
    setUser(null)
    navigateTo({ view: 'home' }, { replace: true })
  }

  useEffect(() => {
    writeCombinationSelection({ character: selectedCharacter, world: selectedWorld })
  }, [selectedCharacter, selectedWorld])

  const handleSelectEntity = (item: EntitySummary) => {
    if (item.entityType === 'character') {
      setSelectedCharacter(item as CharacterSummary)
      toast.success(`${item.name}을(를) 선택했습니다.`)
      return
    }
    setSelectedWorld(item as WorldSummary)
    toast.success(`${item.name} 월드를 선택했습니다.`)
  }

  const handleClearSelectedEntity = (entityType: 'character' | 'world') => {
    if (entityType === 'character') setSelectedCharacter(null)
    else setSelectedWorld(null)
  }

  const handleStartCombination = async () => {
    if (!selectedCharacter) {
      toast.error('먼저 대화할 캐릭터를 선택해주세요.')
      return
    }
    if (!user) {
      openAuthDialog()
      return
    }
    setIsStartingCombination(true)
    try {
      const { platformApi } = await import('@/lib/platform/apiClient')
      const { room } = await platformApi.createRoom({
        characterSlug: selectedCharacter.slug,
        worldSlug: selectedWorld?.slug || null,
        userAlias: '나',
      })
      setSelectedCharacter(null)
      setSelectedWorld(null)
      clearCombinationSelection()
      navigateTo({ view: 'room', roomId: room.id })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '대화방을 만들지 못했습니다.')
    } finally {
      setIsStartingCombination(false)
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
    onDeleteAccount: handleDeleteAccount,
    selectedCharacter,
    selectedWorld,
    isStartingCombination,
    onSelectEntity: handleSelectEntity,
    onClearSelectedEntity: handleClearSelectedEntity,
    onStartCombination: handleStartCombination,
  }), [user, searchQuery, selectedCharacter, selectedWorld, isStartingCombination])

  const routeKey = route.view === 'room' ? `room-${route.roomId}` : route.view === 'character' ? `character-${route.slug}` : route.view === 'world' ? `world-${route.slug}` : route.view === 'startCharacter' ? `start-character-${route.slug}` : route.view === 'startWorld' ? `start-world-${route.slug}` : route.view

  return (
    <MotionConfig transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
      <div className="relative min-h-dvh w-full overflow-x-hidden bg-[#ffffff]">
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
              {route.view === 'editCharacter' && <CreateCharacterPage chrome={chrome} slug={route.slug} />}
              {route.view === 'editWorld' && <CreateWorldPage chrome={chrome} slug={route.slug} />}
              {route.view === 'recent' && <RecentRoomsPage chrome={chrome} />}
              {route.view === 'library' && <LibraryPage chrome={chrome} />}
              {route.view === 'ops' && <OpsPage chrome={chrome} />}
              {route.view === 'privacy' && <PrivacyPage chrome={chrome} />}
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
