import { CreateWorldPage } from '@/components/platform/pages/EditorPages'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'

export default function WorldEditorRoute(props: { chrome: PlatformPageChromeProps; slug?: string }) {
  return <CreateWorldPage {...props} />
}
