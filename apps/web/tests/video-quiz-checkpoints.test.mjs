import { describe, expect, test } from 'bun:test'
import { checkpointToTrigger, maxAllowedPosition, clampSeekToCheckpoints, sortCheckpoints } from '../lib/videoQuiz/checkpoints.ts'
import { pickLocale, missingLanguages } from '../lib/videoQuiz/localized.ts'

const cps = [
  { id: 'c2', kind: 'checkpoint', timestamp: 300 },
  { id: 'e1', kind: 'end' },
  { id: 'c1', kind: 'checkpoint', timestamp: 120 },
  { id: 'c0', kind: 'checkpoint', timestamp: 0 },
]

describe('checkpoints', () => {
  test('sorted by timestamp, end questions excluded', () => {
    expect(sortCheckpoints(cps).map((c) => c.id)).toEqual(['c0', 'c1', 'c2'])
  })
  test('triggers when crossing, not again once answered, earliest when skipping two', () => {
    expect(checkpointToTrigger(cps, 119.5, 120.1, [])?.id).toBe('c1')
    expect(checkpointToTrigger(cps, 119.5, 120.1, ['c1', 'c0'])).toBeNull()
    expect(checkpointToTrigger(cps, 100, 400, ['c0'])?.id).toBe('c1')
    expect(checkpointToTrigger(cps, 0, 0.5, [])?.id).toBe('c0')
    expect(checkpointToTrigger(cps, 130, 140, ['c0', 'c1'])).toBeNull()
  })
  test('max allowed position and seek clamp', () => {
    expect(maxAllowedPosition(cps, ['c0'], 600)).toBe(120)
    expect(maxAllowedPosition(cps, ['c0', 'c1', 'c2'], 600)).toBe(600)
    expect(clampSeekToCheckpoints(500, cps, ['c0'], 600)).toBe(120)
    expect(clampSeekToCheckpoints(120.2, cps, ['c0'], 600)).toBe(120.2)
    expect(clampSeekToCheckpoints(50, cps, ['c0'], 600)).toBe(50)
  })
})

describe('localized', () => {
  test('fallback chain and missing languages', () => {
    expect(pickLocale({ ko: '안녕', en: 'Hi' }, 'ko-KR')).toBe('안녕')
    expect(pickLocale({ en: 'Hi' }, 'fr')).toBe('Hi')
    expect(pickLocale({ pt: 'Olá' }, 'fr')).toBe('Olá')
    expect(pickLocale(null, 'ko')).toBe('')
    expect(missingLanguages([{ en: 'a', ko: 'b' }, { en: 'c' }])).toEqual(['ko', 'it', 'fr', 'es', 'pt'])
  })
})
