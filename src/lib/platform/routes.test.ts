import { describe, expect, it } from 'vitest'
import { parseRoute, routePath, routeTable } from '@/lib/platform/routes'

describe('platform route table', () => {
  it('owns canonical parse and generation including the legacy chat alias', () => {
    expect(routePath(parseRoute('/edit/character/guide'))).toBe('/edit/character/guide')
    expect(parseRoute('/chat/guide')).toEqual({ view: 'startCharacter', slug: 'guide' })
    expect(routePath(parseRoute('/chat/guide'))).toBe('/start/character/guide')
    expect(parseRoute('/characters/%')).toEqual({ view: 'home' })
    expect(new Set(routeTable.map((route) => route.view)).size).toBe(routeTable.length)
  })
})
