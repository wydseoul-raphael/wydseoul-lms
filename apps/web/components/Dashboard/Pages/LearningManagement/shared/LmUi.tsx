'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { DownloadSimple } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { cn } from '@/lib/utils'

export const P = 'dashboard.learning_management'

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('bg-white rounded-xl nice-shadow p-5 min-w-0', className)}>{children}</div>
}

export function Kpi({ label, value, sub, tone = 'default' }: { label: string; value: React.ReactNode; sub?: string; tone?: 'default' | 'good' | 'warn' }) {
  return (
    <Card className="p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className={cn('mt-1 text-2xl font-black tracking-tight', tone === 'good' ? 'text-wyd-success' : tone === 'warn' ? 'text-wyd-red' : 'text-gray-900')}>{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </Card>
  )
}

export function Bar({ pct, className }: { pct: number; className?: string }) {
  const v = Math.max(0, Math.min(100, pct))
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-gray-100', className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full', v >= 100 ? 'bg-wyd-success' : 'bg-wyd-blue')} style={{ width: `${v}%` }} />
    </div>
  )
}

export function StatusPill({ status }: { status: string }) {
  const { t } = useTranslation()
  const map: Record<string, string> = {
    completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    in_progress: 'bg-blue-50 text-blue-700 ring-blue-200',
    not_started: 'bg-gray-100 text-gray-500 ring-gray-200',
  }
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1', map[status] || map.not_started)}>{t(`${P}.status.${status}`, { defaultValue: status })}</span>
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (_p: number) => void }) {
  const { t } = useTranslation()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-gray-500">
      <span>{t(`${P}.pagination`, { defaultValue: '{{from}}–{{to}} of {{total}}', from: total ? (page - 1) * pageSize + 1 : 0, to: Math.min(total, page * pageSize), total })}</span>
      <div className="flex gap-1">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded-md border border-gray-200 px-2 py-1 disabled:opacity-40">‹</button>
        <span className="px-2 py-1">{page} / {pages}</span>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className="rounded-md border border-gray-200 px-2 py-1 disabled:opacity-40">›</button>
      </div>
    </div>
  )
}

// Authenticated CSV download (the API needs the bearer token, so no plain <a>).
export function ExportButton({ url, filename }: { url: string; filename: string }) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const [busy, setBusy] = React.useState(false)
  const download = async () => {
    setBusy(true)
    try {
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename
      a.click()
      URL.revokeObjectURL(a.href)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" onClick={download} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-50">
      <DownloadSimple size={14} /> {busy ? t(`${P}.export.downloading`, { defaultValue: 'Downloading…' }) : t(`${P}.export.csv`, { defaultValue: 'Export CSV' })}
    </button>
  )
}

export function Empty({ label }: { label: string }) {
  return <div className="flex h-32 items-center justify-center text-sm text-gray-300">{label}</div>
}
