'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { GraduationCap, Users, ListChecks } from '@phosphor-icons/react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { DashTabBar } from '@components/Dashboard/Shared/DashTabBar/DashTabBar'
import { getUriWithOrg } from '@services/config/config'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLmCourseSummary, useLmCourseLearners } from './useLearningManagement'
import { Card, Kpi, Bar as ProgressBar, StatusPill, Pagination, ExportButton, Empty, P } from './shared/LmUi'
import { formatPercent, formatMinutes } from './shared/pace'
import { lmCourseExportUrl } from '@services/learningManagement/learningManagement'

type Tab = 'learners' | 'activities'

export default function LmCoursePage({ orgslug, courseUuid }: { orgslug: string; courseUuid: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const [tab, setTab] = useState<Tab>('learners')
  const [status, setStatus] = useState<string>('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const { data: summary } = useLmCourseSummary(courseUuid)
  const { data: learners, isLoading } = useLmCourseLearners(courseUuid, { status: status || undefined, search: search || undefined, page, page_size: 50 })
  const href = (p: string) => getUriWithOrg(orgslug, p)
  const name = summary?.course.name || learners?.course.name || ''

  return (
    <div className="h-full w-full bg-[#f8f8f8] flex flex-col">
      <div className="ps-4 pe-4 sm:ps-10 sm:pe-10 tracking-tight bg-[#fcfbfc] z-10 nice-shadow flex-shrink-0">
        <div className="pt-6 pb-4">
          <Breadcrumbs items={[
            { label: t(`${P}.title`), href: '/dash/learning-management', icon: <GraduationCap size={14} /> },
            { label: name || '…' },
          ]} />
        </div>
        <div className="my-2 py-2 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <div className="pt-3 font-bold text-3xl tracking-tighter">{name}</div>
            <div className="font-medium text-gray-400 text-md">{t(`${P}.course.subtitle`)}</div>
          </div>
          {org?.id && <ExportButton url={lmCourseExportUrl(org.id, courseUuid, { status: status || undefined, search: search || undefined })} filename={`wyd-${courseUuid}.csv`} />}
        </div>
        <DashTabBar tabs={[
          { key: 'learners', label: t(`${P}.course.tabs.learners`), icon: <Users size={16} />, onClick: () => setTab('learners'), active: tab === 'learners' },
          { key: 'activities', label: t(`${P}.course.tabs.activities`), icon: <ListChecks size={16} />, onClick: () => setTab('activities'), active: tab === 'activities' },
        ]} />
      </div>

      <div className="p-4 sm:p-10 space-y-6">
        {summary && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi label={t(`${P}.kpi.members`)} value={summary.members} />
            <Kpi label={t(`${P}.kpi.enrolled`)} value={summary.enrolled} />
            <Kpi label={t(`${P}.kpi.started`)} value={summary.started} />
            <Kpi label={t(`${P}.kpi.completed`)} value={summary.completed} sub={formatPercent(summary.completion_rate)} tone="good" />
            <Kpi label={t(`${P}.kpi.avg_watch_time`)} value={formatMinutes(summary.avg_verified_watch_seconds)} />
          </div>
        )}

        {tab === 'learners' && (
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs">
                <option value="">{t(`${P}.course.filters.all`)}</option>
                <option value="completed">{t(`${P}.status.completed`)}</option>
                <option value="in_progress">{t(`${P}.status.in_progress`)}</option>
                <option value="not_started">{t(`${P}.status.not_started`)}</option>
              </select>
              <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder={t(`${P}.course.filters.search_placeholder`)} className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs sm:w-64" />
            </div>
            {isLoading || !learners ? (
              <Empty label="…" />
            ) : learners.total === 0 ? (
              <Empty label={t(`${P}.empty`)} />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-400">
                      <tr>
                        <th className="sticky start-0 bg-white py-2 text-start font-medium">{t(`${P}.course.columns.learner`)}</th>
                        <th className="text-start font-medium">{t(`${P}.course.columns.status`)}</th>
                        <th className="w-40 text-start font-medium">{t(`${P}.course.columns.progress`)}</th>
                        {learners.activities.map((a) => (
                          <th key={a.activity_uuid} className="min-w-[110px] text-center font-medium" title={a.name}>{a.name.length > 14 ? `${a.name.slice(0, 14)}…` : a.name}</th>
                        ))}
                        <th className="text-start font-medium">{t(`${P}.course.columns.certificate`)}</th>
                        <th className="text-start font-medium">{t(`${P}.at_risk.last_active`)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {learners.data.map((r) => (
                        <tr key={r.user.user_uuid} className="border-t border-gray-100 align-top">
                          <td className="sticky start-0 bg-white py-2">
                            <Link href={href(`/dash/learning-management/learners/${r.user.user_uuid}`)} className="font-medium text-wyd-blue hover:underline">{r.user.first_name || r.user.last_name ? `${r.user.first_name} ${r.user.last_name}`.trim() : r.user.username}</Link>
                            <div className="text-xs text-gray-400">{r.user.email}</div>
                          </td>
                          <td className="py-2"><StatusPill status={r.status} /></td>
                          <td className="py-2 pe-3">
                            <div className="flex items-center gap-2"><ProgressBar pct={r.progress_percent} /><span className="w-10 text-end text-xs tabular-nums">{r.completed_count}/{r.total_count}</span></div>
                          </td>
                          {r.activities.map((c) => (
                            <td key={c.activity_uuid} className="py-2 text-center text-xs">
                              {c.complete ? <span className="font-semibold text-wyd-success">✓</span> : <span className="text-gray-300">·</span>}
                              {c.video_percent !== null && c.video_percent !== undefined && <div className="text-gray-500">{Math.round(c.video_percent)}%</div>}
                              {c.quiz_score !== null && c.quiz_score !== undefined && <div className={c.quiz_score >= 100 ? 'text-wyd-success' : 'text-wyd-red'}>Q {Math.round(c.quiz_score)}</div>}
                            </td>
                          ))}
                          <td className="py-2 text-xs">
                            {r.certificate_uuid ? <Link href={href(`/certificates/${r.certificate_uuid}`)} className="text-wyd-blue hover:underline">{t(`${P}.learner.certificate`)}</Link> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="py-2 text-xs text-gray-500">{r.last_active || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3"><Pagination page={learners.page} pageSize={learners.page_size} total={learners.total} onPage={setPage} /></div>
              </>
            )}
          </Card>
        )}

        {tab === 'activities' && summary && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">{t(`${P}.course.activities.completion_title`)}</h3>
              <ResponsiveContainer width="100%" height={Math.max(160, summary.activities.length * 34)}>
                <BarChart data={summary.activities} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6' }} />
                  <Bar dataKey="completed" name={t(`${P}.kpi.completed`)} fill="#16835c" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card>
              <h3 className="text-sm font-semibold text-gray-700 mb-1">{t(`${P}.course.dropoff.title`)}</h3>
              <p className="text-xs text-gray-400 mb-3">{t(`${P}.course.dropoff.help`)}</p>
              <div className="space-y-3">
                {summary.activities.filter((a) => a.dropoff_deciles.some((n) => n > 0)).map((a) => {
                  const max = Math.max(1, ...a.dropoff_deciles)
                  return (
                    <div key={a.activity_uuid}>
                      <div className="mb-1 text-xs font-medium text-gray-600">{a.name}</div>
                      <div className="flex h-8 items-end gap-0.5">
                        {a.dropoff_deciles.map((n, i) => (
                          <div key={i} title={`${i * 10}–${i * 10 + 10}%: ${n}`} className="flex-1 rounded-t bg-wyd-blue/70" style={{ height: `${(n / max) * 100}%`, minHeight: n ? 3 : 0 }} />
                        ))}
                      </div>
                    </div>
                  )
                })}
                {summary.activities.every((a) => a.dropoff_deciles.every((n) => n === 0)) && <Empty label={t(`${P}.empty`)} />}
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
