import type { Metadata } from 'next'
import LearnerDrilldown from '@components/Dashboard/Pages/LearningManagement/LearnerDrilldown'

export const metadata: Metadata = { title: 'Learner | WYD SEOUL 2027' }

export default async function LmLearner(props: { params: Promise<{ orgslug: string; useruuid: string }> }) {
  const { orgslug, useruuid } = await props.params
  return <LearnerDrilldown orgslug={orgslug} userUuid={useruuid} />
}
