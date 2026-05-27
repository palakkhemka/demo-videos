// Color Transfer demo - single video:
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
    // Dismiss the real OS chooser (empty) BEFORE any upload click so the FAKE
    // picker shows first; the real image is set later via fakeUpload's
    // setInputFiles. Register once, up front (a click can fire it immediately).
    page.on('filechooser', (c) => c.setFiles([]).catch(() => {}))

    await page.goto(`${BASE_URL}/ai?tab=home`, { waitUntil: 'domcontentloaded' })
    const nav = page.locator('button[class*="tool-row"]').filter({ hasText: /color transfer/i }).first()
    console.log('[color_transfer] waiting for home (log in if prompted)...')
    await nav.waitFor({ state: 'visible', timeout: 300000 })
    await sleep(1000)
    await glide(nav, { force: true }).catch(() => {})

    // The color_transfer surface is the only tab that mounts the #source and
    // #target file inputs (DoubleImageUploadSection + ColorTransferFileInputs).
    // They are class="hidden", so wait for ATTACHED, not visible - this is the
    // definitive "the tool loaded" signal (the old code waited on a generic
    // /upload/i button that never matched before the tab had switched).
    const sourceInput = page.locator('input#source').first()
    try { await sourceInput.waitFor({ state: 'attached', timeout: 18000 }) }
    catch {
      console.log('[color_transfer] nav click did not switch tabs - navigating to ?tab=color_transfer')
      await page.goto(`${BASE_URL}/ai?tab=color_transfer`, { waitUntil: 'domcontentloaded' })
      await sourceInput.waitFor({ state: 'attached', timeout: 30000 })
    }
    await sleep(900)

    // Source design. Click the labelled Source upload button for the on-screen
    // cursor, then drive the real upload through the stable #source input id.
    // (The label is "Upload Source Image"; the control panel upper-cases it.)
    const sourceUploadBtn = page.getByRole('button', { name: /upload source/i }).first()
    await glide(sourceUploadBtn, { force: true }).catch(() => {})
    await sleep(300)
    await fakeUpload(SOURCE, 'input#source')
    await sleep(1800)
    await zoomEl(['#sourceCanvas', 'canvas'])

    // Target color reference (label "Upload Target Design"), via #target input.
    const targetUploadBtn = page.getByRole('button', { name: /upload target/i }).first()
    await glide(targetUploadBtn, { force: true }).catch(() => {})
    await sleep(300)
    await fakeUpload(TARGET, 'input#target')
    await sleep(1800)
    await zoomEl(['#targetCanvas', 'canvas'])

    // Wait for Submit to enable (the upload may crop/process first), then submit.
    const submit = page.getByRole('button', { name: /^submit$/i })
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /^submit$/i.test((x.textContent || '').trim()))
      return b && !b.disabled
    }, { timeout: 90000 }).catch(() => {})
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
    caption: 'Recoloring designs by hand - new palette in seconds',
    viewport, t0, submitMs, resultMs,
  })
}

main().catch((e) => { console.error(e); process.exit(1) })
