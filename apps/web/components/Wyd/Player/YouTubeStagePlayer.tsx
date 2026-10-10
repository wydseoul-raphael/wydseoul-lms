'use client'
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import YouTube, { type YouTubeEvent, type YouTubePlayer } from 'react-youtube'
import { useTranslation } from 'react-i18next'
import { Play, Pause, Volume2, VolumeX, Maximize } from 'lucide-react'
import { cn } from '@/lib/utils'
import { mapYtState, mapYtError, type StagePlayerState, type ProgressSample } from './playerState'

export interface YouTubeStagePlayerHandle {
  play(): void
  pause(): void
  mute(): void
  unmute(): void
  getCurrentTime(): number
  getDuration(): number
  getPlayer(): YouTubePlayer | null
}

export interface YouTubeStagePlayerProps {
  videoId: string
  // youtube-nocookie keeps the embed out of the visitor's YouTube history.
  host?: string
  autoplay?: boolean
  // Interval of `onProgress` samples while playing. The watch-verification
  // tracker (phase 3) subscribes here; 1 s matches the reference client.
  progressIntervalMs?: number
  onReady?: (_player: YouTubePlayer) => void
  onStateChange?: (_state: StagePlayerState, _player: YouTubePlayer) => void
  onProgress?: (_sample: ProgressSample) => void
  onError?: (_code: number) => void
  className?: string
}

// A YouTube embed with the native chrome disabled and our own control bar:
// play/pause, mute, fullscreen — and deliberately no seek bar. The iframe is
// made inert (pointer-events: none + a click shield) so viewers cannot reach
// YouTube's own controls, which is what lets phase 3 enforce watch policy.
export const YouTubeStagePlayer = forwardRef<YouTubeStagePlayerHandle, YouTubeStagePlayerProps>(
  function YouTubeStagePlayer(
    { videoId, host = 'https://www.youtube-nocookie.com', autoplay = false, progressIntervalMs = 1000, onReady, onStateChange, onProgress, onError, className },
    ref
  ) {
    const { t, i18n } = useTranslation()
    const stageRef = useRef<HTMLDivElement>(null)
    const playerRef = useRef<YouTubePlayer | null>(null)
    const [ready, setReady] = useState(false)
    const [playing, setPlaying] = useState(false)
    const [muted, setMuted] = useState(false)
    const [errorKey, setErrorKey] = useState<'error' | 'unavailable' | null>(null)
    const [fullscreenEnabled, setFullscreenEnabled] = useState(false)

    useEffect(() => {
      setFullscreenEnabled(typeof document !== 'undefined' && !!document.fullscreenEnabled)
    }, [])

    const safe = useCallback(<T,>(fn: (_p: YouTubePlayer) => T, fallback: T): T => {
      try {
        return playerRef.current ? fn(playerRef.current) : fallback
      } catch {
        return fallback
      }
    }, [])

    useImperativeHandle(ref, () => ({
      play: () => safe((p) => p.playVideo(), undefined),
      pause: () => safe((p) => p.pauseVideo(), undefined),
      mute: () => {
        safe((p) => p.mute(), undefined)
        setMuted(true)
      },
      unmute: () => {
        safe((p) => p.unMute(), undefined)
        setMuted(false)
      },
      getCurrentTime: () => Number(safe((p) => p.getCurrentTime(), 0)) || 0,
      getDuration: () => Number(safe((p) => p.getDuration(), 0)) || 0,
      getPlayer: () => playerRef.current,
    }))

    // Progress sampling while playing (+ one sample when playback stops).
    useEffect(() => {
      if (!onProgress) return
      const emit = (isPlaying: boolean) =>
        onProgress({
          currentTime: Number(safe((p) => p.getCurrentTime(), 0)) || 0,
          duration: Number(safe((p) => p.getDuration(), 0)) || 0,
          playing: isPlaying,
          wallClock: Date.now(),
        })
      if (!playing) {
        if (ready) emit(false)
        return
      }
      emit(true)
      const id = window.setInterval(() => emit(true), progressIntervalMs)
      return () => window.clearInterval(id)
    }, [playing, ready, onProgress, progressIntervalMs, safe])

    const lang = i18n.language.split('-')[0]

    return (
      <div className={cn('w-full', className)}>
        <div
          ref={stageRef}
          className="relative aspect-video w-full overflow-hidden rounded-t-[10px] bg-black shadow-[0_18px_60px_rgba(0,0,0,0.35)]"
          role="group"
          aria-label={t('wyd.player.label', { defaultValue: 'Video player' })}
        >
          <YouTube
            videoId={videoId}
            className="absolute inset-0 h-full w-full"
            iframeClassName="pointer-events-none absolute inset-0 h-full w-full"
            opts={{
              width: '100%',
              height: '100%',
              host,
              playerVars: {
                controls: 0,
                disablekb: 1,
                fs: 0,
                rel: 0,
                modestbranding: 1,
                playsinline: 1,
                iv_load_policy: 3,
                cc_load_policy: 1,
                cc_lang_pref: lang,
                hl: lang,
                autoplay: autoplay ? 1 : 0,
                origin: typeof window !== 'undefined' ? window.location.origin : undefined,
              },
            }}
            onReady={(e: YouTubeEvent) => {
              playerRef.current = e.target
              try {
                const iframe = e.target.getIframe?.()
                iframe?.setAttribute('tabindex', '-1')
                iframe?.setAttribute('title', t('wyd.player.label', { defaultValue: 'Video player' }))
              } catch {
                /* iframe not reachable yet */
              }
              setReady(true)
              setErrorKey(null)
              onReady?.(e.target)
            }}
            onStateChange={(e: YouTubeEvent<number>) => {
              const state = mapYtState(e.data)
              setPlaying(state === 'playing')
              onStateChange?.(state, e.target)
            }}
            onError={(e: YouTubeEvent<number>) => {
              setErrorKey(mapYtError(e.data))
              onError?.(e.data)
            }}
          />
          {/* Click shield: toggles playback instead of exposing YouTube's UI. */}
          <button
            type="button"
            aria-label={playing ? t('wyd.player.pause', { defaultValue: 'Pause' }) : t('wyd.player.play', { defaultValue: 'Play' })}
            onClick={() => (playing ? safe((p) => p.pauseVideo(), undefined) : safe((p) => p.playVideo(), undefined))}
            className="absolute inset-0 z-10 cursor-pointer bg-transparent"
          />
          {!ready && !errorKey && (
            <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center text-sm font-semibold text-white/70">
              {t('wyd.player.loading', { defaultValue: 'Loading…' })}
            </div>
          )}
          {errorKey && (
            <div role="alert" className="absolute inset-0 z-20 grid place-items-center bg-black/80 p-6 text-center text-sm font-semibold text-white">
              {t(`wyd.player.${errorKey}`)}
            </div>
          )}
        </div>

        <div className="flex min-h-[48px] flex-wrap items-center gap-1.5 rounded-b-[10px] bg-[#111] px-2.5 py-2 text-white">
          <button
            type="button"
            onClick={() => (playing ? safe((p) => p.pauseVideo(), undefined) : safe((p) => p.playVideo(), undefined))}
            className="inline-flex items-center gap-2 rounded-lg bg-[#292929] px-3 py-2 text-[13px] font-bold hover:bg-[#3a3a3a] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-wyd-yellow"
          >
            {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
            {playing ? t('wyd.player.pause', { defaultValue: 'Pause' }) : t('wyd.player.play', { defaultValue: 'Play' })}
          </button>
          <button
            type="button"
            aria-pressed={muted}
            onClick={() => {
              const next = !muted
              safe((p) => (next ? p.mute() : p.unMute()), undefined)
              setMuted(next)
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-[#292929] px-3 py-2 text-[13px] font-bold hover:bg-[#3a3a3a] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-wyd-yellow"
          >
            {muted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
            {muted ? t('wyd.player.unmute', { defaultValue: 'Unmute' }) : t('wyd.player.mute', { defaultValue: 'Mute' })}
          </button>
          {fullscreenEnabled && (
            <button
              type="button"
              onClick={() => stageRef.current?.requestFullscreen?.()}
              className="ms-auto inline-flex items-center gap-2 rounded-lg bg-[#292929] px-3 py-2 text-[13px] font-bold hover:bg-[#3a3a3a] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-wyd-yellow"
            >
              <Maximize size={16} aria-hidden="true" />
              {t('wyd.player.fullscreen', { defaultValue: 'Fullscreen' })}
            </button>
          )}
        </div>
      </div>
    )
  }
)

export default YouTubeStagePlayer
