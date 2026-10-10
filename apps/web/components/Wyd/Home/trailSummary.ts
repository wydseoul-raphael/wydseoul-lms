// Aggregates the learner's trail into the numbers shown on the home journey
// panel and the /learning overview. Pure so bun tests can exercise it.

export interface TrailRunLike {
  steps?: Array<{ complete?: boolean } | null> | null
  course_total_steps?: number | null
  status?: string | null
}

export interface TrailSummary {
  courses: number
  completedCourses: number
  completedSteps: number
  totalSteps: number
  percent: number
}

export function summarizeTrail(runs: TrailRunLike[] | null | undefined): TrailSummary {
  const list = Array.isArray(runs) ? runs : []
  let completedSteps = 0
  let totalSteps = 0
  let completedCourses = 0
  for (const run of list) {
    // A step row exists only once an activity is done; `complete === false`
    // rows are reserved for future partial states and must not count.
    const done = (run.steps ?? []).filter((s) => s && s.complete !== false).length
    const total = Math.max(0, Number(run.course_total_steps) || 0)
    completedSteps += done
    totalSteps += total
    if (total > 0 && done >= total) completedCourses += 1
  }
  const percent = totalSteps > 0 ? Math.min(100, Math.round((completedSteps / totalSteps) * 100)) : 0
  return { courses: list.length, completedCourses, completedSteps, totalSteps, percent }
}
