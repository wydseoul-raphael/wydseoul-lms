'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { GraduationCap } from '@phosphor-icons/react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from 'recharts'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { getUriWithOrg } from '@services/config/config'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLmOverview, useLmAtRisk } from './useLearningManagement'
import { Card, Kpi, Bar as ProgressBar, Pagination, ExportButton, Empty, P } from './shared/LmUi'
import { formatPercent } from './shared/pace'
import { lmLearnersExportUrl } from '@services/learningManagement/learningManagement'

export default function LmOverview({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const [daysInactive, setDaysInactive] = useState(14)
  const [page, setPage] = useState(1)
  const { data, isLoading } = useLmOverview(daysInactive)
  const { data: atRisk } = useLmAtRisk({ days_inactive: daysInactive, page, page_size: 20 })
  const href = (p: string) => getUriWithOrg(orgslug, p)

  const funnel = data
    ? [
        { key: 'members', label: t(`${P}.funnel.members`), value: data.funnel.members },
        { key: 'enrolled', label: t(`${P}.funnel.enrolled_any`), value: data.funnel.enrolled_any_required },
        { key: 'any', label: t(`${P}.funnel.completed_any`), value: data.funnel.completed_any_required },
        { key: 'all', label: t(`${P}.funnel.completed_all`), value: data.funnel.completed_all_required },
      ]
    : []

  return (
    <div className="h-full w-full bg-[#f8f8f8] flex flex-col">
      <div className="ps-4 pe-4 sm:ps-10 sm:pe-10 tracking-tight bg-[#fcfbfc] z-10 nice-shadow flex-shrink-0">
        <div className="pt-6 pb-4">
          <Breadcrumbs items={[{ label: t(`${P}.title`), href: '/dash/learning-management', icon: <GraduationCap size={14} /> }]} />
        </div>
        <div className="my-2 py-2 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <div className="pt-3 font-bold text-4xl tracking-tighter">{t(`${P}.title`)}</div>
            <div className="font-medium text-gray-400 text-md">{t(`${P}.subtitle`)}</div>
          </div>
          <div className="flex items-center gap-2 pb-2">
            <label className="text-xs text-gray-500">
              {t(`${P}.at_risk.days_inactive`)}
              <select value={daysInactive} onChange={(e) => setDaysInactive(Number(e.target.value))} className="ms-2 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs">
                {[7, 14, 30].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            {org?.id && <ExportButton url={lmLearnersExportUrl(org.id, {})} filename="wyd-learners.csv" />}
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-10 space-y-6">
        {isLoading || !data ? (
          <Empty label="…" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Kpi label={t(`${P}.kpi.members`)} value={data.members} />
              <Kpi label={t(`${P}.kpi.required_courses`)} value={data.required_courses} />
              <Kpi label={t(`${P}.kpi.completed_all`)} value={data.funnel.completed_all_required} sub={formatPercent(data.members ? data.funnel.completed_all_required / data.members : 0)} tone="good" />
              <Kpi label={t(`${P}.kpi.at_risk`)} value={data.at_risk_count} tone={data.at_risk_count ? 'warn' : 'default'} />
              <Kpi label={t(`${P}.kpi.dau`)} value={data.daily_active.at(-1)?.users ?? 0} sub={data.daily_active.at(-1)?.date} />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">{t(`${P}.funnel.title`)}</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={funnel} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
                    <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 11 }} stroke="#9ca3af" />
                    <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6' }} />
                    <Bar dataKey="value" fill="#0047bb" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
              <Card>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">{t(`${P}.dau.title`)}</h3>
                {data.daily_active.length === 0 ? (
                  <Empty label={t(`${P}.empty`)} />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={data.daily_active}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#9ca3af" tickFormatter={(d: string) => d.slice(5)} />
                      <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6' }} />
                      <Area type="monotone" dataKey="users" stroke="#0047bb" fill="#0047bb22" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </div>

            <Card>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">{t(`${P}.required_courses.title`)}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-400">
                    <tr className="text-start">
                      <th className="py-2 text-start font-medium">{t(`${P}.required_courses.course`)}</th>
                      <th className="text-start font-medium">{t(`${P}.required_courses.type`)}</th>
                      <th className="text-start font-medium">{t(`${P}.required_courses.deadline`)}</th>
                      <th className="text-end font-medium">{t(`${P}.required_courses.enrolled`)}</th>
                      <th className="text-end font-medium">{t(`${P}.required_courses.completed`)}</th>
                      <th className="w-48 text-start font-medium">{t(`${P}.required_courses.rate`)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.courses.map((c) => (
                      <tr key={c.course_uuid} className="border-t border-gray-100">
                        <td className="py-2.5 font-medium">
                          <Link href={href(`/dash/learning-management/courses/${c.course_uuid}`)} className="text-wyd-blue hover:underline">{c.name}</Link>
                        </td>
                        <td>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.required ? 'bg-[#fff0f1] text-wyd-red' : 'bg-[#fff8d8] text-wyd-navy'}`}>
                            {c.required ? t(`${P}.required_courses.required`) : t(`${P}.required_courses.optional`)}
                          </span>
                        </td>
                        <td className="text-gray-600">
                          {c.deadline || '—'}
                          {c.days_left !== null && c.days_left !== undefined && (
                            <span className={`ms-2 text-[11px] font-semibold ${c.days_left < 0 ? 'text-wyd-red' : 'text-gray-400'}`}>
                              {c.days_left < 0 ? t(`${P}.required_courses.overdue`) : t(`${P}.required_courses.days_left`, { n: c.days_left })}
                            </span>
                          )}
                        </td>
                        <td className="text-end tabular-nums">{c.enrolled}</td>
                        <td className="text-end tabular-nums">{c.completed}</td>
                        <td className="ps-3">
                          <div className="flex items-center gap-2"><ProgressBar pct={(c.completion_rate || 0) * 100} /><span className="w-12 text-end text-xs tabular-nums">{formatPercent(c.completion_rate)}</span></div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <h3 className="text-sm font-semibold text-gray-700 mb-1">{t(`${P}.at_risk.title`)}</h3>
              <p className="text-xs text-gray-400 mb-3">{t(`${P}.at_risk.help`, { days: daysInactive })}</p>
              {!atRisk || atRisk.total === 0 ? (
                <Empty label={t(`${P}.at_risk.none`)} />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-gray-400">
                        <tr>
                          <th className="py-2 text-start font-medium">{t(`${P}.course.columns.learner`)}</th>
                          <th className="text-start font-medium">{t(`${P}.at_risk.reason`)}</th>
                          <th className="text-start font-medium">{t(`${P}.at_risk.last_active`)}</th>
                          <th className="text-end font-medium">{t(`${P}.at_risk.progress`)}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {atRisk.data.map((r) => (
                          <tr key={r.user.user_uuid} className="border-t border-gray-100">
                            <td className="py-2">
                              <Link href={href(`/dash/learning-management/learners/${r.user.user_uuid}`)} className="font-medium text-wyd-blue hover:underline">{r.user.first_name || r.user.last_name ? `${r.user.first_name} ${r.user.last_name}`.trim() : r.user.username}</Link>
                              <div className="text-xs text-gray-400">{r.user.email}</div>
                            </td>
                            <td className="space-x-1">
                              {r.reasons.map((reason) => (
                                <span key={reason} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${reason === 'inactive' ? 'bg-gray-100 text-gray-600' : 'bg-[#fff0f1] text-wyd-red'}`}>{t(`${P}.at_risk.reason_${reason}`)}</span>
                              ))}
                            </td>
                            <td className="text-gray-600">{r.last_active || t(`${P}.at_risk.never_active`)}</td>
                            <td className="text-end tabular-nums">{r.completed_required}/{r.total_required}{r.expected_progress !== null && <span className="ms-1 text-xs text-gray-400">({t(`${P}.at_risk.expected`)} {formatPercent(r.expected_progress)})</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3"><Pagination page={atRisk.page} pageSize={atRisk.page_size} total={atRisk.total} onPage={setPage} /></div>
                </>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
