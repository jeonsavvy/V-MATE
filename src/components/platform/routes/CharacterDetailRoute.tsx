import { CharacterDetailPage } from '@/components/platform/pages/DetailPages'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'

export default function CharacterDetailRoute(props: { chrome: PlatformPageChromeProps; slug: string }) {
  return <CharacterDetailPage {...props} />
}
