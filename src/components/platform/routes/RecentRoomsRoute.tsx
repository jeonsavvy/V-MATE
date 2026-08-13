import { RecentRoomsPage } from '@/components/platform/pages/PersonalPages'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'

export default function RecentRoomsRoute(props: { chrome: PlatformPageChromeProps }) {
  return <RecentRoomsPage {...props} />
}
