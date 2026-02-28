import { useState, useEffect, lazy, Suspense } from "react"
import { Toaster } from "@/components/ui/sonner"
import { toast } from "sonner"
import { CHARACTERS, isCharacterId } from "@/lib/data"
import type { Character, CharacterId } from "@/lib/data"
import type { User } from "@supabase/supabase-js"
import { devError } from "@/lib/logger"
import { getStoredKeys } from "@/lib/browserStorage"

const Home = lazy(() => import("@/components/Home").then((module) => ({ default: module.Home })))
const ChatView = lazy(() => import("@/components/ChatView").then((module) => ({ default: module.ChatView })))
const AuthDialog = lazy(() => import("@/components/AuthDialog").then((module) => ({ default: module.AuthDialog })))

type RouteState =
  | { view: "home" }
  | { view: "chat"; charId: CharacterId }

const normalizePathname = (pathname: string) => {
  if (!pathname || pathname === "/") {
    return "/"
  }
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname
}

const parseRouteFromPathname = (pathname: string): RouteState => {
  const normalizedPath = normalizePathname(pathname)
  const segments = normalizedPath.split("/").filter(Boolean)

  if (segments[0] === "chat" && segments[1]) {
    const charId = segments[1].toLowerCase()
    if (isCharacterId(charId)) {
      return { view: "chat", charId }
    }
  }

  return { view: "home" }
}

const toPathname = (route: RouteState): string => {
  if (route.view === "chat") {
    return `/chat/${route.charId}`
  }
  return "/"
}

const resolveInitialRoute = (): RouteState => {
  if (typeof window === "undefined") {
    return { view: "home" }
  }
  return parseRouteFromPathname(window.location.pathname)
}

const hasPersistedSupabaseSession = (): boolean => {
  if (typeof window === "undefined") {
    return false
  }

  return getStoredKeys().some((key) => key.startsWith("sb-") && key.endsWith("-auth-token"))
}

function App() {
  const [route, setRoute] = useState<RouteState>(resolveInitialRoute)
  const [user, setUser] = useState<User | null>(null)
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false)
  const [shouldInitializeAuth, setShouldInitializeAuth] = useState<boolean>(hasPersistedSupabaseSession)
  const [isAuthResolved, setIsAuthResolved] = useState<boolean>(() => !hasPersistedSupabaseSession())

  useEffect(() => {
    const handlePopState = () => {
      setRoute(parseRouteFromPathname(window.location.pathname))
    }

    const initialRoute = parseRouteFromPathname(window.location.pathname)
    const normalizedPath = toPathname(initialRoute)
    if (window.location.pathname !== normalizedPath) {
      window.history.replaceState({}, "", normalizedPath)
    }
    setRoute(initialRoute)

    window.addEventListener("popstate", handlePopState)
    return () => {
      window.removeEventListener("popstate", handlePopState)
    }
  }, [])

  useEffect(() => {
    if (!shouldInitializeAuth) {
      setIsAuthResolved(true)
      return
    }

    let mounted = true
    let unsubscribe: (() => void) | null = null

    const bindAuthListener = async () => {
      const module = await import("@/lib/supabase")
      if (!module.isSupabaseConfigured()) {
        return
      }

      const supabase = await module.resolveSupabaseClient()
      if (!supabase) {
        return
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()

        if (mounted) {
          setUser(session?.user ?? null)
          setIsAuthResolved(true)
        }
      } catch (error) {
        devError("Failed to get session:", error)
        if (mounted) {
          setIsAuthResolved(true)
        }
      }

      try {
        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
          if (mounted) {
            setUser(session?.user ?? null)
          }
        })

        unsubscribe = () => subscription.unsubscribe()
      } catch (error) {
        devError("Failed to set up auth state change listener:", error)
      }
    }

    void bindAuthListener()

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [shouldInitializeAuth])

  useEffect(() => {
    if (route.view !== "chat") {
      return
    }

    if (user) {
      return
    }

    if (!isAuthResolved) {
      return
    }

    setShouldInitializeAuth(true)
    setIsAuthDialogOpen(true)
    toast.error("채팅은 로그인 후 이용할 수 있습니다.")
    navigateTo({ view: "home" }, { replace: true })
  }, [isAuthResolved, route, user])

  const navigateTo = (nextRoute: RouteState, options?: { replace?: boolean }) => {
    const nextPath = toPathname(nextRoute)
    const currentPath = normalizePathname(window.location.pathname)
    if (currentPath !== nextPath) {
      if (options?.replace) {
        window.history.replaceState({}, "", nextPath)
      } else {
        window.history.pushState({}, "", nextPath)
      }
    } else if (options?.replace) {
      window.history.replaceState({}, "", nextPath)
    }
    setRoute(nextRoute)
  }

  const handleCharacterSelect = (character: Character) => {
    if (!user) {
      setShouldInitializeAuth(true)
      setIsAuthDialogOpen(true)
      toast.message("회원 전용 기능", {
        description: "채팅은 로그인 후 시작할 수 있습니다.",
      })
      return
    }

    navigateTo({ view: "chat", charId: character.id })
  }

  const handleCharacterChange = (charId: string) => {
    if (!user) {
      setShouldInitializeAuth(true)
      setIsAuthDialogOpen(true)
      toast.error("채팅은 로그인 후 이용할 수 있습니다.")
      return
    }

    const normalizedCharId = String(charId || "").toLowerCase()
    if (!isCharacterId(normalizedCharId)) {
      return
    }
    navigateTo({ view: "chat", charId: normalizedCharId })
  }

  const handleBackToHome = () => {
    navigateTo({ view: "home" })
  }

  const character = route.view === "chat" ? CHARACTERS[route.charId] ?? null : null

  const openAuthDialog = () => {
    setShouldInitializeAuth(true)
    setIsAuthResolved(false)
    setIsAuthDialogOpen(true)
  }

  return (
    <div className="min-h-dvh w-full overflow-x-hidden bg-[#e7dfd3]">
      <Suspense fallback={<div className="flex min-h-dvh items-center justify-center text-sm text-[#6d665d]">화면 로딩 중...</div>}>
        {route.view === "home" ? (
          <Home
            onCharacterSelect={handleCharacterSelect}
            user={user}
            onAuthRequest={openAuthDialog}
          />
        ) : (
          character && (
            <ChatView
              key={character.id}
              character={character}
              onCharacterChange={handleCharacterChange}
              user={user}
              onBack={handleBackToHome}
            />
          )
        )}
      </Suspense>

      {isAuthDialogOpen && (
        <Suspense fallback={null}>
          <AuthDialog
            open={isAuthDialogOpen}
            onOpenChange={setIsAuthDialogOpen}
            onSuccess={() => {
              setIsAuthDialogOpen(false)
            }}
          />
        </Suspense>
      )}
      <Toaster />
    </div>
  )
}

export default App
