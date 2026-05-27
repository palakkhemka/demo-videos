// One-time login: opens a HEADED Chromium with a persistent profile so the
// Firebase session (stored in IndexedDB) is saved to disk and reused by the
// recording script. Run this yourself, log in as agarwalpalak99@gmail.com,
// then it auto-closes once you reach the /ai workspace.
//
// Usage (from demo/):
//   node login-once.mjs
// Env:
//   BASE_URL   default http://localhost:3000
//   PROFILE    profile dir (default ./.profile)

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const PROFILE = process.env.PROFILE || path.join(__dirname, '.profile')

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 800 },
})
const page = ctx.pages()[0] || (await ctx.newPage())

console.log(`\nProfile: ${PROFILE}`)
console.log('Opening the app — log in as agarwalpalak99@gmail.com.')
console.log('This window closes automatically once you reach /ai (or close it yourself).\n')

await page.goto(`${BASE_URL}/ai`, { waitUntil: 'domcontentloaded' }).catch(() => {})

try {
  // Resolve when the workspace loads (logged in) — give plenty of time to log in.
  await page.waitForURL('**/ai**', { timeout: 300000 })
  console.log('Reached /ai — session saved to the profile. Closing.')
  await page.waitForTimeout(2000)
} catch {
  console.log('Timed out waiting for /ai — closing anyway; session is saved if you logged in.')
}

await ctx.close()
console.log('Done. Profile is ready for the recording.')
