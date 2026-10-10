import type { VideoSourceV2 } from '../videoContent'
import { isFatalYouTubeError } from '../videoContent'
import { Emitter, type AdapterError, type AdapterMountOptions, type AdapterState, type PlayerAdapter, type TextTrackInfo } from './types'

let apiPromise: Promise<any> | null = null

// Load the IFrame API script once per page; the global callback is chained so
// other users of the API (react-youtube, the boards block) keep working. The
// window globals are read untyped on purpose: another component already
// declares them and conflicting ambient declarations fail the build.
export function loadYouTubeApi(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  const w = window as any
  if (w.YT?.Player) return Promise.resolve(w.YT)
  if (apiPromise) return apiPromise
  apiPromise = new Promise((resolve, reject) => {
    const prev = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve(w.YT)
    }
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      s.async = true
      s.onerror = () => reject(new Error('playerError'))
      document.head.appendChild(s)
    }
    window.setTimeout(() => reject(new Error('playerError')), 15_000)
  })
  return apiPromise
}

export class YouTubeAdapter implements PlayerAdapter {
  readonly provider = 'youtube' as const
  private player: any = null
  private host: HTMLDivElement | null = null
  private state: AdapterState = 'ready'
  private muted = false
  private captionsOn = true
  private states = new Emitter<AdapterState>()
  private errors = new Emitter<AdapterError>()
  private destroyed = false

  async mount(container: HTMLElement, source: VideoSourceV2, opts: AdapterMountOptions): Promise<void> {
    const YT = await loadYouTubeApi()
    if (this.destroyed) return
    const host = document.createElement('div')
    host.className = 'absolute inset-0 h-full w-full'
    container.appendChild(host)
    this.host = host
    this.muted = !!opts.muted
    await new Promise<void>((resolve) => {
      this.player = new YT.Player(host, {
        host: 'https://www.youtube-nocookie.com',
        videoId: source.videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          modestbranding: 1,
          iv_load_policy: 3,
          playsinline: 1,
          cc_load_policy: 1,
          cc_lang_pref: opts.lang,
          hl: opts.lang,
          autoplay: opts.autoplay ? 1 : 0,
          origin: window.location.origin,
        },
        events: {
          onReady: (e: any) => {
            try {
              const iframe = e.target?.getIframe?.()
              iframe?.setAttribute('tabindex', '-1')
              iframe?.classList.add('pointer-events-none')
              if (this.muted) e.target?.mute?.()
              e.target?.loadModule?.('captions')
              e.target?.setOption?.('captions', 'track', { languageCode: opts.lang })
            } catch {
              /* best effort */
            }
            this.state = 'ready'
            this.states.emit('ready')
            resolve()
          },
          onStateChange: (e: any) => {
            const map: Record<number, AdapterState> = { 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'ready' }
            const next = map[e.data] ?? 'ready'
            this.state = next
            this.states.emit(next)
          },
          onError: (e: any) => {
            this.errors.emit({ code: e.data, fatal: isFatalYouTubeError(e.data) })
          },
        },
      })
    })
  }

  private safe<T>(fn: (_p: any) => T, fallback: T): T {
    try {
      return this.player ? fn(this.player) : fallback
    } catch {
      return fallback
    }
  }

  getCurrentTime(): number {
    return Number(this.safe((p) => p.getCurrentTime?.(), 0)) || 0
  }
  getDuration(): number {
    return Number(this.safe((p) => p.getDuration?.(), 0)) || 0
  }
  getPlaybackRate(): number {
    return Number(this.safe((p) => p.getPlaybackRate?.(), 1)) || 1
  }
  setPlaybackRate(rate: number): void {
    this.safe((p) => p.setPlaybackRate?.(rate), undefined)
  }
  seekTo(seconds: number): void {
    this.safe((p) => p.seekTo?.(seconds, true), undefined)
  }
  play(): void {
    this.safe((p) => p.playVideo?.(), undefined)
  }
  pause(): void {
    this.safe((p) => p.pauseVideo?.(), undefined)
  }
  isPlaying(): boolean {
    return this.state === 'playing'
  }
  setMuted(muted: boolean): void {
    this.muted = muted
    this.safe((p) => (muted ? p.mute?.() : p.unMute?.()), undefined)
  }
  isMuted(): boolean {
    return this.muted
  }
  getTextTracks(): TextTrackInfo[] {
    const list = this.safe((p) => p.getOption?.('captions', 'tracklist'), null) as any[] | null
    if (!Array.isArray(list)) return []
    return list
      .filter((t) => t?.languageCode)
      .map((t) => ({ code: String(t.languageCode), label: String(t.displayName || t.languageName || t.languageCode) }))
  }
  setTextTrack(code: string | null): void {
    if (!code) {
      this.captionsOn = false
      this.safe((p) => p.unloadModule?.('captions'), undefined)
      return
    }
    this.captionsOn = true
    this.safe((p) => {
      p.loadModule?.('captions')
      p.setOption?.('captions', 'track', { languageCode: code })
    }, undefined)
  }
  onStateChange(cb: (_s: AdapterState) => void): () => void {
    return this.states.on(cb)
  }
  onError(cb: (_e: AdapterError) => void): () => void {
    return this.errors.on(cb)
  }
  destroy(): void {
    this.destroyed = true
    this.states.clear()
    this.errors.clear()
    this.safe((p) => p.destroy?.(), undefined)
    this.player = null
    this.host?.remove()
    this.host = null
  }
}
