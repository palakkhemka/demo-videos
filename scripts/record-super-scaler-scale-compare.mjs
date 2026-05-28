// Super Scaler scale comparison demo - one image, 3 runs at 2x / 4x / 8x
// (mode + detail kept at Creative + Prism Shift so the upscale-only axis
// stays clean), captured downloads composed into a loupe magnifier overlay
// at the end so the resolution gain is actually visible (same camera frame,
// pixels zoomed under a glass that glides across the three outputs).
// Needs the image_enhance worker on the target site.
//
// Usage: node record-super-scaler-scale-compare.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDemoSession, finalizeVideo, sleep } from '../lib/demo-kit.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const INPUT = path.resolve(__dirname, '..', process.env.INPUT || 'assets/input.jpg')
const RUNS = [
  { scale: '2x', label: '2×' },
  { scale: '4x', label: '4×' },
  { scale: '8x', label: '8×' },
]

async function main() {
  if (!fs.existsSync(INPUT)) { console.error(`[super_scaler] INPUT not found: ${INPUT}`); process.exit(1) }
  console.log(`[super_scaler] INPUT=${INPUT}`)

  const s = await createDemoSession({ dirName: 'super-scaler-scale' })
  const { ctx, page, glide, fakeUpload, zoomEl, downloads, dir, t0, viewport, rp } = s
  const spans = []
  const outputs = []

  const banner = async (text, color = '#2f6fed') => {
    await page.evaluate(({ text, color }) => {
      document.getElementById('tr-banner')?.remove()
      const b = document.createElement('div'); b.id = 'tr-banner'
      b.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:2147483500;background:' + color + ';color:#fff;font:600 22px Segoe UI,system-ui,sans-serif;padding:12px 26px;border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.4)'
      b.textContent = text
      document.body.appendChild(b)
    }, { text, color })
  }
  const clearBanner = () => page.evaluate(() => document.getElementById('tr-banner')?.remove())
  const coreOf = (p) => path.basename(p).replace(/^\d+-/, '')

  try {
    page.on('filechooser', (c) => c.setFiles([]).catch(() => {}))
    await page.goto(`${BASE_URL}/ai?tab=home`, { waitUntil: 'domcontentloaded' })
    const nav = page.locator('button[class*="tool-row"]').filter({ hasText: /super scaler/i }).first()
    console.log('[super_scaler] waiting for home (log in if prompted)...')
    await nav.waitFor({ state: 'visible', timeout: 300000 })
    await sleep(1000)
    await glide(nav, { force: true }).catch(() => {})

    const uploadBtn = page.getByRole('button', { name: /upload image/i })
    try { await uploadBtn.waitFor({ state: 'visible', timeout: 18000 }) }
    catch { await page.goto(`${BASE_URL}/ai?tab=image_enhance`, { waitUntil: 'domcontentloaded' }); await uploadBtn.waitFor({ state: 'visible', timeout: 30000 }) }
    await sleep(800)
    await glide(uploadBtn)
    await sleep(300)
    await fakeUpload(INPUT)
    await sleep(2200)
    await zoomEl(['canvas'])

    // Lock the non-scale axes to "Creative + Prism Shift" so the runs differ
    // only in output_size. Best-effort: if the labels are gated by org config
    // and a click silently no-ops the demo will still produce three outputs.
    const pickSegmented = async (label) => {
      const btn = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first()
      if (await btn.count().catch(() => 0)) await glide(btn).catch(() => {})
      await sleep(350)
    }
    await pickSegmented('Creative')
    await pickSegmented('Prism Shift')
    await sleep(400)

    const submitBtn = page.getByRole('button', { name: /^submit$/i })
    const downloadBtn = page.getByRole('button', { name: /download/i })
    const waitSubmit = (wantEnabled, ms) => page.waitForFunction((want) => {
      const b = [...document.querySelectorAll('button')].find((x) => /^submit$/i.test((x.textContent || '').trim()))
      return b ? (want ? !b.disabled : b.disabled) : false
    }, wantEnabled, { timeout: ms }).catch(() => {})

    for (const run of RUNS) {
      console.log(`[super_scaler] === ${run.label} ===`)
      await banner(`Output size: ${run.label}`, '#2f6fed')
      // Each output_size choice is a segmented button: '2x' | '4x' | '8x'.
      await pickSegmented(run.scale)
      await sleep(600)

      const seenCores = new Set(downloads.map(coreOf))
      const tSubmit = Date.now()
      await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/sqs/send-task-message'), { timeout: 30000 }).catch(() => null),
        glide(submitBtn),
      ])
      await waitSubmit(false, 8000)
      console.log(`[super_scaler] ${run.label} processing...`)
      await waitSubmit(true, 600000)
      try { await downloadBtn.first().waitFor({ state: 'visible', timeout: 600000 }) } catch {}
      spans.push({ start: (tSubmit - t0) / 1000 + 1.0, end: (Date.now() - t0) / 1000 - 0.5 })
      await sleep(900)

      // Before/after slider for the on-camera reveal of this scale's result.
      const slider = page.locator('div.cursor-col-resize').first()
      const box = await slider.boundingBox().catch(() => null)
      if (box) {
        const cy = box.y + box.height / 2, xAt = (f) => box.x + box.width * f
        await page.mouse.move(xAt(0.5), cy); await page.mouse.down()
        await page.mouse.move(xAt(0.15), cy, { steps: 30 }); await sleep(500)
        await page.mouse.move(xAt(0.85), cy, { steps: 40 }); await sleep(500)
        await page.mouse.move(xAt(0.5), cy, { steps: 30 }); await page.mouse.up(); await sleep(700)
      }

      // Capture the result file. The button can briefly point at the previous
      // run's output, so we retry a few times if the just-saved file matches a
      // core we've already captured (same trick record-upscale.mjs uses).
      let captured = null
      for (let tries = 0; tries < 6 && !captured; tries++) {
        await Promise.all([
          page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
          glide(downloadBtn.first()).catch(() => {}),
        ])
        await sleep(1400)
        captured = downloads.find((p) => !seenCores.has(coreOf(p))) || null
        if (!captured) {
          const last = downloads[downloads.length - 1]
          if (last && seenCores.has(coreOf(last))) { try { fs.rmSync(last) } catch {} ; downloads.pop() }
          console.log(`[super_scaler] ${run.label}: result not ready, retry ${tries + 1}/6`)
          await sleep(4000)
        }
      }
      if (captured) { outputs.push({ file: captured, label: run.label }); console.log(`[super_scaler] captured ${run.label} -> ${path.basename(captured)}`) }
      else console.log(`[super_scaler] WARN: no fresh download for ${run.label}`)
      await clearBanner()
      await sleep(800)
    }

    // Loupe comparison: 3-cell strip, magnifier glides across so the
    // resolution gap is visible on camera. Same shape as record-upscale.mjs
    // (proven to render at 1920x1080 inside the recorded webm).
    const toData = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64')
    const cards = outputs.map((o) => ({ src: toData(o.file), label: o.label }))
    console.log(`[super_scaler] loupe comparison of ${cards.length} outputs`)
    if (cards.length) {
      const dur = Math.max(7, cards.length * 2.5)
      await page.evaluate(({ cards, dur }) => new Promise((resolve) => {
        const ov = document.createElement('div'); ov.id = 'tr-cmp'
        ov.style.cssText = 'position:fixed;inset:0;z-index:2147483500;background:rgba(13,27,42,.97);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;font-family:Segoe UI,system-ui,sans-serif;color:#e8eef4'
        const title = document.createElement('div')
        title.style.cssText = 'font-size:26px;font-weight:700'
        title.textContent = 'Super Scaler - resolution comparison'
        const sub = document.createElement('div')
        sub.style.cssText = 'font-size:14px;opacity:.75;margin-top:-12px'
        sub.textContent = 'Same input. 2x / 4x / 8x output. Watch the loupe.'
        const grid = document.createElement('div')
        grid.style.cssText = `position:relative;display:grid;grid-template-columns:repeat(${cards.length},360px);gap:14px`
        cards.forEach((c) => {
          const cell = document.createElement('div'); cell.className = 'tr-cell'
          cell.style.cssText = 'position:relative;width:360px;height:360px;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px #000'
          const im = document.createElement('img'); im.src = c.src; im.dataset.src = c.src
          im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block'
          const lab = document.createElement('div')
          lab.textContent = c.label
          lab.style.cssText = 'position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);font-size:15px;font-weight:600;padding:5px 8px;text-align:center'
          cell.appendChild(im); cell.appendChild(lab); grid.appendChild(cell)
        })
        const LS = 220, Z = 3.4
        const loupe = document.createElement('div'); loupe.id = 'tr-loupe'
        loupe.style.cssText = `position:fixed;width:${LS}px;height:${LS}px;border-radius:50%;border:4px solid #fff;box-shadow:0 6px 24px rgba(0,0,0,.6),inset 0 0 0 2px rgba(0,0,0,.25);pointer-events:none;background-repeat:no-repeat;z-index:2147483600;opacity:0`
        ov.appendChild(title); ov.appendChild(sub); ov.appendChild(grid); document.body.appendChild(ov); document.body.appendChild(loupe)
        const update = (px, py) => {
          loupe.style.left = (px - LS / 2) + 'px'; loupe.style.top = (py - LS / 2) + 'px'
          const el = document.elementFromPoint(px, py)
          const cell = el && el.closest ? el.closest('.tr-cell') : null
          const im = cell ? cell.querySelector('img') : null
          if (!im) { loupe.style.opacity = '0'; return }
          loupe.style.opacity = '1'
          const r = im.getBoundingClientRect()
          const nW = im.naturalWidth || r.width, nH = im.naturalHeight || r.height
          const sc = Math.max(r.width / nW, r.height / nH)
          const dispW = nW * sc, dispH = nH * sc
          const ix = (px - r.left) + (dispW - r.width) / 2
          const iy = (py - r.top) + (dispH - r.height) / 2
          loupe.style.backgroundImage = 'url(' + im.dataset.src + ')'
          loupe.style.backgroundSize = (dispW * Z) + 'px ' + (dispH * Z) + 'px'
          loupe.style.backgroundPosition = (-(ix * Z - LS / 2)) + 'px ' + (-(iy * Z - LS / 2)) + 'px'
        }
        requestAnimationFrame(() => {
          const cells = [...grid.children].map((c) => { const b = c.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })
          const pts = cells.length ? cells : [{ x: innerWidth / 2, y: innerHeight / 2 }]
          if (pts.length === 1) pts.push(pts[0])
          const start = performance.now(), total = dur * 1000, seg = total / pts.length
          const tick = (now) => {
            const t = now - start
            if (t >= total) { loupe.remove(); ov.remove(); resolve(); return }
            const fi = Math.min(pts.length - 1, Math.floor(t / seg))
            const ni = Math.min(pts.length - 1, fi + 1)
            const f = (t - fi * seg) / seg
            const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2
            update(pts[fi].x + (pts[ni].x - pts[fi].x) * e, pts[fi].y + (pts[ni].y - pts[fi].y) * e)
            requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        })
      }), { cards, dur }).catch((e) => console.log('[super_scaler] loupe failed:', e?.message))
    }

    await page.screenshot({ path: path.join(rp.outputs, 'super-scaler-scale-final.png') }).catch(() => {})
    console.log(`[super_scaler] downloads: ${downloads.length}`)
  } finally {
    await ctx.close().catch(() => {})
  }

  await finalizeVideo({
    dir,
    outName: 'super-scaler-scale-demo',
    titleUrl: 'textile-designer.ai/ai?tab=image_enhance',
    displayName: 'Super Scaler - 2x vs 4x vs 8x',
    caption: 'Same tiny scan - three resolution targets one click each',
    viewport, t0, spans,
  })
}

main().catch((e) => { console.error(e); process.exit(1) })
