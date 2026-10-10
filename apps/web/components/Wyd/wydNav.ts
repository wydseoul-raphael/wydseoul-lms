// Navigation model for the WYD header. Pure data + helpers so bun tests can
// import it without React.
import { WYD_BRAND } from '@/lib/wyd/brand'

export type NavVisibility = 'all' | 'auth' | 'guest'
export type SessionStatus = 'authenticated' | 'unauthenticated' | 'loading'

export interface WydNavItem {
  key: string
  labelKey: string
  href: string
  visibility: NavVisibility
}

// Order mirrors the reference portal header:
// 교육 소개 · 나의 학습 · 비회원 체험 · 선택 교과 수강신청 · 마이페이지
export const WYD_NAV: WydNavItem[] = [
  { key: 'about', labelKey: 'wyd.nav.about', href: WYD_BRAND.routes.about, visibility: 'all' },
  { key: 'learning', labelKey: 'wyd.nav.learning', href: WYD_BRAND.routes.learning, visibility: 'auth' },
  { key: 'preview', labelKey: 'wyd.nav.preview', href: WYD_BRAND.routes.preview, visibility: 'guest' },
  { key: 'enroll', labelKey: 'wyd.nav.enroll', href: WYD_BRAND.routes.enroll, visibility: 'auth' },
  { key: 'mypage', labelKey: 'wyd.nav.mypage', href: WYD_BRAND.routes.mypage, visibility: 'auth' },
]

export function visibleNavItems(items: WydNavItem[], status: SessionStatus): WydNavItem[] {
  // While the session is still resolving, show only what is safe for everyone;
  // the header re-renders once the status settles.
  const signedIn = status === 'authenticated'
  const signedOut = status === 'unauthenticated'
  return items.filter((item) => {
    if (item.visibility === 'all') return true
    if (item.visibility === 'auth') return signedIn
    return signedOut
  })
}

// A nav link is active for its own path and for anything nested under it,
// except the home link which only matches exactly.
export function isActivePath(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false
  const clean = pathname.replace(/\/+$/, '') || '/'
  if (href === '/') return clean === '/'
  return clean === href || clean.startsWith(`${href}/`)
}
