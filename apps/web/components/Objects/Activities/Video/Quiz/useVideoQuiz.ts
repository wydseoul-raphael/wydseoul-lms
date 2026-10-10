'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@/lib/query/keys'
import { answerCheckpoint, getVideoQuiz, submitEndQuiz, type VideoQuizPublic } from '@services/courses/videoQuiz'

export function useVideoQuiz(activityUuid: string | undefined, { orgId, courseUuid }: { orgId?: number; courseUuid?: string } = {}) {
  const session = useLHSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const enabled = !!activityUuid && session?.status === 'authenticated'

  const query = useQuery<VideoQuizPublic>({
    queryKey: queryKeys.videoQuiz.learner(activityUuid ?? ''),
    queryFn: () => getVideoQuiz(activityUuid!, token),
    enabled,
    staleTime: 60_000,
  })

  const invalidateProgress = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.videoQuiz.learner(activityUuid ?? '') })
    queryClient.invalidateQueries({ queryKey: queryKeys.videoProgress.activity(activityUuid ?? '') })
    if (courseUuid) {
      queryClient.invalidateQueries({ queryKey: queryKeys.videoProgress.course(courseUuid) })
      queryClient.invalidateQueries({ queryKey: queryKeys.courses.meta(courseUuid) })
    }
    if (orgId) queryClient.invalidateQueries({ queryKey: queryKeys.trail.org(orgId) })
  }

  const checkpoint = useMutation({
    mutationFn: ({ questionId, attemptId, selected }: { questionId: string; attemptId: string; selected: string[] }) =>
      answerCheckpoint(activityUuid!, questionId, attemptId, selected, token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.videoQuiz.learner(activityUuid ?? '') }),
  })

  const endQuiz = useMutation({
    mutationFn: ({ attemptId, answers }: { attemptId: string; answers: Record<string, string[]> }) => submitEndQuiz(activityUuid!, attemptId, answers, token),
    onSuccess: (res) => {
      if (res.activityCompleted) invalidateProgress()
      else queryClient.invalidateQueries({ queryKey: queryKeys.videoQuiz.learner(activityUuid ?? '') })
    },
  })

  return { ...query, checkpoint, endQuiz }
}
