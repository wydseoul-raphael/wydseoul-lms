'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import { AVAILABLE_LANGUAGES, type Language } from '@/lib/languages'
import { changeLanguage } from '@/lib/i18n'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { WYD_BRAND } from '@/lib/wyd/brand'
import { cn } from '@/lib/utils'

// The six official languages of the learning center, in the brand's order.
export const WYD_LANGUAGES: Language[] = WYD_BRAND.languages
  .map((code) => AVAILABLE_LANGUAGES.find((l) => l.code === code))
  .filter((l): l is Language => !!l)

interface WydLanguageSelectProps {
  // `dark` is used on the black preview stage toolbar.
  tone?: 'light' | 'dark'
  className?: string
}

// Native <select>: keyboard and screen-reader friendly out of the box, and
// matches the reference portal's compact language control.
export function WydLanguageSelect({ tone = 'light', className }: WydLanguageSelectProps) {
  const { t, i18n } = useTranslation()
  const { track } = useLHAnalytics()
  // Server render has no detected language; only read it once hydrated so
  // the markup matches on both sides.
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  const current = mounted ? i18n.language.split('-')[0] : ''
  const value = WYD_LANGUAGES.some((l) => l.code === current) ? current : 'en'

  const onChange = (code: string) => {
    try {
      localStorage.setItem('i18nextLng_userPicked', '1')
    } catch {
      /* storage unavailable (private mode) — language still switches for this session */
    }
    track(AnalyticsEvent.LanguageChanged, { language_code: code, source: 'wyd_header' })
    changeLanguage(code)
  }

  return (
    <label
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[13px] font-semibold',
        tone === 'dark'
          ? 'border-white/20 bg-[#171c25] text-white'
          : 'border-wyd-line bg-white text-wyd-ink',
        className
      )}
    >
      <Globe size={14} aria-hidden="true" className="opacity-70" />
      <span className="sr-only">{t('wyd.nav.language', { defaultValue: 'Language' })}</span>
      <select
        aria-label={t('wyd.nav.language', { defaultValue: 'Language' })}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        suppressHydrationWarning
        className={cn(
          'bg-transparent outline-none cursor-pointer min-w-[88px]',
          tone === 'dark' ? 'text-white [&>option]:text-black' : 'text-wyd-ink'
        )}
      >
        {WYD_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.nativeName}
          </option>
        ))}
      </select>
    </label>
  )
}

export default WydLanguageSelect
