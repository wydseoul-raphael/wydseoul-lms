import '../styles/globals.css'
import React from 'react'
import type { Metadata } from 'next'
import Providers from '@components/Providers'
import { Inter, Noto_Sans_KR, Tajawal } from 'next/font/google'
import { WYD_BRAND } from '@/lib/wyd/brand'

// Latin/base face. Korean glyphs fall through to Noto Sans KR via the font
// stack in globals.css (`--font-default` first, then `--font-kr`).
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-default',
})

// Korean companion face: the learning center is operated from Seoul and ko is
// a first-class UI language, so Hangul must not depend on the OS fallback.
const notoSansKr = Noto_Sans_KR({
  subsets: ['latin'],
  weight: ['400', '500', '700', '900'],
  display: 'swap',
  variable: '--font-kr',
})

// Inter has no Arabic subset, so Arabic would otherwise fall back to
// whatever the OS provides (Geeza Pro, Segoe UI, Noto) and look like a
// different product on every platform.
//
// Tajawal is the Arabic face for the whole product. It is FORCED whenever the
// UI is Arabic (see globals.css), not merely offered as a fallback: Tajawal
// ships a Latin subset too, so a mixed Arabic screen renders in one typeface
// instead of switching per glyph between two designs with different
// proportions.
//
// Weights are 200-900 with no 600, so a `font-semibold` element rounds up to 700,
// which is the intended reading.
const tajawal = Tajawal({
  subsets: ['arabic', 'latin'],
  weight: ['300', '400', '500', '700', '800'],
  display: 'swap',
  variable: '--font-arabic',
})

// Root metadata: WYD branding for every page that does not set its own.
// Org-level `generateMetadata` (favicon_image, per-page titles) still wins
// when present.
export const metadata: Metadata = {
  title: { default: WYD_BRAND.appName, template: '%s' },
  description: WYD_BRAND.description,
  applicationName: WYD_BRAND.name,
  manifest: WYD_BRAND.assets.manifest,
  icons: {
    icon: [
      { url: WYD_BRAND.assets.icon(32), sizes: '32x32', type: 'image/png' },
      { url: WYD_BRAND.assets.icon(192), sizes: '192x192', type: 'image/png' },
      { url: WYD_BRAND.assets.emblem, type: 'image/svg+xml' },
    ],
    apple: WYD_BRAND.assets.appleTouchIcon,
    shortcut: WYD_BRAND.assets.favicon,
  },
  openGraph: { siteName: WYD_BRAND.name },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // `dir` is deliberately absent from the <html> below. React only reconciles
  // attributes present in its virtual tree, so leaving it out means React never
  // clobbers what dir-init.js wrote before paint. `lang="en"` stays as the
  // no-JS baseline for crawlers; the script overwrites it for everyone else.
  return (
    <html
      className={`${inter.variable} ${notoSansKr.variable} ${tajawal.variable}`}
      lang="en"
      suppressHydrationWarning
    >
      <head>
        {/* Synchronous script: sets <html lang/dir> before body paints so an
            RTL locale never flashes an LTR layout. Must run first. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/dir-init.js" />
        {/* Synchronous script: blocks parsing to guarantee window.__RUNTIME_CONFIG__ exists before any JS runs.
            Next.js <Script strategy="beforeInteractive"> is not truly blocking in all browsers (Safari). */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/runtime-config.js" />
        {/* Prevent white flash on embed routes: set html+body bg before body is painted.
            Reads the optional ?bgcolor param (hex-validated) or defaults to dark. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/embed-bg.js" />
      </head>
      <body suppressHydrationWarning>
        <Providers>
          <main className="animate-fade-in">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  )
}
