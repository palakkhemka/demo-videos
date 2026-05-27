// Color Transfer demo — single video:
//   upload Source design -> zoom -> upload Target color reference -> zoom
//   -> submit -> recolored result.
// Two uploaders: SOURCE (first file input) + TARGET (second). Needs the
// color_transfer worker (machine1) on DEV.
//
// Inputs: SOURCE = env INPUT (or assets/input.jpg), TARGET = env TARGET
// (or assets/colors-target.jpg). Drop both in assets, or use the runner UI
// (it has a Target picker for this script).
//
// Usage: node record-color-transfer.mjs

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDemoSession, finalizeVideo, sleep } from './lib/demo-kit.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const SOURCE = path.resolve(__dirname, process.env.INPUT || 'assets/input.jpg')
const TARGET = path.resolve(__dirname, process.env.TARGET || 'assets/colors-target.jpg')

async function main() {
  const s = await createDemoSession({ dirName: 'color-transfer' })
  const { ctx, page, glide, fakeUpload, zoomEl, dir, t0, viewport } = s
  let submitMs = 0, resultMs = 0

  try {
    await page.goto(`${BASE_URL}/ai?tab=home`, { waitUntil: 'domcontentloaded' })
    const nav = page.locator('button[class*="tool-row"]').filter({ hasText: /color transfer/i }).first()
    console.log('[color_transfer] waiting for home (log in if prompted)...')
    await nav.waitFor({ state: 'visible', timeout: 300000 })
    await sleep(1000)
    await glide(nav, { force: true }).catch(() => {})

    // The tab has two upload buttons; the first/second file inputs back them.
    const uploadBtns = page.getByRole('button', { name: /upload/i })
    try { await uploadBtns.first().waitFor({ state: 'visible', timeout: 18000 }) }
    catch { await page.goto(`${BASE_URL}/ai?tab=color_transfer`, { waitUntil: 'domcontentloaded' }); await uploadBtns.first().waitFor({ state: 'visible', timeout: 30000 }) }
    await sleep(800)
    page.on('filechooser', (c) => c.setFiles([]).catch(() => {}))

    // Source design
    await glide(uploadBtns.nth(0)).catch(() => {})
    await sleep(300)
    await fakeUpload(SOURCE, 'input[type="file"] >> nth=0')
    await sleep(1800)
    await zoomEl(['canvas'])

    // Target color reference
    await glide(uploadBtns.nth(1)).catch(() => {})
    await sleep(300)
    await fakeUpload(TARGET, 'input[type="file"] >> nth=1')
    await sleep(1800)
    await zoomEl(['canvas'])

    const submit = page.getByRole('button', { name: /^submit$/i })
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/sqs/send-task-message'), { timeout: 30000 }).catch(() => null),
      glide(submit),
    ])
    submitMs = Date.now()
    const downloadBtn = page.getByRole('button', { name: /download/i })
    try { await downloadBtn.first().waitFor({ state: 'visible', timeout: 600000 }); resultMs = Date.now() } catch {}
    await sleep(1500)
    await zoomEl(['div.cursor-col-resize', 'main canvas', 'canvas'])
    await page.screenshot({ path: path.join(dir, 'color-transfer-final.png') }).catch(() => {})
  } finally {
    await ctx.close().catch(() => {})
  }

  await finalizeVideo({
    dir,
    outName: 'color-transfer-demo',
    titleUrl: 'textile-designer.ai/ai?tab=color_transfer',
    displayName: 'Color Transfer',
    caption: 'Recoloring designs by hand — new palette in seconds',
    viewport, t0, submitMs, resultMs,
  })
}

main().catch((e) => { console.error(e); process.exit(1) })
