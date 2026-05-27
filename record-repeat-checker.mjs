// Demo recording: Seamless Repeat Checker (public /tools/repeat_checker page).
// Smoke test for the testreel pipeline - no auth, no worker, no credits.
//
// Usage (from demo/):
//   node record-repeat-checker.mjs
// Env:
//   BASE_URL   default http://localhost:3000
//   HEADLESS   set to "1" to run headless (default: headed so you can watch)
//   OUT        output dir (default ./output)

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { recordPage } from 'testreel'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const HEADLESS = process.env.HEADLESS === '1'
const OUT = process.env.OUT || path.join(__dirname, 'output')
const SAMPLE = path.join(__dirname, 'assets', 'sample-tile.svg')
const VIEWPORT = { width: 1280, height: 800 }

async function main() {
  const browser = await chromium.launch({ headless: HEADLESS })
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    recordVideo: { dir: OUT, size: VIEWPORT },
  })
  const page = await context.newPage()

  await page.goto(`${BASE_URL}/tools/repeat_checker`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#fileInput', { state: 'attached', timeout: 30000 })

  // Dismiss the cookie-consent banner before recording so it stays out of the video.
  await page
    .getByRole('button', { name: /^Accept$/ })
    .click({ timeout: 4000 })
    .catch(() => {})

  const recorder = await recordPage(page, {
    outputDir: OUT,
    name: 'repeat-checker-demo',
    clean: true,
    outputFormat: 'mp4',
    cursor: { style: 'pointer' },
    chrome: { url: 'https://textile-designer.ai/tools/repeat_checker', trafficLights: true },
    background: { gradient: { from: '#1f3a5f', to: '#3f7d54' }, padding: 56, borderRadius: 14 },
  })

  try {
    await recorder.wait(800)

    // Upload the sample tile by actually clicking the "click to upload" label,
    // with animated cursor + click ripple. The hidden <input id="fileInput">
    // opens a file chooser; this handler feeds it the file so no OS dialog
    // appears in the video.
    page.on('filechooser', (chooser) => chooser.setFiles(SAMPLE).catch(() => {}))
    await recorder.click('label[for="fileInput"]')
    // Guarantee the file is attached even if the chooser path flaked, so the
    // pattern (and the Enlarge button) reliably appear.
    await page.setInputFiles('#fileInput', SAMPLE).catch(() => {})
    await page.waitForSelector('button[aria-label="Enlarge preview"]', { timeout: 10000 })
    await recorder.wait(1400) // let the canvas draw the repeated pattern

    // Show the different repeat layouts.
    await recorder.click('input[name="patternType"][value="half-drop"]')
    await recorder.wait(1000)
    await recorder.click('input[name="patternType"][value="half-brick"]')
    await recorder.wait(1000)
    await recorder.click('input[name="patternType"][value="full"]')
    await recorder.wait(800)

    // Star feature: the fullscreen enlarge + zoom/pan preview.
    await recorder.click('button[aria-label="Enlarge preview"]')
    await recorder.wait(900)
    await recorder.click('button[aria-label="Zoom in"]')
    await recorder.wait(600)
    await recorder.click('button[aria-label="Zoom in"]')
    await recorder.wait(700)

    // Pan the zoomed canvas (drag) - recorder has no drag, drive the mouse directly.
    const cx = VIEWPORT.width / 2
    const cy = VIEWPORT.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx - 160, cy - 120, { steps: 24 })
    await page.mouse.up()
    await recorder.wait(900)

    await recorder.click('button[aria-label="Close fullscreen"]')
    await recorder.wait(700)
    await recorder.screenshot('repeat-checker-final')

    const result = await recorder.stop()
    console.log('\nVIDEO:', result.video)
    console.log('SHOTS:', result.screenshots)
  } finally {
    await browser.close().catch(() => {})
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
