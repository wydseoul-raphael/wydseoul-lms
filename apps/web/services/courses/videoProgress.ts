import { RequestBodyWithAuthHeader, RequestBodyFormWithAuthHeader, errorHandling } from '@services/utils/ts/requests'
import { getAPIUrl } from '@services/config/config'
import type { HeartbeatPayload } from '@components/Objects/Activities/Video/heartbeatQueue'

// Client for /api/v1/video-progress (learner) and the instructor video
// configuration endpoints under /api/v1/activities/video.

export interface WatchPolicy {
  version: number
  heartbeatSeconds: number
  bucketSeconds: number
  completeRatio: number
  maxPlaybackRate: number
}

export interface VideoProgressSnapshot {
  activityId?: number
  policy: WatchPolicy
  durationSeconds: number | null
  durationTrusted: boolean
  durationSource?: string | null
  requiredWatchSeconds: number | null
  verifiedWatchSeconds: number
  videoPercent: number
  furthestVerifiedPosition: number
  resumePosition: number
  coverageSeconds: number
  coverageRatio: number
  coverageBuckets: number[]
  isComplete: boolean
  videoComplete: boolean
  completionState: 'in_progress' | 'video_complete_quiz_pending' | 'complete'
  sessionId: string | null
  seq: number
  hasEndQuiz?: boolean
  verifiedWatch?: boolean
  serverTime?: string
  // heartbeat-only
  accepted?: boolean
  reason?: string
  creditedSeconds?: number
  newlyComplete?: boolean
}

export interface CourseProgressActivity {
  activityUuid: string
  name: string
  activityType: string
  activitySubType: string
  isVideo: boolean
  verifiedWatch: boolean
  durationSeconds: number | null
  verifiedWatchSeconds: number
  videoPercent: number
  videoComplete: boolean
  completionState: string
  complete: boolean
  locked: boolean
  lockReason: string | null
  unlockActivityUuid: string | null
  resumePosition: number
}

export interface CourseProgressSummary {
  courseUuid: string
  sequential: boolean
  activities: CourseProgressActivity[]
  completedCount: number
  totalCount: number
  percent: number
  verifiedWatchSeconds: number
}

const base = () => `${getAPIUrl()}video-progress`

export async function startWatchSession(
  activityUuid: string,
  body: { sourceProvider?: 'hosted' | 'youtube' | 'vimeo'; clientReportedDuration?: number },
  accessToken?: string
): Promise<VideoProgressSnapshot> {
  const res = await fetch(`${base()}/sessions/${activityUuid}`, RequestBodyWithAuthHeader('POST', body, null, accessToken))
  return errorHandling(res)
}

export async function sendHeartbeat(
  payload: HeartbeatPayload,
  accessToken?: string,
  opts: { keepalive?: boolean } = {}
): Promise<VideoProgressSnapshot> {
  const init = RequestBodyWithAuthHeader('POST', payload, null, accessToken)
  // pagehide: the request must outlive the document.
  if (opts.keepalive) init.keepalive = true
  const res = await fetch(`${base()}/heartbeat`, init)
  return errorHandling(res)
}

export async function closeWatchSession(sessionId: string, currentTime: number | null, accessToken?: string): Promise<unknown> {
  const init = RequestBodyWithAuthHeader('POST', currentTime === null ? {} : { currentTime }, null, accessToken)
  init.keepalive = true
  const res = await fetch(`${base()}/sessions/${sessionId}/close`, init)
  return errorHandling(res)
}

export async function getActivityVideoProgress(activityUuid: string, accessToken?: string): Promise<VideoProgressSnapshot> {
  const res = await fetch(`${base()}/activity/${activityUuid}`, RequestBodyWithAuthHeader('GET', null, null, accessToken))
  return errorHandling(res)
}

export async function getCourseVideoProgress(courseUuid: string, accessToken?: string): Promise<CourseProgressSummary> {
  const res = await fetch(`${base()}/course/${courseUuid}`, RequestBodyWithAuthHeader('GET', null, null, accessToken))
  return errorHandling(res)
}

export async function getCourseVideoProgressAdmin(
  courseUuid: string,
  params: { user_uuid?: string; page?: number; limit?: number },
  accessToken?: string
): Promise<{ data: any[]; page: number; page_size: number; total: number }> {
  const qs = new URLSearchParams()
  if (params.user_uuid) qs.set('user_uuid', params.user_uuid)
  if (params.page) qs.set('page', String(params.page))
  if (params.limit) qs.set('limit', String(params.limit))
  const res = await fetch(`${base()}/course/${courseUuid}/admin?${qs.toString()}`, RequestBodyWithAuthHeader('GET', null, null, accessToken))
  return errorHandling(res)
}

// ---- instructor configuration -------------------------------------------

export interface PlaybackConfigIn {
  sources?: Array<{ provider: 'hosted' | 'youtube' | 'vimeo'; filename?: string; videoId?: string; hash?: string; label?: string }>
  signVideo?: { provider: 'hosted' | 'youtube'; filename?: string; videoId?: string } | null
  durationSeconds?: number
  durationSource?: 'admin' | 'probe:hls' | 'probe:youtube' | 'probe:vimeo' | 'probe:file'
  verifiedWatch?: boolean
  captionsDefault?: string
}

export async function updateVideoPlaybackConfig(activityUuid: string, config: PlaybackConfigIn, accessToken?: string): Promise<{ content: any; details: any }> {
  const res = await fetch(`${getAPIUrl()}activities/video/${activityUuid}/playback-config`, RequestBodyWithAuthHeader('PUT', config, null, accessToken))
  return errorHandling(res)
}

export async function uploadManualCaption(activityUuid: string, lang: string, label: string, file: File, accessToken?: string): Promise<any> {
  const form = new FormData()
  form.append('file', file)
  form.append('label', label)
  const res = await fetch(`${getAPIUrl()}activities/video/${activityUuid}/captions/${encodeURIComponent(lang)}`, RequestBodyFormWithAuthHeader('POST', form, null, accessToken ?? ''))
  return errorHandling(res)
}

export async function deleteManualCaption(activityUuid: string, lang: string, accessToken?: string): Promise<any> {
  const res = await fetch(`${getAPIUrl()}activities/video/${activityUuid}/captions/${encodeURIComponent(lang)}`, RequestBodyWithAuthHeader('DELETE', null, null, accessToken))
  return errorHandling(res)
}

export async function uploadSignVideo(activityUuid: string, file: File, accessToken?: string): Promise<{ signVideo: any }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${getAPIUrl()}activities/video/${activityUuid}/sign-video`, RequestBodyFormWithAuthHeader('POST', form, null, accessToken ?? ''))
  return errorHandling(res)
}

export async function probeVideoUrl(url: string, accessToken?: string): Promise<{ provider: string; videoId: string; hash?: string | null; title?: string; durationSeconds: number | null }> {
  const res = await fetch(`${getAPIUrl()}activities/video/probe?url=${encodeURIComponent(url)}`, RequestBodyWithAuthHeader('GET', null, null, accessToken))
  return errorHandling(res)
}
