import type { Metadata } from 'next'
import { WYD_BRAND } from '@/lib/wyd/brand'
import ContributorsClient from './ContributorsClient'

export const metadata: Metadata = {
  title: { absolute: `Contributors | ${WYD_BRAND.name}` },
  robots: { index: true, follow: true },
}

export default function ContributorsPage() {
  return <ContributorsClient />
}
