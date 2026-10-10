import type { Metadata } from 'next'
import { WYD_BRAND } from '@/lib/wyd/brand'
import WydLearning from './WydLearning'

export const metadata: Metadata = {
  title: { absolute: `My learning | ${WYD_BRAND.name}` },
  robots: { index: false, follow: false },
}

export default async function LearningPage(props: { params: Promise<{ orgslug: string }> }) {
  const { orgslug } = await props.params
  return <WydLearning orgslug={orgslug} />
}
