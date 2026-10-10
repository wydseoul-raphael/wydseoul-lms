import type { Metadata } from 'next'
import { WYD_BRAND } from '@/lib/wyd/brand'
import CopyrightClient from './CopyrightClient'

export const metadata: Metadata = {
  title: { absolute: `Copyright | ${WYD_BRAND.name}` },
  robots: { index: true, follow: true },
}

export default function CopyrightPage() {
  return <CopyrightClient />
}
