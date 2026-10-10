import { describe, expect, test } from 'bun:test'
import { clampSeek, isRunaway, shouldSendHeartbeat, formatVerifiedReadout, clampRate, HEARTBEAT_MS } from '../components/Objects/Activities/Video/watchPolicy.ts'
import { normalizeVideoContent, extractYouTubeId, extractVimeo, isFatalYouTubeError, nextSourceIndex } from '../components/Objects/Activities/Video/videoContent.ts'
import { HeartbeatQueue } from '../components/Objects/Activities/Video/heartbeatQueue.ts'

describe('watchPolicy', () => {
  test('clampSeek allows rewinds and caps forward seeks at the verified front', () => {
    expect(clampSeek(10, 100, 600)).toBe(10)
    expect(clampSeek(300, 100, 600)).toBeCloseTo(101.5)
    expect(clampSeek(-5, 100, 600)).toBe(0)
    expect(clampSeek(700, 650, 600)).toBe(600)
    expect(clampSeek(50, 0, 0)).toBeCloseTo(1.5)
  })
  test('isRunaway only while playing and beyond slack', () => {
    expect(isRunaway(120, 100, true)).toBe(true)
    expect(isRunaway(102, 100, true)).toBe(false)
    expect(isRunaway(120, 100, false)).toBe(false)
  })
  test('shouldSendHeartbeat triggers', () => {
    expect(shouldSendHeartbeat({ playing: true, lastSentAt: 0, now: HEARTBEAT_MS })).toBe('interval')
    expect(shouldSendHeartbeat({ playing: true, lastSentAt: 0, now: HEARTBEAT_MS - 1 })).toBe('none')
    expect(shouldSendHeartbeat({ playing: false, lastSentAt: 0, now: 99999 })).toBe('none')
    expect(shouldSendHeartbeat({ playing: true, lastSentAt: 0, now: 1, stateChanged: 'pause' })).toBe('pause')
    expect(shouldSendHeartbeat({ playing: true, lastSentAt: 0, now: 1, crossedNinety: true })).toBe('ninety')
  })
  test('readout and rate', () => {
    expect(formatVerifiedReadout(571, 540)).toBe('9:00 / 9:00 · 100%')
    expect(formatVerifiedReadout(65, 540)).toBe('1:05 / 9:00 · 12%')
    expect(formatVerifiedReadout(65, null)).toBe('1:05')
    expect(clampRate(3)).toBe(2)
    expect(clampRate(0)).toBe(1)
  })
})

describe('videoContent', () => {
  test('ids', () => {
    expect(extractYouTubeId('https://youtu.be/42M5kFJU804?t=1')).toBe('42M5kFJU804')
    expect(extractYouTubeId('nope')).toBe('')
    expect(extractVimeo('https://vimeo.com/123456789/abcdef12')).toEqual({ videoId: '123456789', hash: 'abcdef12' })
  })
  test('normalizes legacy content and failover order', () => {
    const n = normalizeVideoContent({ uri: 'https://youtu.be/42M5kFJU804', type: 'youtube' })
    expect(n.sources).toEqual([{ provider: 'youtube', videoId: '42M5kFJU804' }])
    const h = normalizeVideoContent({ filename: 'video_a.mp4' }, 'SUBTYPE_VIDEO_HOSTED')
    expect(h.sources[0].provider).toBe('hosted')
    expect(nextSourceIndex(n.sources, 0)).toBe(-1)
    expect(nextSourceIndex([{ provider: 'hosted' }, { provider: 'youtube' }], 0)).toBe(1)
    expect(isFatalYouTubeError(150)).toBe(true)
    expect(isFatalYouTubeError(0)).toBe(false)
  })
})

describe('HeartbeatQueue', () => {
  const draft = { sessionId: 'ws_1', activityUuid: 'a', currentTime: 1, playbackRate: 1, playerState: 'playing', visible: true }
  test('seq increases and retries reuse the seq', async () => {
    const sent = []
    let fail = 1
    const q = new HeartbeatQueue({
      send: async (p) => {
        sent.push(p.seq)
        if (fail > 0) { fail -= 1; throw Object.assign(new Error('net'), { status: 0 }) }
        return { ok: true }
      },
    })
    await q.push(draft)
    await q.push(draft)
    expect(sent).toEqual([1, 1, 2])
    expect(q.nextSeq).toBe(3)
  })
  test('409 is terminal and counted', async () => {
    const errors = []
    const q = new HeartbeatQueue({
      send: async () => { throw Object.assign(new Error('conflict'), { status: 409 }) },
      onError: (e) => errors.push(e.status),
    })
    await q.push(draft)
    expect(errors).toEqual([409])
    expect(q.errors).toBe(1)
  })
  test('newest draft replaces a waiting one', async () => {
    const times = []
    let release
    const gate = new Promise((r) => { release = r })
    const q = new HeartbeatQueue({ send: async (p) => { times.push(p.currentTime); if (p.seq === 1) await gate; return {} } })
    const first = q.push({ ...draft, currentTime: 1 })
    q.push({ ...draft, currentTime: 2 })
    q.push({ ...draft, currentTime: 3 })
    release()
    await first
    expect(times).toEqual([1, 3])
  })
})
