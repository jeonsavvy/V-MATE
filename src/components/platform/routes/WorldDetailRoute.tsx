import { WorldDetailPage } from '@/components/platform/pages/DetailPages'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'

export default function WorldDetailRoute(props: { chrome: PlatformPageChromeProps; slug: string }) {
  return <WorldDetailPage {...props} />
}
