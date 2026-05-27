// Upscale ("Ready to Print") demo — single video:
//   upload -> zoom input -> ADVANCED mode -> run 2x (controls, before/after, zoom)
//   -> run 4x -> side-by-side 2x vs 4x comparison.
// Needs the upscale worker (machine1 upscale_md / machine2 upscale_sd) on DEV.
// Untested until that worker is up; the scale-input selector may need a tweak.
//
// Usage: node record-upscale.mjs   (leave the window alone)

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createDemoSession, finalizeVideo, sleep } from './lib/demo-kit.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const INPUT = path.resolve(__dirname, process.env.INPUT || 'assets/input.jpg')
const SCALES = [2, 4]

async function main() {
  const s = await createDemoSession({ dirName: 'upscale' })
  const { ctx, page, glide, fakeUpload, zoomEl, downloads, dir, t0, viewport } = s
  const spans = []

  try {
    await page.goto(`${BASE_URL}/ai?tab=home`, { waitUntil: 'domcontentloaded' })
    const nav = page.locator('button[class*="tool-row"]').filter({ hasText: /ready to print/i }).first()
    console.log('[upscale] waiting for home (log in if prompted)...')
    await nav.waitFor({ state: 'visible', timeout: 300000 })
    await sleep(1200)
    await glide(nav, { force: true }).catch(() => {})

    const uploadBtn = page.getByRole('button', { name: /upload image/i })
    try { await uploadBtn.waitFor({ state: 'visible', timeout: 18000 }) }
    catch { await page.goto(`${BASE_URL}/ai?tab=upscale`, { waitUntil: 'domcontentloaded' }); await uploadBtn.waitFor({ state: 'visible', timeout: 30000 }) }
    await sleep(800)

    page.on('filechooser', (c) => c.setFiles(INPUT).catch(() => {})) // feed real file via tool chooser
    await glide(uploadBtn)
    await sleep(300)
    await fakeUpload(INPUT)
    await sleep(2000)
    await zoomEl(['canvas']) // show the low-res input

    // Advanced mode exposes the scale-factor input.
    await glide(page.getByRole('button', { name: /^advanced$/i })).catch(() => {})
    await sleep(700)

    const submitBtn = page.getByRole('button', { name: /^submit$/i })
    const downloadBtn = page.getByRole('button', { name: /download/i })

    for (const sc of SCALES) {
      // Set the scale factor (small numeric input next to "Scale Factor:").
      const scaleInput = page.locator('input').filter({ hasNot: page.locator('[type="range"]') }).first()
      await scaleInput.click({ timeout: 5000 }).catch(() => {})
      await scaleInput.fill(String(sc)).catch(() => {})
      await sleep(900)

      const before = downloads.length
      const tSubmit = Date.now()
      await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/sqs/send-task-message'), { timeout: 30000 }).catch(() => null),
        glide(submitBtn),
      ])
      try { await downloadBtn.first().waitFor({ state: 'visible', timeout: 600000 }) } catch {}
      const tResult = Date.now()
      spans.push({ start: (tSubmit - t0) / 1000 + 1.0, end: (tResult - t0) / 1000 - 0.5 })
      await sleep(1200)

      // before/after slider + zoom result
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
      await glide(downloadBtn.first()).catch(() => {}) // save this scale's output
      await sleep(1500)
      void before
    }

    // Side-by-side 2x vs 4x comparison from the two downloaded outputs.
    const toData = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64')
    const imgs = downloads.slice(0, 2).map(toData)
    if (imgs.length === 2) {
      await page.evaluate(({ a, b }) => {
        const ov = document.createElement('div'); ov.id = 'tr-cmp'
        ov.style.cssText = 'position:fixed;inset:0;z-index:2147483500;background:rgba(13,27,42,.96);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;font-family:Segoe UI,system-ui,sans-serif;color:#e8eef4'
        ov.innerHTML = '<div style="font-size:28px;font-weight:700">2× vs 4× — Ready to Print</div>' +
          '<div style="display:flex;gap:30px">' +
          '<div style="text-align:center"><img src="' + a + '" style="width:420px;height:420px;object-fit:cover;border-radius:12px;box-shadow:0 10px 40px #000"/><div style="margin-top:10px;font-size:20px;font-weight:600">2×</div></div>' +
          '<div style="text-align:center"><img src="' + b + '" style="width:420px;height:420px;object-fit:cover;border-radius:12px;box-shadow:0 10px 40px #000"/><div style="margin-top:10px;font-size:20px;font-weight:600">4×</div></div>' +
          '</div>'
        document.body.appendChild(ov)
      }, { a: imgs[0], b: imgs[1] })
      await sleep(3200)
      await page.evaluate(() => document.getElementById('tr-cmp')?.remove())
    }

    await page.screenshot({ path: path.join(dir, 'upscale-final.png') }).catch(() => {})
    console.log('[upscale] downloads:', downloads.length)
  } finally {
    await ctx.close().catch(() => {})
  }

  await finalizeVideo({
    dir,
    outName: 'upscale-demo',
    titleUrl: 'textile-designer.ai/ai?tab=upscale',
    displayName: 'Ready to Print',
    caption: 'Low-res art too small to print — print-ready in seconds',
    viewport, t0, spans,
  })
}

main().catch((e) => { console.error(e); process.exit(1) })
