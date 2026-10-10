import type { VideoSourceV2 } from '../videoContent'
import { shouldSendHlsCredentials } from '../videoSource'
import { Emitter, type AdapterError, type AdapterMountOptions, type AdapterState, type PlayerAdapter, type TextTrackInfo } from './types'

// Hosted video (HLS ladder with MP4 fallback) through video.js, chrome-less:
// the watch engine supplies its own control bar so seeking can be restricted.
export class VideoJsAdapter implements PlayerAdapter {
  readonly provider = 'hosted' as const
  private player: any = null
  private host: HTMLElement | null = null
  private state: AdapterState = 'ready'
  private states = new Emitter<AdapterState>()
  private errors = new Emitter<AdapterError>()
  private blobUrls: string[] = []
  private destroyed = false
  private fellBack = false

  async mount(container: HTMLElement, _source: VideoSourceV2, opts: AdapterMountOptions): Promise<void> {
    const hosted = opts.hosted
    if (!hosted?.src) throw new Error('hosted source missing')
    const { default: videojs } = await import('video.js')
    await import('videojs-contrib-quality-levels')
    await import('videojs-hls-quality-selector')
    if (this.destroyed) return

    const Vhs = (videojs as any).Vhs
    if (Vhs && !Vhs.__lhBeforeRequestSet) {
      Vhs.xhr.beforeRequest = (options: any) => {
        if (options?.uri && shouldSendHlsCredentials(options.uri)) options.withCredentials = true
        return options
      }
      Vhs.__lhBeforeRequestSet = true
    }

    const wrapper = document.createElement('div')
    wrapper.setAttribute('dir', 'ltr')
    wrapper.className = 'absolute inset-0 h-full w-full'
    wrapper.setAttribute('data-vjs-player', '')
    const videoEl = document.createElement('video-js')
    videoEl.setAttribute('playsinline', '')
    videoEl.className = 'h-full w-full'
    wrapper.appendChild(videoEl)
    container.appendChild(wrapper)
    this.host = wrapper

    await new Promise<void>((resolve) => {
      const player = videojs(
        videoEl,
        {
          controls: false,
          fill: true,
          preload: 'metadata',
          autoplay: !!opts.autoplay,
          muted: !!opts.muted,
          sources: [{ src: hosted.src, type: hosted.isHls ? 'application/x-mpegURL' : 'video/mp4' }],
          html5: { vhs: { overrideNative: true }, nativeAudioTracks: false, nativeVideoTracks: false },
        },
        () => resolve()
      )
      this.player = player
      player.on('play', () => this.set('playing'))
      player.on('playing', () => this.set('playing'))
      player.on('pause', () => this.set('paused'))
      player.on('ended', () => this.set('ended'))
      player.on('waiting', () => this.set('buffering'))
      player.on('error', () => {
        // HLS → MP4 once, then report fatal so the controller can fail over.
        if (hosted.isHls && hosted.fallbackSrc && !this.fellBack) {
          this.fellBack = true
          const resume = player.currentTime?.() ?? 0
          try {
            player.error(null)
            player.src({ src: hosted.fallbackSrc, type: 'video/mp4' })
            player.load()
            player.one('loadedmetadata', () => {
              try {
                if (resume > 0) player.currentTime(resume)
              } catch {
                /* noop */
              }
            })
            return
          } catch {
            /* fall through */
          }
        }
        this.errors.emit({ code: player.error?.()?.code ?? 'error', fatal: true })
      })
      try {
        const techEl = player.el().querySelector('video') as HTMLVideoElement | null
        techEl?.setAttribute('controlsList', 'nodownload')
        player.el().addEventListener('contextmenu', (e: Event) => e.preventDefault())
        ;(player as any).hlsQualitySelector?.({ displayCurrentQuality: true })
      } catch {
        /* best effort */
      }
      // Captions: fetched with credentials and attached as blob tracks.
      for (const track of hosted.captions || []) {
        fetch(track.url, { credentials: 'include' })
          .then(async (res) => {
            if (!res.ok || this.destroyed) return
            const vtt = await res.text()
            const blobUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
            this.blobUrls.push(blobUrl)
            player.addRemoteTextTrack({ kind: 'subtitles', src: blobUrl, srclang: track.code, label: track.label }, false)
          })
          .catch(() => {
            /* captions are best-effort */
          })
      }
    })
    this.set('ready')
  }

  private set(state: AdapterState): void {
    this.state = state
    this.states.emit(state)
  }

  private safe<T>(fn: (_p: any) => T, fallback: T): T {
    try {
      return this.player ? fn(this.player) : fallback
    } catch {
      return fallback
    }
  }

  getCurrentTime(): number {
    return Number(this.safe((p) => p.currentTime(), 0)) || 0
  }
  getDuration(): number {
    const d = Number(this.safe((p) => p.duration(), 0))
    return Number.isFinite(d) ? d : 0
  }
  getPlaybackRate(): number {
    return Number(this.safe((p) => p.playbackRate(), 1)) || 1
  }
  setPlaybackRate(rate: number): void {
    this.safe((p) => p.playbackRate(rate), undefined)
  }
  seekTo(seconds: number): void {
    this.safe((p) => p.currentTime(seconds), undefined)
  }
  play(): void {
    this.safe((p) => void Promise.resolve(p.play?.()).catch(() => {}), undefined)
  }
  pause(): void {
    this.safe((p) => p.pause(), undefined)
  }
  isPlaying(): boolean {
    return this.state === 'playing' || this.state === 'buffering'
  }
  setMuted(muted: boolean): void {
    this.safe((p) => p.muted(muted), undefined)
  }
  isMuted(): boolean {
    return !!this.safe((p) => p.muted(), false)
  }
  getTextTracks(): TextTrackInfo[] {
    const tracks = this.safe((p) => p.textTracks(), null) as any
    if (!tracks) return []
    const out: TextTrackInfo[] = []
    for (let i = 0; i < tracks.length; i += 1) {
      const t = tracks[i]
      if (t.kind === 'subtitles' || t.kind === 'captions') out.push({ code: t.language, label: t.label || t.language })
    }
    return out
  }
  setTextTrack(code: string | null): void {
    const tracks = this.safe((p) => p.textTracks(), null) as any
    if (!tracks) return
    for (let i = 0; i < tracks.length; i += 1) {
      const t = tracks[i]
      if (t.kind !== 'subtitles' && t.kind !== 'captions') continue
      t.mode = code && t.language === code ? 'showing' : 'disabled'
    }
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
    this.safe((p) => p.dispose(), undefined)
    this.player = null
    this.blobUrls.forEach((u) => URL.revokeObjectURL(u))
    this.blobUrls = []
    this.host?.remove()
    this.host = null
  }
}
