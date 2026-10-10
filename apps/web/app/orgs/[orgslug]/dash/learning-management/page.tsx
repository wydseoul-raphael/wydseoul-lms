import type { Metadata } from 'next'
import LmOverview from '@components/Dashboard/Pages/LearningManagement/LmOverview'

export const metadata: Metadata = { title: 'Learning management | WYD SEOUL 2027' }

export default async function LearningManagementPage(props: { params: Promise<{ orgslug: string }> }) {
  const { orgslug } = await props.params
  return <LmOverview orgslug={orgslug} />
}
