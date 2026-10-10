// Pure checkpoint gating helpers (bun-testable).

export interface CheckpointLike {
  id: string
  kind: 'checkpoint' | 'end'
  timestamp?: number | null
}

export const SEEK_TOLERANCE_S = 0.25

export function sortCheckpoints<T extends CheckpointLike>(questions: T[]): T[] {
  return questions
    .filter((q) => q.kind === 'checkpoint' && typeof q.timestamp === 'number')
    .sort((a, b) => (a.timestamp as number) - (b.timestamp as number))
}

// The earliest unanswered checkpoint whose timestamp was crossed between two
// polls (prev < t <= curr). Skipping two in one tick fires the earliest.
export function checkpointToTrigger<T extends CheckpointLike>(
  checkpoints: T[],
  prevTime: number,
  currTime: number,
  answered: Set<string> | string[]
): T | null {
  const done = answered instanceof Set ? answered : new Set(answered)
  for (const cp of sortCheckpoints(checkpoints)) {
    const t = cp.timestamp as number
    if (done.has(cp.id)) continue
    if (t > prevTime && t <= currTime) return cp
    if (prevTime === 0 && currTime >= t && t === 0) return cp
  }
  return null
}

// Furthest position the learner may reach before answering: the first
// unanswered checkpoint's timestamp (or the full duration).
export function maxAllowedPosition<T extends CheckpointLike>(checkpoints: T[], answered: Set<string> | string[], duration: number): number {
  const done = answered instanceof Set ? answered : new Set(answered)
  for (const cp of sortCheckpoints(checkpoints)) {
    if (!done.has(cp.id)) return cp.timestamp as number
  }
  return duration
}

export function clampSeekToCheckpoints<T extends CheckpointLike>(
  target: number,
  checkpoints: T[],
  answered: Set<string> | string[],
  duration: number,
  tolerance = SEEK_TOLERANCE_S
): number {
  const limit = maxAllowedPosition(checkpoints, answered, duration)
  return target > limit + tolerance ? limit : target
}
