import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import type { User } from '@supabase/supabase-js'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { devError } from '@/lib/logger'
import { getStoredKeys } from '@/lib/browserStorage'
import { UnsavedChangesDialog } from '@/components/platform/UnsavedChangesDialog'
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
const PasswordRecoveryPage = lazy(() => import('@/components/PasswordRecoveryPage').then((module) => ({ default: module.PasswordRecoveryPage })))

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
  | { view: 'recovery' }

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
  if (segments[0] === 'auth' && segments[1] === 'recovery') return { view: 'recovery' }
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
    case 'recovery':
      return '/auth/recovery'
    default:
      return '/'
  }
}

const resolveInitialRoute = (): RouteState => {
  if (typeof window === 'undefined') return { view: 'home' }
  return parseRouteFromPathname(window.location.pathname)
}

const resolveSearchQuery = () => {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('search') || ''
}

const HISTORY_INDEX_KEY = '__vMateHistoryIndex'

interface PendingHistoryNavigation {
  targetUrl: string
  targetIndex: number | null
  restoreDelta: number
  isReady: boolean
}

interface DeferredNavigation {
  nextRoute: RouteState
  options?: { replace?: boolean; search?: string }
}

const resolveCurrentUrl = () => typeof window === 'undefined'
  ? '/'
  : `${normalizePathname(window.location.pathname)}${window.location.search}${window.location.hash}`

const readHistoryIndex = (state: unknown): number | null => {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null
  const value = (state as Record<string, unknown>)[HISTORY_INDEX_KEY]
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

const withHistoryIndex = (state: unknown, index: number) => ({
  ...(state && typeof state === 'object' && !Array.isArray(state) ? state : {}),
  [HISTORY_INDEX_KEY]: index,
})

const hasPersistedSupabaseSession = (): boolean => {
  if (typeof window === 'undefined') return false
  return getStoredKeys().some((key) => key.startsWith('sb-') && key.endsWith('-auth-token'))
}

const PageFallback = () => (
  <div className="flex min-h-dvh items-center justify-center bg-[#ffffff] px-6 text-center">
    <p role="status" className="text-sm text-[#6f6f6f]">화면 불러오는 중…</p>
  </div>
)

const toAvatarInitial = (user: User | null) => {
  const candidate = String(user?.user_metadata?.name || user?.email || 'V').trim()
  return candidate ? candidate[0].toUpperCase() : 'V'
}

function App() {
  const [route, setRoute] = useState<RouteState>(resolveInitialRoute)
  const [user, setUser] = useState<User | null>(null)
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'anonymous' | 'unavailable'>(() => hasPersistedSupabaseSession() || resolveInitialRoute().view === 'recovery' ? 'checking' : 'anonymous')
  const [searchQuery, setSearchQuery] = useState(resolveSearchQuery)
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false)
  const [authDialogMode, setAuthDialogMode] = useState<'signin' | 'reset'>('signin')
  const [shouldInitializeAuth, setShouldInitializeAuth] = useState<boolean>(() => hasPersistedSupabaseSession() || resolveInitialRoute().view === 'recovery')
  const [authRetryNonce, setAuthRetryNonce] = useState(0)
  const initialSelection = useMemo(() => readCombinationSelection(), [])
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterSummary | null>(initialSelection.character)
  const [selectedWorld, setSelectedWorld] = useState<WorldSummary | null>(initialSelection.world)
  const [isStartingCombination, setIsStartingCombination] = useState(false)
  const [selectionHydratedScope, setSelectionHydratedScope] = useState<string | null>(null)
  const [pendingHistoryNavigation, setPendingHistoryNavigation] = useState<PendingHistoryNavigation | null>(null)
  const authenticatedUserIdRef = useRef<string | null>(null)
  const editorDirtyRef = useRef(false)
  const historyIndexRef = useRef(0)
  const committedUrlRef = useRef(resolveCurrentUrl())
  const pendingHistoryNavigationRef = useRef<PendingHistoryNavigation | null>(null)
  const approvedHistoryNavigationRef = useRef<PendingHistoryNavigation | null>(null)
  const deferredNavigationRef = useRef<DeferredNavigation | null>(null)
  const navigateToRef = useRef<(nextRoute: RouteState, options?: DeferredNavigation['options']) => void>(() => undefined)
  const isConfirmingHistoryNavigationRef = useRef(false)
  const navigationGenerationRef = useRef(0)
  const combinationSelectionScope = authStatus === 'authenticated' && user?.id
    ? `user:${user.id}`
    : authStatus === 'anonymous'
      ? 'anonymous'
      : null

  useEffect(() => {
    const markPendingHistoryNavigationReady = () => {
      const pendingNavigation = pendingHistoryNavigationRef.current
      if (!pendingNavigation || pendingNavigation.isReady) return
      const readyNavigation = { ...pendingNavigation, isReady: true }
      pendingHistoryNavigationRef.current = readyNavigation
      setPendingHistoryNavigation(readyNavigation)
    }

    const restoreCommittedHistoryEntry = (targetIndex: number | null) => {
      const restoreDelta = targetIndex === null ? 0 : historyIndexRef.current - targetIndex
      if (restoreDelta !== 0) {
        const pendingNavigation = pendingHistoryNavigationRef.current
        if (pendingNavigation?.isReady) {
          const restoringNavigation = { ...pendingNavigation, isReady: false }
          pendingHistoryNavigationRef.current = restoringNavigation
          setPendingHistoryNavigation(restoringNavigation)
        }
        window.history.go(restoreDelta)
        return
      }
      window.history.pushState(withHistoryIndex(window.history.state, historyIndexRef.current), '', committedUrlRef.current)
      markPendingHistoryNavigationReady()
    }

    const traverseApprovedHistoryNavigation = (approvedNavigation: PendingHistoryNavigation) => {
      const targetDelta = approvedNavigation.targetIndex === null
        ? null
        : approvedNavigation.targetIndex - historyIndexRef.current
      if (targetDelta !== null && targetDelta !== 0) window.history.go(targetDelta)
      else window.history.back()
    }

    const handlePopState = (event: PopStateEvent) => {
      const targetUrl = resolveCurrentUrl()
      const targetIndex = readHistoryIndex(event.state)
      const approvedNavigation = approvedHistoryNavigationRef.current
      if (approvedNavigation
        && targetUrl === approvedNavigation.targetUrl
        && (approvedNavigation.targetIndex === null || targetIndex === approvedNavigation.targetIndex)) {
        approvedHistoryNavigationRef.current = null
        isConfirmingHistoryNavigationRef.current = false
        if (targetIndex !== null) historyIndexRef.current = targetIndex
        committedUrlRef.current = targetUrl
        setRoute(parseRouteFromPathname(window.location.pathname))
        setSearchQuery(resolveSearchQuery())
        return
      }
      if (targetUrl === committedUrlRef.current) {
        if (targetIndex !== null) historyIndexRef.current = targetIndex
        const deferredNavigation = deferredNavigationRef.current
        if (deferredNavigation) {
          deferredNavigationRef.current = null
          pendingHistoryNavigationRef.current = null
          setPendingHistoryNavigation(null)
          navigateToRef.current(deferredNavigation.nextRoute, deferredNavigation.options)
        } else if (approvedNavigation) traverseApprovedHistoryNavigation(approvedNavigation)
        else markPendingHistoryNavigationReady()
        return
      }
      if (pendingHistoryNavigationRef.current || approvedHistoryNavigationRef.current) {
        restoreCommittedHistoryEntry(targetIndex)
        return
      }
      if (editorDirtyRef.current) {
        const restoreDelta = targetIndex === null ? 0 : historyIndexRef.current - targetIndex
        const pendingNavigation: PendingHistoryNavigation = {
          targetUrl,
          targetIndex,
          restoreDelta,
          isReady: restoreDelta === 0,
        }
        pendingHistoryNavigationRef.current = pendingNavigation
        setPendingHistoryNavigation(pendingNavigation)
        restoreCommittedHistoryEntry(targetIndex)
        return
      }
      editorDirtyRef.current = false
      navigationGenerationRef.current += 1
      if (targetIndex !== null) historyIndexRef.current = targetIndex
      committedUrlRef.current = targetUrl
      setRoute(parseRouteFromPathname(window.location.pathname))
      setSearchQuery(resolveSearchQuery())
    }
    const initialRoute = parseRouteFromPathname(window.location.pathname)
    const normalizedPath = toPathname(initialRoute)
    const initialUrl = `${normalizedPath}${window.location.search}${window.location.hash}`
    const initialIndex = readHistoryIndex(window.history.state) ?? 0
    historyIndexRef.current = initialIndex
    window.history.replaceState(withHistoryIndex(window.history.state, initialIndex), '', initialUrl)
    committedUrlRef.current = initialUrl
    setRoute(initialRoute)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const cancelHistoryNavigation = () => {
    if (isConfirmingHistoryNavigationRef.current) return
    pendingHistoryNavigationRef.current = null
    setPendingHistoryNavigation(null)
  }

  const confirmHistoryNavigation = () => {
    const pendingNavigation = pendingHistoryNavigationRef.current
    if (!pendingNavigation?.isReady || isConfirmingHistoryNavigationRef.current) return
    isConfirmingHistoryNavigationRef.current = true
    pendingHistoryNavigationRef.current = null
    approvedHistoryNavigationRef.current = pendingNavigation
    setPendingHistoryNavigation(null)
    editorDirtyRef.current = false
    navigationGenerationRef.current += 1
    if (pendingNavigation.restoreDelta !== 0) {
      window.history.go(-pendingNavigation.restoreDelta)
    } else {
      window.history.back()
    }
  }

  useEffect(() => {
    if (!shouldInitializeAuth) return

    let mounted = true
    let unsubscribe: (() => void) | null = null
    // 세션 흔적이 있는 경우에만 Supabase를 지연 초기화해 첫 진입 비용을 줄인다.
    const bindAuthListener = async () => {
      const module = await import('@/lib/supabase')
      if (!module.isSupabaseConfigured()) {
        if (mounted) setAuthStatus('unavailable')
        return
      }
      const supabase = await module.resolveSupabaseClient()
      if (!supabase) { if (mounted) setAuthStatus('unavailable'); return }
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (mounted) { authenticatedUserIdRef.current = session?.user?.id ?? null; setUser(session?.user ?? null); setAuthStatus(session?.user ? 'authenticated' : 'anonymous') }
      } catch {
        devError('Failed to resolve authentication state.')
        if (mounted) setAuthStatus('unavailable')
      }
      try {
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
          if (mounted) {
            const nextUserId = session?.user?.id ?? null
            if (authenticatedUserIdRef.current && authenticatedUserIdRef.current !== nextUserId) {
              clearCombinationSelection()
              setSelectedCharacter((current) => current?.visibility === 'private' ? null : current)
              setSelectedWorld((current) => current?.visibility === 'private' ? null : current)
            }
            authenticatedUserIdRef.current = nextUserId
            setUser(session?.user ?? null); setAuthStatus(session?.user ? 'authenticated' : 'anonymous')
          }
        })
        unsubscribe = () => subscription.unsubscribe()
      } catch {
        devError('Failed to observe authentication state.')
      }
    }
    void bindAuthListener()
    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [shouldInitializeAuth, authRetryNonce])

  const navigateTo = (nextRoute: RouteState, options?: { replace?: boolean; search?: string }) => {
    const nextPath = toPathname(nextRoute)
    const nextUrl = `${nextPath}${options?.search || ''}`
    const nextSearchQuery = nextRoute.view === 'home'
      ? new URLSearchParams(options?.search || '').get('search') || ''
      : null
    const pendingHistoryNavigation = pendingHistoryNavigationRef.current
    if (pendingHistoryNavigation && !pendingHistoryNavigation.isReady) {
      deferredNavigationRef.current = { nextRoute, options }
      setPendingHistoryNavigation(null)
      return
    }
    if (pendingHistoryNavigationRef.current?.isReady) {
      pendingHistoryNavigationRef.current = null
      setPendingHistoryNavigation(null)
    }
    const currentUrl = resolveCurrentUrl()
    if (currentUrl === nextUrl) {
      if (nextSearchQuery !== null) setSearchQuery(nextSearchQuery)
      return
    }
    const nextIndex = options?.replace ? historyIndexRef.current : historyIndexRef.current + 1
    if (options?.replace) {
      window.history.replaceState(withHistoryIndex(window.history.state, nextIndex), '', nextUrl)
    } else {
      window.history.pushState(withHistoryIndex({}, nextIndex), '', nextUrl)
    }
    historyIndexRef.current = nextIndex
    committedUrlRef.current = nextUrl
    editorDirtyRef.current = false
    navigationGenerationRef.current += 1
    if (nextSearchQuery !== null) setSearchQuery(nextSearchQuery)
    setRoute(nextRoute)
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }
  navigateToRef.current = navigateTo

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    if (route.view !== 'home') return
    const normalized = value.trim()
    const nextUrl = normalized ? `/?search=${encodeURIComponent(normalized)}` : '/'
    window.history.replaceState(withHistoryIndex(window.history.state, historyIndexRef.current), '', nextUrl)
    committedUrlRef.current = nextUrl
  }

  const handleSearchSubmit = (value: string) => {
    const normalized = value.trim()
    setSearchQuery(normalized)
    navigateTo({ view: 'home' }, { search: normalized ? `?search=${encodeURIComponent(normalized)}` : '' })
  }

  const prepareAuthDialog = () => {
    setShouldInitializeAuth(true)
    if (authStatus === 'unavailable') {
      setAuthStatus('checking')
      setAuthRetryNonce((current) => current + 1)
    }
  }

  const openAuthDialog = () => {
    prepareAuthDialog()
    setAuthDialogMode('signin')
    setIsAuthDialogOpen(true)
  }

  const openPasswordResetDialog = () => {
    prepareAuthDialog()
    setAuthDialogMode('reset')
    setIsAuthDialogOpen(true)
  }

  const handleSignOut = async () => {
    const supabaseModule = await import('@/lib/supabase')
    if (!supabaseModule.isSupabaseConfigured()) throw new Error('AUTH_UNAVAILABLE')
    const supabase = await supabaseModule.resolveSupabaseClient()
    if (!supabase) throw new Error('AUTH_UNAVAILABLE')
    try {
      await supabase.auth.signOut()
      setUser(null)
      setSelectedCharacter(null)
      setSelectedWorld(null)
      clearCombinationSelection()
      setAuthStatus('anonymous')
      navigateTo({ view: 'home' }, { replace: true })
    } catch {
      devError('Sign out failed.')
      throw new Error('AUTH_SIGN_OUT_FAILED')
    }
  }

  const handleDeleteAccount = async () => {
    const { platformApi } = await import('@/lib/platform/apiClient')
    await platformApi.deleteAccount()
    const supabaseModule = await import('@/lib/supabase')
    if (supabaseModule.isSupabaseConfigured()) {
      const supabase = await supabaseModule.resolveSupabaseClient()
      await supabase?.auth.signOut().catch(() => {
        devError('Post-deletion local sign out failed.')
      })
    }
    setUser(null)
    setSelectedCharacter(null)
    setSelectedWorld(null)
    clearCombinationSelection()
    setAuthStatus('anonymous')
    navigateTo({ view: 'home' }, { replace: true })
  }

  useEffect(() => {
    if (!combinationSelectionScope) {
      setSelectionHydratedScope(null)
      return
    }
    const stored = readCombinationSelection(user?.id)
    setSelectedCharacter((current) => {
      if (!stored.character && current?.visibility === 'private') return null
      return current || stored.character
    })
    setSelectedWorld((current) => {
      if (!stored.world && current?.visibility === 'private') return null
      return current || stored.world
    })
    setSelectionHydratedScope(combinationSelectionScope)
  }, [combinationSelectionScope, user?.id])

  useEffect(() => {
    if (!combinationSelectionScope || selectionHydratedScope !== combinationSelectionScope) return
    writeCombinationSelection({ character: selectedCharacter, world: selectedWorld }, user?.id)
  }, [combinationSelectionScope, selectionHydratedScope, selectedCharacter, selectedWorld, user?.id])

  const handleSelectEntity = (item: EntitySummary) => {
    if (item.entityType === 'character') {
      setSelectedCharacter(item as CharacterSummary)
      return
    }
    setSelectedWorld(item as WorldSummary)
  }

  const handleClearSelectedEntity = (entityType: 'character' | 'world') => {
    if (entityType === 'character') setSelectedCharacter(null)
    else setSelectedWorld(null)
  }

  const handleStartCombination = async () => {
    if (!selectedCharacter) {
      toast.error('대화할 캐릭터를 먼저 선택해 주세요.')
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
      const { toUserFacingError } = await import('@/lib/platform/apiClient')
      toast.error(toUserFacingError(error, '대화방을 만들지 못했습니다.').message)
    } finally {
      setIsStartingCombination(false)
    }
  }

  const chrome = useMemo(() => ({
    user,
    authStatus,
    userAvatarInitial: toAvatarInitial(user),
    searchQuery,
    onSearchChange: handleSearchChange,
    onSearchSubmit: handleSearchSubmit,
    onNavigate: (path: string) => navigateTo(parseRouteFromPathname(path)),
    onEditorDirtyChange: (isDirty: boolean) => { editorDirtyRef.current = isDirty },
    getNavigationGeneration: () => navigationGenerationRef.current,
    onAuthRequest: openAuthDialog,
    onSignOut: handleSignOut,
    onDeleteAccount: handleDeleteAccount,
    selectedCharacter,
    selectedWorld,
    isStartingCombination,
    onSelectEntity: handleSelectEntity,
    onClearSelectedEntity: handleClearSelectedEntity,
    onStartCombination: handleStartCombination,
  }), [user, authStatus, route.view, searchQuery, selectedCharacter, selectedWorld, isStartingCombination])

  const routeKey = route.view === 'room' ? `room-${route.roomId}` : route.view === 'character' ? `character-${route.slug}` : route.view === 'world' ? `world-${route.slug}` : route.view === 'startCharacter' ? `start-character-${route.slug}` : route.view === 'startWorld' ? `start-world-${route.slug}` : route.view === 'editCharacter' ? `edit-character-${route.slug}` : route.view === 'editWorld' ? `edit-world-${route.slug}` : route.view

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
      <div className="relative min-h-dvh w-full overflow-x-hidden bg-[#ffffff]">
        <Suspense fallback={<PageFallback />}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={routeKey} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="relative">
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
              {route.view === 'recovery' && <PasswordRecoveryPage onComplete={() => navigateTo({ view: 'home' }, { replace: true })} onOpenAuth={openPasswordResetDialog} />}
            </motion.div>
          </AnimatePresence>
        </Suspense>

        {isAuthDialogOpen && (
          <Suspense fallback={null}>
            <AuthDialog open={isAuthDialogOpen} onOpenChange={setIsAuthDialogOpen} onSuccess={() => setIsAuthDialogOpen(false)} initialMode={authDialogMode} />
          </Suspense>
        )}
        <UnsavedChangesDialog
          open={pendingHistoryNavigation !== null}
          description="이전 또는 다음 화면으로 이동하면 현재 입력 내용은 임시저장본으로만 남습니다."
          confirmDisabled={!pendingHistoryNavigation?.isReady}
          onCancel={cancelHistoryNavigation}
          onConfirm={confirmHistoryNavigation}
        />
        <Toaster />
      </div>
    </MotionConfig>
  )
}

export default App
