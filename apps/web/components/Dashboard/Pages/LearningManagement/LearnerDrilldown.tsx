'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { GraduationCap } from '@phosphor-icons/react'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { getUriWithOrg } from '@services/config/config'
import { useLmLearner } from './useLearningManagement'
import { Card, Kpi, Bar as ProgressBar, StatusPill, Empty, P } from './shared/LmUi'

export default function LearnerDrilldown({ orgslug, userUuid }: { orgslug: string; userUuid: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useLmLearner(userUuid)
  const href = (p: string) => getUriWithOrg(orgslug, p)
  const name = data ? (data.user.first_name || data.user.last_name ? `${data.user.first_name} ${data.user.last_name}`.trim() : data.user.username) : '…'

  return (
    <div className="h-full w-full bg-[#f8f8f8] flex flex-col">
      <div className="ps-4 pe-4 sm:ps-10 sm:pe-10 tracking-tight bg-[#fcfbfc] z-10 nice-shadow flex-shrink-0">
        <div className="pt-6 pb-4">
          <Breadcrumbs items={[
            { label: t(`${P}.title`), href: '/dash/learning-management', icon: <GraduationCap size={14} /> },
            { label: name },
          ]} />
        </div>
        <div className="my-2 py-2">
          <div className="pt-3 font-bold text-3xl tracking-tighter">{name}</div>
          <div className="font-medium text-gray-400 text-md">{data?.user.email}</div>
        </div>
      </div>
      <div className="p-4 sm:p-10 space-y-6">
        {isLoading || !data ? (
          <Empty label="…" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Kpi label={t(`${P}.learner.required_courses`)} value={`${data.required_completed} / ${data.required_total}`} tone={data.all_required_completed ? 'good' : 'default'} sub={data.all_required_completed ? t(`${P}.learner.all_required_completed`) : undefined} />
              <Kpi label={t(`${P}.at_risk.last_active`)} value={data.last_active || t(`${P}.at_risk.never_active`)} />
              <Kpi label={t(`${P}.learner.certificates`)} value={data.courses.filter((c) => c.certificate_uuid).length} />
            </div>
            <Card>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">{t(`${P}.learner.courses`)}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-400">
                    <tr>
                      <th className="py-2 text-start font-medium">{t(`${P}.required_courses.course`)}</th>
                      <th className="text-start font-medium">{t(`${P}.required_courses.type`)}</th>
                      <th className="text-start font-medium">{t(`${P}.course.columns.status`)}</th>
                      <th className="w-44 text-start font-medium">{t(`${P}.course.columns.progress`)}</th>
                      <th className="text-start font-medium">{t(`${P}.required_courses.deadline`)}</th>
                      <th className="text-start font-medium">{t(`${P}.course.columns.certificate`)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.courses.map((c) => (
                      <tr key={c.course_uuid} className="border-t border-gray-100">
                        <td className="py-2.5 font-medium"><Link href={href(`/dash/learning-management/courses/${c.course_uuid}`)} className="text-wyd-blue hover:underline">{c.name}</Link></td>
                        <td><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.required ? 'bg-[#fff0f1] text-wyd-red' : 'bg-[#fff8d8] text-wyd-navy'}`}>{c.required ? t(`${P}.required_courses.required`) : t(`${P}.required_courses.optional`)}</span></td>
                        <td><StatusPill status={c.status} /></td>
                        <td className="pe-3"><div className="flex items-center gap-2"><ProgressBar pct={c.progress_percent} /><span className="w-10 text-end text-xs tabular-nums">{c.completed_count}/{c.total_count}</span></div></td>
                        <td className="text-gray-600">{c.deadline || '—'}{c.days_left !== null && c.days_left !== undefined && <span className={`ms-2 text-[11px] font-semibold ${c.days_left < 0 ? 'text-wyd-red' : 'text-gray-400'}`}>{c.days_left < 0 ? t(`${P}.required_courses.overdue`) : t(`${P}.required_courses.days_left`, { n: c.days_left })}</span>}</td>
                        <td className="text-xs">{c.certificate_uuid ? <Link href={href(`/certificates/${c.certificate_uuid}`)} className="text-wyd-blue hover:underline">{t(`${P}.learner.certificate`)}</Link> : <span className="text-gray-300">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
