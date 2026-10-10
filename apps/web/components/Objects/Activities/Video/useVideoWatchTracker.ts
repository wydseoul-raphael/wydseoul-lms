'use client'
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@/lib/query/keys'
import { startWatchSession, sendHeartbeat, closeWatchSession, type VideoProgressSnapshot } from '@services/courses/videoProgress'
import type { PlayerAdapter, AdapterState } from './adapters/types'
import type { VideoProvider } from './videoContent'
import { HeartbeatQueue, type HeartbeatPayload } from './heartbeatQueue'
import { HEARTBEAT_MS, LOCAL_POLL_MS, FORWARD_SEEK_SLACK_S, NINETY_PERCENT, clampRate } from './watchPolicy'

export type TrackerStatus = 'idle' | 'starting' | 'tracking' | 'superseded' | 'error'

export interface WatchTracker {
  status: TrackerStatus
  snapshot: VideoProgressSnapshot | null
  // Furthest position the viewer may seek to (server-verified + honest local advance).
  furthest: number
  seekRestricted: boolean
  syncError: boolean
  // Current adapter state mirrored for the UI.
  playing: boolean
  currentTime: number
  duration: number
  restart(): void
  // The control bar routes every seek through here.
  requestSeek(_target: number): void
}

interface Options {
  adapterRef: MutableRefObject<PlayerAdapter | null>
  // Bumps whenever a new adapter is mounted (source failover).
  adapterVersion: number
  activityUuid: string
  provider: VideoProvider
  orgId?: number
  courseUuid?: string
  enabled: boolean
  onComplete?: () => void
}

// Drives the watch-verification protocol against one PlayerAdapter:
// start session → local 500 ms polling → 10 s heartbeats (+ pause/ended/
// hidden/90 % events) → server snapshot. The server decides what counted;
// the hook only restricts seeking so honest viewers never trip the policy.
export function useVideoWatchTracker(opts: Options): WatchTracker {
  const { adapterRef, adapterVersion, activityUuid, provider, orgId, courseUuid, enabled, onComplete } = opts
  const session = useLHSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()

  const [status, setStatus] = useState<TrackerStatus>('idle')
  const [snapshot, setSnapshot] = useState<VideoProgressSnapshot | null>(null)
  const [furthest, setFurthest] = useState(0)
  const [seekRestricted, setSeekRestricted] = useState(false)
  const [syncError, setSyncError] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const sessionIdRef = useRef<string | null>(null)
  const furthestRef = useRef(0)
  const lastPollRef = useRef<{ t: number; wall: number } | null>(null)
  const lastHeartbeatAtRef = useRef(0)
  const ninetySentRef = useRef(false)
  const completedRef = useRef(false)
  const playingRef = useRef(false)
  const visibleRef = useRef(true)
  const toastTimerRef = useRef<number | null>(null)
  const queueRef = useRef<HeartbeatQueue | null>(null)
  const restartNonceRef = useRef(0)
  const [restartNonce, setRestartNonce] = useState(0)

  const applySnapshot = useCallback(
    (snap: VideoProgressSnapshot) => {
      setSnapshot(snap)
      if (Number.isFinite(snap.furthestVerifiedPosition)) {
        furthestRef.current = Math.max(furthestRef.current, snap.furthestVerifiedPosition)
        setFurthest(furthestRef.current)
      }
      if (snap.newlyComplete && !completedRef.current) {
        completedRef.current = true
        if (orgId) queryClient.invalidateQueries({ queryKey: queryKeys.trail.org(orgId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.videoProgress.activity(activityUuid) })
        if (courseUuid) {
          queryClient.invalidateQueries({ queryKey: queryKeys.videoProgress.course(courseUuid) })
          queryClient.invalidateQueries({ queryKey: queryKeys.courses.meta(courseUuid) })
        }
        onComplete?.()
      } else if (snap.isComplete) {
        completedRef.current = true
      }
    },
    [activityUuid, courseUuid, orgId, onComplete, queryClient]
  )

  const showSeekToast = useCallback(() => {
    setSeekRestricted(true)
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setSeekRestricted(false), 3000)
  }, [])

  // Build the heartbeat queue once per session.
  const ensureQueue = useCallback(() => {
    if (queueRef.current) return queueRef.current
    queueRef.current = new HeartbeatQueue({
      send: (payload: HeartbeatPayload, { keepalive }) => sendHeartbeat(payload, token, { keepalive }),
      onResult: (result) => {
        setSyncError(false)
        applySnapshot(result as VideoProgressSnapshot)
      },
      onError: (error) => {
        const status = (error as { status?: number })?.status
        if (status === 409) {
          setStatus('superseded')
          adapterRef.current?.pause()
          return
        }
        if (status === 404) {
          // Session vanished (server restart / expiry): start a new one.
          sessionIdRef.current = null
          setStatus('idle')
          return
        }
        if ((queueRef.current?.errors ?? 0) >= 3) setSyncError(true)
      },
    })
    return queueRef.current
  }, [adapterRef, applySnapshot, token])

  const heartbeat = useCallback(
    (state: 'playing' | 'paused' | 'ended', { keepalive = false } = {}) => {
      const adapter = adapterRef.current
      const sid = sessionIdRef.current
      if (!adapter || !sid) return
      lastHeartbeatAtRef.current = Date.now()
      ensureQueue().push(
        {
          sessionId: sid,
          activityUuid,
          currentTime: adapter.getCurrentTime(),
          playbackRate: clampRate(adapter.getPlaybackRate()),
          playerState: state,
          visible: visibleRef.current,
          sourceProvider: provider,
        },
        { keepalive }
      )
    },
    [activityUuid, adapterRef, ensureQueue, provider]
  )

  const startSession = useCallback(async () => {
    if (!enabled || !token || sessionIdRef.current || status === 'starting') return
    setStatus('starting')
    try {
      const snap = await startWatchSession(
        activityUuid,
        { sourceProvider: provider, clientReportedDuration: adapterRef.current?.getDuration() || undefined },
        token
      )
      sessionIdRef.current = snap.sessionId
      queueRef.current?.reset()
      queueRef.current = null
      furthestRef.current = snap.furthestVerifiedPosition || 0
      setFurthest(furthestRef.current)
      ninetySentRef.current = false
      applySnapshot(snap)
      // Resume where the learner stopped (never beyond what was verified).
      const resume = Math.min(snap.resumePosition || 0, furthestRef.current || snap.resumePosition || 0)
      const dur = adapterRef.current?.getDuration() || snap.durationSeconds || 0
      if (resume > 1 && (!dur || resume < dur - 5)) adapterRef.current?.seekTo(resume)
      lastHeartbeatAtRef.current = Date.now()
      setStatus('tracking')
      // Anchor heartbeat so the server has a position to measure from.
      heartbeat(playingRef.current ? 'playing' : 'paused')
    } catch (error) {
      const code = (error as { status?: number })?.status
      setStatus(code === 403 ? 'error' : 'error')
    }
  }, [activityUuid, adapterRef, applySnapshot, enabled, heartbeat, provider, status, token])

  // Seek requests from the control bar: backwards always, forwards only into
  // verified territory.
  const requestSeek = useCallback(
    (target: number) => {
      const adapter = adapterRef.current
      if (!adapter) return
      const limit = furthestRef.current + FORWARD_SEEK_SLACK_S
      const dur = adapter.getDuration()
      const clamped = Math.max(0, Math.min(target, limit, dur > 0 ? dur : Infinity))
      adapter.seekTo(clamped)
      setCurrentTime(clamped)
      lastPollRef.current = { t: clamped, wall: performance.now() }
      if (target > limit + 0.5) showSeekToast()
    },
    [adapterRef, showSeekToast]
  )

  // Adapter subscriptions + polling, re-armed on failover/restart.
  useEffect(() => {
    const adapter = adapterRef.current
    if (!adapter || !enabled) return
    let cancelled = false

    const offState = adapter.onStateChange((s: AdapterState) => {
      if (cancelled) return
      const nowPlaying = s === 'playing' || s === 'buffering'
      const wasPlaying = playingRef.current
      playingRef.current = nowPlaying
      setPlaying(nowPlaying)
      if (nowPlaying && !wasPlaying) {
        lastPollRef.current = null
        if (!sessionIdRef.current) void startSession()
        else heartbeat('playing')
      } else if (!nowPlaying && wasPlaying) {
        heartbeat(s === 'ended' ? 'ended' : 'paused')
      }
    })

    const poll = window.setInterval(() => {
      if (cancelled) return
      const t = adapter.getCurrentTime()
      const d = adapter.getDuration()
      const rate = clampRate(adapter.getPlaybackRate())
      const wall = performance.now()
      setCurrentTime(t)
      if (d > 0) setDuration(d)
      if (!playingRef.current) {
        lastPollRef.current = { t, wall }
        return
      }
      const prev = lastPollRef.current
      if (prev) {
        const dt = (wall - prev.wall) / 1000
        const honestAdvance = dt * rate + 1.0
        if (t > prev.t + honestAdvance && t > furthestRef.current + FORWARD_SEEK_SLACK_S) {
          // A jump the control bar did not make (media keys, embedded UI): pull back.
          adapter.seekTo(furthestRef.current)
          setCurrentTime(furthestRef.current)
          lastPollRef.current = { t: furthestRef.current, wall }
          showSeekToast()
          return
        }
        if (t <= prev.t + honestAdvance) {
          furthestRef.current = Math.max(furthestRef.current, t)
          setFurthest(furthestRef.current)
        }
      }
      lastPollRef.current = { t, wall }
      if (!sessionIdRef.current) return
      if (!ninetySentRef.current && d > 0 && t / d >= NINETY_PERCENT) {
        ninetySentRef.current = true
        heartbeat('playing')
        return
      }
      if (Date.now() - lastHeartbeatAtRef.current >= HEARTBEAT_MS) heartbeat('playing')
    }, LOCAL_POLL_MS)

    const onVisibility = () => {
      visibleRef.current = !document.hidden
      if (document.hidden && playingRef.current) {
        heartbeat('paused')
        adapter.pause()
      }
    }
    const onPageHide = () => {
      if (sessionIdRef.current) {
        void closeWatchSession(sessionIdRef.current, adapter.getCurrentTime(), token).catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)

    return () => {
      cancelled = true
      offState()
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapterVersion, enabled, restartNonce, activityUuid])

  // Close the session when the page unmounts.
  useEffect(() => {
    return () => {
      const sid = sessionIdRef.current
      const adapter = adapterRef.current
      if (sid) void closeWatchSession(sid, adapter?.getCurrentTime() ?? null, token).catch(() => {})
      sessionIdRef.current = null
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityUuid])

  const restart = useCallback(() => {
    sessionIdRef.current = null
    queueRef.current = null
    setStatus('idle')
    restartNonceRef.current += 1
    setRestartNonce(restartNonceRef.current)
    void startSession()
  }, [startSession])

  return { status, snapshot, furthest, seekRestricted, syncError, playing, currentTime, duration, restart, requestSeek }
}
