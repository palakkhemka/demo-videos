// Upscale ("Ready to Print") demo - single video:
//   upload -> zoom input -> ADVANCED mode -> four runs (2x@20%, 2x@60%, 4x@20%,
//   4x@60% creativity), each: set scale via the Select dropdown + set creativity,
//   submit, before/after slider, zoom -> final side-by-side comparison of all four.
// Needs the upscale worker (machine1 upscale_md / machine2 upscale_sd) live.
//
// Usage: node record-upscale.mjs   (leave the window alone)

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createDemoSession, finalizeVideo, sleep } from '../lib/demo-kit.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const INPUT = path.resolve(__dirname, '..', process.env.INPUT || 'assets/input.jpg')
// Four runs: each scale at low and high creativity, so the demo shows both the
// scale-factor and creativity controls. Creativity is a percent (range 10-70).
const RUNS = [
  { scale: 2, creativity: 20 },
  { scale: 2, creativity: 60 },
  { scale: 4, creativity: 20 },
  { scale: 4, creativity: 60 },
]

async function main() {
  const s = await createDemoSession({ dirName: 'upscale' })
  const { ctx, page, glide, fakeUpload, zoomEl, downloads, dir, t0, viewport, rp } = s
  const spans = []
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

    // Advanced mode exposes the scale-factor dropdown + creativity slider.
    await glide(page.getByRole('button', { name: /^advanced$/i })).catch(() => {})
    await sleep(700)

    const submitBtn = page.getByRole('button', { name: /^submit$/i })
    const downloadBtn = page.getByRole('button', { name: /download/i })
    const coreOf = (p) => path.basename(p).replace(/^\d+-/, '')
    const outputs = [] // the captured output file for each scale, in order

    // Wait for the Submit button to reach an enabled/disabled state.
    const waitSubmit = (enabled, ms) => page.waitForFunction((want) => {
      const b = [...document.querySelectorAll('button')].find((x) => /^submit$/i.test((x.textContent || '').trim()))
      return b ? (want ? !b.disabled : b.disabled) : false
    }, enabled, { timeout: ms }).catch(() => {})

    for (const { scale: sc, creativity: cr } of RUNS) {
      console.log(`[upscale] === ${sc}x @ ${cr}% creativity ===`)
      await banner(`Scale factor: ${sc}x`, '#2f6fed')
      await sleep(900)
      // Scale factor via the Advanced "Select" dropdown (fixed menu, z-index 9999,
      // of 1/2/3/4 option buttons). The old code typed into the first <input> on
      // the page - the wrong field - so the scale never actually changed.
      await glide(page.getByRole('button', { name: /^select$/i }).first()).catch(() => {})
      await sleep(500)
      await page.locator('div[style*="9999"]').getByRole('button', { name: String(sc), exact: true })
        .click({ timeout: 5000 }).catch(() => {})
      await sleep(700)

      // Creativity is the first percent number-box in the Advanced panel
      // (resemblance is the second). Type the percent and commit with Tab.
      await banner(`Creativity: ${cr}%`, '#2f7d54')
      await sleep(800)
      const crBox = page.locator('input[type="number"]').first()
      await crBox.click({ timeout: 5000 }).catch(() => {})
      await crBox.fill(String(cr)).catch(() => {})
      await crBox.press('Tab').catch(() => {})
      await sleep(600)
      const crGot = await crBox.inputValue().catch(() => '?')
      console.log(`[upscale] scale=${sc}x, creativity requested ${cr}%, field shows ${crGot}%`)

      const seenCores = new Set(downloads.map(coreOf))
      const tSubmit = Date.now()
      console.log(`[upscale] submitting ${sc}x @ ${cr}% (captured so far: ${downloads.length})`)
      await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/sqs/send-task-message'), { timeout: 30000 }).catch(() => null),
        glide(submitBtn),
      ])
      // Wait for THIS result: Submit disables while the worker runs, re-enables
      // when done. (Short timeout on the "started" wait in case it is fast.)
      await waitSubmit(false, 8000)
      console.log(`[upscale] ${sc}x @ ${cr}% processing...`)
      await waitSubmit(true, 600000)
      try { await downloadBtn.first().waitFor({ state: 'visible', timeout: 600000 }) } catch {}
      spans.push({ start: (tSubmit - t0) / 1000 + 1.0, end: (Date.now() - t0) / 1000 - 0.5 })
      await sleep(800)

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

      // Save THIS run's output: click Download once, confirm a not-yet-seen file
      // landed; if it grabbed the stale prior output, delete that dup and retry a
      // few times (bounded - never spams the downloads folder).
      let captured = null
      for (let tries = 0; tries < 6 && !captured; tries++) {
        await Promise.all([
          page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
          glide(downloadBtn.first()).catch(() => {}),
        ])
        await sleep(1500) // let the save handler write the file
        captured = downloads.find((p) => !seenCores.has(coreOf(p))) || null
        if (!captured) {
          const last = downloads[downloads.length - 1]
          if (last && seenCores.has(coreOf(last))) { try { fs.rmSync(last) } catch {} ; downloads.pop() }
          console.log(`[upscale] ${sc}x @ ${cr}%: result not ready, retry ${tries + 1}/6`)
          await sleep(5000)
        }
      }
      if (captured) { outputs.push({ file: captured, label: `${sc}× · ${cr}%` }); console.log(`[upscale] captured ${sc}x @ ${cr}% -> ${path.basename(captured)}`) }
      else console.log(`[upscale] WARN: no fresh download for ${sc}x @ ${cr}%`)
      await clearBanner()
      await sleep(1000)
    }

    // Comparison: 2x2 grid of the captured outputs with a magnifier loupe gliding
    // across, showing zoomed pixels so the scale (sharpness) and creativity (added
    // detail) differences are actually visible. Cover-math keeps the magnified
    // region registered to what each cell shows.
    const toData = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64')
    const cards = outputs.map((o) => ({ src: toData(o.file), label: o.label }))
    console.log(`[upscale] loupe comparison of ${cards.length} outputs`)
    if (cards.length) {
      const runLoupe = async (dur) => page.evaluate(({ cards, dur }) => new Promise((resolve) => {
        const ov = document.createElement('div'); ov.id = 'tr-cmp'
        ov.style.cssText = 'position:fixed;inset:0;z-index:2147483500;background:rgba(13,27,42,.97);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;font-family:Segoe UI,system-ui,sans-serif;color:#e8eef4'
        const title = document.createElement('div'); title.style.cssText = 'font-size:26px;font-weight:700'
        title.textContent = 'Ready to Print - zoom in to compare'
        const cols = cards.length <= 2 ? cards.length : 2
        const grid = document.createElement('div')
        grid.style.cssText = `position:relative;display:grid;grid-template-columns:repeat(${cols},360px);gap:14px`
        cards.forEach((c) => {
          const cell = document.createElement('div'); cell.className = 'tr-cell'
          cell.style.cssText = 'position:relative;width:360px;height:360px;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px #000'
          const im = document.createElement('img'); im.src = c.src; im.dataset.src = c.src
          im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block'
          const lab = document.createElement('div'); lab.textContent = c.label
          lab.style.cssText = 'position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.55);font-size:15px;font-weight:600;padding:5px 8px;text-align:center'
          cell.appendChild(im); cell.appendChild(lab); grid.appendChild(cell)
        })
        const LS = 210, Z = 3.2
        const loupe = document.createElement('div'); loupe.id = 'tr-loupe'
        loupe.style.cssText = `position:fixed;width:${LS}px;height:${LS}px;border-radius:50%;border:4px solid #fff;box-shadow:0 6px 24px rgba(0,0,0,.6),inset 0 0 0 2px rgba(0,0,0,.25);pointer-events:none;background-repeat:no-repeat;z-index:2147483600;opacity:0`
        ov.appendChild(title); ov.appendChild(grid); document.body.appendChild(ov); document.body.appendChild(loupe)
        const update = (px, py) => {
          loupe.style.left = (px - LS / 2) + 'px'; loupe.style.top = (py - LS / 2) + 'px'
          const el = document.elementFromPoint(px, py)
          const cell = el && el.closest ? el.closest('.tr-cell') : null
          const im = cell ? cell.querySelector('img') : null
          if (!im) { loupe.style.opacity = '0'; return }
          loupe.style.opacity = '1'
          const r = im.getBoundingClientRect()
          const nW = im.naturalWidth || r.width, nH = im.naturalHeight || r.height
          const s = Math.max(r.width / nW, r.height / nH)  // object-fit: cover
          const dispW = nW * s, dispH = nH * s
          const ix = (px - r.left) + (dispW - r.width) / 2
          const iy = (py - r.top) + (dispH - r.height) / 2
          loupe.style.backgroundImage = 'url(' + im.dataset.src + ')'
          loupe.style.backgroundSize = (dispW * Z) + 'px ' + (dispH * Z) + 'px'
          loupe.style.backgroundPosition = (-(ix * Z - LS / 2)) + 'px ' + (-(iy * Z - LS / 2)) + 'px'
        }
        requestAnimationFrame(() => {
          const cells = [...grid.children].map((c) => { const b = c.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })
          const order = cells.length === 4 ? [0, 1, 3, 2] : cells.map((_, i) => i)
          const pts = order.map((i) => cells[i])
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
      }), { cards, dur })

      const runStaticCompare = async () => page.evaluate(({ cards }) => new Promise((resolve) => {
        const ov = document.createElement('div')
        ov.id = 'tr-cmp-fallback'
        ov.style.cssText = 'position:fixed;inset:0;z-index:2147483500;background:rgba(13,27,42,.97);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;font-family:Segoe UI,system-ui,sans-serif;color:#e8eef4'
        const title = document.createElement('div')
        title.style.cssText = 'font-size:26px;font-weight:700'
        title.textContent = 'Ready to Print - result comparison'
        const cols = cards.length <= 2 ? cards.length : 2
        const grid = document.createElement('div')
        grid.style.cssText = `display:grid;grid-template-columns:repeat(${cols},360px);gap:14px`
        cards.forEach((c) => {
          const cell = document.createElement('div')
          cell.style.cssText = 'position:relative;width:360px;height:360px;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px #000'
          const im = document.createElement('img')
          im.src = c.src
          im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block'
          const lab = document.createElement('div')
          lab.textContent = c.label
          lab.style.cssText = 'position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.55);font-size:15px;font-weight:600;padding:5px 8px;text-align:center'
          cell.appendChild(im); cell.appendChild(lab); grid.appendChild(cell)
        })
        ov.appendChild(title); ov.appendChild(grid); document.body.appendChild(ov)
        setTimeout(() => { ov.remove(); resolve() }, 3500)
      }), { cards })

      const dur = Math.max(7, cards.length * 2)
      try {
        await runLoupe(dur)
      } catch (e) {
        console.log('loupe failed:', e.message)
        console.log('[upscale] retrying loupe with shorter pass...')
        try { await runLoupe(4.5) }
        catch {
          console.log('[upscale] loupe retry failed - showing static comparison fallback')
          await runStaticCompare().catch(() => {})
        }
      }
    }

    await page.screenshot({ path: path.join(rp.outputs, 'upscale-final.png') }).catch(() => {})
    console.log('[upscale] downloads:', downloads.length)
  } finally {
    await ctx.close().catch(() => {})
  }

  await finalizeVideo({
    dir,
    outName: 'upscale-demo',
    titleUrl: 'textile-designer.ai/ai?tab=upscale',
    displayName: 'Ready to Print',
    caption: 'Low-res art too small to print - print-ready in seconds',
    viewport, t0, spans,
  })
}

main().catch((e) => { console.error(e); process.exit(1) })
