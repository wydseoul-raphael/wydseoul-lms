import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const LANGS = ['en', 'ko', 'it', 'fr', 'es', 'pt']
const load = (lang) => JSON.parse(readFileSync(join(import.meta.dir, '..', 'locales', `${lang}.json`), 'utf8'))

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') flatten(v, key, out)
    else out[key] = v
  }
  return out
}

describe('wyd locale namespace', () => {
  const en = flatten(load('en').wyd)
  const enKeys = Object.keys(en).sort()

  test('english has the namespace', () => {
    expect(enKeys.length).toBeGreaterThan(100)
    expect(en['nav.about']).toBeTruthy()
    expect(en['preview.title']).toBeTruthy()
  })

  for (const lang of LANGS.filter((l) => l !== 'en')) {
    test(`${lang} has the same keys and no empty strings`, () => {
      const flat = flatten(load(lang).wyd)
      expect(Object.keys(flat).sort()).toEqual(enKeys)
      for (const [k, v] of Object.entries(flat)) {
        expect(typeof v === 'string' && v.trim().length > 0, `${lang}:${k}`).toBe(true)
      }
    })
  }

  test('interpolation uses i18next double braces', () => {
    for (const lang of LANGS) {
      for (const [k, v] of Object.entries(flatten(load(lang).wyd))) {
        expect(/(^|[^{])\{[^{}]+\}([^}]|$)/.test(v), `${lang}:${k} has a single-brace placeholder`).toBe(false)
      }
    }
  })
})
