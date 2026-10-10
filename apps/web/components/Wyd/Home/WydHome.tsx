'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, ArrowRight } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useTrail } from '@/hooks/queries/useTrail'
import { getUriWithOrg } from '@services/config/config'
import { WYD_BRAND } from '@/lib/wyd/brand'
import { cn } from '@/lib/utils'
import { summarizeTrail } from './trailSummary'

const container = 'mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8'

function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('mb-2 text-[12px] font-black uppercase tracking-[0.16em] text-wyd-blue', className)}>{children}</p>
  )
}

const primaryBtn =
  'inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-wyd-blue px-6 text-[15px] font-extrabold text-white transition-colors hover:bg-wyd-blue-dark'
const ghostBtn =
  'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-wyd-line bg-white px-5 text-[14px] font-extrabold text-wyd-ink transition-colors hover:border-wyd-blue hover:text-wyd-blue'
const textLink = 'inline-flex items-center gap-1 text-[14px] font-extrabold text-wyd-blue hover:underline'

// Decorative composition in the hero (reference `.learning-art`): orbit, sun,
// stacked book, step tiles. Pure CSS so it needs no asset.
function LearningArt({ caption }: { caption: string }) {
  return (
    <div aria-hidden="true" className="relative mx-auto aspect-[5/4] w-full max-w-[460px] select-none">
      <div className="absolute inset-[6%] rounded-full border-2 border-dashed border-wyd-blue/25" />
      <div className="absolute end-[10%] top-[8%] h-[26%] w-[26%] rounded-full bg-wyd-yellow shadow-[0_18px_40px_rgba(251,225,38,0.45)]" />
      <div className="absolute bottom-[14%] start-[12%] grid w-[46%] gap-2 rounded-2xl bg-white p-4 shadow-[0_18px_50px_rgba(7,31,71,0.14)] ring-1 ring-wyd-line">
        <span className="block h-2.5 w-3/4 rounded-full bg-wyd-navy" />
        <span className="block h-2.5 w-1/2 rounded-full bg-wyd-red" />
        <span className="block h-2.5 w-2/3 rounded-full bg-wyd-blue" />
      </div>
      <div className="absolute end-[14%] top-[44%] grid h-[18%] w-[18%] place-items-center rounded-2xl bg-wyd-blue text-2xl text-white shadow-[0_14px_30px_rgba(0,71,187,0.35)]">
        ✦
      </div>
      <div className="absolute bottom-[8%] end-[6%] h-[12%] w-[28%] rounded-xl bg-wyd-navy/90" />
      <div className="absolute bottom-[2%] end-[18%] h-[10%] w-[20%] rounded-xl bg-wyd-red/90" />
      <span className="absolute start-[2%] top-[2%] rounded-full bg-white px-3 py-1 text-[11px] font-black tracking-wide text-wyd-blue ring-1 ring-wyd-line">
        {caption}
      </span>
    </div>
  )
}

function HomeHero({ orgslug, signedIn }: { orgslug: string; signedIn: boolean }) {
  const { t } = useTranslation()
  return (
    <section className={cn(container, 'grid items-center gap-10 py-12 lg:grid-cols-[1.1fr_0.9fr] lg:py-20')}>
      <div>
        <span className="mb-6 inline-flex items-center gap-2 text-[12px] font-extrabold text-wyd-blue">
          <span className="h-[7px] w-[7px] rounded-full bg-wyd-blue" />
          {t('wyd.home.eyebrow')}
        </span>
        <h1 className="text-[clamp(2rem,4.6vw,3.4rem)] font-black leading-[1.12] tracking-tight text-wyd-navy">
          {t('wyd.home.title')}
        </h1>
        <p className="mt-5 max-w-[560px] text-[17px] leading-relaxed text-wyd-muted">{t('wyd.home.body')}</p>
        <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-3">
          <Link href={getUriWithOrg(orgslug, signedIn ? WYD_BRAND.routes.learning : WYD_BRAND.routes.login)} className={primaryBtn}>
            {signedIn ? t('wyd.nav.learning') : t('wyd.home.startLearning')}
            <ArrowUpRight size={18} aria-hidden="true" />
          </Link>
          <Link href={getUriWithOrg(orgslug, WYD_BRAND.routes.about)} className={textLink}>
            {t('wyd.nav.about')} <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <p className="mt-6 flex items-center gap-2 text-[13px] font-semibold text-wyd-muted">
          <span aria-hidden="true" className="text-wyd-yellow">
            ✦
          </span>
          {t('wyd.home.note')}
        </p>
      </div>
      <LearningArt caption={t('wyd.brand.tagline')} />
    </section>
  )
}

function LearningBenefits() {
  const { t } = useTranslation()
  const items = [
    ['01', t('wyd.home.benefitVideo')],
    ['02', t('wyd.home.benefitMultilingual')],
    ['03', t('wyd.home.benefitGrowth')],
  ]
  return (
    <div className="border-y border-wyd-line bg-white">
      <div className={cn(container, 'grid gap-4 py-6 sm:grid-cols-3')}>
        {items.map(([n, label]) => (
          <span key={n} className="flex items-center gap-3 text-[15px] font-bold text-wyd-ink">
            <b className="text-[13px] font-black tracking-widest text-wyd-blue">{n}</b>
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

interface PathwayCardProps {
  href: string
  accent: 'red' | 'yellow'
  badge: string
  eyebrow: string
  title: string
  body: string
  action: string
}

function PathwayCard({ href, accent, badge, eyebrow, title, body, action }: PathwayCardProps) {
  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-wyd-lg border border-wyd-line bg-white shadow-[0_8px_28px_rgba(17,38,71,0.05)] transition-shadow hover:shadow-[0_14px_40px_rgba(8,43,103,0.12)]"
    >
      <div
        className={cn(
          'relative flex h-[150px] items-end justify-between p-5',
          accent === 'red' ? 'bg-[#fff0f1]' : 'bg-[#fff8d8]'
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute end-5 top-5 grid h-12 w-12 place-items-center rounded-2xl text-2xl text-white',
            accent === 'red' ? 'bg-wyd-red' : 'bg-wyd-yellow text-wyd-navy'
          )}
        >
          {accent === 'red' ? '▲' : '✳'}
        </span>
        <span className="text-[11px] font-black uppercase tracking-[0.18em] text-wyd-navy/70">{eyebrow}</span>
        <span
          className={cn(
            'rounded-full px-3 py-1 text-[11px] font-black',
            accent === 'red' ? 'bg-wyd-red text-white' : 'bg-wyd-yellow text-wyd-navy'
          )}
        >
          {badge}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-6">
        <h3 className="text-[22px] font-black leading-tight text-wyd-navy">{title}</h3>
        <p className="flex-1 text-[15px] leading-relaxed text-wyd-muted">{body}</p>
        <span className="inline-flex items-center gap-2 text-[14px] font-extrabold text-wyd-blue">
          {action}
          <ArrowUpRight size={16} aria-hidden="true" className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
        </span>
      </div>
    </Link>
  )
}

function JourneyPanel({ orgslug, signedIn }: { orgslug: string; signedIn: boolean }) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const org = useOrg() as any
  const { data: trail } = useTrail(signedIn ? org?.id : undefined)
  const summary = summarizeTrail(trail?.runs)
  const name = session?.data?.user?.first_name || session?.data?.user?.username || session?.data?.user?.email

  return (
    <div className="flex flex-col gap-4 rounded-wyd-lg bg-wyd-blue p-6 text-white shadow-[0_18px_50px_rgba(0,71,187,0.28)]">
      <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15 text-xl">
        ↗
      </span>
      <Eyebrow className="mb-0 text-white/70">{t('wyd.home.oneStep')}</Eyebrow>
      <h3 className="text-[22px] font-black leading-tight">
        {signedIn ? t('wyd.nav.learning') : t('wyd.home.guestCard')}
      </h3>
      <p className="text-[14px] leading-relaxed text-white/80">{signedIn ? name : t('wyd.home.guestCardBody')}</p>
      {signedIn && (
        <div>
          <div className="mb-2 flex justify-between text-[13px] font-bold">
            <span>{t('wyd.home.progress')}</span>
            <span>{summary.percent}%</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-white/25">
            <div
              className={cn('h-full rounded-full transition-[width]', summary.percent >= 100 ? 'bg-wyd-yellow' : 'bg-white')}
              style={{ width: `${summary.percent}%` }}
            />
          </div>
          <p className="mt-2 text-[12px] text-white/70">
            {t('wyd.learning.completedLessons')} {summary.completedSteps} / {summary.totalSteps}
          </p>
        </div>
      )}
      <Link
        href={getUriWithOrg(orgslug, signedIn ? WYD_BRAND.routes.learning : WYD_BRAND.routes.login)}
        className="mt-auto inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-white px-5 text-[14px] font-extrabold text-wyd-blue hover:bg-[#eef4ff]"
      >
        {signedIn ? t('wyd.home.continue') : t('wyd.home.startLearning')} <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </div>
  )
}

function HomePathways({ orgslug, signedIn }: { orgslug: string; signedIn: boolean }) {
  const { t } = useTranslation()
  const to = (path: string) => getUriWithOrg(orgslug, signedIn ? path : WYD_BRAND.routes.login)
  return (
    <section className={cn(container, 'py-16')}>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-[640px]">
          <Eyebrow>{t('wyd.home.journey')}</Eyebrow>
          <h2 className="text-[clamp(1.6rem,3vw,2.3rem)] font-black leading-tight tracking-tight text-wyd-navy">
            {t('wyd.home.chooseYourPath')}
          </h2>
          <p className="mt-3 text-[16px] text-wyd-muted">{t('wyd.home.chooseYourPathBody')}</p>
        </div>
        <Link href={to(WYD_BRAND.routes.enroll)} className={textLink}>
          {t('wyd.nav.enroll')} <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <PathwayCard
          href={to(WYD_BRAND.routes.learning)}
          accent="red"
          badge={t('wyd.home.required')}
          eyebrow={t('wyd.home.essentials')}
          title={t('wyd.home.buildYourFoundation')}
          body={t('wyd.home.requiredPathBody')}
          action={t('wyd.home.start')}
        />
        <PathwayCard
          href={to(WYD_BRAND.routes.enroll)}
          accent="yellow"
          badge={t('wyd.home.optional')}
          eyebrow={t('wyd.home.discovery')}
          title={t('wyd.home.followYourCuriosity')}
          body={t('wyd.home.optionalPathBody')}
          action={t('wyd.nav.enroll')}
        />
        <JourneyPanel orgslug={orgslug} signedIn={signedIn} />
      </div>
    </section>
  )
}

function GuestPreviewCta({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
  return (
    <section className={cn(container, 'pb-12')}>
      <div className="flex flex-col items-start justify-between gap-6 rounded-wyd-lg border border-wyd-line bg-[linear-gradient(120deg,rgba(251,225,38,0.28),#fff)] p-7 md:flex-row md:items-center">
        <div>
          <Eyebrow>{t('wyd.preview.eyebrow')}</Eyebrow>
          <h2 className="text-[22px] font-black leading-tight text-wyd-navy">{t('wyd.preview.title')}</h2>
          <p className="mt-2 max-w-[640px] text-[15px] text-wyd-muted">{t('wyd.preview.body')}</p>
        </div>
        <Link href={getUriWithOrg(orgslug, WYD_BRAND.routes.preview)} className={primaryBtn}>
          {t('wyd.home.watchPreview')} <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </section>
  )
}

function HomeMission({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
  return (
    <section className={cn(container, 'pb-24')}>
      <div className="grid items-center gap-6 rounded-wyd-lg bg-wyd-navy p-8 text-white md:grid-cols-[auto_1fr_auto] md:p-10">
        <span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-2xl bg-wyd-yellow text-2xl text-wyd-navy">
          ✳
        </span>
        <div>
          <Eyebrow className="text-wyd-yellow">{t('wyd.home.betterTogether')}</Eyebrow>
          <h2 className="text-[clamp(1.4rem,2.6vw,2rem)] font-black leading-tight">{t('wyd.home.togetherTitle')}</h2>
          <p className="mt-2 text-[15px] text-white/75">{t('wyd.home.educationIntroShort')}</p>
        </div>
        <Link href={getUriWithOrg(orgslug, WYD_BRAND.routes.contributors)} className={cn(ghostBtn, 'border-white/20 bg-white/10 text-white hover:border-white hover:text-white')}>
          {t('wyd.footer.contributors')} <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </section>
  )
}

export default function WydHome({ orgslug }: { orgslug: string }) {
  const session = useLHSession() as any
  const signedIn = session?.status === 'authenticated'
  return (
    <div className="w-full">
      <HomeHero orgslug={orgslug} signedIn={signedIn} />
      <LearningBenefits />
      <HomePathways orgslug={orgslug} signedIn={signedIn} />
      {!signedIn && <GuestPreviewCta orgslug={orgslug} />}
      <HomeMission orgslug={orgslug} />
    </div>
  )
}
