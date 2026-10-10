import { redirect } from 'next/navigation'

// Optional-course enrollment. Until the dedicated enrollment screen ships
// (phase 5), the course catalogue is the place to enrol. Browser-relative
// path: the proxy adds the /orgs/{slug} prefix.
export default function EnrollPage() {
  redirect('/courses')
}
