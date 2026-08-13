import { lazy, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'

export type RouteState =
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

// Route renderers are the typed adaptation boundary for page-specific props.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteComponent = ComponentType<any>

interface RouteDefinition {
  view: RouteState['view']
  pattern: string
  aliases?: string[]
  component: LazyExoticComponent<RouteComponent>
  create: (params: Record<string, string>) => RouteState
  render: (component: RouteComponent, route: RouteState, context: RouteRenderContext) => ReactNode
}

export interface RouteRenderContext {
  chrome: PlatformPageChromeProps
  onRecoveryComplete: () => void
  onOpenPasswordReset: () => void
}

const route = (
  definition: Omit<RouteDefinition, 'component'> & { load: () => Promise<{ default: RouteComponent }> },
): RouteDefinition => ({ ...definition, component: lazy(definition.load) })

const renderChrome = (Component: RouteComponent, _route: RouteState, context: RouteRenderContext) => <Component {...context.chrome} />
const renderChromeProp = (Component: RouteComponent, _route: RouteState, context: RouteRenderContext) => <Component chrome={context.chrome} />

// URL matching, generation, rendering, and lazy module ownership intentionally live in one table.
export const routeTable: readonly RouteDefinition[] = [
  route({ view: 'home', pattern: '/', load: () => import('@/components/routes/HomeRoute'), create: () => ({ view: 'home' }), render: renderChrome }),
  route({ view: 'character', pattern: '/characters/:slug', load: () => import('@/components/platform/routes/CharacterDetailRoute'), create: ({ slug }) => ({ view: 'character', slug }), render: (Component, state, context) => <Component chrome={context.chrome} slug={'slug' in state ? state.slug : ''} /> }),
  route({ view: 'world', pattern: '/worlds/:slug', load: () => import('@/components/platform/routes/WorldDetailRoute'), create: ({ slug }) => ({ view: 'world', slug }), render: (Component, state, context) => <Component chrome={context.chrome} slug={'slug' in state ? state.slug : ''} /> }),
  route({ view: 'startCharacter', pattern: '/start/character/:slug', aliases: ['/chat/:slug'], load: () => import('@/components/platform/routes/StartCharacterRoute'), create: ({ slug }) => ({ view: 'startCharacter', slug }), render: (Component, state, context) => <Component chrome={context.chrome} slug={'slug' in state ? state.slug : ''} /> }),
  route({ view: 'startWorld', pattern: '/start/world/:slug', load: () => import('@/components/platform/routes/StartWorldRoute'), create: ({ slug }) => ({ view: 'startWorld', slug }), render: (Component, state, context) => <Component chrome={context.chrome} slug={'slug' in state ? state.slug : ''} /> }),
  route({ view: 'room', pattern: '/rooms/:roomId', load: () => import('@/components/platform/routes/RoomRoute'), create: ({ roomId }) => ({ view: 'room', roomId }), render: (Component, state, context) => <Component chrome={context.chrome} roomId={'roomId' in state ? state.roomId : ''} /> }),
  route({ view: 'createCharacter', pattern: '/create/character', load: () => import('@/components/platform/routes/CharacterEditorRoute'), create: () => ({ view: 'createCharacter' }), render: renderChromeProp }),
  route({ view: 'createWorld', pattern: '/create/world', load: () => import('@/components/platform/routes/WorldEditorRoute'), create: () => ({ view: 'createWorld' }), render: renderChromeProp }),
  route({ view: 'editCharacter', pattern: '/edit/character/:slug', load: () => import('@/components/platform/routes/CharacterEditorRoute'), create: ({ slug }) => ({ view: 'editCharacter', slug }), render: (Component, state, context) => <Component chrome={context.chrome} slug={'slug' in state ? state.slug : ''} /> }),
  route({ view: 'editWorld', pattern: '/edit/world/:slug', load: () => import('@/components/platform/routes/WorldEditorRoute'), create: ({ slug }) => ({ view: 'editWorld', slug }), render: (Component, state, context) => <Component chrome={context.chrome} slug={'slug' in state ? state.slug : ''} /> }),
  route({ view: 'recent', pattern: '/recent', load: () => import('@/components/platform/routes/RecentRoomsRoute'), create: () => ({ view: 'recent' }), render: renderChromeProp }),
  route({ view: 'library', pattern: '/library', load: () => import('@/components/platform/routes/LibraryRoute'), create: () => ({ view: 'library' }), render: renderChromeProp }),
  route({ view: 'ops', pattern: '/ops', load: () => import('@/components/platform/routes/OpsRoute'), create: () => ({ view: 'ops' }), render: renderChromeProp }),
  route({ view: 'privacy', pattern: '/privacy', load: () => import('@/components/routes/PrivacyRoute'), create: () => ({ view: 'privacy' }), render: renderChromeProp }),
  route({ view: 'recovery', pattern: '/auth/recovery', load: () => import('@/components/routes/RecoveryRoute'), create: () => ({ view: 'recovery' }), render: (Component, _state, context) => <Component onComplete={context.onRecoveryComplete} onOpenAuth={context.onOpenPasswordReset} /> }),
]

const normalizePathname = (pathname: string) => {
  if (!pathname || pathname === '/') return '/'
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

const matchPattern = (pattern: string, pathname: string): Record<string, string> | null => {
  const patternSegments = normalizePathname(pattern).split('/').filter(Boolean)
  const pathSegments = normalizePathname(pathname).split('/').filter(Boolean)
  if (patternSegments.length !== pathSegments.length) return null
  const params: Record<string, string> = {}
  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index]
    const actual = pathSegments[index]
    if (expected.startsWith(':')) {
      try {
        params[expected.slice(1)] = decodeURIComponent(actual)
      } catch {
        return null
      }
    }
    else if (expected !== actual) return null
  }
  return params
}

export const parseRoute = (pathname: string): RouteState => {
  for (const definition of routeTable) {
    for (const pattern of [definition.pattern, ...(definition.aliases ?? [])]) {
      const params = matchPattern(pattern, pathname)
      if (params) return definition.create(params)
    }
  }
  return { view: 'home' }
}

export const routePath = (state: RouteState): string => {
  const definition = routeTable.find((candidate) => candidate.view === state.view) ?? routeTable[0]
  return definition.pattern.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    const value = (state as unknown as Record<string, unknown>)[name]
    return encodeURIComponent(String(value ?? ''))
  })
}

export const renderRoute = (state: RouteState, context: RouteRenderContext) => {
  const definition = routeTable.find((candidate) => candidate.view === state.view) ?? routeTable[0]
  return definition.render(definition.component, state, context)
}

export const routeKey = (state: RouteState) => `${state.view}:${routePath(state)}`
