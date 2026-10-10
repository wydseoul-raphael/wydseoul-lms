import type { Metadata } from 'next'
import LmCoursePage from '@components/Dashboard/Pages/LearningManagement/LmCoursePage'

export const metadata: Metadata = { title: 'Course completion | WYD SEOUL 2027' }

export default async function LmCourse(props: { params: Promise<{ orgslug: string; courseuuid: string }> }) {
  const { orgslug, courseuuid } = await props.params
  return <LmCoursePage orgslug={orgslug} courseUuid={courseuuid} />
}
