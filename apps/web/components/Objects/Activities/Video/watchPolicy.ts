// Client mirror of the server watch policy (services/video_progress/progress_math.py).
// The server is the source of truth; these helpers only decide WHEN to talk to
// it and HOW to restrict the player so honest viewers never trip the policy.

export const HEARTBEAT_MS = 10_000
export const LOCAL_POLL_MS = 500
export const FORWARD_SEEK_SLACK_S = 1.5
export const SIGN_SYNC_TOLERANCE_S = 0.7
export const NINETY_PERCENT = 0.9
export const MAX_PLAYBACK_RATE = 2

// Forward seeks are allowed only up to what the server has already verified
// (plus a little slack for the interval in flight). Rewinding is always fine.
export function clampSeek(target: number, furthestVerified: number, duration: number): number {
  const d = Number.isFinite(duration) && duration > 0 ? duration : Infinity
  const limit = Math.min(d, Math.max(0, furthestVerified) + FORWARD_SEEK_SLACK_S)
  return Math.max(0, Math.min(target, limit))
}

// True when the local poll sees the player past what was verified: the viewer
// used a shortcut the control bar does not expose (media keys, YouTube's own
// keyboard shortcuts) and must be pulled back.
export function isRunaway(currentTime: number, furthestVerified: number, playing: boolean): boolean {
  if (!playing) return false
  return currentTime > furthestVerified + FORWARD_SEEK_SLACK_S + 1
}

export type HeartbeatTrigger = 'interval' | 'pause' | 'ended' | 'hidden' | 'ninety' | 'none'

export function shouldSendHeartbeat(args: {
  playing: boolean
  lastSentAt: number
  now: number
  stateChanged?: 'pause' | 'ended' | 'hidden'
  crossedNinety?: boolean
}): HeartbeatTrigger {
  if (args.stateChanged) return args.stateChanged
  if (args.crossedNinety) return 'ninety'
  if (args.playing && args.now - args.lastSentAt >= HEARTBEAT_MS) return 'interval'
  return 'none'
}

export function shouldSyncSign(mainTime: number, signTime: number): boolean {
  return Math.abs(mainTime - signTime) > SIGN_SYNC_TOLERANCE_S
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

// "9:31 / 10:00 · 95%" — verified seconds against the required amount.
export function formatVerifiedReadout(verified: number, required: number | null | undefined): string {
  if (!required || required <= 0) return formatClock(verified)
  const pct = Math.min(100, Math.round((verified / required) * 100))
  return `${formatClock(Math.min(verified, required))} / ${formatClock(required)} · ${pct}%`
}

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 1
  return Math.min(MAX_PLAYBACK_RATE, rate)
}
