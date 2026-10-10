import type { Metadata } from 'next'
import { WYD_BRAND } from '@/lib/wyd/brand'
import AboutClient from './AboutClient'

export const metadata: Metadata = {
  title: { absolute: `About training | ${WYD_BRAND.name}` },
  description: WYD_BRAND.description,
  robots: { index: true, follow: true },
}

export default function AboutPage() {
  return <AboutClient />
}
