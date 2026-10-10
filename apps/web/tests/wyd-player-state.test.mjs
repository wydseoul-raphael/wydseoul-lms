import { describe, expect, test } from 'bun:test'
import { mapYtState, mapYtError, formatClock } from '../components/Wyd/Player/playerState.ts'

describe('mapYtState', () => {
  test('maps YT.PlayerState codes', () => {
    expect(mapYtState(-1)).toBe('unstarted')
    expect(mapYtState(0)).toBe('ended')
    expect(mapYtState(1)).toBe('playing')
    expect(mapYtState(2)).toBe('paused')
    expect(mapYtState(3)).toBe('buffering')
    expect(mapYtState(5)).toBe('cued')
    expect(mapYtState(42)).toBe('unstarted')
  })
})

describe('mapYtError', () => {
  test('embedding/removed videos are "unavailable", the rest generic', () => {
    expect(mapYtError(100)).toBe('unavailable')
    expect(mapYtError(101)).toBe('unavailable')
    expect(mapYtError(150)).toBe('unavailable')
    expect(mapYtError(2)).toBe('error')
    expect(mapYtError(5)).toBe('error')
  })
})

describe('formatClock', () => {
  test('m:ss and h:mm:ss', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(3600)).toBe('1:00:00')
    expect(formatClock(3725.9)).toBe('1:02:05')
    expect(formatClock(-3)).toBe('0:00')
  })
})
