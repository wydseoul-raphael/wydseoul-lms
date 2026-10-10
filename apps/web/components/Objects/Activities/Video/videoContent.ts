// Pure helpers for the v2 video activity content (mirrors the API's
// services/video_progress/video_content.py). No React, bun-testable.

export type VideoProvider = 'hosted' | 'youtube' | 'vimeo'

export interface VideoSourceV2 {
  provider: VideoProvider
  filename?: string
  videoId?: string
  hash?: string
  label?: string
}

export interface SignVideoV2 {
  provider: 'hosted' | 'youtube'
  filename?: string
  videoId?: string
}

export interface VideoContentV2 {
  schemaVersion: 2
  sources: VideoSourceV2[]
  signVideo: SignVideoV2 | null
  // Legacy mirrors kept for old readers.
  uri?: string
  type?: string
  filename?: string
  [key: string]: unknown
}

export interface VideoDetailsV2 {
  startTime?: number
  endTime?: number | null
  autoplay?: boolean
  muted?: boolean
  durationSeconds?: number
  durationSource?: string
  verifiedWatch?: boolean
  policyVersion?: number
  captions?: { default?: string }
  endQuiz?: unknown
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/

export function extractYouTubeId(value: string | null | undefined): string {
  const raw = (value || '').trim()
  if (!raw) return ''
  if (YT_ID.test(raw)) return raw
  const m = raw.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/)
  return m ? m[1] : ''
}

export function extractVimeo(value: string | null | undefined): { videoId: string; hash?: string } {
  const raw = (value || '').trim()
  if (!raw) return { videoId: '' }
  if (/^\d{5,15}$/.test(raw)) return { videoId: raw }
  const m = raw.match(/vimeo\.com\/(?:video\/)?(\d{5,15})(?:\/([A-Za-z0-9]{6,32}))?/)
  if (!m) return { videoId: '' }
  let hash = m[2]
  if (!hash) {
    const h = raw.match(/[?&]h=([A-Za-z0-9]{6,32})/)
    hash = h ? h[1] : undefined
  }
  return hash ? { videoId: m[1], hash } : { videoId: m[1] }
}

export function normalizeVideoContent(content: Record<string, any> | null | undefined, subType?: string): VideoContentV2 {
  const c = { ...(content || {}) }
  let sources: VideoSourceV2[] = Array.isArray(c.sources)
    ? c.sources.filter((s: any) => s && ['hosted', 'youtube', 'vimeo'].includes(s.provider)).map((s: any) => ({ ...s }))
    : []
  if (sources.length === 0) {
    if (c.filename || subType === 'SUBTYPE_VIDEO_HOSTED') {
      if (c.filename) sources.push({ provider: 'hosted', filename: c.filename })
    }
    if (c.uri) {
      if ((c.type || 'youtube') === 'vimeo') {
        const v = extractVimeo(c.uri)
        if (v.videoId) sources.push({ provider: 'vimeo', ...v })
      } else {
        const id = extractYouTubeId(c.uri)
        if (id) sources.push({ provider: 'youtube', videoId: id })
      }
    }
  }
  const sign = c.signVideo && typeof c.signVideo === 'object' ? (c.signVideo as SignVideoV2) : null
  return { ...c, schemaVersion: 2, sources, signVideo: sign }
}

export function isVerifiedWatch(details: VideoDetailsV2 | null | undefined): boolean {
  return !!details?.verifiedWatch
}

// YouTube IFrame API error codes that mean "this source will not play here".
export function isFatalYouTubeError(code: number): boolean {
  return [2, 5, 100, 101, 150].includes(Number(code))
}

// Index of the next source to try after `current` failed, or -1 when exhausted.
export function nextSourceIndex(sources: VideoSourceV2[], current: number): number {
  const next = current + 1
  return next < sources.length ? next : -1
}
