'use client'
import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { useJoinBannerVisible, JOIN_BANNER_HEIGHT } from '@components/Objects/Banners/OrgJoinBanner'
import { useActivityFocusMode } from '@components/Hooks/useActivityFocusMode'
import { signOut } from '@components/Contexts/AuthContext'
import { getUriWithOrg } from '@services/config/config'
import { WYD_BRAND } from '@/lib/wyd/brand'
import { cn } from '@/lib/utils'
import { WydBrandLockup } from './WydBrandLockup'
import { WydLanguageSelect } from './WydLanguageSelect'
import { WYD_NAV, visibleNavItems, isActivePath, type SessionStatus } from './wydNav'

// Public site header, modelled on the reference portal (.app-header--portal):
// white bar, logo lockup, text nav, language select, admin link, login/logout.
export function WydHeader({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
  const pathname = usePathname()
  const session = useLHSession() as any
  const { isAdmin } = useAdminStatus()
  const { isVisible: bannerVisible } = useJoinBannerVisible()
  const focusMode = useActivityFocusMode()

  const status: SessionStatus = session?.status ?? 'loading'
  const items = visibleNavItems(WYD_NAV, status)

  // Learners can hide the chrome inside an activity.
  if (focusMode) return null

  const href = (path: string) => getUriWithOrg(orgslug, path)

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[1000] focus:rounded-lg focus:bg-wyd-blue focus:px-4 focus:py-2 focus:text-white"
      >
        {t('wyd.nav.skipToContent', { defaultValue: 'Skip to content' })}
      </a>
      <header
        role="banner"
        className="sticky bg-white border-b border-[#e6ebf2] shadow-[0_3px_14px_rgba(19,43,80,0.06)]"
        style={{ top: bannerVisible ? JOIN_BANNER_HEIGHT : 0, zIndex: 'var(--z-nav)' }}
      >
        <div className="mx-auto flex min-h-[68px] max-w-[1280px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6 md:flex-nowrap md:py-0 lg:px-8">
          <WydBrandLockup href={href('/')} size="header" />

          <nav
            aria-label={t('wyd.nav.main', { defaultValue: 'Main navigation' })}
            className="order-3 -mx-4 basis-full overflow-x-auto px-4 scrollbar-hide md:order-none md:mx-0 md:ms-auto md:basis-auto md:px-0"
          >
            <ul className="flex items-center gap-1 whitespace-nowrap">
              {items.map((item) => {
                const active = isActivePath(pathname, item.href)
                return (
                  <li key={item.key}>
                    <Link
                      href={href(item.href)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'inline-block border-b-2 px-2 py-2 text-[14px] font-bold transition-colors',
                        active
                          ? 'border-wyd-blue text-wyd-blue'
                          : 'border-transparent text-[#24324a] hover:border-wyd-blue hover:text-wyd-blue'
                      )}
                    >
                      {t(item.labelKey)}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>

          <div className="ms-auto flex shrink-0 items-center gap-2 md:ms-0">
            <WydLanguageSelect />
            {isAdmin && (
              <Link
                href={href(WYD_BRAND.routes.admin)}
                className="hidden rounded-lg px-3 py-2 text-[13px] font-bold text-wyd-blue hover:bg-[#eef4ff] sm:inline-block"
              >
                {t('wyd.nav.admin', { defaultValue: 'Administration' })}
              </Link>
            )}
            {status === 'authenticated' ? (
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: '/' })}
                className="rounded-xl bg-wyd-blue px-3.5 py-2 text-[13px] font-extrabold text-white transition-colors hover:bg-wyd-blue-dark"
              >
                {t('wyd.nav.logout', { defaultValue: 'Sign out' })}
              </button>
            ) : (
              <Link
                href={href(WYD_BRAND.routes.login)}
                className="rounded-xl bg-wyd-blue px-3.5 py-2 text-[13px] font-extrabold text-white transition-colors hover:bg-wyd-blue-dark"
              >
                {t('wyd.nav.login', { defaultValue: 'Sign in' })}
              </Link>
            )}
          </div>
        </div>
      </header>
    </>
  )
}

export default WydHeader
