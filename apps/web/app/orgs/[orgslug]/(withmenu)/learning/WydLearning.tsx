'use client'
import React, { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useTrail } from '@/hooks/queries/useTrail'
import TrailCourseCard from '@components/Pages/Trail/TrailCourseCard'
import UserCertificates from '@components/Pages/Trail/UserCertificates'
import { getUriWithOrg } from '@services/config/config'
import { WYD_BRAND } from '@/lib/wyd/brand'
import { summarizeTrail } from '@components/Wyd/Home/trailSummary'

// "나의 학습": the learner's dashboard. Signed-out visitors are sent to login
// and brought back here afterwards.
export default function WydLearning({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
  const router = useRouter()
  const session = useLHSession() as any
  const org = useOrg() as any
  const signedIn = session?.status === 'authenticated'
  const { data: trail, isLoading } = useTrail(signedIn ? org?.id : undefined)

  useEffect(() => {
    if (session?.status === 'unauthenticated') {
      router.replace(getUriWithOrg(orgslug, `${WYD_BRAND.routes.login}?next=${encodeURIComponent(WYD_BRAND.routes.learning)}`))
    }
  }, [session?.status, router, orgslug])

  if (!signedIn) {
    return (
      <main className="mx-auto w-full max-w-[1280px] px-4 py-16 text-center text-wyd-muted sm:px-6 lg:px-8">
        {t('wyd.learning.loginRequired')}
      </main>
    )
  }

  const runs: any[] = trail?.runs ?? []
  const summary = summarizeTrail(runs)
  const name = session?.data?.user?.first_name || session?.data?.user?.username || ''

  return (
    <main className="mx-auto w-full max-w-[1280px] px-4 pb-20 pt-10 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[12px] font-black uppercase tracking-[0.16em] text-wyd-blue">{t('wyd.nav.learning')}</p>
          <h1 className="text-[clamp(1.8rem,3.2vw,2.5rem)] font-black leading-tight tracking-tight text-wyd-navy">
            {t('wyd.learning.welcome', { name })}
          </h1>
        </div>
        <Link href={getUriWithOrg(orgslug, WYD_BRAND.routes.enroll)} className="inline-flex items-center gap-1 text-[14px] font-extrabold text-wyd-blue hover:underline">
          {t('wyd.nav.enroll')} <ArrowRight size={16} aria-hidden="true" className="rtl:rotate-180" />
        </Link>
      </header>

      <section className="mt-8 grid gap-4 rounded-wyd-lg bg-wyd-blue p-6 text-white sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <h2 className="text-[18px] font-black">{t('wyd.learning.overview')}</h2>
          <div className="mt-3 flex justify-between text-[13px] font-bold">
            <span>{t('wyd.learning.progress')}</span>
            <span>{summary.percent}%</span>
          </div>
          <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-white/25">
            <div className="h-full rounded-full bg-white transition-[width]" style={{ width: `${summary.percent}%` }} />
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-4 text-center sm:min-w-[220px]">
          <div className="rounded-xl bg-white/10 p-3">
            <dt className="text-[11px] font-bold text-white/70">{t('wyd.learning.completedLessons')}</dt>
            <dd className="text-2xl font-black">{summary.completedSteps}</dd>
          </div>
          <div className="rounded-xl bg-white/10 p-3">
            <dt className="text-[11px] font-bold text-white/70">{t('wyd.learning.totalLessons')}</dt>
            <dd className="text-2xl font-black">{summary.totalSteps}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-[20px] font-black text-wyd-navy">{t('wyd.learning.paths')}</h2>
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[220px] animate-pulse rounded-wyd-lg bg-white ring-1 ring-wyd-line" />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <div className="rounded-wyd-lg border border-dashed border-wyd-line bg-white p-10 text-center">
            <p className="text-[15px] text-wyd-muted">{t('wyd.learning.noCourses')}</p>
            <Link
              href={getUriWithOrg(orgslug, WYD_BRAND.routes.courses)}
              className="mt-5 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-wyd-blue px-5 text-[14px] font-extrabold text-white hover:bg-wyd-blue-dark"
            >
              {t('wyd.learning.browseCourses')} <ArrowRight size={16} aria-hidden="true" className="rtl:rotate-180" />
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {runs.map((run: any) => (
              <TrailCourseCard key={run.course?.course_uuid ?? run.id} course={run.course} run={run} orgslug={orgslug} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-12">
        <h2 className="mb-4 text-[20px] font-black text-wyd-navy">{t('wyd.learning.certificates')}</h2>
        <UserCertificates orgslug={orgslug} />
      </section>
    </main>
  )
}
