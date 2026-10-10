// Pure helpers for deadline pace (bun-testable).
export function daysLeft(deadline: string | null | undefined, today = new Date()): number | null {
  if (!deadline) return null
  const d = new Date(`${deadline}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return Math.round((d.getTime() - t) / 86_400_000)
}

export function expectedProgress(enrolledAt: string | null | undefined, deadline: string | null | undefined, today = new Date()): number | null {
  if (!enrolledAt || !deadline) return null
  const start = new Date(enrolledAt).getTime()
  const end = new Date(`${deadline}T00:00:00Z`).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null
  return Math.min(1, Math.max(0, (today.getTime() - start) / (end - start)))
}

export function isBehindPace(actual: number, expected: number | null, slack = 0.2): boolean {
  return expected !== null && actual < expected - slack
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

export function formatMinutes(seconds: number | null | undefined): string {
  if (!seconds && seconds !== 0) return '—'
  const m = Math.round(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}
