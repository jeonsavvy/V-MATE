import { OpsPage } from '@/components/platform/pages/OpsPage'
import type { PlatformPageChromeProps } from '@/components/platform/pageTypes'

export default function OpsRoute(props: { chrome: PlatformPageChromeProps }) {
  return <OpsPage {...props} />
}
