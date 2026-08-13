import { CreateCharacterPage } from '@/components/platform/pages/EditorPages'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'

export default function CharacterEditorRoute(props: { chrome: PlatformPageChromeProps; slug?: string }) {
  return <CreateCharacterPage {...props} />
}
