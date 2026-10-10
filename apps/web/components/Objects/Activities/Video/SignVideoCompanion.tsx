'use client'
import React, { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { PlayerAdapter } from './adapters/types'
import { createAdapter } from './adapters'
import type { SignVideoV2 } from './videoContent'
import { shouldSyncSign } from './watchPolicy'
import { getActivityVideoStreamUrl } from '@services/media/media'

interface Props {
  signVideo: SignVideoV2
  mainRef: React.MutableRefObject<PlayerAdapter | null>
  mainPlaying: boolean
  lang: string
  ids: { orgUuid: string; courseUuid: string; activityUuid: string }
  visible: boolean
}

// Sign-language companion: a second, muted player kept in lock-step with the
// main one (seek when drift > 0.7 s, mirror play/pause and rate). It never
// reports to the watch tracker.
export function SignVideoCompanion({ signVideo, mainRef, mainPlaying, lang, ids, visible }: Props) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<PlayerAdapter | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const adapter = createAdapter(signVideo.provider === 'hosted' ? 'hosted' : 'youtube')
    adapterRef.current = adapter
    let disposed = false
    const source =
      signVideo.provider === 'hosted'
        ? { provider: 'hosted' as const, filename: signVideo.filename }
        : { provider: 'youtube' as const, videoId: signVideo.videoId }
    adapter
      .mount(container, source, {
        lang,
        muted: true,
        hosted:
          signVideo.provider === 'hosted' && signVideo.filename
            ? { src: getActivityVideoStreamUrl(ids.orgUuid, ids.courseUuid, ids.activityUuid, signVideo.filename), isHls: false }
            : undefined,
      })
      .then(() => {
        if (disposed) return
        adapter.setMuted(true)
      })
      .catch(() => {
        /* companion is best-effort */
      })
    const sync = window.setInterval(() => {
      const main = mainRef.current
      if (!main || disposed) return
      const mt = main.getCurrentTime()
      if (shouldSyncSign(mt, adapter.getCurrentTime())) adapter.seekTo(mt)
      const rate = main.getPlaybackRate()
      if (Math.abs(adapter.getPlaybackRate() - rate) > 0.01) adapter.setPlaybackRate(rate)
      if (main.isPlaying() && !adapter.isPlaying()) adapter.play()
      if (!main.isPlaying() && adapter.isPlaying()) adapter.pause()
    }, 1000)
    return () => {
      disposed = true
      window.clearInterval(sync)
      adapter.destroy()
      adapterRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signVideo.provider, signVideo.filename, signVideo.videoId, ids.activityUuid])

  useEffect(() => {
    const adapter = adapterRef.current
    if (!adapter) return
    if (mainPlaying) adapter.play()
    else adapter.pause()
  }, [mainPlaying])

  return (
    <div
      aria-label={t('activities.video_engine.sign_video', { defaultValue: 'Sign language video' })}
      className={`absolute bottom-3 end-3 z-20 aspect-video w-[30%] min-w-[160px] max-w-[360px] overflow-hidden rounded-lg bg-black shadow-[0_10px_30px_rgba(0,0,0,0.5)] ring-1 ring-white/20 ${visible ? '' : 'hidden'}`}
    >
      <div ref={containerRef} className="relative h-full w-full [&_iframe]:pointer-events-none" />
    </div>
  )
}

export default SignVideoCompanion
