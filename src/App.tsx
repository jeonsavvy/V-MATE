import { useState, useEffect, lazy, Suspense } from "react"
import { Toaster } from "@/components/ui/sonner"
import { CHARACTERS } from "@/lib/data"
import { User } from "@supabase/supabase-js"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
import type { Character } from "@/lib/data"

const Home = lazy(() => import("@/components/Home").then((module) => ({ default: module.Home })))
const ChatView = lazy(() => import("@/components/ChatView").then((module) => ({ default: module.ChatView })))
const AuthDialog = lazy(() => import("@/components/AuthDialog").then((module) => ({ default: module.AuthDialog })))

type RouteState =
  | { view: "home" }
  | { view: "chat"; charId: string }

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
    if (CHARACTERS[charId]) {
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

function App() {
  const [route, setRoute] = useState<RouteState>(resolveInitialRoute)
  const [user, setUser] = useState<User | null>(null)
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false)

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
    if (!isSupabaseConfigured()) {
      return
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
    }).catch((error) => {
      console.error("Failed to get session:", error)
    })

    try {
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null)
      })

      return () => subscription.unsubscribe()
    } catch (error) {
      console.error("Failed to set up auth state change listener:", error)
    }
  }, [])

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
    navigateTo({ view: "chat", charId: character.id })
  }

  const handleCharacterChange = (charId: string) => {
    const normalizedCharId = String(charId || "").toLowerCase()
    if (!CHARACTERS[normalizedCharId]) {
      return
    }
    navigateTo({ view: "chat", charId: normalizedCharId })
  }

  const handleBackToHome = () => {
    navigateTo({ view: "home" })
  }

  const character = route.view === "chat" ? CHARACTERS[route.charId] : null

  return (
    <div className="min-h-dvh w-full overflow-x-hidden bg-[#e7dfd3]">
      <Suspense fallback={<div className="flex min-h-dvh items-center justify-center text-sm text-[#6d665d]">화면 로딩 중...</div>}>
        {route.view === "home" ? (
          <Home
            onCharacterSelect={handleCharacterSelect}
            user={user}
            onAuthRequest={() => setIsAuthDialogOpen(true)}
          />
        ) : (
          character && (
            <ChatView
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
