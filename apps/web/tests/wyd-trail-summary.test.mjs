import { describe, expect, test } from 'bun:test'
import { summarizeTrail } from '../components/Wyd/Home/trailSummary.ts'

describe('summarizeTrail', () => {
  test('empty trail', () => {
    expect(summarizeTrail(undefined)).toEqual({ courses: 0, completedCourses: 0, completedSteps: 0, totalSteps: 0, percent: 0 })
  })

  test('aggregates steps across runs and counts finished courses', () => {
    const runs = [
      { steps: [{ complete: true }, { complete: true }], course_total_steps: 4 },
      { steps: [{ complete: true }, { complete: true }, { complete: true }], course_total_steps: 3 },
    ]
    expect(summarizeTrail(runs)).toEqual({ courses: 2, completedCourses: 1, completedSteps: 5, totalSteps: 7, percent: 71 })
  })

  test('ignores explicit complete:false rows and caps at 100', () => {
    const runs = [{ steps: [{ complete: false }, { complete: true }, {}], course_total_steps: 1 }]
    const s = summarizeTrail(runs)
    expect(s.completedSteps).toBe(2)
    expect(s.percent).toBe(100)
  })
})
