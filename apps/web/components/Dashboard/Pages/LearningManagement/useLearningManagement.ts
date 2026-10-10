'use client'
import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { queryKeys } from '@/lib/query/keys'
import * as api from '@services/learningManagement/learningManagement'

function useCtx() {
  const session = useLHSession() as any
  const org = useOrg() as any
  return { token: session?.data?.tokens?.access_token as string | undefined, orgId: org?.id as number | undefined }
}

export function useLmOverview(daysInactive = 14) {
  const { token, orgId } = useCtx()
  return useQuery({ queryKey: queryKeys.learningManagement.overview(orgId ?? 0, daysInactive), queryFn: () => api.getLmOverview(orgId!, daysInactive, token), enabled: !!orgId, staleTime: 60_000 })
}

export function useLmAtRisk(params: { days_inactive?: number; page?: number; page_size?: number }) {
  const { token, orgId } = useCtx()
  return useQuery({ queryKey: queryKeys.learningManagement.atRisk(orgId ?? 0, JSON.stringify(params)), queryFn: () => api.getLmAtRisk(orgId!, params, token), enabled: !!orgId, staleTime: 60_000 })
}

export function useLmCourses() {
  const { token, orgId } = useCtx()
  return useQuery({ queryKey: queryKeys.learningManagement.courses(orgId ?? 0), queryFn: () => api.getLmCourses(orgId!, token), enabled: !!orgId, staleTime: 60_000 })
}

export function useLmLearners(params: { usergroup_id?: number; search?: string; page?: number; page_size?: number }) {
  const { token, orgId } = useCtx()
  return useQuery({ queryKey: queryKeys.learningManagement.learners(orgId ?? 0, JSON.stringify(params)), queryFn: () => api.getLmLearners(orgId!, params, token), enabled: !!orgId, staleTime: 30_000 })
}

export function useLmLearner(userUuid: string | undefined) {
  const { token, orgId } = useCtx()
  return useQuery({ queryKey: queryKeys.learningManagement.learner(orgId ?? 0, userUuid ?? ''), queryFn: () => api.getLmLearner(orgId!, userUuid!, token), enabled: !!orgId && !!userUuid, staleTime: 30_000 })
}

export function useLmCourseSummary(courseUuid: string | undefined) {
  const { token, orgId } = useCtx()
  return useQuery({ queryKey: queryKeys.learningManagement.courseSummary(orgId ?? 0, courseUuid ?? ''), queryFn: () => api.getLmCourseSummary(orgId!, courseUuid!, token), enabled: !!orgId && !!courseUuid, staleTime: 60_000 })
}

export function useLmCourseLearners(courseUuid: string | undefined, params: { status?: string; usergroup_id?: number; search?: string; page?: number; page_size?: number }) {
  const { token, orgId } = useCtx()
  return useQuery({
    queryKey: queryKeys.learningManagement.courseLearners(orgId ?? 0, courseUuid ?? '', JSON.stringify(params)),
    queryFn: () => api.getLmCourseLearners(orgId!, courseUuid!, params, token),
    enabled: !!orgId && !!courseUuid,
    staleTime: 30_000,
  })
}
