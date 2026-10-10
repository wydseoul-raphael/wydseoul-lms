import type { VideoSourceV2 } from '../videoContent'
import { Emitter, type AdapterError, type AdapterMountOptions, type AdapterState, type PlayerAdapter, type TextTrackInfo } from './types'

// Vimeo Player SDK is promise-based; the adapter caches time/duration/rate
// from the player's own events so the tracker can read them synchronously.
// Use "Unlisted" + "embed on specific domains" on the Vimeo side; password
// protected videos break autoplay/sync because the viewer must type into the
// iframe.
export class VimeoAdapter implements PlayerAdapter {
  readonly provider = 'vimeo' as const
  private player: any = null
  private host: HTMLDivElement | null = null
  private state: AdapterState = 'ready'
  private currentTime = 0
  private duration = 0
  private rate = 1
  private muted = false
  private tracks: TextTrackInfo[] = []
  private states = new Emitter<AdapterState>()
  private errors = new Emitter<AdapterError>()
  private destroyed = false

  async mount(container: HTMLElement, source: VideoSourceV2, opts: AdapterMountOptions): Promise<void> {
    const { default: Player } = await import('@vimeo/player')
    if (this.destroyed) return
    const host = document.createElement('div')
    host.className = 'absolute inset-0 h-full w-full [&>iframe]:h-full [&>iframe]:w-full [&>iframe]:pointer-events-none'
    container.appendChild(host)
    this.host = host
    this.muted = !!opts.muted
    const options: any = {
      id: Number(source.videoId),
      controls: false,
      dnt: true,
      playsinline: true,
      autopause: false,
      muted: !!opts.muted,
      autoplay: !!opts.autoplay,
      texttrack: opts.lang,
      keyboard: false,
    }
    if (source.hash) options.h = source.hash
    const player = new Player(host, options)
    this.player = player
    player.on('play', () => this.set('playing'))
    player.on('pause', () => this.set('paused'))
    player.on('ended', () => this.set('ended'))
    player.on('bufferstart', () => this.set('buffering'))
    player.on('bufferend', () => {
      if (this.state === 'buffering') this.set('playing')
    })
    player.on('timeupdate', (d: any) => {
      this.currentTime = Number(d?.seconds) || 0
      if (d?.duration) this.duration = Number(d.duration) || this.duration
    })
    player.on('durationchange', (d: any) => {
      this.duration = Number(d?.duration) || this.duration
    })
    player.on('playbackratechange', (d: any) => {
      this.rate = Number(d?.playbackRate) || 1
    })
    player.on('error', (e: any) => {
      const name = String(e?.name || 'Error')
      const fatal = ['PrivacyError', 'NotFoundError', 'PasswordError', 'InvalidTrackError'].includes(name) || name === 'Error'
      this.errors.emit({ code: name, fatal })
    })
    try {
      await player.ready()
      this.duration = Number(await player.getDuration()) || 0
      const list = (await player.getTextTracks()) as any[]
      this.tracks = (list || []).map((t) => ({ code: String(t.language), label: String(t.label || t.language) }))
    } catch (e: any) {
      this.errors.emit({ code: String(e?.name || 'Error'), fatal: true })
      return
    }
    this.set('ready')
  }

  private set(state: AdapterState): void {
    this.state = state
    this.states.emit(state)
  }

  getCurrentTime(): number {
    return this.currentTime
  }
  getDuration(): number {
    return this.duration
  }
  getPlaybackRate(): number {
    return this.rate
  }
  setPlaybackRate(rate: number): void {
    this.rate = rate
    void this.player?.setPlaybackRate?.(rate).catch(() => {})
  }
  seekTo(seconds: number): void {
    this.currentTime = seconds
    void this.player?.setCurrentTime?.(seconds).catch(() => {})
  }
  play(): void {
    void this.player?.play?.().catch(() => {})
  }
  pause(): void {
    void this.player?.pause?.().catch(() => {})
  }
  isPlaying(): boolean {
    return this.state === 'playing' || this.state === 'buffering'
  }
  setMuted(muted: boolean): void {
    this.muted = muted
    void this.player?.setMuted?.(muted).catch(() => {})
  }
  isMuted(): boolean {
    return this.muted
  }
  getTextTracks(): TextTrackInfo[] {
    return this.tracks
  }
  setTextTrack(code: string | null): void {
    if (!code) {
      void this.player?.disableTextTrack?.().catch(() => {})
      return
    }
    void this.player?.enableTextTrack?.(code).catch(() => {})
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
    void this.player?.destroy?.().catch(() => {})
    this.player = null
    this.host?.remove()
    this.host = null
  }
}
