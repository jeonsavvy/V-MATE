import { LibraryPage } from '@/components/platform/pages/PersonalPages'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'

export default function LibraryRoute(props: { chrome: PlatformPageChromeProps }) {
  return <LibraryPage {...props} />
}
