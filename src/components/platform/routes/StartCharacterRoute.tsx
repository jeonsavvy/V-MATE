import { StartCharacterPage } from '@/components/platform/pages/RoomPages'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'

export default function StartCharacterRoute(props: { chrome: PlatformPageChromeProps; slug: string }) {
  return <StartCharacterPage {...props} />
}
