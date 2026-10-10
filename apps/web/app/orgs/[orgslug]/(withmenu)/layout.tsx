'use client';
import { use, useEffect, type ReactNode } from "react";
import '@styles/globals.css'
import { SessionGate } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { OrgJoinBanner, OrgJoinBannerProvider } from '@components/Objects/Banners/OrgJoinBanner'
import { OrgMFAPolicyGate } from '@components/Objects/Banners/OrgMFAPolicyGate'
import { PodcastPlayerProvider } from '@components/Contexts/PodcastPlayerContext'
import dynamic from 'next/dynamic'
const PodcastPlayer = dynamic(() => import('@components/Objects/Podcasts/PodcastPlayer'), { ssr: false })
import { PageViewTracker } from '@components/Analytics/PageViewTracker'
import { usePathname, useSearchParams } from 'next/navigation'
import { getGoogleFontUrl, DEFAULT_FONT } from '@/lib/fonts'
import { WydHeader } from '@components/Wyd/WydHeader'
import { WydFooter } from '@components/Wyd/WydFooter'

// Public shell of the WYD SEOUL 2027 learning center: WYD header + footer
// around every (withmenu) route. The org's primary-colour tint is intentionally
// not applied here (the brand palette is fixed in globals.css); the org's
// custom font, if any, still is.
function LayoutContent({ children, orgslug }: { children: ReactNode; orgslug: string }) {
  const org = useOrg() as any
  const customFont = org?.config?.config?.customization?.general?.font || org?.config?.config?.general?.font || ''
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // chrome=none strips the org navigation/footer so this route can be embedded
  // inside another view (e.g. a Resource activity iframe) without duplicate chrome.
  const chromeless = searchParams?.get('chrome') === 'none'

  // Inject Google Font stylesheet into document head
  useEffect(() => {
    if (!customFont || customFont === DEFAULT_FONT) return

    const fontId = `gfont-${customFont.replace(/\s/g, '-')}`
    if (document.getElementById(fontId)) return

    // Add preconnect hints
    const preconnect1 = document.createElement('link')
    preconnect1.rel = 'preconnect'
    preconnect1.href = 'https://fonts.googleapis.com'
    document.head.appendChild(preconnect1)

    const preconnect2 = document.createElement('link')
    preconnect2.rel = 'preconnect'
    preconnect2.href = 'https://fonts.gstatic.com'
    preconnect2.crossOrigin = 'anonymous'
    document.head.appendChild(preconnect2)

    // Add font stylesheet
    const link = document.createElement('link')
    link.id = fontId
    link.rel = 'stylesheet'
    link.href = getGoogleFontUrl(customFont)
    document.head.appendChild(link)

    return () => {
      document.head.removeChild(preconnect1)
      document.head.removeChild(preconnect2)
      const existing = document.getElementById(fontId)
      if (existing) document.head.removeChild(existing)
    }
  }, [customFont])

  const pathParts = pathname?.split('/').filter(Boolean) || []

  // Full-bleed pages: no footer. The guest preview is a self-contained dark
  // stage with its own toolbar (exit link, brand, language), so it hides the
  // header as well — a second bar on top would duplicate that chrome.
  const noFooterPaths = ['copilot', 'preview']
  const noHeaderPaths = ['preview']
  const isFullBleedPage = noFooterPaths.some((p) => pathParts.includes(p))
  const hideHeader = noHeaderPaths.some((p) => pathParts.includes(p))

  return (
    <div
      // lh-org-font-root gives globals.css a hook to override this inline
      // font-family in Arabic, where Tajawal replaces the org's custom face
      // outright. An inline style beats any normal rule, so the override has to
      // target this element specifically.
      className="lh-org-font-root flex flex-col min-h-screen bg-wyd-canvas text-wyd-ink"
      style={{
        ...(customFont ? { fontFamily: `'${customFont}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` } : {}),
      }}
    >
      <PageViewTracker />
      {!chromeless && <OrgJoinBanner />}
      {!chromeless && !hideHeader && <WydHeader orgslug={orgslug} />}
      {/* Org-wide 2FA policy: renders nothing unless this user is non-compliant. */}
      {!chromeless && <OrgMFAPolicyGate />}
      <div id="main" tabIndex={-1} className="flex-1 relative outline-none" style={{ zIndex: 'var(--z-content)' }}>
        {children}
      </div>
      {!isFullBleedPage && !chromeless && <WydFooter orgslug={orgslug} />}
    </div>
  )
}

export default function RootLayout(
  props: {
    children: ReactNode
    params: Promise<any>
  }
) {
  const params = use(props.params);

  const {
    children
  } = props;

  return (
    <>
      <SessionGate>
      <OrgJoinBannerProvider>
        <PodcastPlayerProvider>
          <LayoutContent orgslug={params?.orgslug}>
            {children}
          </LayoutContent>
          <PodcastPlayer />
        </PodcastPlayerProvider>
      </OrgJoinBannerProvider>
      </SessionGate>
    </>
  )
}
