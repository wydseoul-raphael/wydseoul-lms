'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, Maximize, Captions, Hand as HandWaving, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'
import { cn } from '@/lib/utils'
import { createAdapter, type PlayerAdapter } from './adapters'
import { normalizeVideoContent, nextSourceIndex, type VideoDetailsV2 } from './videoContent'
import { isActivityHlsReady, resolveActivityVideoSource, resolveActivityCaptions } from './videoSource'
import { useVideoWatchTracker } from './useVideoWatchTracker'
import { formatClock, formatVerifiedReadout, MAX_PLAYBACK_RATE } from './watchPolicy'
import { SignVideoCompanion } from './SignVideoCompanion'

const RATES = [0.75, 1, 1.25, 1.5, 2]
const SKIP_S = 15

interface Props {
  activity: any
  course: { course_uuid: string }
  orgUuid?: string
  onComplete?: () => void
}

// Learner-facing player for verified-watch video activities: chrome-less
// backend (YouTube / hosted HLS / Vimeo) + our own control bar with a
// restricted seek slider, verified-time readout, captions, sign-language
// companion and automatic failover to backup sources.
export default function VerifiedVideoPlayer({ activity, course, orgUuid, onComplete }: Props) {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const resolvedOrgUuid = orgUuid || org?.org_uuid
  const lang = i18n.language.split('-')[0]

  const content = useMemo(() => normalizeVideoContent(activity?.content, activity?.activity_sub_type), [activity])
  const details: VideoDetailsV2 = activity?.details || {}
  const sources = content.sources
  const [sourceIndex, setSourceIndex] = useState(0)
  const source = sources[sourceIndex]

  const stageRef = useRef<HTMLDivElement>(null)
  const mountRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<PlayerAdapter | null>(null)
  const [adapterVersion, setAdapterVersion] = useState(0)
  const [mountError, setMountError] = useState<string | null>(null)
  const [muted, setMuted] = useState(!!details.muted)
  const [rate, setRate] = useState(1)
  const [tracks, setTracks] = useState<{ code: string; label: string }[]>([])
  const [track, setTrack] = useState<string | null>(details.captions?.default || lang)
  const [showSign, setShowSign] = useState(() => {
    try {
      return localStorage.getItem('wyd_sign_video') === '1'
    } catch {
      return false
    }
  })
  const [fullscreenEnabled, setFullscreenEnabled] = useState(false)
  const resumeOnFailoverRef = useRef(0)

  useEffect(() => setFullscreenEnabled(typeof document !== 'undefined' && !!document.fullscreenEnabled), [])

  const tracker = useVideoWatchTracker({
    adapterRef,
    adapterVersion,
    activityUuid: activity.activity_uuid,
    provider: source?.provider || 'youtube',
    orgId: org?.id,
    courseUuid: course?.course_uuid,
    enabled: !!source,
    onComplete,
  })

  // Mount the adapter for the current source; fail over on fatal errors.
  useEffect(() => {
    const host = mountRef.current
    if (!host || !source) return
    let disposed = false
    setMountError(null)
    const adapter = createAdapter(source.provider)
    adapterRef.current = adapter
    const hlsReady = isActivityHlsReady(activity)
    const hosted =
      source.provider === 'hosted'
        ? {
            ...resolveActivityVideoSource({ hlsReady, orgUuid: resolvedOrgUuid, courseUuid: course?.course_uuid, activityUuid: activity.activity_uuid, filename: source.filename }),
            fallbackSrc: hlsReady
              ? resolveActivityVideoSource({ hlsReady: false, orgUuid: resolvedOrgUuid, courseUuid: course?.course_uuid, activityUuid: activity.activity_uuid, filename: source.filename }).src
              : undefined,
            captions: resolveActivityCaptions(activity, { orgUuid: resolvedOrgUuid, courseUuid: course?.course_uuid, activityUuid: activity.activity_uuid }),
          }
        : undefined
    const offError = adapter.onError((e) => {
      if (disposed || !e.fatal) return
      const next = nextSourceIndex(sources, sourceIndex)
      if (next === -1) {
        setMountError(t('activities.video_engine.unavailable', { defaultValue: 'This video is not available right now.' }))
        return
      }
      resumeOnFailoverRef.current = adapter.getCurrentTime()
      toast(t('activities.video_engine.failover', { defaultValue: 'Switched to a backup video source.' }))
      setSourceIndex(next)
    })
    adapter
      .mount(host, source, { lang, muted, autoplay: false, hosted })
      .then(() => {
        if (disposed) return
        setAdapterVersion((v) => v + 1)
        setTracks(adapter.getTextTracks())
        if (track) adapter.setTextTrack(track)
        if (resumeOnFailoverRef.current > 0) {
          adapter.seekTo(resumeOnFailoverRef.current)
          resumeOnFailoverRef.current = 0
        }
      })
      .catch(() => {
        if (disposed) return
        const next = nextSourceIndex(sources, sourceIndex)
        if (next === -1) setMountError(t('activities.video_engine.unavailable', { defaultValue: 'This video is not available right now.' }))
        else setSourceIndex(next)
      })
    return () => {
      disposed = true
      offError()
      adapter.destroy()
      if (adapterRef.current === adapter) adapterRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceIndex, activity?.activity_uuid])

  // Captions list may arrive late (YouTube loads the module after ready).
  useEffect(() => {
    if (!adapterRef.current) return
    const id = window.setTimeout(() => setTracks(adapterRef.current?.getTextTracks() || []), 2500)
    return () => window.clearTimeout(id)
  }, [adapterVersion])

  const togglePlay = useCallback(() => {
    const a = adapterRef.current
    if (!a) return
    if (tracker.playing) a.pause()
    else a.play()
  }, [tracker.playing])

  const snap = tracker.snapshot
  const duration = tracker.duration || snap?.durationSeconds || 0
  const required = snap?.requiredWatchSeconds ?? (snap?.durationSeconds ? snap.durationSeconds * 0.9 : null)
  const verified = snap?.verifiedWatchSeconds ?? 0
  const complete = !!snap?.isComplete
  const allowedPct = duration > 0 ? Math.min(100, (tracker.furthest / duration) * 100) : 0
  const positionPct = duration > 0 ? Math.min(100, (tracker.currentTime / duration) * 100) : 0
  const coverageStops = useMemo(() => {
    if (!snap?.coverageBuckets?.length || !duration) return ''
    const bucket = snap.policy?.bucketSeconds || 5
    return snap.coverageBuckets
      .map((i) => {
        const a = Math.min(100, (i * bucket * 100) / duration)
        const b = Math.min(100, ((i + 1) * bucket * 100) / duration)
        return `rgba(22,131,92,0.75) ${a}% ${b}%`
      })
      .join(', ')
  }, [snap?.coverageBuckets, snap?.policy?.bucketSeconds, duration])

  const ids = { orgUuid: resolvedOrgUuid, courseUuid: course?.course_uuid, activityUuid: activity.activity_uuid }
  const btn = 'inline-flex items-center gap-1.5 rounded-lg bg-[#292929] px-2.5 py-2 text-[12px] font-bold text-white hover:bg-[#3a3a3a] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-wyd-yellow disabled:opacity-40'

  if (!source) {
    return <div className="rounded-xl bg-black/80 p-8 text-center text-sm text-white">{t('activities.video_engine.no_source', { defaultValue: 'No video source configured.' })}</div>
  }

  return (
    <div className="w-full">
      <div ref={stageRef} className="relative w-full overflow-hidden rounded-t-[10px] bg-black">
        <div className="relative aspect-video w-full">
          <div ref={mountRef} className="absolute inset-0" />
          {/* Click shield: the embed's own UI is unreachable; click toggles playback. */}
          <button
            type="button"
            aria-label={tracker.playing ? t('wyd.player.pause', { defaultValue: 'Pause' }) : t('wyd.player.play', { defaultValue: 'Play' })}
            onClick={togglePlay}
            className="absolute inset-0 z-10 cursor-pointer bg-transparent"
          />
          {content.signVideo && (
            <SignVideoCompanion signVideo={content.signVideo} mainRef={adapterRef} mainPlaying={tracker.playing} lang={lang} ids={ids} visible={showSign} />
          )}
          {mountError && (
            <div role="alert" className="absolute inset-0 z-30 grid place-items-center bg-black/85 p-6 text-center text-sm font-semibold text-white">
              {mountError}
            </div>
          )}
          {tracker.status === 'superseded' && (
            <div role="alert" className="absolute inset-0 z-30 grid place-items-center bg-black/85 p-6 text-center text-white">
              <div className="max-w-md">
                <p className="text-sm font-semibold">{t('activities.video_engine.superseded', { defaultValue: 'Playback started in another tab or device, so this tab stopped recording progress.' })}</p>
                <button type="button" onClick={tracker.restart} className="mt-4 rounded-lg bg-wyd-blue px-4 py-2 text-sm font-bold text-white hover:bg-wyd-blue-dark">
                  {t('activities.video_engine.continue_here', { defaultValue: 'Continue here' })}
                </button>
              </div>
            </div>
          )}
          {tracker.seekRestricted && (
            <div role="status" aria-live="polite" className="absolute inset-x-4 top-4 z-30 rounded-lg bg-wyd-yellow px-4 py-2 text-center text-[13px] font-bold text-wyd-navy shadow">
              {t('activities.video_engine.seek_restricted', { defaultValue: 'You can only move within the part you have already watched. Rewinding is always available.' })}
            </div>
          )}
        </div>
      </div>

      <div dir="ltr" className="flex flex-wrap items-center gap-1.5 rounded-b-[10px] bg-[#111] px-2.5 py-2 text-white" aria-label={t('wyd.player.label', { defaultValue: 'Video player' })}>
        <button type="button" onClick={togglePlay} className={btn} disabled={!!mountError}>
          {tracker.playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
          {tracker.playing ? t('wyd.player.pause', { defaultValue: 'Pause' }) : t('wyd.player.play', { defaultValue: 'Play' })}
        </button>
        <button type="button" onClick={() => tracker.requestSeek(tracker.currentTime - SKIP_S)} className={btn} aria-label={t('activities.video_engine.back_15', { defaultValue: 'Back 15 seconds' })}>
          <RotateCcw size={15} aria-hidden="true" />15
        </button>
        <button type="button" onClick={() => tracker.requestSeek(tracker.currentTime + SKIP_S)} className={btn} aria-label={t('activities.video_engine.forward_15', { defaultValue: 'Forward 15 seconds' })}>
          <RotateCw size={15} aria-hidden="true" />15
        </button>

        <label className="flex min-w-[180px] flex-1 items-center gap-2 px-1 text-[11px] tabular-nums">
          <span className="sr-only">{t('activities.video_engine.position', { defaultValue: 'Playback position' })}</span>
          <span aria-hidden="true">{formatClock(tracker.currentTime)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, duration)}
            step={0.1}
            value={Math.min(tracker.currentTime, Math.max(1, duration))}
            onChange={(e) => tracker.requestSeek(Number(e.target.value) || 0)}
            aria-valuetext={`${formatClock(tracker.currentTime)} / ${formatClock(duration)} · ${t('activities.video_engine.seek_allowed_until', { defaultValue: 'Available through {{time}}', time: formatClock(tracker.furthest) })}`}
            className="wyd-seek h-2 flex-1 cursor-pointer appearance-none rounded-full"
            style={{
              background: `linear-gradient(to right, #0047bb 0%, #0047bb ${positionPct}%, rgba(255,255,255,0.35) ${positionPct}%, rgba(255,255,255,0.35) ${allowedPct}%, rgba(255,255,255,0.12) ${allowedPct}%, rgba(255,255,255,0.12) 100%)${coverageStops ? `, linear-gradient(to right, ${coverageStops})` : ''}`,
            }}
          />
          <span aria-hidden="true">{formatClock(duration)}</span>
        </label>

        <select
          aria-label={t('activities.video_engine.speed', { defaultValue: 'Playback speed' })}
          value={rate}
          onChange={(e) => {
            const r = Math.min(MAX_PLAYBACK_RATE, Number(e.target.value) || 1)
            setRate(r)
            adapterRef.current?.setPlaybackRate(r)
          }}
          className="rounded-lg bg-[#292929] px-2 py-2 text-[12px] font-bold text-white"
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-pressed={muted}
          onClick={() => {
            const next = !muted
            setMuted(next)
            adapterRef.current?.setMuted(next)
          }}
          className={btn}
        >
          {muted ? <VolumeX size={15} aria-hidden="true" /> : <Volume2 size={15} aria-hidden="true" />}
        </button>
        {tracks.length > 0 && (
          <label className="inline-flex items-center gap-1 rounded-lg bg-[#292929] px-2 py-1.5 text-[12px] font-bold">
            <Captions size={15} aria-hidden="true" />
            <span className="sr-only">{t('activities.video_engine.captions', { defaultValue: 'Captions' })}</span>
            <select
              value={track ?? ''}
              onChange={(e) => {
                const code = e.target.value || null
                setTrack(code)
                adapterRef.current?.setTextTrack(code)
              }}
              className="bg-transparent text-white [&>option]:text-black"
            >
              <option value="">{t('activities.video_engine.captions_off', { defaultValue: 'Off' })}</option>
              {tracks.map((tr) => (
                <option key={tr.code} value={tr.code}>
                  {tr.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {content.signVideo && (
          <button
            type="button"
            aria-pressed={showSign}
            onClick={() => {
              const next = !showSign
              setShowSign(next)
              try {
                localStorage.setItem('wyd_sign_video', next ? '1' : '0')
              } catch {
                /* ignore */
              }
            }}
            className={cn(btn, showSign && 'bg-wyd-blue hover:bg-wyd-blue-dark')}
          >
            <HandWaving size={15} aria-hidden="true" />
            {t('activities.video_engine.sign_video', { defaultValue: 'Sign language' })}
          </button>
        )}
        {fullscreenEnabled && (
          <button type="button" onClick={() => stageRef.current?.requestFullscreen?.()} className={btn} aria-label={t('wyd.player.fullscreen', { defaultValue: 'Fullscreen' })}>
            <Maximize size={15} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[13px]">
        <span className="font-semibold text-wyd-ink">
          {t('activities.video_engine.verified_watch', { defaultValue: 'Verified viewing time' })} {formatVerifiedReadout(verified, required)}
        </span>
        {complete ? (
          <span className="inline-flex items-center gap-1 font-bold text-wyd-success">
            <CheckCircle2 size={15} aria-hidden="true" /> {t('activities.video_engine.video_completed', { defaultValue: 'Video completed' })}
          </span>
        ) : snap && !snap.durationTrusted ? (
          <span className="inline-flex items-center gap-1 text-wyd-muted">
            <AlertTriangle size={14} aria-hidden="true" /> {t('activities.video_engine.duration_missing', { defaultValue: 'Progress will count once an administrator has verified the video length.' })}
          </span>
        ) : required ? (
          <span className="text-wyd-muted">{t('activities.video_engine.remaining', { defaultValue: '{{time}} remaining', time: formatClock(Math.max(0, required - verified)) })}</span>
        ) : null}
      </div>
      {tracker.syncError && (
        <div role="alert" className="mt-2 rounded-lg border border-wyd-yellow bg-[#fff9d8] px-3 py-2 text-[13px] font-semibold text-wyd-navy">
          {t('activities.video_engine.sync_error', { defaultValue: 'Progress could not be saved. Check your connection and keep playing.' })}
        </div>
      )}
      {tracker.status === 'error' && (
        <div role="alert" className="mt-2 rounded-lg border border-wyd-red/40 bg-[#fff0f1] px-3 py-2 text-[13px] font-semibold text-wyd-red">
          {t('activities.video_engine.session_error', { defaultValue: 'Could not start a verified watch session for this video.' })}
        </div>
      )}
    </div>
  )
}
