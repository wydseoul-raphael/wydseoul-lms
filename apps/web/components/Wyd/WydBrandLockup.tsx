'use client'
import React from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { WYD_BRAND } from '@/lib/wyd/brand'
import { cn } from '@/lib/utils'

interface WydBrandLockupProps {
  href: string
  size?: 'header' | 'footer'
  className?: string
}

// Logo + two-line name block used in the header and footer.
export function WydBrandLockup({ href, size = 'header', className }: WydBrandLockupProps) {
  const { t } = useTranslation()
  const logoWidth = size === 'header' ? 82 : 72
  const logoHeight = Math.round((logoWidth * WYD_BRAND.logoSize.height) / WYD_BRAND.logoSize.width)

  return (
    <Link
      href={href}
      aria-label={t('wyd.nav.home', { defaultValue: 'Home' })}
      className={cn('flex shrink-0 items-center gap-2.5', className)}
    >
      <Image
        src={WYD_BRAND.assets.logoSmall}
        alt={WYD_BRAND.name}
        width={logoWidth}
        height={logoHeight}
        priority={size === 'header'}
        style={{ width: logoWidth, height: 'auto' }}
      />
      <span className="grid gap-px leading-tight">
        <strong className={cn('text-wyd-blue font-black', size === 'header' ? 'text-[15px]' : 'text-[14px]')}>
          {WYD_BRAND.name}
        </strong>
        <span className="hidden min-[360px]:block text-[10px] font-semibold text-[#536076]">
          {t('wyd.brand.subtitle', { defaultValue: WYD_BRAND.subtitle })}
        </span>
      </span>
    </Link>
  )
}

export default WydBrandLockup
