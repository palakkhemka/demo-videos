// Repeat Set demo - two clips stitched into one video:
//   CLIP 1 (logged in): Repeat Set tab -> upload -> Full/Half Brick/Half Drop,
//           capture each seamless output.
//   CLIP 2 (logged out): /tools/repeat_checker (public, no sidebar/redirect) ->
//           tile the RAW input (visible seams) then each output (seamless) = proof.
//   Stitch: intro -> clip1 -> clip2 -> outro.
//
// Needs the repeat_set worker (machine6) on DEV. Usage: node record-repeat-set.mjs

import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createDemoSession, makeSocialCuts, sleep, stamp, runPaths } from '../lib/demo-kit.mjs'
import { FONTS } from '../config.mjs'
import { renderCard } from '../lib/cards.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const HEADLESS = process.env.HEADLESS === '1'
const INPUT = path.resolve(__dirname, '..', process.env.INPUT || 'assets/input.jpg')
const OUT = process.env.OUT || path.join(__dirname, 'output')
const FFMPEG = path.join(__dirname, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
const VIEWPORT = { width: 1920, height: 1080 }
const TYPES = [
  { label: 'Full Repeat', re: /full repeat/i, pt: 'full' },
  { label: 'Half Brick', re: /half brick/i, pt: 'half-brick' },
  { label: 'Half Drop', re: /half drop/i, pt: 'half-drop' },
]

const CURSOR_AND_ZOOM = () => {
  if (window.__cursor) return
  window.__cursor = true
  const root = document.documentElement
  const applyZoom = () => { if (document.body) document.body.style.zoom = '0.8' }
  document.addEventListener('DOMContentLoaded', applyZoom); applyZoom()
  const dot = document.createElement('div')
  dot.style.cssText = 'position:fixed;z-index:2147483647;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;background:rgba(0,0,0,.30);border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.5);pointer-events:none;left:-50px;top:-50px'
  const mount = () => { if (!dot.isConnected) root.appendChild(dot) }
  mount()
  addEventListener('mousemove', (e) => { mount(); dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px' }, true)
  addEventListener('mousedown', (e) => {
    const r = document.createElement('div')
    r.style.cssText = 'position:fixed;z-index:2147483646;left:' + e.clientX + 'px;top:' + e.clientY + 'px;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:2px solid #fff;pointer-events:none'
    root.appendChild(r); r.animate([{ transform: 'scale(1)', opacity: 0.9 }, { transform: 'scale(4)', opacity: 0 }], { duration: 450 }); setTimeout(() => r.remove(), 470)
  }, true)
}

const newestWebm = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.webm'))
  .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.f

async function main() {
  // One run folder shared by both clips: videos/ holds the clips + final mp4,
  // outputs/ the downloaded repeat outputs, input/ the source image.
  const runId = process.env.DEMO_RUN_ID || stamp()
  const rp = runPaths('repeat-set', runId)
  const dir = rp.videos
  const clip1 = path.join(dir, 'clip1.webm')
  const clip2 = path.join(dir, 'clip2.webm')
  const spans = []
  let downloads = []

  // ---------- CLIP 1: Repeat Set (logged in) ----------
  {
    const s = await createDemoSession({ dirName: 'repeat-set', runId })
    const { ctx, page, glide, fakeUpload, t0 } = s
    try {
      await page.goto(`${BASE_URL}/ai?tab=home`, { waitUntil: 'domcontentloaded' })
      const nav = page.locator('button[class*="tool-row"]').filter({ hasText: /repeat set/i }).first()
      console.log('[repeat_set] waiting for home (log in if prompted)...')
      await nav.waitFor({ state: 'visible', timeout: 300000 })
      await sleep(1000)
      await glide(nav, { force: true }).catch(() => {})
      const uploadBtn = page.getByRole('button', { name: /upload image/i })
      try { await uploadBtn.waitFor({ state: 'visible', timeout: 18000 }) }
      catch { await page.goto(`${BASE_URL}/ai?tab=repeat_set`, { waitUntil: 'domcontentloaded' }); await uploadBtn.waitFor({ state: 'visible', timeout: 30000 }) }
      await sleep(800)
      page.on('filechooser', (c) => c.setFiles([]).catch(() => {})) // dismiss so fake picker shows first
      await glide(uploadBtn)
      await sleep(300)
      await fakeUpload(INPUT)
      await sleep(2000)

      const submitBtn = page.getByRole('button', { name: /^make repeat set$/i })
      const downloadBtn = page.getByRole('button', { name: /download/i })
      // Captures land in s.downloads (the live session array, index-prefixed);
      // strip the prefix to compare the real output name.
      const coreOf = (p) => path.basename(p).replace(/^\d+-/, '')
      // Wait for the "Make Repeat Set" button to reach an enabled/disabled state.
      const waitBtn = (enabled, ms) => page.waitForFunction((want) => {
        const b = [...document.querySelectorAll('button')].find((x) => /^make repeat set$/i.test((x.textContent || '').trim()))
        return b ? (want ? !b.disabled : b.disabled) : false
      }, enabled, { timeout: ms }).catch(() => {})

      for (const ty of TYPES) {
        console.log(`[repeat_set] === ${ty.label} ===`)
        const preset = page.getByText(ty.re).first()
        if (await preset.count().catch(() => 0)) { await glide(preset, { force: true }).catch(() => {}); await sleep(800) }
        await waitBtn(true, 90000) // clickable
        await sleep(400)
        const seenCores = new Set(s.downloads.map(coreOf))
        const tSubmit = Date.now()
        console.log(`[repeat_set] submitting ${ty.label} (seen so far: ${s.downloads.length})`)
        await Promise.all([
          page.waitForResponse((r) => r.url().includes('/api/sqs/send-task-message'), { timeout: 30000 }).catch(() => null),
          glide(submitBtn),
        ])
        // Wait for THIS result: the button disables while the worker runs, then
        // re-enables when the new output is ready. (Best-effort; short timeout on
        // the "started" wait in case the tool is fast.)
        await waitBtn(false, 8000)
        console.log(`[repeat_set] ${ty.label} processing...`)
        await waitBtn(true, 600000)
        try { await downloadBtn.first().waitFor({ state: 'visible', timeout: 600000 }) } catch {}
        spans.push({ start: (tSubmit - t0) / 1000 + 1.0, end: (Date.now() - t0) / 1000 - 0.5 })
        await sleep(800)

        // Download once and confirm a NOT-yet-seen output landed. The Download
        // button persists from the previous type, so an early click can grab the
        // stale prior output - if so, delete that duplicate and retry a few times
        // (NOT a tight loop, so it never spams the downloads folder).
        let captured = null
        for (let tries = 0; tries < 6 && !captured; tries++) {
          await Promise.all([
            page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
            glide(downloadBtn.first()).catch(() => {}),
          ])
          await sleep(1500) // let the save handler write the file
          captured = s.downloads.find((p) => !seenCores.has(coreOf(p))) || null
          if (!captured) {
            const last = s.downloads[s.downloads.length - 1]
            if (last && seenCores.has(coreOf(last))) { try { fs.rmSync(last) } catch {} ; s.downloads.pop() }
            console.log(`[repeat_set] ${ty.label}: result not ready, retry ${tries + 1}/6`)
            await sleep(5000)
          }
        }
        if (captured) console.log(`[repeat_set] captured ${ty.label} -> ${path.basename(captured)}`)
        else console.log(`[repeat_set] WARN: no fresh download for ${ty.label}`)
        await sleep(1000)
      }
      // Only THIS run's captured outputs (in submit order: Full, Half Brick, Half Drop).
      downloads = s.downloads.slice()
    } finally {
      await ctx.close().catch(() => {})
    }
    const w = newestWebm(dir)
    if (w) fs.renameSync(path.join(dir, w), clip1)
  }

  // ---------- CLIP 2: Seamless Checker (logged out, public /tools page) ----------
  {
    const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, args: ['--start-maximized'] })
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, recordVideo: { dir, size: VIEWPORT } })
    await ctx.addInitScript(CURSOR_AND_ZOOM)
    const page = await ctx.newPage()
    const glide = async (loc) => { const b = await loc.boundingBox().catch(() => null); if (b) { await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 22 }); await sleep(200) } await loc.click({ timeout: 8000 }).catch(() => {}) }
    const banner = async (text, color) => page.evaluate(({ text, color }) => {
      document.getElementById('b')?.remove(); const b = document.createElement('div'); b.id = 'b'
      b.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:2147483500;background:' + color + ';color:#fff;font:600 22px Segoe UI,system-ui,sans-serif;padding:12px 26px;border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.4)'
      b.textContent = text; document.documentElement.appendChild(b)
    }, { text, color })
    // Downloads-folder picker showing the output filename (e.g. half_drop_output.png);
    // image loads only after "Open".
    const pickFromDownloads = async (file, fileName) => {
      const ext = path.extname(file).toLowerCase()
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
      const dataUrl = `data:${mime};base64,` + fs.readFileSync(file).toString('base64')
      await page.evaluate(({ src, name }) => {
        const ov = document.createElement('div'); ov.id = 'tr-picker'
        ov.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-family:Segoe UI,system-ui,sans-serif'
        const win = document.createElement('div'); win.style.cssText = 'width:680px;height:460px;background:#f3f3f4;border-radius:12px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.55);display:flex;flex-direction:column'
        win.innerHTML =
          '<div style="height:46px;background:#e6e6e8;display:flex;align-items:center;padding:0 14px;gap:8px"><span style="width:12px;height:12px;border-radius:50%;background:#ff5f56"></span><span style="width:12px;height:12px;border-radius:50%;background:#ffbd2e"></span><span style="width:12px;height:12px;border-radius:50%;background:#27c93f"></span><span style="margin-left:14px;font-weight:600;color:#444">📁 Downloads</span></div>' +
          '<div style="flex:1;display:flex"><div style="width:170px;background:#ececee;border-right:1px solid #dcdcde;padding:16px 12px;color:#666;font-size:13px"><div style="font-weight:600;margin-bottom:10px;color:#999">Favorites</div><div style="margin:7px 0">📁 Designs</div><div style="margin:7px 0;color:#2f6fed">📁 Downloads</div></div>' +
          '<div style="flex:1;padding:20px"><div id="tr-thumb" style="width:160px;cursor:pointer;border:2px solid transparent;border-radius:9px;padding:9px;text-align:center"><img src="' + src + '" style="width:138px;height:138px;object-fit:cover;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.25)"/><div style="margin-top:8px;font-size:12px;color:#444">' + name + '</div></div></div></div>' +
          '<div style="height:58px;background:#ededef;border-top:1px solid #dcdcde;display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:0 18px"><span id="tr-fname" style="margin-right:auto;color:#777;font-size:13px">' + name + '</span><button id="tr-open" style="padding:8px 20px;border-radius:7px;border:none;background:#2f6fed;color:#fff;font-size:13px;font-weight:600">Open</button></div>'
        ov.appendChild(win); document.body.appendChild(ov)
        win.querySelector('#tr-thumb').addEventListener('click', () => { const t = win.querySelector('#tr-thumb'); t.style.borderColor = '#2f6fed'; t.style.background = '#dde9ff' })
      }, { src: dataUrl, name: fileName })
      await sleep(700)
      await glide(page.locator('#tr-thumb'))
      await sleep(500)
      await glide(page.locator('#tr-open'))
      await page.evaluate(() => document.getElementById('tr-picker')?.remove())
      await page.locator('#fileInput').setInputFiles(file).catch(() => {})
    }
    const tile = async (file, label, color, fileName, { cycle = false, patternType = null } = {}) => {
      await page.goto(`${BASE_URL}/tools/repeat_checker`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('#fileInput', { state: 'attached', timeout: 30000 })
      await page.getByRole('button', { name: /^Accept$/ }).click({ timeout: 3000 }).catch(() => {})
      await banner(label, color)
      await pickFromDownloads(file, fileName)
      await sleep(1500)
      // Keep the grid at its 2x2 default (the page loads with gridSize=2; range
      // is 1-4). Previously the slider was dragged to ~66% which snapped it to
      // 3x3 - we now leave the initial 2x2 view as requested.
      // For the raw input: show it tiled in every repeat type (seams in each).
      if (cycle) {
        for (const [val, name] of [['full', 'Full'], ['half-brick', 'Half Brick'], ['half-drop', 'Half Drop']]) {
          await banner(`Original in ${name} repeat - seams`, color)
          await glide(page.locator(`input[name="patternType"][value="${val}"]`)).catch(() => {})
          await sleep(1400)
        }
      } else if (patternType) {
        // Each repeat-set output was generated for a specific repeat type - set
        // the checker to the SAME pattern type so it previews seamlessly (Half
        // Brick / Half Drop were previously left on the default Full).
        await glide(page.locator(`input[name="patternType"][value="${patternType}"]`)).catch(() => {})
        await sleep(1300)
      }
      await glide(page.getByRole('button', { name: /enlarge preview/i }))
      await sleep(800)
      await glide(page.getByRole('button', { name: /zoom in/i }))
      await sleep(700)
      const cx = VIEWPORT.width / 2, cy = VIEWPORT.height / 2
      await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx - 180, cy - 130, { steps: 26 }); await sleep(900); await page.mouse.up()
      await glide(page.getByRole('button', { name: /close fullscreen/i }))
      await sleep(400)
    }
    try {
      await tile(INPUT, 'Original - seams in every repeat', '#b4453c', 'design.png', { cycle: true })
      for (let i = 0; i < downloads.slice(0, 3).length; i++) {
        const fn = (TYPES[i]?.label || 'repeat').toLowerCase().replace(/ /g, '_') + '_output.png'
        await tile(downloads[i], `${TYPES[i]?.label || 'Repeat Set'} - seamless`, '#2f7d54', fn, { patternType: TYPES[i]?.pt })
      }
    } finally {
      await ctx.close().catch(() => {}); await browser.close().catch(() => {})
    }
    const w = newestWebm(dir)
    if (w && w !== 'clip1.webm') fs.renameSync(path.join(dir, w), clip2)
  }

  stitch(dir, clip1, clip2, spans)
}

// ---------- stitch: frame each clip + intro/outro + concat ----------
function stitch(dir, clip1, clip2, spans) {
  const TB = 44, PAD = 60, W = VIEWPORT.width, H = VIEWPORT.height
  const OW = W + 2 * PAD, OH = H + TB + 2 * PAD
  const { ui, uib, sym } = FONTS
  const run = (args) => spawnSync(FFMPEG, ['-y', ...args], { encoding: 'utf8' })
  const dy = Math.round((TB - 20) / 2)
  const logo = path.join(__dirname, 'assets', 'logo-main.png')
  const titleUrl = 'textile-designer.ai/ai?tab=repeat_set'
  const MAX = 2.5

  const frame = (webm, out, clipSpans, caption) => {
    if (!fs.existsSync(webm)) return false
    let speedPrefix = '', base = '[0:v]'
    const list = (clipSpans || []).map((s) => ({ start: Math.max(0, s.start), end: Math.max(s.start + 0.5, s.end) }))
      .filter((s) => s.end - s.start > MAX + 1.5).sort((a, b) => a.start - b.start)
    if (list.length) {
      const segs = []; let prev = 0
      for (const sp of list) { if (sp.start > prev + 0.05) segs.push([prev, sp.start, false]); segs.push([sp.start, sp.end, true]); prev = sp.end }
      segs.push([prev, null, false])
      const n = segs.length
      speedPrefix = `[0:v]split=${n}` + segs.map((_, i) => `[s${i}]`).join('') + ';'
      segs.forEach(([a, b, fast], i) => { const trim = b == null ? `trim=start=${a.toFixed(2)}` : `trim=${a.toFixed(2)}:${b.toFixed(2)}`; speedPrefix += `[s${i}]${trim},${fast ? `setpts=(PTS-STARTPTS)/${((b - a) / MAX).toFixed(3)}` : 'setpts=PTS-STARTPTS'}[p${i}];` })
      speedPrefix += segs.map((_, i) => `[p${i}]`).join('') + `concat=n=${n}:v=1[sped];`; base = '[sped]'
    }
    const cap = caption ? `drawtext=fontfile=${uib}:text='${caption}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=h*0.82:box=1:boxcolor=0x14294a@0.72:boxborderw=26:enable='between(t\\,0.4\\,5.6)':alpha='min((t-0.4)/0.4\\,(5.6-t)/0.4)',` : ''
    const filter = [
      `${speedPrefix}${base}pad=iw:ih+${TB}:0:${TB}:color=0xf2f2f3[bar]`,
      `[bar]drawtext=fontfile=${sym}:text=●:fontcolor=0xff5f56:fontsize=20:x=24:y=${dy},drawtext=fontfile=${sym}:text=●:fontcolor=0xffbd2e:fontsize=20:x=50:y=${dy},drawtext=fontfile=${sym}:text=●:fontcolor=0x27c93f:fontsize=20:x=76:y=${dy},drawtext=fontfile=${ui}:text='${titleUrl}':fontcolor=0x555555:fontsize=18:x=(w-text_w)/2:y=${dy}[chrome]`,
      `[1:v][chrome]overlay=(W-w)/2:(H-h)/2:shortest=1[fr]`,
      `[fr]${cap}format=yuv420p[out]`,
    ].join(';')
    const r = run(['-i', webm, '-f', 'lavfi', '-i', `gradients=s=${OW}x${OH}:c0=0x1f3a5f:c1=0x3f7d54:d=600`, '-filter_complex', filter, '-map', '[out]', '-r', '25', '-c:v', 'libx264', out])
    return r.status === 0
  }
  const cardOpts = { layout: 'classic', bg: 'gradient', showLogo: true, W: OW, H: OH, logo }
  const mkCard = (out, dur, title, subtitle) => renderCard({ out, dur, title, subtitle, ...cardOpts }).status === 0

  const f1 = path.join(dir, 'f1.mp4'), f2 = path.join(dir, 'f2.mp4'), intro = path.join(dir, 'intro.mp4'), outro = path.join(dir, 'outro.mp4'), mp4 = path.join(dir, `repeat-set-demo-${stamp()}.mp4`)
  const parts = []
  if (mkCard(intro, 3, 'Textile Designer AI', 'Repeat Set')) parts.push(intro)
  if (frame(clip1, f1, spans, 'Hours making seamless repeats - tiled in seconds')) parts.push(f1)
  if (frame(clip2, f2, [], 'Proof - it tiles seamlessly')) parts.push(f2)
  if (mkCard(outro, 3.6, 'Visit textile-designer.ai', 'AI tools for textile & fashion design')) parts.push(outro)

  const inputs = parts.flatMap((p) => ['-i', p])
  const cc = parts.map((_, i) => `[${i}:v]`).join('') + `concat=n=${parts.length}:v=1:a=0,format=yuv420p[out]`
  const r = run([...inputs, '-filter_complex', cc, '-map', '[out]', '-r', '25', '-c:v', 'libx264', '-movflags', '+faststart', mp4])
  if (r.status === 0) { for (const f of [f1, f2, intro, outro, clip1, clip2]) fs.rmSync(f, { force: true }); console.log(`\nVIDEO: ${mp4}`); makeSocialCuts(mp4) }
  else console.log('stitch failed:\n', (r.stderr || '').split('\n').slice(-8).join('\n'))
}

main().catch((e) => { console.error(e); process.exit(1) })
