'use client'
import React, { useMemo, useRef, useState } from 'react'
import YouTube from 'react-youtube'
import toast from 'react-hot-toast'
import { Upload, Trash, ArrowDown, ArrowUp, Timer, ShieldCheck, HandWaving, ClosedCaptioning, LinkSimple } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { AVAILABLE_LANGUAGES } from '@/lib/languages'
import {
  updateVideoPlaybackConfig,
  uploadManualCaption,
  deleteManualCaption,
  uploadSignVideo,
  probeVideoUrl,
  type PlaybackConfigIn,
} from '@services/courses/videoProgress'
import { normalizeVideoContent, extractYouTubeId, extractVimeo, type VideoSourceV2, type SignVideoV2 } from './videoContent'
import { formatClock } from './watchPolicy'

interface Props {
  activity: any
  onSaved?: (_result: { content: any; details: any }) => void
}

const inputCls =
  'w-full h-9 px-3 text-sm rounded-lg bg-gray-50 border border-gray-200 outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition-colors'
const btnCls = 'inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg transition-colors disabled:opacity-50'

// Instructor panel for the watch-verification engine: trusted duration (auto
// probed), verified-watch switch, ordered backup sources (DR), sign-language
// companion and volunteer-translated caption tracks.
export default function VideoPlaybackConfigPanel({ activity, onSaved }: Props) {
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const isHosted = activity.activity_sub_type === 'SUBTYPE_VIDEO_HOSTED'
  const initial = useMemo(() => normalizeVideoContent(activity.content, activity.activity_sub_type), [activity])
  const details = activity.details || {}

  const [sources, setSources] = useState<VideoSourceV2[]>(initial.sources)
  const [signVideo, setSignVideo] = useState<SignVideoV2 | null>(initial.signVideo)
  const [signUrl, setSignUrl] = useState(initial.signVideo?.provider === 'youtube' ? `https://youtu.be/${initial.signVideo.videoId}` : '')
  // Seed the length from the admin value, else from the HLS probe.
  const hlsDuration = activity.extra_metadata?.hls?.duration
  const [duration, setDuration] = useState<number | ''>(
    details.durationSeconds ?? (hlsDuration ? Math.round(hlsDuration) : '')
  )
  const [durationSource, setDurationSource] = useState<string>(
    details.durationSource || (details.durationSeconds ? 'admin' : hlsDuration ? 'probe:hls' : '')
  )
  const [verifiedWatch, setVerifiedWatch] = useState<boolean>(details.verifiedWatch ?? true)
  const [backupUrl, setBackupUrl] = useState('')
  const [probeId, setProbeId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [captionLang, setCaptionLang] = useState('ko')
  const [captionFile, setCaptionFile] = useState<File | null>(null)
  const [captionBusy, setCaptionBusy] = useState(false)
  const [manualTracks, setManualTracks] = useState<any[]>(
    ((activity.extra_metadata?.captions?.languages as any[]) || []).filter((l) => l.source === 'manual')
  )
  const signFileRef = useRef<HTMLInputElement>(null)

  const primaryYouTube = sources.find((s) => s.provider === 'youtube')?.videoId

  // Duration: hosted → HLS probe already stored; YouTube → hidden IFrame
  // player; Vimeo → oEmbed via the API.
  const measureDuration = async () => {
    const primary = sources[0]
    if (!primary) return
    if (primary.provider === 'youtube' && primary.videoId) {
      setProbeId(primary.videoId)
      return
    }
    if (primary.provider === 'vimeo' && primary.videoId) {
      try {
        const res = await probeVideoUrl(`https://vimeo.com/${primary.videoId}${primary.hash ? `/${primary.hash}` : ''}`, token)
        if (res.durationSeconds) {
          setDuration(Math.round(res.durationSeconds))
          setDurationSource('probe:vimeo')
        } else toast.error('Vimeo did not report a duration')
      } catch {
        toast.error('Could not probe the Vimeo video')
      }
      return
    }
    if (activity.extra_metadata?.hls?.duration) {
      setDuration(Math.round(activity.extra_metadata.hls.duration))
      setDurationSource('probe:hls')
    } else toast('Upload finishes transcoding first; then the length is measured automatically')
  }

  const addBackup = () => {
    const raw = backupUrl.trim()
    const yt = extractYouTubeId(raw)
    if (yt) {
      setSources((s) => [...s, { provider: 'youtube', videoId: yt }])
      setBackupUrl('')
      return
    }
    const v = extractVimeo(raw)
    if (v.videoId) {
      setSources((s) => [...s, { provider: 'vimeo', videoId: v.videoId, ...(v.hash ? { hash: v.hash } : {}) }])
      setBackupUrl('')
      return
    }
    toast.error('Paste a YouTube or Vimeo URL')
  }

  const move = (i: number, dir: -1 | 1) => {
    setSources((s) => {
      const next = [...s]
      const j = i + dir
      if (j < 0 || j >= next.length) return s
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    const toastId = toast.loading('Saving playback settings…')
    try {
      const payload: PlaybackConfigIn = {
        sources,
        verifiedWatch,
        ...(duration !== '' ? { durationSeconds: Number(duration), durationSource: (durationSource || 'admin') as any } : {}),
      }
      if (signUrl.trim()) {
        const id = extractYouTubeId(signUrl)
        if (!id) throw new Error('Sign video needs a YouTube URL')
        payload.signVideo = { provider: 'youtube', videoId: id }
      } else if (signVideo?.provider === 'hosted') {
        payload.signVideo = signVideo
      } else {
        payload.signVideo = null
      }
      const res = await updateVideoPlaybackConfig(activity.activity_uuid, payload, token)
      toast.success('Playback settings saved', { id: toastId })
      onSaved?.(res)
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save playback settings', { id: toastId })
    } finally {
      setSaving(false)
    }
  }

  const uploadCaption = async () => {
    if (!captionFile) return
    setCaptionBusy(true)
    try {
      const label = AVAILABLE_LANGUAGES.find((l) => l.code === captionLang)?.nativeName || captionLang
      const captions = await uploadManualCaption(activity.activity_uuid, captionLang, label, captionFile, token)
      setManualTracks((captions.languages || []).filter((l: any) => l.source === 'manual'))
      setCaptionFile(null)
      toast.success(`Caption track ${captionLang} uploaded`)
    } catch (e: any) {
      toast.error(e?.message || 'Caption upload failed')
    } finally {
      setCaptionBusy(false)
    }
  }

  const removeCaption = async (code: string) => {
    try {
      const captions = await deleteManualCaption(activity.activity_uuid, code, token)
      setManualTracks((captions.languages || []).filter((l: any) => l.source === 'manual'))
    } catch (e: any) {
      toast.error(e?.message || 'Could not remove the track')
    }
  }

  const onSignFile = async (file: File | null) => {
    if (!file) return
    const toastId = toast.loading('Uploading sign language video…')
    try {
      const res = await uploadSignVideo(activity.activity_uuid, file, token)
      setSignVideo(res.signVideo)
      setSignUrl('')
      toast.success('Sign language video uploaded', { id: toastId })
    } catch (e: any) {
      toast.error(e?.message || 'Upload failed', { id: toastId })
    }
  }

  return (
    <div className="rounded-xl nice-shadow p-4 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700 inline-flex items-center gap-2">
          <ShieldCheck size={16} weight="duotone" className="text-wyd-blue" /> Watch verification (WYD)
        </h3>
        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600">
          <input type="checkbox" checked={verifiedWatch} onChange={(e) => setVerifiedWatch(e.target.checked)} className="rounded border-gray-300" />
          Require verified viewing (90%)
        </label>
      </div>

      {/* Trusted duration */}
      <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-500 inline-flex items-center gap-1">
            <Timer size={14} /> Trusted video length (seconds)
          </label>
          <input
            type="number"
            min={1}
            value={duration}
            onChange={(e) => {
              setDuration(e.target.value === '' ? '' : Math.max(1, Number(e.target.value)))
              setDurationSource('admin')
            }}
            className={inputCls}
            placeholder="e.g. 600"
          />
          <p className="text-[11px] text-gray-400">
            {duration !== '' ? `${formatClock(Number(duration))} · source: ${durationSource || 'admin'}` : 'Required: completion is judged against this length, never the browser\'s.'}
          </p>
        </div>
        <button type="button" onClick={measureDuration} className={`${btnCls} bg-gray-100 text-gray-700 hover:bg-gray-200`}>
          Measure automatically
        </button>
      </div>
      {probeId && (
        <div className="h-0 w-0 overflow-hidden" aria-hidden="true">
          <YouTube
            videoId={probeId}
            opts={{ width: '1', height: '1', playerVars: { controls: 0 } }}
            onReady={(e) => {
              const d = Math.round(Number(e.target.getDuration?.() || 0))
              if (d > 0) {
                setDuration(d)
                setDurationSource('probe:youtube')
                toast.success(`Measured ${formatClock(d)} from YouTube`)
              } else toast.error('YouTube did not report a duration (private or unavailable video?)')
              setProbeId(null)
            }}
            onError={() => {
              toast.error('YouTube could not load this video. Use an Unlisted (not Private) video.')
              setProbeId(null)
            }}
          />
        </div>
      )}

      {/* Sources */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-gray-500 inline-flex items-center gap-1">
          <LinkSimple size={14} /> Playback sources (first = primary, others = failover backups)
        </label>
        <ul className="space-y-1.5">
          {sources.map((s, i) => (
            <li key={`${s.provider}-${s.videoId || s.filename}`} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm">
              <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold uppercase text-gray-500 ring-1 ring-gray-200">{s.provider}</span>
              <span className="flex-1 truncate text-gray-700">{s.provider === 'hosted' ? s.filename : s.videoId}</span>
              {i === 0 && <span className="text-[11px] font-semibold text-wyd-blue">primary</span>}
              <button type="button" aria-label="Move up" onClick={() => move(i, -1)} className="p-1 text-gray-400 hover:text-gray-700"><ArrowUp size={14} /></button>
              <button type="button" aria-label="Move down" onClick={() => move(i, 1)} className="p-1 text-gray-400 hover:text-gray-700"><ArrowDown size={14} /></button>
              {!(s.provider === 'hosted' && isHosted) && (
                <button type="button" aria-label="Remove" onClick={() => setSources((list) => list.filter((_, k) => k !== i))} className="p-1 text-gray-400 hover:text-rose-600"><Trash size={14} /></button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input value={backupUrl} onChange={(e) => setBackupUrl(e.target.value)} placeholder="Backup: YouTube (unlisted) or Vimeo URL" className={inputCls} />
          <button type="button" onClick={addBackup} className={`${btnCls} bg-gray-900 text-white hover:bg-gray-800`}>Add</button>
        </div>
        <p className="text-[11px] text-gray-400">If the primary source fails (removed video, embedding blocked), the player switches to the next one automatically.</p>
      </div>

      {/* Sign language */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-gray-500 inline-flex items-center gap-1">
          <HandWaving size={14} /> Sign language companion video
        </label>
        <div className="flex gap-2">
          <input value={signUrl} onChange={(e) => setSignUrl(e.target.value)} placeholder="YouTube URL of the sign language version" className={inputCls} />
          <button type="button" onClick={() => signFileRef.current?.click()} className={`${btnCls} bg-gray-100 text-gray-700 hover:bg-gray-200`}>
            <Upload size={14} /> Upload file
          </button>
          <input ref={signFileRef} type="file" accept="video/mp4,video/webm" className="hidden" onChange={(e) => onSignFile(e.target.files?.[0] ?? null)} />
        </div>
        {signVideo?.provider === 'hosted' && !signUrl && (
          <p className="text-[11px] text-gray-500">Uploaded: {signVideo.filename} <button type="button" className="text-rose-600 underline" onClick={() => setSignVideo(null)}>remove</button></p>
        )}
      </div>

      {/* Manual captions (hosted only; YouTube uses its own tracks) */}
      {isHosted && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500 inline-flex items-center gap-1">
            <ClosedCaptioning size={14} /> Translated captions (VTT / SRT, uploaded by volunteers)
          </label>
          {manualTracks.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {manualTracks.map((l) => (
                <li key={l.code} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  {l.label} ({l.code})
                  <button type="button" aria-label={`Remove ${l.code}`} onClick={() => removeCaption(l.code)} className="text-emerald-700/70 hover:text-rose-600"><Trash size={12} /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <select value={captionLang} onChange={(e) => setCaptionLang(e.target.value)} className={`${inputCls} w-auto`}>
              {AVAILABLE_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.nativeName} ({l.code})</option>
              ))}
            </select>
            <input type="file" accept=".vtt,.srt,text/vtt" onChange={(e) => setCaptionFile(e.target.files?.[0] ?? null)} className="text-sm text-gray-500 file:me-3 file:rounded-full file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-xs" />
            <button type="button" disabled={!captionFile || captionBusy} onClick={uploadCaption} className={`${btnCls} bg-gray-900 text-white hover:bg-gray-800`}>Upload</button>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={saving} className={`${btnCls} h-9 px-4 bg-wyd-blue text-white hover:bg-wyd-blue-dark`}>
          {saving ? 'Saving…' : 'Save watch settings'}
        </button>
      </div>
      <p className="text-[11px] text-gray-400">
        YouTube videos must be <b>Unlisted</b> (not Private) to play inside the learning center. YouTube serves the video; the center only records verified progress.
      </p>
    </div>
  )
}
