import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import type { User } from '@supabase/supabase-js'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { devError } from '@/lib/logger'
import { getStoredKeys } from '@/lib/browserStorage'
import { UnsavedChangesDialog } from '@/components/platform/UnsavedChangesDialog'
import type { CharacterSummary, EntitySummary, WorldSummary } from '@/lib/platform/types'
import { parseRoute, renderRoute, routeKey, routePath, type RouteState } from '@/lib/platform/routes'
import {
  clearCombinationSelection,
  readCombinationSelection,
  writeCombinationSelection,
} from '@/lib/platform/combinationSelection'

const AuthDialog = lazy(() => import('@/components/AuthDialog').then((module) => ({ default: module.AuthDialog })))

const normalizePathname = (pathname: string) => {
  if (!pathname || pathname === '/') return '/'
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

const resolveInitialRoute = (): RouteState => {
  if (typeof window === 'undefined') return { view: 'home' }
  return parseRoute(window.location.pathname)
}

const resolveSearchQuery = () => {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('search') || ''
}

interface NavigationOptions {
  replace?: boolean
  search?: string
}

interface DeferredNavigation {
  nextRoute: RouteState
  options?: NavigationOptions
}

type PendingNavigation =
  | ({ kind: 'internal' } & DeferredNavigation)
  | { kind: 'history'; targetUrl: string }

const resolveCurrentUrl = () => typeof window === 'undefined'
  ? '/'
  : `${normalizePathname(window.location.pathname)}${window.location.search}${window.location.hash}`

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
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null)
  const authenticatedUserIdRef = useRef<string | null>(null)
  const editorDirtyRef = useRef(false)
  const committedUrlRef = useRef(resolveCurrentUrl())
  const pendingNavigationRef = useRef<PendingNavigation | null>(null)
  const isConfirmingNavigationRef = useRef(false)
  const combinationSelectionScope = authStatus === 'authenticated' && user?.id
    ? `user:${user.id}`
    : authStatus === 'anonymous'
      ? 'anonymous'
      : null

  useEffect(() => {
    const commitBrowserLocation = () => {
      const targetUrl = resolveCurrentUrl()
      committedUrlRef.current = targetUrl
      setRoute(parseRoute(window.location.pathname))
      setSearchQuery(resolveSearchQuery())
    }
    const restoreCommittedUrl = () => {
      window.history.pushState(window.history.state, '', committedUrlRef.current)
    }
    const handlePopState = () => {
      const targetUrl = resolveCurrentUrl()
      if (targetUrl === committedUrlRef.current) return
      if (editorDirtyRef.current) {
        if (!pendingNavigationRef.current) {
          const nextNavigation: PendingNavigation = { kind: 'history', targetUrl }
          pendingNavigationRef.current = nextNavigation
          setPendingNavigation(nextNavigation)
        }
        restoreCommittedUrl()
        return
      }
      editorDirtyRef.current = false
      commitBrowserLocation()
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!editorDirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    const initialRoute = parseRoute(window.location.pathname)
    const normalizedPath = routePath(initialRoute)
    const initialUrl = `${normalizedPath}${window.location.search}${window.location.hash}`
    window.history.replaceState(window.history.state, '', initialUrl)
    committedUrlRef.current = initialUrl
    setRoute(initialRoute)
    window.addEventListener('popstate', handlePopState)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  const cancelNavigation = () => {
    if (isConfirmingNavigationRef.current) return
    pendingNavigationRef.current = null
    setPendingNavigation(null)
  }

  const commitNavigation = (nextRoute: RouteState, options?: NavigationOptions) => {
    const nextPath = routePath(nextRoute)
    const nextUrl = `${nextPath}${options?.search || ''}`
    const nextSearchQuery = nextRoute.view === 'home'
      ? new URLSearchParams(options?.search || '').get('search') || ''
      : null
    if (resolveCurrentUrl() === nextUrl) {
      if (nextSearchQuery !== null) setSearchQuery(nextSearchQuery)
      return
    }
    const historyMethod = options?.replace ? 'replaceState' : 'pushState'
    window.history[historyMethod]({}, '', nextUrl)
    committedUrlRef.current = nextUrl
    editorDirtyRef.current = false
    if (nextSearchQuery !== null) setSearchQuery(nextSearchQuery)
    setRoute(nextRoute)
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }

  const confirmNavigation = () => {
    const nextNavigation = pendingNavigationRef.current
    if (!nextNavigation || isConfirmingNavigationRef.current) return
    isConfirmingNavigationRef.current = true
    pendingNavigationRef.current = null
    setPendingNavigation(null)
    editorDirtyRef.current = false
    if (nextNavigation.kind === 'history') {
      window.history.replaceState(window.history.state, '', nextNavigation.targetUrl)
      committedUrlRef.current = nextNavigation.targetUrl
      setRoute(parseRoute(window.location.pathname))
      setSearchQuery(resolveSearchQuery())
    } else {
      commitNavigation(nextNavigation.nextRoute, nextNavigation.options)
    }
    isConfirmingNavigationRef.current = false
  }

  useEffect(() => {
    if (!shouldInitializeAuth) return

    let mounted = true
    let unsubscribe: (() => void) | undefined
    // UI and bearer-token callers share the same lazy session resource.
    void import('@/lib/authSession').then(({ observeAuthSession }) => observeAuthSession((next) => {
      if (!mounted) return
      const nextUserId = next.user?.id ?? null
      if (authenticatedUserIdRef.current && authenticatedUserIdRef.current !== nextUserId) {
        clearCombinationSelection()
        setSelectedCharacter((current) => current?.visibility === 'private' ? null : current)
        setSelectedWorld((current) => current?.visibility === 'private' ? null : current)
      }
      authenticatedUserIdRef.current = nextUserId
      setUser(next.user)
      setAuthStatus(next.status)
    }, { force: true })).then((dispose) => {
      if (mounted) unsubscribe = dispose
      else dispose()
    })
      .catch(() => { if (mounted) setAuthStatus('unavailable') })
    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [shouldInitializeAuth, authRetryNonce])

  const navigateTo = (nextRoute: RouteState, options?: NavigationOptions) => {
    const nextPath = routePath(nextRoute)
    const nextUrl = `${nextPath}${options?.search || ''}`
    const nextSearchQuery = nextRoute.view === 'home'
      ? new URLSearchParams(options?.search || '').get('search') || ''
      : null
    if (resolveCurrentUrl() === nextUrl) {
      if (nextSearchQuery !== null) setSearchQuery(nextSearchQuery)
      return
    }
    if (editorDirtyRef.current) {
      if (pendingNavigationRef.current) return
      const nextNavigation: PendingNavigation = { kind: 'internal', nextRoute, options }
      pendingNavigationRef.current = nextNavigation
      setPendingNavigation(nextNavigation)
      return
    }
    commitNavigation(nextRoute, options)
  }

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    if (route.view !== 'home') return
    const normalized = value.trim()
    const nextUrl = normalized ? `/?search=${encodeURIComponent(normalized)}` : '/'
    window.history.replaceState(window.history.state, '', nextUrl)
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
    onNavigate: (path: string) => navigateTo(parseRoute(path)),
    onEditorDirtyChange: (isDirty: boolean) => { editorDirtyRef.current = isDirty },
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

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
      <div className="relative min-h-dvh w-full overflow-x-hidden bg-[#ffffff]">
        <Suspense fallback={<PageFallback />}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={routeKey(route)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="relative">
              {renderRoute(route, {
                chrome,
                onRecoveryComplete: () => navigateTo({ view: 'home' }, { replace: true }),
                onOpenPasswordReset: openPasswordResetDialog,
              })}
            </motion.div>
          </AnimatePresence>
        </Suspense>

        {isAuthDialogOpen && (
          <Suspense fallback={null}>
            <AuthDialog open={isAuthDialogOpen} onOpenChange={setIsAuthDialogOpen} onSuccess={() => setIsAuthDialogOpen(false)} initialMode={authDialogMode} />
          </Suspense>
        )}
        <UnsavedChangesDialog
          open={pendingNavigation !== null}
          description={pendingNavigation?.kind === 'history'
            ? '이전 또는 다음 화면으로 이동하면 현재 입력 내용은 임시저장본으로만 남습니다.'
            : pendingNavigation?.nextRoute.view === 'home'
              ? '검색 결과로 이동하면 현재 입력 내용은 임시저장본으로만 남습니다.'
              : '다른 화면으로 이동하면 현재 입력 내용은 임시저장본으로만 남습니다.'}
          onCancel={cancelNavigation}
          onConfirm={confirmNavigation}
        />
        <Toaster />
      </div>
    </MotionConfig>
  )
}

export default App
