import type { VideoProvider, VideoSourceV2 } from '../videoContent'
import type { CaptionTrack } from '../videoSource'

export type AdapterState = 'ready' | 'playing' | 'paused' | 'ended' | 'buffering'

export interface AdapterError {
  code: string | number
  // fatal: this source will not play here → try the next one.
  fatal: boolean
}

export interface TextTrackInfo {
  code: string
  label: string
}

export interface AdapterMountOptions {
  lang: string
  muted?: boolean
  autoplay?: boolean
  // Hosted playback: resolved stream URLs + caption VTTs.
  hosted?: { src: string; isHls: boolean; fallbackSrc?: string; captions?: CaptionTrack[] }
}

// One interface over YouTube IFrame API, video.js (hosted HLS/MP4) and the
// Vimeo Player SDK, so the watch tracker and the control bar never care which
// backend is playing. Every getter is synchronous (adapters cache values from
// the player's own events where the SDK is promise-based).
export interface PlayerAdapter {
  readonly provider: VideoProvider
  mount(_container: HTMLElement, _source: VideoSourceV2, _opts: AdapterMountOptions): Promise<void>
  getCurrentTime(): number
  getDuration(): number
  getPlaybackRate(): number
  setPlaybackRate(_rate: number): void
  seekTo(_seconds: number): void
  play(): void
  pause(): void
  isPlaying(): boolean
  setMuted(_muted: boolean): void
  isMuted(): boolean
  getTextTracks(): TextTrackInfo[]
  setTextTrack(_code: string | null): void
  onStateChange(_cb: (_state: AdapterState) => void): () => void
  onError(_cb: (_error: AdapterError) => void): () => void
  destroy(): void
}

export type Unsubscribe = () => void

export class Emitter<T> {
  private listeners = new Set<(_v: T) => void>()
  on(cb: (_v: T) => void): Unsubscribe {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  emit(v: T): void {
    this.listeners.forEach((cb) => {
      try {
        cb(v)
      } catch {
        /* listener errors must not break playback */
      }
    })
  }
  clear(): void {
    this.listeners.clear()
  }
}
