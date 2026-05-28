// Color Transfer demo - single video:
//   upload Source design -> zoom -> upload Target color reference -> zoom
//   -> submit -> recolored result.
// Two uploaders: SOURCE (input#source) + TARGET (input#target). Needs the
// color_transfer worker (machine1) on DEV.
//
// Inputs: SOURCE = env INPUT (or assets/input.jpg), TARGET = env TARGET. If
// TARGET is missing or points to a non-existent file, we fall back to SOURCE
// so the recording still completes - the runner UI's Target picker is the
// way to supply a real palette reference per-run.
//
// Usage: node record-color-transfer.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDemoSession, finalizeVideo, sleep } from './lib/demo-kit.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const SOURCE = path.resolve(__dirname, process.env.INPUT || 'assets/input.jpg')
// Fall back to SOURCE if env TARGET is unset or its file does not exist - the
// previous default (assets/colors-target.jpg) is not in the repo, which made
// fakeUpload's fs.readFileSync throw and aborted the whole recording before
// finalizeVideo could run.
const targetCandidate = process.env.TARGET
  ? path.resolve(__dirname, process.env.TARGET)
  : ''
const TARGET = targetCandidate && fs.existsSync(targetCandidate) ? targetCandidate : SOURCE

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`[color_transfer] SOURCE not found: ${SOURCE}`)
    process.exit(1)
  }
  if (TARGET === SOURCE) {
    if (process.env.TARGET) console.warn(`[color_transfer] TARGET "${process.env.TARGET}" not found - falling back to SOURCE`)
    else console.warn('[color_transfer] no TARGET supplied - reusing SOURCE for the demo (use the runner Target picker for a real palette ref)')
  }
  console.log(`[color_transfer] SOURCE=${SOURCE}`)
  console.log(`[color_transfer] TARGET=${TARGET}`)

  const s = await createDemoSession({ dirName: 'color-transfer' })
  const { ctx, page, glide, fakeUpload, zoomEl, dir, t0, viewport, rp } = s
  let submitMs = 0, resultMs = 0

  // Copy TARGET into the per-run input/ folder so the run is self-contained
  // (createDemoSession already copies SOURCE via env INPUT).
  if (TARGET !== SOURCE) {
    try { fs.copyFileSync(TARGET, path.join(rp.input, `target-${path.basename(TARGET)}`)) } catch {}
  }

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
    const targetInput = page.locator('input#target').first()
    try { await sourceInput.waitFor({ state: 'attached', timeout: 18000 }) }
    catch {
      console.log('[color_transfer] nav click did not switch tabs - navigating to ?tab=color_transfer')
      await page.goto(`${BASE_URL}/ai?tab=color_transfer`, { waitUntil: 'domcontentloaded' })
      await sourceInput.waitFor({ state: 'attached', timeout: 30000 })
    }
    await targetInput.waitFor({ state: 'attached', timeout: 15000 }).catch(() => {})
    await sleep(900)

    // Make sure cropping is OFF for this recording - the recorder cannot dismiss
    // the crop modal, and if the user's profile somehow has alwaysKeepOriginal
    // unchecked, uploads would stall inside the modal. The checkbox in
    // DoubleImageUploadSection has id="alwaysKeepOriginalDouble"; default is
    // checked (DEFAULTS.DEFAULT_VALUES.TRUE), so this is defensive only.
    await page.evaluate(() => {
      const cb = document.getElementById('alwaysKeepOriginalDouble')
      if (cb && !cb.checked) cb.click()
    }).catch(() => {})

    // Helper: did the source/target canvas actually receive an image? Looks at
    // the sentinel sourceImageUrl/targetImageUrl state by sniffing the rendered
    // canvas pixels (any non-checkerboard content -> non-blank). We just poll
    // the existence + size of the canvas and assume the brief draw call landed.
    const waitForCanvasReady = async (canvasId, ms = 15000) => {
      try {
        await page.waitForFunction(
          (id) => {
            const c = document.getElementById(id)
            return !!(c && c.width > 0 && c.height > 0)
          },
          canvasId,
          { timeout: ms }
        )
      } catch {}
    }

    // Source design. Click the labelled Source upload button for the on-screen
    // cursor, then drive the real upload through the stable #source input id.
    // (The label is "Upload Source Image"; the control panel upper-cases it.)
    const sourceUploadBtn = page.getByRole('button', { name: /upload source/i }).first()
    await glide(sourceUploadBtn, { force: true }).catch(() => {})
    await sleep(300)
    await fakeUpload(SOURCE, 'input#source')
    // Confirm the file actually landed on the input (setInputFiles in fakeUpload
    // swallows errors). If not, retry once with a direct setInputFiles.
    const sourceLoaded = await page.evaluate(() => {
      const el = document.querySelector('input#source')
      return !!(el && el.files && el.files.length > 0)
    }).catch(() => false)
    if (!sourceLoaded) {
      console.log('[color_transfer] source setInputFiles did not stick - retrying directly')
      await sourceInput.setInputFiles(SOURCE).catch((e) => console.error('[color_transfer] retry source failed:', e?.message || e))
    }
    await waitForCanvasReady('sourceCanvas')
    await sleep(1500)
    await zoomEl(['#sourceCanvas', 'canvas'])

    // Target color reference (label "Upload Target Design"), via #target input.
    const targetUploadBtn = page.getByRole('button', { name: /upload target/i }).first()
    await glide(targetUploadBtn, { force: true }).catch(() => {})
    await sleep(300)
    await fakeUpload(TARGET, 'input#target')
    const targetLoaded = await page.evaluate(() => {
      const el = document.querySelector('input#target')
      return !!(el && el.files && el.files.length > 0)
    }).catch(() => false)
    if (!targetLoaded) {
      console.log('[color_transfer] target setInputFiles did not stick - retrying directly')
      await targetInput.setInputFiles(TARGET).catch((e) => console.error('[color_transfer] retry target failed:', e?.message || e))
    }
    await waitForCanvasReady('targetCanvas')
    await sleep(1500)
    await zoomEl(['#targetCanvas', 'canvas'])

    // Wait for Submit to enable (the upload may crop/process first), then submit.
    const submit = page.getByRole('button', { name: /^submit$/i })
    const submitEnabled = await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /^submit$/i.test((x.textContent || '').trim()))
      return b && !b.disabled
    }, { timeout: 90000 }).then(() => true).catch(() => false)
    if (!submitEnabled) {
      console.log('[color_transfer] Submit never enabled - source/target probably did not register')
    }
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/sqs/send-task-message'), { timeout: 30000 }).catch(() => null),
      glide(submit),
    ])
    submitMs = Date.now()
    const downloadBtn = page.getByRole('button', { name: /download/i })
    try { await downloadBtn.first().waitFor({ state: 'visible', timeout: 600000 }); resultMs = Date.now() } catch {}
    await sleep(1500)
    await zoomEl(['div.cursor-col-resize', 'main canvas', 'canvas'])
    await page.screenshot({ path: path.join(rp.outputs, 'color-transfer-final.png') }).catch(() => {})
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
