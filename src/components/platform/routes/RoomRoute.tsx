import { RoomPage } from '@/components/platform/pages/RoomPages'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'

export default function RoomRoute(props: { chrome: PlatformPageChromeProps; roomId: string }) {
  return <RoomPage {...props} />
}
