#!/usr/bin/env node
// Build-time twin of server-wrapper.js's runtime config.
//
// The browser reads window.__RUNTIME_CONFIG__ (public/runtime-config.js) for
// every NEXT_PUBLIC_* value; services/config/config.ts never uses literal
// process.env.NEXT_PUBLIC_X reads, so Next's compile-time inlining does not
// apply. The Docker image writes this file when the container starts
// (server-wrapper.js). On platforms that run `next build` and serve the result
// as-is (Vercel), nothing would write it, so we generate it here from the
// build environment. Harmless elsewhere: server-wrapper.js overwrites it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const EXTRA_CLIENT_VARS = []
const here = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(here, '..', 'public')

const runtimeConfig = {}
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined && (key.startsWith('NEXT_PUBLIC_') || EXTRA_CLIENT_VARS.includes(key))) {
    runtimeConfig[key] = value
  }
}

fs.mkdirSync(publicDir, { recursive: true })
fs.writeFileSync(
  path.join(publicDir, 'runtime-config.js'),
  `window.__RUNTIME_CONFIG__ = ${JSON.stringify(runtimeConfig)};\n`,
  'utf8'
)
console.log(`[runtime-config] wrote ${Object.keys(runtimeConfig).length} NEXT_PUBLIC_* values to public/runtime-config.js`)
