import { RequestBodyWithAuthHeader, errorHandling } from '@services/utils/ts/requests'
import { getAPIUrl } from '@services/config/config'

const base = (orgId: number) => `${getAPIUrl()}learning-management/${orgId}`
const qs = (params: Record<string, string | number | undefined | null>) => {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v))
  })
  const s = q.toString()
  return s ? `?${s}` : ''
}

export interface LmCourseRow {
  course_uuid: string
  name: string
  required: boolean
  deadline: string | null
  days_left?: number | null
  enrolled?: number
  completed?: number
  completion_rate?: number
  track?: string | null
}

export interface LmOverview {
  members: number
  required_courses: number
  funnel: { members: number; enrolled_any_required: number; completed_any_required: number; completed_all_required: number }
  courses: LmCourseRow[]
  daily_active: Array<{ date: string; users: number }>
  at_risk_count: number
}

export interface LmUser {
  user_uuid: string
  username: string
  email: string
  first_name: string
  last_name: string
}

export interface Paged<T> {
  data: T[]
  page: number
  page_size: number
  total: number
}

export interface LmAtRiskRow {
  user: LmUser
  reasons: string[]
  last_active: string | null
  completed_required: number
  total_required: number
  expected_progress: number | null
  actual_progress: number
}

export interface LmLearnerMatrixRow {
  user: LmUser
  courses: Array<{ course_uuid: string; status: string }>
  completed_required: number
  total_required: number
  all_required_completed: boolean
  last_active: string | null
}

export interface LmCourseSummary {
  course: { course_uuid: string; name: string }
  members: number
  enrolled: number
  started: number
  completed: number
  completion_rate: number
  avg_verified_watch_seconds: number | null
  activities: Array<{ activity_uuid: string; name: string; activity_type: string; completed: number; dropoff_deciles: number[] }>
}

export interface LmCourseLearnerRow {
  user: LmUser
  status: string
  enrolled_at: string | null
  progress_percent: number
  completed_count: number
  total_count: number
  certificate_uuid: string | null
  last_active: string | null
  activities: Array<{ activity_uuid: string; complete: boolean; completed_at: string | null; video_percent: number | null; quiz_score: number | null }>
}

export interface LmLearnerDetail {
  user: LmUser
  last_active: string | null
  courses: Array<LmCourseRow & { status: string; enrolled_at: string | null; completed_count: number; total_count: number; progress_percent: number; certificate_uuid: string | null }>
  required_completed: number
  required_total: number
  all_required_completed: boolean
}

const get = async <T,>(url: string, token?: string): Promise<T> => errorHandling(await fetch(url, RequestBodyWithAuthHeader('GET', null, null, token)))

export const getLmOverview = (orgId: number, daysInactive: number, token?: string) => get<LmOverview>(`${base(orgId)}/overview${qs({ days_inactive: daysInactive })}`, token)
export const getLmAtRisk = (orgId: number, params: { days_inactive?: number; page?: number; page_size?: number }, token?: string) => get<Paged<LmAtRiskRow>>(`${base(orgId)}/at-risk${qs(params)}`, token)
export const getLmCourses = (orgId: number, token?: string) => get<LmCourseRow[]>(`${base(orgId)}/courses`, token)
export const getLmLearners = (orgId: number, params: { usergroup_id?: number; search?: string; page?: number; page_size?: number }, token?: string) =>
  get<Paged<LmLearnerMatrixRow> & { courses: LmCourseRow[] }>(`${base(orgId)}/learners${qs(params)}`, token)
export const getLmLearner = (orgId: number, userUuid: string, token?: string) => get<LmLearnerDetail>(`${base(orgId)}/learners/${userUuid}`, token)
export const getLmCourseSummary = (orgId: number, courseUuid: string, token?: string) => get<LmCourseSummary>(`${base(orgId)}/courses/${courseUuid}/summary`, token)
export const getLmCourseLearners = (orgId: number, courseUuid: string, params: { status?: string; usergroup_id?: number; search?: string; page?: number; page_size?: number }, token?: string) =>
  get<Paged<LmCourseLearnerRow> & { course: { course_uuid: string; name: string }; activities: Array<{ activity_uuid: string; name: string; activity_type: string }> }>(
    `${base(orgId)}/courses/${courseUuid}/learners${qs(params)}`,
    token
  )
export const lmCourseExportUrl = (orgId: number, courseUuid: string, params: { status?: string; usergroup_id?: number; search?: string }) => `${base(orgId)}/courses/${courseUuid}/export${qs(params)}`
export const lmLearnersExportUrl = (orgId: number, params: { usergroup_id?: number; search?: string }) => `${base(orgId)}/learners/export${qs(params)}`
