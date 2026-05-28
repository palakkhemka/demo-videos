// Design Extension demo - 8 runs in one video showing both axes of control:
//   4 directions (top / right / bottom / left emphasis)
//   x 2 creativity levels (1.0 then 0.6)
// Each run uses an asymmetric gap config so the directional behavior is
// obvious on camera (primary side gap=6, perpendicular bias gap=2). After
// all 8 runs we render two "compass" overlays - a 3x3 grid with the
// original in the centre and each direction's extension placed in its
// actual direction (top output above, left output to the left, ...) -
// one compass per creativity. Tool-specific layout: the compass IS the
// thing the tool does, so it's the natural way to compare.
//
// Needs the design_extension worker on the target site.
//
// Usage: node record-design-extension.mjs
//   INPUT=assets/my-tile.png LAYERS=- BASE_URL=https://textile-designer.ai
//
// The runner UI passes INPUT and DEMO_RUN_ID per-image.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDemoSession, finalizeVideo, sleep } from '../lib/demo-kit.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const INPUT = path.resolve(__dirname, '..', process.env.INPUT || 'assets/input.jpg')

// Each config emphasizes ONE direction with a big gap (6) and adds a small
// secondary gap (2) on the perpendicular axis to keep the result obviously
// asymmetric. The interlock requires >=1 gap >=1, which all rows satisfy.
const CONFIGS = [
  { dir: 'top',    creativity: 1.0, top: 6, left: 0, bottom: 0, right: 2 },
  { dir: 'right',  creativity: 1.0, top: 2, left: 0, bottom: 0, right: 6 },
  { dir: 'bottom', creativity: 1.0, top: 0, left: 2, bottom: 6, right: 0 },
  { dir: 'left',   creativity: 1.0, top: 0, left: 6, bottom: 2, right: 0 },
  { dir: 'top',    creativity: 0.6, top: 6, left: 0, bottom: 0, right: 2 },
  { dir: 'right',  creativity: 0.6, top: 2, left: 0, bottom: 0, right: 6 },
  { dir: 'bottom', creativity: 0.6, top: 0, left: 2, bottom: 6, right: 0 },
  { dir: 'left',   creativity: 0.6, top: 0, left: 6, bottom: 2, right: 0 },
]

async function main() {
  if (!fs.existsSync(INPUT)) { console.error(`[design_extension] INPUT not found: ${INPUT}`); process.exit(1) }
  console.log(`[design_extension] INPUT=${INPUT}`)
  const s = await createDemoSession({ dirName: 'design-extension' })
  const { ctx, page, glide, fakeUpload, zoomEl, downloads, dir, t0, viewport, rp } = s
  const spans = []
  const captured = new Array(CONFIGS.length).fill(null)

  // Set a single ParamInput slider+number value by its visible label. Uses the
  // React-friendly native setter so NextUI's onValueChange fires and the slider
  // + warning text update with it. For the percent-display Creativity input we
  // pass the display value (e.g. 100 for 1.0); for the gap inputs we pass the
  // raw 0..10 number.
  const setParam = async (label, displayValue) => {
    const ok = await page.evaluate(({ label, displayValue }) => {
      const spans = Array.from(document.querySelectorAll('span'))
        .filter((s) => (s.textContent || '').trim() === label)
      for (const sp of spans) {
        let n = sp
        for (let i = 0; i < 8 && n; i++) {
          n = n.parentElement
          if (!n) break
          const inp = n.querySelector('input[type="number"]')
          if (inp) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
            setter.call(inp, String(displayValue))
            inp.dispatchEvent(new Event('input', { bubbles: true }))
            inp.dispatchEvent(new Event('change', { bubbles: true }))
            return true
          }
        }
      }
      return false
    }, { label, displayValue: String(displayValue) })
    if (!ok) console.log(`[design_extension] could not set ${label} = ${displayValue}`)
    return ok
  }

  try {
    page.on('filechooser', (c) => c.setFiles([]).catch(() => {}))
    await page.goto(`${BASE_URL}/ai?tab=home`, { waitUntil: 'domcontentloaded' })
    const nav = page.locator('button[class*="tool-row"]').filter({ hasText: /design extension/i }).first()
    console.log('[design_extension] waiting for home (log in if prompted)...')
    await nav.waitFor({ state: 'visible', timeout: 300000 })
    await sleep(1000)
    await glide(nav, { force: true }).catch(() => {})

    const uploadBtn = page.getByRole('button', { name: /upload image/i })
    try { await uploadBtn.waitFor({ state: 'visible', timeout: 18000 }) }
    catch {
      await page.goto(`${BASE_URL}/ai?tab=design_extension`, { waitUntil: 'domcontentloaded' })
      await uploadBtn.waitFor({ state: 'visible', timeout: 30000 })
    }
    await sleep(800)
    await glide(uploadBtn)
    await sleep(300)
    await fakeUpload(INPUT)
    await sleep(2400)
    await zoomEl(['canvas'])

    // Run each configuration. The submit button label for this tool is
    // "Extend Design"; wait until it un-disables before clicking (slider
    // re-validation can briefly disable it).
    const submitOne = async (cfg, idx) => {
      console.log(`[design_extension] run ${idx + 1}/${CONFIGS.length}: ${cfg.dir} @ creativity ${cfg.creativity}  gaps t=${cfg.top} r=${cfg.right} b=${cfg.bottom} l=${cfg.left}`)
      await setParam('Top Gap', cfg.top)
      await setParam('Left Gap', cfg.left)
      await setParam('Bottom Gap', cfg.bottom)
      await setParam('Right Gap', cfg.right)
      // Creativity input renders as percent (display = raw * 100); slider+input
      // both show the percent. So pass 100 for 1.0, 60 for 0.6, etc.
      await setParam('Creativity:', Math.round(cfg.creativity * 100))
      await sleep(600)

      const submit = page.getByRole('button', { name: /^extend design$/i })
      await page.waitForFunction(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /^extend design$/i.test((x.textContent || '').trim()))
        return b && !b.disabled
      }, { timeout: 60000 }).catch(() => {})

      const tSubmit = Date.now()
      await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/sqs/send-task-message'), { timeout: 30000 }).catch(() => null),
        glide(submit),
      ])

      const downloadBtn = page.getByRole('button', { name: /download/i })
      try { await downloadBtn.first().waitFor({ state: 'visible', timeout: 600000 }) } catch {
        console.log(`[design_extension] run ${idx + 1} download button never appeared`)
      }
      spans.push({ start: (tSubmit - t0) / 1000 + 1.0, end: (Date.now() - t0) / 1000 - 0.5 })
      await sleep(1200)

      // Capture by clicking Download. createDemoSession's 'download' handler
      // saves to outputs/ and pushes to `downloads`. Wait for the new entry.
      const before = downloads.length
      await glide(downloadBtn.first()).catch(() => {})
      const deadline = Date.now() + 30000
      while (downloads.length === before && Date.now() < deadline) await sleep(200)
      const file = downloads[downloads.length - 1] || null
      console.log(`[design_extension] captured: ${file ? path.basename(file) : '(none)'}`)
      return file
    }

    for (let i = 0; i < CONFIGS.length; i++) {
      captured[i] = await submitOne(CONFIGS[i], i)
    }

    // Compass overlay: 3x3 grid with input in the centre and each direction's
    // output placed where that direction extends. Two passes - one per
    // creativity - each held ~5s on camera.
    const toData = (f) => (f && fs.existsSync(f))
      ? 'data:image/png;base64,' + fs.readFileSync(f).toString('base64')
      : ''
    const inputData = toData(INPUT)
    for (const cVal of [1.0, 0.6]) {
      const byDir = {}
      CONFIGS.forEach((cfg, i) => {
        if (cfg.creativity === cVal && captured[i]) byDir[cfg.dir] = toData(captured[i])
      })
      const haveAny = Object.values(byDir).some(Boolean)
      if (!haveAny) {
        console.log(`[design_extension] no captures for creativity ${cVal} - skipping compass`)
        continue
      }
      await renderCompass(page, {
        inputData,
        byDir,
        creativity: cVal,
        dur: 5000,
      }).catch((e) => console.log('[design_extension] compass render failed:', e?.message))
    }

    await page.screenshot({ path: path.join(rp.outputs, 'design-extension-final.png') }).catch(() => {})
    console.log(`[design_extension] downloads: ${downloads.length}`)
  } finally {
    await ctx.close().catch(() => {})
  }

  await finalizeVideo({
    dir,
    outName: 'design-extension-demo',
    titleUrl: 'textile-designer.ai/ai?tab=design_extension',
    displayName: 'Design Extension',
    caption: 'Extend a tile in any direction - AI fills the gap',
    viewport, t0, spans,
  })
}

async function renderCompass(page, { inputData, byDir, creativity, dur }) {
  return page.evaluate(({ inputData, byDir, creativity, dur }) => new Promise((resolve) => {
    const ov = document.createElement('div')
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483500;background:rgba(13,27,42,.97);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;font-family:Segoe UI,system-ui,sans-serif;color:#e8eef4'
    const title = document.createElement('div')
    title.style.cssText = 'font-size:26px;font-weight:700'
    title.textContent = `Directional extension - creativity ${creativity.toFixed(2)}`
    const subtitle = document.createElement('div')
    subtitle.style.cssText = 'font-size:14px;opacity:.75;margin-top:-12px'
    subtitle.textContent = 'Same input, gap=6 on the active side, gap=2 on the perpendicular bias'
    const grid = document.createElement('div')
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,260px);grid-template-rows:repeat(3,260px);gap:14px'

    const makeCell = (src, label, accent) => {
      const cell = document.createElement('div')
      if (!src) {
        cell.style.cssText = 'width:260px;height:260px;background:transparent'
        return cell
      }
      cell.style.cssText = 'position:relative;width:260px;height:260px;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.55)'
      if (accent) cell.style.outline = `2px solid ${accent}`
      const im = document.createElement('img')
      im.src = src
      im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block'
      cell.appendChild(im)
      const lab = document.createElement('div')
      lab.textContent = label
      lab.style.cssText = 'position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);font-size:13px;font-weight:600;padding:5px 7px;text-align:center'
      cell.appendChild(lab)
      return cell
    }

    // 3x3 grid filled row-by-row. Corners are blank; cardinals get the
    // matching directional output; centre holds the original.
    const ACCENT = '#5bd6a0'
    const cells = [
      makeCell(null),
      makeCell(byDir.top,    'Top extended',    ACCENT),
      makeCell(null),
      makeCell(byDir.left,   'Left extended',   ACCENT),
      makeCell(inputData,    'Original input'),
      makeCell(byDir.right,  'Right extended',  ACCENT),
      makeCell(null),
      makeCell(byDir.bottom, 'Bottom extended', ACCENT),
      makeCell(null),
    ]
    for (const c of cells) grid.appendChild(c)

    ov.appendChild(title)
    ov.appendChild(subtitle)
    ov.appendChild(grid)
    document.body.appendChild(ov)
    setTimeout(() => { ov.remove(); resolve() }, dur)
  }), { inputData, byDir, creativity, dur })
}

main().catch((e) => { console.error(e); process.exit(1) })
