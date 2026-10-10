'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import {
  getActivityVideoProgress,
  getCourseVideoProgress,
  getCourseVideoProgressAdmin,
} from '@services/courses/videoProgress'

function useToken(): string | undefined {
  const session = useLHSession() as any
  return session?.data?.tokens?.access_token as string | undefined
}

export function useActivityVideoProgress(activityUuid: string | undefined, enabled = true) {
  const token = useToken()
  const session = useLHSession() as any
  return useQuery({
    queryKey: queryKeys.videoProgress.activity(activityUuid ?? ''),
    queryFn: () => getActivityVideoProgress(activityUuid!, token),
    enabled: !!activityUuid && enabled && session?.status === 'authenticated',
    staleTime: 15_000,
  })
}

export function useCourseVideoProgress(courseUuid: string | undefined) {
  const token = useToken()
  const session = useLHSession() as any
  return useQuery({
    queryKey: queryKeys.videoProgress.course(courseUuid ?? ''),
    queryFn: () => getCourseVideoProgress(courseUuid!, token),
    enabled: !!courseUuid && session?.status === 'authenticated',
    staleTime: 30_000,
  })
}

export function useAdminCourseVideoProgress(courseUuid: string | undefined, params: { user_uuid?: string; page?: number; limit?: number }) {
  const token = useToken()
  const key = JSON.stringify(params)
  return useQuery({
    queryKey: queryKeys.videoProgress.admin(courseUuid ?? '', key),
    queryFn: () => getCourseVideoProgressAdmin(courseUuid!, params, token),
    enabled: !!courseUuid,
    staleTime: 15_000,
  })
}
