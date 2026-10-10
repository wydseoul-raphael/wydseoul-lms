'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { WYD_BRAND } from '@/lib/wyd/brand'
import { WydLanguageSelect } from '@components/Wyd/WydLanguageSelect'
import { YouTubeStagePlayer } from '@components/Wyd/Player/YouTubeStagePlayer'

// Guest preview: the reference `/preview` stage. Dark full-bleed layout with
// the introduction video on the left and the lesson panel on the right. No
// progress is recorded here; it exists to show how video learning works.
export default function GuestPreviewClient({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const signedIn = session?.status === 'authenticated'
  const href = (path: string) => getUriWithOrg(orgslug, path)

  return (
    <main className="min-h-screen w-full bg-wyd-stage text-white">
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(330px,410px)]">
        <section className="grid place-items-center p-3 sm:p-6 lg:p-9">
          <div className="w-full max-w-[1180px]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-[13px]">
              <Link
                href={href('/')}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 font-extrabold text-white hover:bg-white/20"
              >
                <ArrowLeft size={14} aria-hidden="true" className="rtl:rotate-180" />
                {t('wyd.preview.exitLesson')}
              </Link>
              <span className="truncate font-bold text-[#c8d0dc]">{WYD_BRAND.name}</span>
              <WydLanguageSelect tone="dark" />
            </div>
            <YouTubeStagePlayer videoId={WYD_BRAND.previewVideoId} />
          </div>
        </section>

        <aside
          aria-labelledby="guest-lesson-title"
          className="flex flex-col bg-white p-6 text-wyd-ink lg:max-h-screen lg:overflow-y-auto lg:border-s lg:border-wyd-line lg:p-9"
        >
          <div className="border-b border-wyd-line pb-6">
            <p className="mb-2 text-[12px] font-black uppercase tracking-[0.16em] text-wyd-blue">{t('wyd.preview.eyebrow')}</p>
            <h1 id="guest-lesson-title" className="text-[clamp(1.5rem,2.3vw,2.1rem)] font-black leading-tight text-wyd-navy">
              {t('wyd.preview.title')}
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-wyd-muted">{t('wyd.preview.body')}</p>
          </div>

          <section className="mt-6 border-t border-wyd-line pt-5">
            <h2 className="text-[16px] font-black text-wyd-navy">{t('wyd.preview.aboutLesson')}</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-wyd-muted">{t('wyd.preview.lessonDescription')}</p>
          </section>

          <div className="mt-6 grid gap-1.5 rounded-lg border-s-4 border-wyd-yellow bg-[#fff9d8] p-4">
            <strong className="text-[13px] font-black text-wyd-navy">{t('wyd.preview.eyebrow')}</strong>
            <span className="text-[14px] leading-relaxed text-wyd-ink">{t('wyd.preview.notice')}</span>
          </div>

          <div className="sticky bottom-0 mt-auto bg-[linear-gradient(rgba(255,255,255,0.85),#fff_25%)] pt-6 pb-2">
            <Link
              href={href(signedIn ? WYD_BRAND.routes.learning : WYD_BRAND.routes.login)}
              className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-wyd-blue px-5 text-[15px] font-extrabold text-white hover:bg-wyd-blue-dark"
            >
              {signedIn ? t('wyd.preview.signedInCta') : t('wyd.preview.signup')}
              <ArrowRight size={16} aria-hidden="true" className="rtl:rotate-180" />
            </Link>
          </div>
        </aside>
      </div>
    </main>
  )
}
