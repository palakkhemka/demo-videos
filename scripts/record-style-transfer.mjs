// Style Transfer demo - single video showing BOTH modes:
//   Mode 1 "Image Style Transfer" (style PRESET): upload one design, auto-pick
//     the first/featured preset, set creativity ~50%, submit, before/after.
//   Mode 2 "Image to Image Style Transfer": flip the Mode toggle, set
//     source = INPUT + target = TARGET (the same #source/#target file inputs
//     color_transfer uses), submit, show the styled result.
//
// Needs the style_transfer worker (queueBase 'style_transfer') live on DEV and
// the org to have credits, or each result wait times out (video still produced).
//
// Inputs: SOURCE design = env INPUT (or assets/input.jpg); style REFERENCE for
// image-to-image = env TARGET (falls back to INPUT if unset - supply a real
// style reference via TARGET for a meaningful mode-2 result).
//
// Usage: node record-style-transfer.mjs   (leave the window alone; log in if asked)

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createDemoSession, finalizeVideo, sleep } from '../lib/demo-kit.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const INPUT = path.resolve(__dirname, '..', process.env.INPUT || 'assets/input.jpg')
// Style reference for the image-to-image mode. No dedicated asset ships, so
// fall back to the same design as INPUT when TARGET is not provided.
const TARGET = path.resolve(__dirname, '..', process.env.TARGET || process.env.INPUT || 'assets/input.jpg')
// A single sensible creativity value (percent). The live tab currently keeps
// the creativity control commented out, so this is applied opportunistically
// (only if a % number box is actually rendered) and otherwise left at default.
const CREATIVITY_PCT = Number(process.env.CREATIVITY_PCT || 50)

async function main() {
  const s = await createDemoSession({ dirName: 'style-transfer' })
  const { ctx, page, glide, fakeUpload, zoomEl, downloads, dir, t0, viewport, rp } = s
  const spans = [] // [{start,end}] processing windows to speed-ramp in post
  const coreOf = (p) => path.basename(p).replace(/^\d+-/, '')

  // Dismiss the real OS chooser (empty) BEFORE any upload click so the FAKE
  // picker shows first; the real image is set later via fakeUpload's
  // setInputFiles. Register once, up front (a click can fire it immediately).
  page.on('filechooser', (c) => c.setFiles([]).catch(() => {}))

  // Wait helper: Submit disables while the worker runs, re-enables when done.
  const waitSubmit = (enabled, ms) => page.waitForFunction((want) => {
    const b = [...document.querySelectorAll('button')].find((x) => /^submit$/i.test((x.textContent || '').trim()))
    return b ? (want ? !b.disabled : b.disabled) : false
  }, enabled, { timeout: ms }).catch(() => {})

  // Submit + wait for THIS run's result; record the processing span, then do a
  // before/after slider sweep and zoom. Returns the captured fresh download (or
  // null) so the caller can keep it.
  const runAndShow = async (tag) => {
    const submit = page.getByRole('button', { name: /^submit$/i })
    // Wait until enabled (uploads may crop/process first).
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /^submit$/i.test((x.textContent || '').trim()))
      return b && !b.disabled
    }, { timeout: 90000 }).catch(() => {})

    const seenCores = new Set(downloads.map(coreOf))
    const tSubmit = Date.now()
    console.log(`[style_transfer] submitting ${tag} (captured so far: ${downloads.length})`)
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/sqs/send-task-message'), { timeout: 30000 }).catch(() => null),
      glide(submit),
    ])
    await waitSubmit(false, 8000)   // processing started
    console.log(`[style_transfer] ${tag} processing...`)
    await waitSubmit(true, 600000)  // processing finished
    const downloadBtn = page.getByRole('button', { name: /download/i })
    try { await downloadBtn.first().waitFor({ state: 'visible', timeout: 600000 }) } catch {}
    spans.push({ start: (tSubmit - t0) / 1000 + 1.0, end: (Date.now() - t0) / 1000 - 0.5 })
    await sleep(1200)

    // before/after compare slider sweep (style_transfer result uses the shared
    // cursor-col-resize compare component, same as the other tools).
    const slider = page.locator('div.cursor-col-resize').first()
    const box = await slider.boundingBox().catch(() => null)
    if (box) {
      const cy = box.y + box.height / 2, xAt = (f) => box.x + box.width * f
      await page.mouse.move(xAt(0.5), cy); await page.mouse.down()
      await page.mouse.move(xAt(0.15), cy, { steps: 30 }); await sleep(600)
      await page.mouse.move(xAt(0.85), cy, { steps: 40 }); await sleep(600)
      await page.mouse.move(xAt(0.5), cy, { steps: 30 }); await page.mouse.up(); await sleep(900)
    }
    await zoomEl(['div.cursor-col-resize', 'main canvas', 'canvas'])

    // Capture this run's fresh output (stale-dup guard like record-upscale).
    let captured = null
    for (let tries = 0; tries < 5 && !captured; tries++) {
      await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
        glide(downloadBtn.first()).catch(() => {}),
      ])
      await sleep(1500)
      captured = downloads.find((p) => !seenCores.has(coreOf(p))) || null
      if (!captured) {
        const last = downloads[downloads.length - 1]
        if (last && seenCores.has(coreOf(last))) { try { fs.rmSync(last) } catch {} ; downloads.pop() }
        console.log(`[style_transfer] ${tag}: result not ready, retry ${tries + 1}/5`)
        await sleep(4000)
      }
    }
    if (captured) console.log(`[style_transfer] captured ${tag} -> ${path.basename(captured)}`)
    else console.log(`[style_transfer] WARN: no fresh download for ${tag}`)
    return captured
  }

  try {
    // Navigate to the tool.
    await page.goto(`${BASE_URL}/ai?tab=home`, { waitUntil: 'domcontentloaded' })
    const nav = page.locator('button[class*="tool-row"]').filter({ hasText: /style transfer/i }).first()
    console.log('[style_transfer] waiting for home (log in if prompted)...')
    await nav.waitFor({ state: 'visible', timeout: 300000 })
    await sleep(1000)
    await glide(nav, { force: true }).catch(() => {})

    // The Mode toggle ("Image Style Transfer" / "Image to Image Style Transfer")
    // is the definitive "tool loaded" signal - it only mounts on this tab.
    const presetModeBtn = page.getByRole('button', { name: /^image style transfer$/i }).first()
    const i2iModeBtn = page.getByRole('button', { name: /image to image style transfer/i }).first()
    try { await presetModeBtn.waitFor({ state: 'visible', timeout: 18000 }) }
    catch {
      console.log('[style_transfer] nav click did not switch tabs - navigating to ?tab=style_transfer')
      await page.goto(`${BASE_URL}/ai?tab=style_transfer`, { waitUntil: 'domcontentloaded' })
      await presetModeBtn.waitFor({ state: 'visible', timeout: 30000 })
    }
    await sleep(900)

    // ============ MODE 1: Image Style Transfer (style PRESET) ============
    // Ensure preset mode (it is the default, but click to be explicit + visible).
    await glide(presetModeBtn, { force: true }).catch(() => {})
    await sleep(700)

    // Single-image upload (FileUploadSection -> "Upload Image" button, single
    // hidden input[type=file]).
    const uploadBtn = page.getByRole('button', { name: /upload image/i }).first()
    await glide(uploadBtn, { force: true }).catch(() => {})
    await sleep(300)
    await fakeUpload(INPUT) // default selector input[type="file"] (the single uploader)
    await sleep(2000)
    await zoomEl(['canvas']) // show the uploaded design

    // Auto-pick the FIRST / featured preset. The style grid renders one button
    // per STYLE_OPTIONS entry; each button contains an <img alt="<style>"> plus a
    // label. Click the first such style button (the grid is the only place with
    // alt-tagged style thumbnails), falling back to the first known preset name.
    const firstStyleByImg = page.locator('button:has(img[alt])').filter({ has: page.locator('img[alt]') }).first()
    let picked = false
    try {
      // Prefer a button whose img alt is the featured (first) preset name.
      const featured = page.locator('button:has(img[alt="Watercolor"])').first()
      if (await featured.count()) { await glide(featured, { force: true }); picked = true }
    } catch {}
    if (!picked) {
      try { await glide(firstStyleByImg, { force: true }); picked = true } catch {}
    }
    if (!picked) {
      // Last resort: click the first preset by its visible label text.
      await glide(page.getByRole('button', { name: /^watercolor$/i }).first(), { force: true }).catch(() => {})
    }
    await sleep(900)

    // Creativity ~50%. The control is currently commented out in the live tab,
    // so set it ONLY if a percent number box is actually present (future-proof);
    // otherwise the default creativity is used. (No comparison - a single value.)
    const crBox = page.locator('input[type="number"]').first()
    if (await crBox.count().catch(() => 0)) {
      await crBox.click({ timeout: 4000 }).catch(() => {})
      await crBox.fill(String(CREATIVITY_PCT)).catch(() => {})
      await crBox.press('Tab').catch(() => {})
      await sleep(500)
      const got = await crBox.inputValue().catch(() => '?')
      console.log(`[style_transfer] creativity requested ${CREATIVITY_PCT}%, field shows ${got}%`)
    } else {
      console.log(`[style_transfer] no creativity % box rendered - using tool default`)
    }

    await runAndShow('preset (image_style_transfer)')
    await sleep(1200)

    // ============ MODE 2: Image to Image Style Transfer ============
    // Flip the segmented Mode toggle. This swaps the surface to the
    // StyleTransferInputTab (source/target canvases) + the #source/#target file
    // inputs (the same ColorTransferFileInputs color_transfer uses).
    await glide(i2iModeBtn, { force: true }).catch(() => {})
    await sleep(900)
    const sourceInput = page.locator('input#source').first()
    const targetInput = page.locator('input#target').first()
    await sourceInput.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {})

    // Source design (header "Source Image", upload button labelled "Upload Source").
    const sourceUploadBtn = page.getByRole('button', { name: /upload source/i }).first()
    await glide(sourceUploadBtn, { force: true }).catch(() => {})
    await sleep(300)
    await fakeUpload(INPUT, 'input#source')
    await sleep(1800)
    await zoomEl(['#sourceCanvas', 'canvas'])

    // Target style reference (header "Target Image", button "Upload Target").
    const targetUploadBtn = page.getByRole('button', { name: /upload target/i }).first()
    await glide(targetUploadBtn, { force: true }).catch(() => {})
    await sleep(300)
    await fakeUpload(TARGET, 'input#target')
    await sleep(1800)
    await zoomEl(['#targetCanvas', 'canvas'])

    await runAndShow('image-to-image (image_to_image_style_transfer)')

    await page.screenshot({ path: path.join(rp.outputs, 'style-transfer-final.png') }).catch(() => {})
    console.log('[style_transfer] downloads:', downloads.length)
  } finally {
    await ctx.close().catch(() => {})
  }

  await finalizeVideo({
    dir,
    outName: 'style-transfer-demo',
    titleUrl: 'textile-designer.ai/ai?tab=style_transfer',
    displayName: 'Style Transfer',
    caption: 'Restyling a design by hand takes hours - any art style in seconds',
    viewport, t0, spans,
  })
}

main().catch((e) => { console.error(e); process.exit(1) })
