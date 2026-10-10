'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'

export interface WydTextSection {
  titleKey: string
  bodyKey: string
  // Optional list rendered instead of a paragraph (e.g. team names).
  items?: string[]
}

interface WydTextPageProps {
  eyebrowKey: string
  titleKey: string
  leadKey: string
  sections: WydTextSection[]
  aside?: React.ReactNode
}

// Shared layout for the simple content pages (/about, /copyright, /contributors):
// eyebrow + title + lead, then a column of titled sections in a white card.
export function WydTextPage({ eyebrowKey, titleKey, leadKey, sections, aside }: WydTextPageProps) {
  const { t } = useTranslation()
  return (
    <main className="mx-auto w-full max-w-[1280px] px-4 pb-20 pt-10 sm:px-6 lg:px-8">
      <header className="max-w-[760px]">
        <p className="mb-2 text-[12px] font-black uppercase tracking-[0.16em] text-wyd-blue">{t(eyebrowKey)}</p>
        <h1 className="text-[clamp(1.8rem,3.4vw,2.6rem)] font-black leading-tight tracking-tight text-wyd-navy">
          {t(titleKey)}
        </h1>
        <p className="mt-4 text-[17px] leading-relaxed text-wyd-muted">{t(leadKey)}</p>
      </header>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4">
          {sections.map((s) => (
            <section
              key={s.titleKey}
              className="rounded-wyd-lg border border-wyd-line bg-white p-6 shadow-[0_10px_30px_rgba(7,31,71,0.05)] sm:p-8"
            >
              <h2 className="text-[18px] font-black text-wyd-navy">{t(s.titleKey)}</h2>
              {s.items ? (
                <ul className="mt-3 grid gap-1.5 text-[15px] leading-relaxed text-wyd-ink">
                  {s.items.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-wyd-blue" />
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-[15px] leading-relaxed text-wyd-muted">{t(s.bodyKey)}</p>
              )}
            </section>
          ))}
        </div>
        {aside && <aside className="lg:sticky lg:top-24 lg:self-start">{aside}</aside>}
      </div>
    </main>
  )
}

export default WydTextPage
