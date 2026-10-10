// WYD SEOUL 2027 brand constants.
//
// Single source of truth for the product name, asset paths, palette and the
// public routes of the Volunteer Online Learning Center. Keep this file free of
// React/Next imports so `bun test` can import it directly.

export const WYD_LANGUAGE_CODES = ['en', 'ko', 'it', 'fr', 'es', 'pt'] as const
export type WydLanguageCode = (typeof WYD_LANGUAGE_CODES)[number]

export const WYD_BRAND = {
  // Never translated.
  name: 'WYD SEOUL 2027',
  // English fallback for <title>; the UI uses t('wyd.brand.appName').
  appName: 'WYD SEOUL 2027 Volunteer Online Learning Center',
  subtitle: 'Volunteer Online Learning Center',
  description:
    'Learn, prepare, and serve together. Complete required training, choose courses for your role, and track your learning in one place.',
  assets: {
    logo: '/wyd/wyd-seoul-2027-logo.webp',
    logoPng: '/wyd/wyd-seoul-2027-logo.png',
    logoSvg: '/wyd/wyd-seoul-2027-logo.svg',
    // Header-sized raster (120px tall) for crisp rendering at 82px width.
    logoSmall: '/wyd/wyd-seoul-2027-logo-h120.webp',
    logoSmallPng: '/wyd/wyd-seoul-2027-logo-h120.png',
    emblem: '/wyd/wyd-emblem.svg',
    emblemPng: '/wyd/wyd-emblem.png',
    emblemWebp: '/wyd/wyd-emblem.webp',
    icon: (size: 16 | 32 | 48 | 180 | 192 | 512) => `/wyd/wyd-emblem-${size}.png`,
    appleTouchIcon: '/wyd/apple-touch-icon.png',
    favicon: '/favicon.ico',
    manifest: '/wyd/site.webmanifest',
  },
  // Native logo aspect ratio (trimmed): 360 × 198.
  logoSize: { width: 360, height: 198 },
  colors: {
    blue: '#0047bb',
    blueDark: '#082b67',
    navy: '#071f47',
    red: '#f32735',
    yellow: '#fbe126',
    ink: '#111111',
    muted: '#687386',
    line: '#dfe4ec',
    surface: '#ffffff',
    success: '#16835c',
    canvas: '#f5f7fb',
    stage: '#0a0d13',
  },
  languages: WYD_LANGUAGE_CODES,
  // Public introduction video shown on /preview (guest experience).
  previewVideoId: '42M5kFJU804',
  routes: {
    home: '/',
    about: '/about',
    preview: '/preview',
    copyright: '/copyright',
    contributors: '/contributors',
    learning: '/learning',
    enroll: '/enroll',
    mypage: '/mypage',
    login: '/login',
    signup: '/signup',
    admin: '/dash',
    courses: '/courses',
  },
} as const

export const WYD_COPYRIGHT_HOLDER = 'WYD SEOUL 2027'
