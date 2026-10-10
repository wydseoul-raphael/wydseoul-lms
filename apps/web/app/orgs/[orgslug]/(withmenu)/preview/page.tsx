import type { Metadata } from 'next'
import { WYD_BRAND } from '@/lib/wyd/brand'
import GuestPreviewClient from './GuestPreviewClient'

export const metadata: Metadata = {
  title: { absolute: `Guest preview | ${WYD_BRAND.name}` },
  description: 'Watch the official WYD volunteer introduction before creating an account.',
  robots: { index: true, follow: true },
}

export default async function GuestPreviewPage(props: { params: Promise<{ orgslug: string }> }) {
  const { orgslug } = await props.params
  return <GuestPreviewClient orgslug={orgslug} />
}
