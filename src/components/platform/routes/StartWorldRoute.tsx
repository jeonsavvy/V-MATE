import { StartWorldPage } from '@/components/platform/pages/RoomPages'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'

export default function StartWorldRoute(props: { chrome: PlatformPageChromeProps; slug: string }) {
  return <StartWorldPage {...props} />
}
