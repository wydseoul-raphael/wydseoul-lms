'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { WYD_BRAND, WYD_COPYRIGHT_HOLDER } from '@/lib/wyd/brand'
import { WydBrandLockup } from './WydBrandLockup'

export function WydFooter({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const footerText =
    org?.config?.config?.customization?.general?.footer_text || org?.config?.config?.general?.footer_text || ''
  const href = (path: string) => getUriWithOrg(orgslug, path)
  const year = new Date().getFullYear()

  const links = [
    { key: 'about', label: t('wyd.footer.about', { defaultValue: 'About training' }), href: WYD_BRAND.routes.about },
    { key: 'copyright', label: t('wyd.footer.copyright', { defaultValue: 'Copyright' }), href: WYD_BRAND.routes.copyright },
    { key: 'contributors', label: t('wyd.footer.contributors', { defaultValue: 'Contributors' }), href: WYD_BRAND.routes.contributors },
  ]

  return (
    <footer className="mt-auto border-t border-wyd-line bg-white">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-5 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <WydBrandLockup href={href('/')} size="footer" />
        <nav aria-label={t('wyd.footer.about', { defaultValue: 'About training' })} className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] font-bold text-[#24324a]">
          {links.map((l) => (
            <Link key={l.key} href={href(l.href)} className="hover:text-wyd-blue">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="grid gap-1 text-[12px] text-wyd-muted md:text-end">
          <small className="font-semibold">{t('wyd.footer.tagline', { defaultValue: 'Learn. Grow. Together.' })}</small>
          {footerText && <small>{footerText}</small>}
          <small>
            © {year} {WYD_COPYRIGHT_HOLDER}. {t('wyd.footer.rights', { defaultValue: 'All rights reserved.' })}
          </small>
        </div>
      </div>
    </footer>
  )
}

export default WydFooter
