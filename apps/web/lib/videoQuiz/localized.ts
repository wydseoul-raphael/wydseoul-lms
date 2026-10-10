export const SUPPORTED_QUIZ_LANGS = ['en', 'ko', 'it', 'fr', 'es', 'pt'] as const
export type QuizLang = (typeof SUPPORTED_QUIZ_LANGS)[number]
export type LocalizedText = Partial<Record<QuizLang, string>> & Record<string, string | undefined>

// Current UI language → English → first non-empty value.
export function pickLocale(map: LocalizedText | null | undefined, lang: string): string {
  if (!map) return ''
  const code = lang.split('-')[0]
  return map[code] || map.en || Object.values(map).find((v) => !!v) || ''
}

export function missingLanguages(texts: Array<LocalizedText | null | undefined>): QuizLang[] {
  return SUPPORTED_QUIZ_LANGS.filter((lang) => texts.some((t) => !t || !t[lang]?.trim()))
}
