import { describe, expect, test } from 'bun:test'
import { daysLeft, expectedProgress, isBehindPace, formatPercent, formatMinutes } from '../components/Dashboard/Pages/LearningManagement/shared/pace.ts'

const today = new Date('2027-01-15T12:00:00Z')

describe('pace helpers', () => {
  test('daysLeft', () => {
    expect(daysLeft('2027-05-31', today)).toBe(136)
    expect(daysLeft(null, today)).toBeNull()
    expect(daysLeft('garbage', today)).toBeNull()
  })
  test('expectedProgress and behind pace', () => {
    const exp = expectedProgress('2026-12-01T00:00:00Z', '2027-05-31', today)
    expect(exp).toBeCloseTo(45 / 181, 2)
    expect(isBehindPace(0.0, exp)).toBe(true)
    expect(isBehindPace(0.2, exp)).toBe(false)
    expect(isBehindPace(0.0, null)).toBe(false)
    expect(expectedProgress(null, '2027-05-31', today)).toBeNull()
  })
  test('formatters', () => {
    expect(formatPercent(0.4567)).toBe('46%')
    expect(formatPercent(null)).toBe('—')
    expect(formatMinutes(125)).toBe('2m')
    expect(formatMinutes(4000)).toBe('1h 7m')
  })
})
