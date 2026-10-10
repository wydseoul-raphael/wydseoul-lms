// Pure helpers for the YouTube stage player (bun-testable).

export type StagePlayerState = 'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued'

// YT.PlayerState codes → readable states.
export function mapYtState(code: number): StagePlayerState {
  switch (code) {
    case 0:
      return 'ended'
    case 1:
      return 'playing'
    case 2:
      return 'paused'
    case 3:
      return 'buffering'
    case 5:
      return 'cued'
    default:
      return 'unstarted'
  }
}

export interface ProgressSample {
  currentTime: number
  duration: number
  playing: boolean
  // Date.now() at sampling time; a tracker compares Δwall vs ΔcurrentTime.
  wallClock: number
}

// YouTube embed error codes → i18n key suffix under `wyd.player`.
export function mapYtError(code: number): 'error' | 'unavailable' {
  // 100 removed/private, 101/150 embedding disabled → "unavailable";
  // 2 bad id, 5 HTML5 error → generic error.
  return code === 100 || code === 101 || code === 150 ? 'unavailable' : 'error'
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}
