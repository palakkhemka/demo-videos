// Shared recorder for the /ai image tools. Each tool has its own thin script
// that calls recordTool({...}). Handles: persistent (logged-in) Chrome, fake
// cursor overlay, clean home->tab navigation, simulated file picker, submit,
// result wait, before/after slider drag, and an ffmpeg mac-titlebar frame.
//
// Per-tool worker must be running on DEV and the org must have credits, or the
// result wait will time out (the video is still produced, minus the result).

import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { FONTS, FONT_PATHS } from '../config.mjs'
import { renderCard } from './cards.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEMO_DIR = path.resolve(__dirname, '..')

const env = (k, d) => process.env[k] ?? d
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Resolves an env-provided path against the demo root if relative. Returns ''
// when the env var is empty so callers can treat it as "not provided".
const resolveEnvPath = (key) => {
  const v = env(key, '')
  return v ? path.resolve(DEMO_DIR, v) : ''
}

// Shared options forwarded to renderCard from the tool recorders. Both
// recordTool and finalizeVideo call this so the runner's Intro/Outro tab
// selections (template + per-template fields) propagate into every tool's
// auto-wrapped intro and outro cards. New templates each read just the
// fields they care about; the rest are inert.
function buildCardOpts(W, H) {
  return {
    // template wins over legacy layout if both are set
    template:  env('CARD_TEMPLATE', '') || undefined,
    layout:    env('CARD_LAYOUT', 'classic'),
    bg:        env('CARD_BG', 'gradient'),
    bgImage:   resolveEnvPath('CARD_BG_IMAGE'),
    bgColor:   env('CARD_BG_COLOR', '14294a'),
    showLogo:  env('CARD_LOGO', '1') !== '0',
    // editorial
    kicker:    env('CARD_KICKER', ''),
    issue:     env('CARD_ISSUE', ''),
    date:      env('CARD_DATE', ''),
    // case-study (outputImage left blank for intro; outro callers set it)
    inputImage:  resolveEnvPath('CARD_INPUT_IMG'),
    outputImage: resolveEnvPath('CARD_OUTPUT_IMG'),
    action:    env('CARD_ACTION', ''),
    metric:    env('CARD_METRIC', ''),
    // reel-hook
    punchline: env('CARD_PUNCHLINE', ''),
    // trade-show
    tools:     env('CARD_TOOLS', ''),
    booth:     env('CARD_BOOTH', ''),
    // process-strip
    steps:       env('CARD_STEPS', ''),
    activeStep:  Number(env('CARD_ACTIVE_STEP', '0')),
    W, H,
  }
}
const browserMode = () => String(env('BROWSER', 'chrome')).trim().toLowerCase()
const launchBrowserOptions = () => {
  const mode = browserMode()
  // Default is the installed Google Chrome channel for stable prod sessions.
  // Set BROWSER=chromium to use Playwright's bundled Chromium instead.
  return mode === 'chromium' ? {} : { channel: 'chrome' }
}

// Per-run output tree: output/{tool}/run_{id}/{input,outputs,videos}/. Keeps every
// run self-contained - the uploaded image (input/), the result files (outputs/),
// and the videos in each aspect ratio (videos/). The runner sets DEMO_RUN_ID so a
// single run shares one folder; standalone runs fall back to a timestamp.
export function runPaths(tool, runId) {
  const OUT = env('OUT', path.join(DEMO_DIR, 'output'))
  const id = runId || env('DEMO_RUN_ID') || stamp()
  const runDir = path.join(OUT, tool, `run_${id}`)
  const p = {
    id,
    runDir,
    input: path.join(runDir, 'input'),
    outputs: path.join(runDir, 'outputs'),
    videos: path.join(runDir, 'videos'),
  }
  for (const d of [p.input, p.outputs, p.videos]) fs.mkdirSync(d, { recursive: true })
  return p
}

export async function recordTool(config) {
  const {
    tabId, // e.g. 'anti_blur'
    navLabel, // string|RegExp shown in the sidebar/home grid to click
    titleUrl = `textile-designer.ai/ai?tab=${tabId}`,
    outName = `${tabId}-demo`,
    selectModel1 = false, // bg_remove has a Model 1/2 toggle (legacy: selects Model 1)
    modelLabel = '', // explicit model toggle to click, e.g. 'Model 2'
    doSlider = true, // tools with a before/after compare slider
    beforeSubmit, // optional async ({ page, glideClick, sleep }) => {} for params
    input = path.join(DEMO_DIR, 'assets', 'input.jpg'),
    displayName = tabId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    caption = '', // problem→claim hook overlaid early (no apostrophes/colons/commas)
    zoomInput = false, // after upload, CSS-zoom into the input to show it clearly
    zoomResult = false, // after the result, CSS-zoom into it to highlight quality
    maxProcessingSec = Number(env('MAX_PROC_SEC', 2.5)), // compress the wait to ~this
    resultTimeoutMs = Number(env('RESULT_TIMEOUT_MS', 1200000)), // 20min; all tasks finish under that
  } = config

  // The runner UI passes INPUT to drive the same script over many images.
  // Both env INPUT and config.input resolve relative to the demo dir.
  const inputFile = path.resolve(DEMO_DIR, env('INPUT') || input)

  const BASE_URL = env('BASE_URL', 'http://localhost:3000')
  const HEADLESS = env('HEADLESS') === '1'
  const PROFILE = env('PROFILE', path.join(DEMO_DIR, '.profile'))
  const OUT = env('OUT', path.join(DEMO_DIR, 'output'))
  const FFMPEG = path.join(DEMO_DIR, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
  const VIEWPORT = { width: 1920, height: 1080 }

  // Per-run tree: webm/mp4/cards live in videos/, the source image in input/,
  // the final screenshot in outputs/.
  const rp = runPaths(outName.replace(/-demo$/, ''))
  const dir = rp.videos
  try { fs.copyFileSync(inputFile, path.join(rp.input, path.basename(inputFile))) } catch {}
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    ...launchBrowserOptions(),
    headless: HEADLESS,
    args: ['--start-maximized'],
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir, size: VIEWPORT },
  })

  await ctx.addInitScript(() => {
    if (window.__cursor) return
    window.__cursor = true
    const dot = document.createElement('div')
    dot.style.cssText =
      'position:fixed;z-index:2147483647;width:24px;height:24px;margin:-12px 0 0 -12px;' +
      'border-radius:50%;background:rgba(0,0,0,.30);border:2px solid #fff;' +
      'box-shadow:0 1px 5px rgba(0,0,0,.5);pointer-events:none;left:-50px;top:-50px'
    const mount = () => { if (document.body && !dot.isConnected) document.body.appendChild(dot) }
    document.addEventListener('DOMContentLoaded', mount)
    mount()
    addEventListener('mousemove', (e) => { mount(); dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px' }, true)
    addEventListener('mousedown', (e) => {
      mount()
      const r = document.createElement('div')
      r.style.cssText =
        'position:fixed;z-index:2147483646;left:' + e.clientX + 'px;top:' + e.clientY + 'px;' +
        'width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:2px solid #fff;pointer-events:none'
      document.body.appendChild(r)
      r.animate([{ transform: 'scale(1)', opacity: 0.9 }, { transform: 'scale(4)', opacity: 0 }], { duration: 450 })
      setTimeout(() => r.remove(), 470)
    }, true)
  })

  const page = ctx.pages()[0] || (await ctx.newPage())
  const t0 = Date.now() // ~video start (recordVideo began at context creation)
  let submitMs = 0, resultMs = 0 // to compress the processing wait in post

  const glideClick = async (locator, { steps = 25, force = false } = {}) => {
    const box = await locator.boundingBox().catch(() => null)
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps })
      await sleep(250)
    }
    await locator.click({ timeout: 8000, force })
  }

  // Smoothly CSS-zoom into a result/input element (prefers selectors, else the
  // biggest visible canvas), hold, then reset.
  const zoomEl = async (prefs, scale = 1.55) => {
    await page.evaluate(({ prefs, scale }) => {
      let el = null
      for (const s of prefs) { const c = document.querySelector(s); if (c && c.offsetWidth > 120) { el = c; break } }
      if (!el) {
        let area = 0
        document.querySelectorAll('canvas').forEach((c) => { const a = c.offsetWidth * c.offsetHeight; if (a > area) { area = a; el = c } })
      }
      if (!el) return
      window.__zt = el
      el.style.transition = 'transform .8s ease'
      el.style.transformOrigin = 'center center'
      el.style.transform = `scale(${scale})`
    }, { prefs, scale })
    await sleep(1800)
    await page.evaluate(() => { if (window.__zt) window.__zt.style.transform = 'scale(1)' })
    await sleep(900)
  }

  const fakeUpload = async (file) => {
    const ext = path.extname(file).toLowerCase()
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    const dataUrl = `data:${mime};base64,` + fs.readFileSync(file).toString('base64')
    await page.evaluate((src) => {
      const ov = document.createElement('div')
      ov.id = 'tr-picker'
      ov.style.cssText =
        'position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.4);display:flex;' +
        'align-items:center;justify-content:center;font-family:Segoe UI,system-ui,sans-serif'
      const win = document.createElement('div')
      win.style.cssText =
        'width:680px;height:460px;background:#f3f3f4;border-radius:12px;overflow:hidden;' +
        'box-shadow:0 24px 70px rgba(0,0,0,.55);display:flex;flex-direction:column'
      win.innerHTML =
        '<div style="height:46px;background:#e6e6e8;display:flex;align-items:center;padding:0 14px;gap:8px;border-bottom:1px solid #d5d5d7">' +
          '<span style="width:12px;height:12px;border-radius:50%;background:#ff5f56"></span>' +
          '<span style="width:12px;height:12px;border-radius:50%;background:#ffbd2e"></span>' +
          '<span style="width:12px;height:12px;border-radius:50%;background:#27c93f"></span>' +
          '<span style="margin-left:14px;font-weight:600;color:#444">Open</span></div>' +
        '<div style="flex:1;display:flex">' +
          '<div style="width:170px;background:#ececee;border-right:1px solid #dcdcde;padding:16px 12px;color:#666;font-size:13px">' +
            '<div style="font-weight:600;margin-bottom:10px;color:#999">Favorites</div>' +
            '<div style="margin:7px 0">📁 Designs</div><div style="margin:7px 0">📁 Downloads</div>' +
            '<div style="margin:7px 0">📁 Desktop</div></div>' +
          '<div style="flex:1;padding:20px;display:flex;gap:18px;align-items:flex-start">' +
            '<div id="tr-thumb" style="width:160px;cursor:pointer;border:2px solid transparent;border-radius:9px;padding:9px;text-align:center">' +
              '<img src="' + src + '" style="width:138px;height:138px;object-fit:cover;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.25)"/>' +
              '<div style="margin-top:8px;font-size:12px;color:#444">design.jpg</div></div></div></div>' +
        '<div style="height:58px;background:#ededef;border-top:1px solid #dcdcde;display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:0 18px">' +
          '<span id="tr-fname" style="margin-right:auto;color:#777;font-size:13px">No file selected</span>' +
          '<button id="tr-cancel" style="padding:8px 16px;border-radius:7px;border:1px solid #cfcfcf;background:#fff;color:#444;font-size:13px">Cancel</button>' +
          '<button id="tr-open" style="padding:8px 20px;border-radius:7px;border:none;background:#2f6fed;color:#fff;font-size:13px;font-weight:600">Open</button></div>'
      ov.appendChild(win)
      document.body.appendChild(ov)
      const thumb = win.querySelector('#tr-thumb')
      thumb.addEventListener('click', () => {
        thumb.style.borderColor = '#2f6fed'
        thumb.style.background = '#dde9ff'
        win.querySelector('#tr-fname').textContent = 'design.jpg'
      })
    }, dataUrl)
    await sleep(700)
    await glideClick(page.locator('#tr-thumb'))
    await sleep(600)
    await glideClick(page.locator('#tr-open'))
    await page.evaluate(() => document.getElementById('tr-picker')?.remove())
    await page.locator('input[type="file"]').first().setInputFiles(file).catch(() => {})
  }

  try {
    await page.goto(`${BASE_URL}/ai?tab=home`, { waitUntil: 'domcontentloaded' })
    const nav = page.locator('button[class*="tool-row"]').filter({ hasText: navLabel }).first()
    console.log(`[${tabId}] waiting for /ai home (log in if prompted)...`)
    await nav.waitFor({ state: 'visible', timeout: 300000 })
    await sleep(1200)
    await glideClick(nav, { force: true }).catch(() => {})

    const uploadBtn = page.getByRole('button', { name: /upload image/i })
    try {
      await uploadBtn.waitFor({ state: 'visible', timeout: 18000 })
    } catch {
      console.log(`[${tabId}] nav click didn't switch tabs - navigating to ?tab=${tabId}`)
      await page.goto(`${BASE_URL}/ai?tab=${tabId}`, { waitUntil: 'domcontentloaded' })
      await uploadBtn.waitFor({ state: 'visible', timeout: 30000 })
    }
    await sleep(900)

    const modelToClick = modelLabel || (selectModel1 ? 'Model 1' : '')
    if (modelToClick) {
      await glideClick(page.getByText(modelToClick, { exact: true })).catch(() => {})
      await sleep(900)
    }

    // Dismiss the real OS chooser (empty) so the FAKE picker shows first; the
    // image is set after "Open" via fakeUpload's setInputFiles (correct order).
    page.on('filechooser', (chooser) => chooser.setFiles([]).catch(() => {}))
    await glideClick(uploadBtn)
    await sleep(300)
    await fakeUpload(inputFile)
    await sleep(2400)

    if (zoomInput) await zoomEl(['canvas'])

    if (beforeSubmit) await beforeSubmit({ page, glideClick, sleep })

    // Action button label varies by tool: Submit / Make Repeat Set / Extend Design.
    const submit = page.getByRole('button', { name: /^(submit|make repeat set|extend design)$/i })
    // Wait until it's enabled (some tools crop/process the upload first).
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /^(submit|make repeat set|extend design)$/i.test((x.textContent || '').trim()))
      return b && !b.disabled
    }, { timeout: 90000 }).catch(() => {})
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/sqs/send-task-message'), { timeout: 30000 }).catch(() => null),
      glideClick(submit),
    ])
    submitMs = Date.now()
    console.log(`[${tabId}] submit:`, resp ? resp.status() : 'not observed')

    const downloadBtn = page.getByRole('button', { name: /download/i })
    let completed = false
    try {
      await downloadBtn.first().waitFor({ state: 'visible', timeout: resultTimeoutMs })
      completed = true
      resultMs = Date.now()
      console.log(`[${tabId}] result ready`)
    } catch {
      console.log(`[${tabId}] result not detected within timeout`)
    }
    await sleep(1500)

    if (completed && doSlider) {
      const slider = page.locator('div.cursor-col-resize').first()
      const box = await slider.boundingBox().catch(() => null)
      if (box) {
        const cy = box.y + box.height / 2
        const xAt = (f) => box.x + box.width * f
        await page.mouse.move(xAt(0.5), cy)
        await page.mouse.down()
        await page.mouse.move(xAt(0.15), cy, { steps: 30 })
        await sleep(700)
        await page.mouse.move(xAt(0.85), cy, { steps: 40 })
        await sleep(700)
        await page.mouse.move(xAt(0.5), cy, { steps: 30 })
        await page.mouse.up()
        await sleep(1300)
      }
    }

    if (completed && zoomResult) await zoomEl(['div.cursor-col-resize', 'main canvas', 'canvas'])

    await page.screenshot({ path: path.join(rp.outputs, `${outName}-final.png`) }).catch(() => {})
    console.log(`[${tabId}] completed:`, completed)
  } finally {
    await ctx.close().catch(() => {})
  }

  // newest webm -> framed mp4 (suffix lets batch runs over many images coexist)
  const suffix = env('DEMO_SUFFIX', '')
  const base = [outName, suffix, stamp()].filter(Boolean).join('-')
  const webms = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  if (!webms.length) return console.log('no webm produced')
  const webm = path.join(dir, webms[0].f)
  const mp4 = path.join(dir, `${base}.mp4`)
  const body = path.join(dir, `${base}-body.mp4`)
  const intro = path.join(dir, `${base}-intro.mp4`)
  const outro = path.join(dir, `${base}-outro.mp4`)
  const logo = path.join(DEMO_DIR, 'assets', 'logo-main.png')

  const TB = 44, PAD = 60, W = VIEWPORT.width, H = VIEWPORT.height
  const OW = W + 2 * PAD, OH = H + TB + 2 * PAD
  const { ui, uib, sym } = FONTS
  const run = (args) => spawnSync(FFMPEG, ['-y', ...args], { encoding: 'utf8' })

  // 1) Frame the recording in a mac titlebar + gradient.
  const dy = Math.round((TB - 20) / 2)
  // Problem→claim hook caption: lower-third pill, fades in/out over the first ~5.5s.
  const capDraw = caption
    ? `drawtext=fontfile=${uib}:text='${caption}':fontcolor=white:fontsize=48:` +
      `x=(w-text_w)/2:y=h*0.82:box=1:boxcolor=0x14294a@0.72:boxborderw=26:` +
      `enable='between(t\\,0.4\\,5.6)':alpha='min((t-0.4)/0.4\\,(5.6-t)/0.4)',`
    : ''
  // Compress the submit→result processing wait to ~maxProcessingSec (speed-ramp).
  let speedPrefix = ''
  let baseStream = '[0:v]'
  if (submitMs && resultMs) {
    const pStart = Math.max(0, (submitMs - t0) / 1000 + 1.0) // keep ~1s of "processing"
    const pEnd = Math.max(pStart + 0.5, (resultMs - t0) / 1000 - 0.5)
    const span = pEnd - pStart
    if (span > maxProcessingSec + 1.5) {
      const speed = (span / maxProcessingSec).toFixed(3)
      speedPrefix =
        `[0:v]split=3[s0][s1][s2];` +
        `[s0]trim=0:${pStart.toFixed(2)},setpts=PTS-STARTPTS[p0];` +
        `[s1]trim=${pStart.toFixed(2)}:${pEnd.toFixed(2)},setpts=(PTS-STARTPTS)/${speed}[p1];` +
        `[s2]trim=start=${pEnd.toFixed(2)},setpts=PTS-STARTPTS[p2];` +
        `[p0][p1][p2]concat=n=3:v=1[sped];`
      baseStream = '[sped]'
      console.log(`[${tabId}] compressing processing ${span.toFixed(1)}s -> ${maxProcessingSec}s (${speed}x)`)
    }
  }
  const frameFilter = [
    `${speedPrefix}${baseStream}pad=iw:ih+${TB}:0:${TB}:color=0xf2f2f3[bar]`,
    `[bar]drawtext=fontfile=${sym}:text=●:fontcolor=0xff5f56:fontsize=20:x=24:y=${dy}` +
      `,drawtext=fontfile=${sym}:text=●:fontcolor=0xffbd2e:fontsize=20:x=50:y=${dy}` +
      `,drawtext=fontfile=${sym}:text=●:fontcolor=0x27c93f:fontsize=20:x=76:y=${dy}` +
      `,drawtext=fontfile=${ui}:text='${titleUrl}':fontcolor=0x555555:fontsize=18:x=(w-text_w)/2:y=${dy}[chrome]`,
    `[1:v][chrome]overlay=(W-w)/2:(H-h)/2:shortest=1[framed]`,
    `[framed]${capDraw}format=yuv420p[out]`,
  ].join(';')
  let r = run(['-i', webm, '-f', 'lavfi', '-i', `gradients=s=${OW}x${OH}:c0=0x1f3a5f:c1=0x3f7d54:d=600`,
    '-filter_complex', frameFilter, '-map', '[out]', '-r', '25', '-c:v', 'libx264', body])
  if (r.status !== 0) return console.log('frame failed:\n', (r.stderr || '').split('\n').slice(-8).join('\n'))

  // 2) Title + end cards (shared renderer + README fonts).
  const cardOpts = buildCardOpts(OW, OH)
  console.log('[fonts]', FONT_PATHS.ui, FONT_PATHS.uib)
  renderCard({ out: intro, dur: 3,   title: env('INTRO_TITLE', 'Textile Designer AI'),         subtitle: env('INTRO_SUBTITLE', displayName), cta: env('INTRO_CTA', 'Watch what happens ↓'),                 ...cardOpts, outputImage: '' })
  renderCard({ out: outro, dur: 3.6, title: env('OUTRO_TITLE', 'Visit textile-designer.ai'),   subtitle: env('OUTRO_SUBTITLE', 'AI tools for textile & fashion design'), cta: env('OUTRO_CTA', 'Try it free → textile-designer.ai'), ...cardOpts })

  // 3) Stitch intro + body + outro.
  r = run(['-i', intro, '-i', body, '-i', outro,
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[out]',
    '-map', '[out]', '-r', '25', '-c:v', 'libx264', '-movflags', '+faststart', mp4])
  if (r.status === 0) {
    for (const f of [body, intro, outro, webm]) fs.rmSync(f, { force: true })
    console.log(`\nVIDEO: ${mp4}`)
    makeSocialCuts(mp4)
  } else {
    console.log('concat failed:\n', (r.stderr || '').split('\n').slice(-8).join('\n'), `\nbody: ${body}`)
  }
}

const KIT_VIEWPORT = { width: 1920, height: 1080 }

// Fake-cursor overlay + 80% page zoom (so the whole tool fits, Submit on-screen).
// Cursor lives on <html> (outside the zoomed <body>) so it stays aligned.
function cursorInit() {
  if (window.__cursor) return
  window.__cursor = true
  const root = document.documentElement
  const applyZoom = () => { if (document.body) document.body.style.zoom = '0.8' }
  document.addEventListener('DOMContentLoaded', applyZoom); applyZoom()
  const dot = document.createElement('div')
  dot.style.cssText =
    'position:fixed;z-index:2147483647;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;' +
    'background:rgba(0,0,0,.30);border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.5);pointer-events:none;left:-50px;top:-50px'
  const mount = () => { if (!dot.isConnected) root.appendChild(dot) }
  mount()
  addEventListener('mousemove', (e) => { mount(); dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px' }, true)
  addEventListener('mousedown', (e) => {
    const r = document.createElement('div')
    r.style.cssText = 'position:fixed;z-index:2147483646;left:' + e.clientX + 'px;top:' + e.clientY + 'px;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:2px solid #fff;pointer-events:none'
    root.appendChild(r)
    r.animate([{ transform: 'scale(1)', opacity: 0.9 }, { transform: 'scale(4)', opacity: 0 }], { duration: 450 })
    setTimeout(() => r.remove(), 470)
  }, true)
}

// Reusable session for custom multi-step scripts (repeat_set, upscale compare…).
// Returns the logged-in page plus cursor-driven helpers + auto download capture.
export async function createDemoSession({ dirName, acceptDownloads = true, runId }) {
  // Per-run tree: video(s) in videos/, downloaded results in outputs/, source in
  // input/. Pass runId to share one run_{id} folder across multiple sessions
  // (e.g. repeat-set's two clips); else falls back to DEMO_RUN_ID / a timestamp.
  const rp = runPaths(dirName, runId)
  const dir = rp.videos
  const dlDir = rp.outputs
  const srcInput = env('INPUT')
  if (srcInput) { try { fs.copyFileSync(path.resolve(DEMO_DIR, srcInput), path.join(rp.input, path.basename(srcInput))) } catch {} }
  const ctx = await chromium.launchPersistentContext(env('PROFILE', path.join(DEMO_DIR, '.profile')), {
    ...launchBrowserOptions(),
    headless: env('HEADLESS') === '1',
    args: ['--start-maximized'],
    viewport: KIT_VIEWPORT,
    deviceScaleFactor: 1,
    acceptDownloads,
    recordVideo: { dir, size: KIT_VIEWPORT },
  })
  await ctx.addInitScript(cursorInit)
  const page = ctx.pages()[0] || (await ctx.newPage())
  const t0 = Date.now()

  const glide = async (loc, { steps = 25, force = false } = {}) => {
    const b = await loc.boundingBox().catch(() => null)
    if (b) { await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps }); await sleep(250) }
    await loc.click({ timeout: 8000, force })
  }

  const fakeUpload = async (file, fileInputSelector = 'input[type="file"]') => {
    const ext = path.extname(file).toLowerCase()
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    const dataUrl = `data:${mime};base64,` + fs.readFileSync(file).toString('base64')
    await page.evaluate((src) => {
      const ov = document.createElement('div'); ov.id = 'tr-picker'
      ov.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-family:Segoe UI,system-ui,sans-serif'
      const win = document.createElement('div')
      win.style.cssText = 'width:680px;height:460px;background:#f3f3f4;border-radius:12px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.55);display:flex;flex-direction:column'
      win.innerHTML =
        '<div style="height:46px;background:#e6e6e8;display:flex;align-items:center;padding:0 14px;gap:8px;border-bottom:1px solid #d5d5d7"><span style="width:12px;height:12px;border-radius:50%;background:#ff5f56"></span><span style="width:12px;height:12px;border-radius:50%;background:#ffbd2e"></span><span style="width:12px;height:12px;border-radius:50%;background:#27c93f"></span><span style="margin-left:14px;font-weight:600;color:#444">Open</span></div>' +
        '<div style="flex:1;display:flex"><div style="width:170px;background:#ececee;border-right:1px solid #dcdcde;padding:16px 12px;color:#666;font-size:13px"><div style="font-weight:600;margin-bottom:10px;color:#999">Favorites</div><div style="margin:7px 0">📁 Designs</div><div style="margin:7px 0">📁 Downloads</div></div>' +
        '<div style="flex:1;padding:20px"><div id="tr-thumb" style="width:160px;cursor:pointer;border:2px solid transparent;border-radius:9px;padding:9px;text-align:center"><img src="' + src + '" style="width:138px;height:138px;object-fit:cover;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.25)"/><div style="margin-top:8px;font-size:12px;color:#444">design.jpg</div></div></div></div>' +
        '<div style="height:58px;background:#ededef;border-top:1px solid #dcdcde;display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:0 18px"><button id="tr-open" style="padding:8px 20px;border-radius:7px;border:none;background:#2f6fed;color:#fff;font-size:13px;font-weight:600">Open</button></div>'
      ov.appendChild(win); document.body.appendChild(ov)
      win.querySelector('#tr-thumb').addEventListener('click', () => { const t = win.querySelector('#tr-thumb'); t.style.borderColor = '#2f6fed'; t.style.background = '#dde9ff' })
    }, dataUrl)
    await sleep(700)
    await glide(page.locator('#tr-thumb'))
    await sleep(500)
    await glide(page.locator('#tr-open'))
    await page.evaluate(() => document.getElementById('tr-picker')?.remove())
    await page.locator(fileInputSelector).first().setInputFiles(file).catch(() => {})
  }

  const zoomEl = async (prefs, scale = 1.55) => {
    await page.evaluate(({ prefs, scale }) => {
      let el = null
      for (const s of prefs) { const c = document.querySelector(s); if (c && c.offsetWidth > 120) { el = c; break } }
      if (!el) { let area = 0; document.querySelectorAll('canvas').forEach((c) => { const a = c.offsetWidth * c.offsetHeight; if (a > area) { area = a; el = c } }) }
      if (!el) return
      window.__zt = el; el.style.transition = 'transform .8s ease'; el.style.transformOrigin = 'center center'; el.style.transform = `scale(${scale})`
    }, { prefs, scale })
    await sleep(1800)
    await page.evaluate(() => { if (window.__zt) window.__zt.style.transform = 'scale(1)' })
    await sleep(900)
  }

  const downloads = []
  page.on('download', async (d) => {
    // Prefix with the capture index so outputs that share a suggested filename
    // (e.g. the app names every repeat output the same) never overwrite each
    // other - otherwise 3 runs could collapse to 2 distinct files on disk.
    const name = d.suggestedFilename() || `dl.png`
    const ext = path.extname(name) || '.png'
    const fp = path.join(dlDir, `${downloads.length}-${path.basename(name, ext)}${ext}`)
    await d.saveAs(fp).catch(() => {})
    downloads.push(fp)
  })

  return { ctx, page, glide, fakeUpload, zoomEl, downloads, dir, t0, viewport: KIT_VIEWPORT, rp }
}

// Run timestamp for unique, non-overwriting output names (true history):
// e.g. 2026-05-27-18-30-00. Override with DEMO_STAMP to pin a name.
export const stamp = () => env('DEMO_STAMP') || new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')

// Standalone video finisher for custom scripts (e.g. record-repeat-set.mjs):
// newest webm in `dir` -> mac-titlebar/gradient frame + caption + processing
// speed-ramp + intro/outro cards -> `${outName}-<input>-<stamp>.mp4`.
export async function finalizeVideo({
  dir, outName, titleUrl, displayName = '', caption = '', viewport,
  t0 = 0, submitMs = 0, resultMs = 0, spans = [], maxProcessingSec = Number(env('MAX_PROC_SEC', 2.5)), label = outName,
}) {
  const FFMPEG = path.join(DEMO_DIR, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
  const suffix = env('DEMO_SUFFIX', '')
  const baseName = [outName, suffix, stamp()].filter(Boolean).join('-')
  const webms = fs.readdirSync(dir).filter((f) => f.endsWith('.webm'))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)
  if (!webms.length) return console.log('no webm produced')
  const webm = path.join(dir, webms[0].f)
  const mp4 = path.join(dir, `${baseName}.mp4`)
  const body = path.join(dir, `${baseName}-body.mp4`)
  const intro = path.join(dir, `${baseName}-intro.mp4`)
  const outro = path.join(dir, `${baseName}-outro.mp4`)
  const logo = path.join(DEMO_DIR, 'assets', 'logo-main.png')
  const TB = 44, PAD = 60, W = viewport.width, H = viewport.height
  const OW = W + 2 * PAD, OH = H + TB + 2 * PAD
  const { ui, uib, sym } = FONTS
  const run = (args) => spawnSync(FFMPEG, ['-y', ...args], { encoding: 'utf8' })
  const dy = Math.round((TB - 20) / 2)
  const capDraw = caption
    ? `drawtext=fontfile=${uib}:text='${caption}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=h*0.82:box=1:boxcolor=0x14294a@0.72:boxborderw=26:enable='between(t\\,0.4\\,5.6)':alpha='min((t-0.4)/0.4\\,(5.6-t)/0.4)',`
    : ''
  // Collect [start,end] (sec) processing spans to speed-ramp; supports many runs.
  let spanList = spans.length ? spans.slice() : (submitMs && resultMs ? [{ start: (submitMs - t0) / 1000 + 1.0, end: (resultMs - t0) / 1000 - 0.5 }] : [])
  spanList = spanList
    .map((s) => ({ start: Math.max(0, s.start), end: Math.max(s.start + 0.5, s.end) }))
    .filter((s) => s.end - s.start > maxProcessingSec + 1.5)
    .sort((a, b) => a.start - b.start)
  let speedPrefix = '', baseStream = '[0:v]'
  if (spanList.length) {
    const segs = []
    let prev = 0
    for (const sp of spanList) { if (sp.start > prev + 0.05) segs.push([prev, sp.start, false]); segs.push([sp.start, sp.end, true]); prev = sp.end }
    segs.push([prev, null, false]) // tail to end
    const n = segs.length
    speedPrefix = `[0:v]split=${n}` + segs.map((_, i) => `[s${i}]`).join('') + ';'
    segs.forEach(([a, b, fast], i) => {
      const trim = b == null ? `trim=start=${a.toFixed(2)}` : `trim=${a.toFixed(2)}:${b.toFixed(2)}`
      const pts = fast ? `setpts=(PTS-STARTPTS)/${((b - a) / maxProcessingSec).toFixed(3)}` : 'setpts=PTS-STARTPTS'
      speedPrefix += `[s${i}]${trim},${pts}[p${i}];`
    })
    speedPrefix += segs.map((_, i) => `[p${i}]`).join('') + `concat=n=${n}:v=1[sped];`
    baseStream = '[sped]'
    console.log(`[${label}] compressing ${spanList.length} processing span(s) to ~${maxProcessingSec}s each`)
  }
  const frameFilter = [
    `${speedPrefix}${baseStream}pad=iw:ih+${TB}:0:${TB}:color=0xf2f2f3[bar]`,
    `[bar]drawtext=fontfile=${sym}:text=●:fontcolor=0xff5f56:fontsize=20:x=24:y=${dy},drawtext=fontfile=${sym}:text=●:fontcolor=0xffbd2e:fontsize=20:x=50:y=${dy},drawtext=fontfile=${sym}:text=●:fontcolor=0x27c93f:fontsize=20:x=76:y=${dy},drawtext=fontfile=${ui}:text='${titleUrl}':fontcolor=0x555555:fontsize=18:x=(w-text_w)/2:y=${dy}[chrome]`,
    `[1:v][chrome]overlay=(W-w)/2:(H-h)/2:shortest=1[framed]`,
    `[framed]${capDraw}format=yuv420p[out]`,
  ].join(';')
  let r = run(['-i', webm, '-f', 'lavfi', '-i', `gradients=s=${OW}x${OH}:c0=0x1f3a5f:c1=0x3f7d54:d=600`, '-filter_complex', frameFilter, '-map', '[out]', '-r', '25', '-c:v', 'libx264', body])
  if (r.status !== 0) return console.log('frame failed:\n', (r.stderr || '').split('\n').slice(-8).join('\n'))
  const cardOpts = buildCardOpts(OW, OH)
  renderCard({ out: intro, dur: 3,   title: env('INTRO_TITLE', 'Textile Designer AI'),         subtitle: env('INTRO_SUBTITLE', displayName), cta: env('INTRO_CTA', 'Watch what happens ↓'),                 ...cardOpts, outputImage: '' })
  renderCard({ out: outro, dur: 3.6, title: env('OUTRO_TITLE', 'Visit textile-designer.ai'),   subtitle: env('OUTRO_SUBTITLE', 'AI tools for textile & fashion design'), cta: env('OUTRO_CTA', 'Try it free → textile-designer.ai'), ...cardOpts })
  r = run(['-i', intro, '-i', body, '-i', outro, '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[out]', '-map', '[out]', '-r', '25', '-c:v', 'libx264', '-movflags', '+faststart', mp4])
  if (r.status === 0) { for (const f of [body, intro, outro, webm]) fs.rmSync(f, { force: true }); console.log(`\nVIDEO: ${mp4}`); makeSocialCuts(mp4) }
  else console.log('concat failed:\n', (r.stderr || '').split('\n').slice(-8).join('\n'), `\nbody: ${body}`)
}

// Produce social aspect-ratio variants of a finished mp4: 9:16 (Reels/Shorts/
// TikTok), 1:1 (IG/LinkedIn feed), 16:9 (YouTube/LinkedIn/landing). Writes
// <base>-9x16/-1x1/-16x9.mp4.
//
// Reels-style reframe: the content is scaled to fill the frame WIDTH (so it is
// large and readable), and the gaps are filled with a zoomed, blurred copy of
// the same video instead of a flat gradient strip - so the content is actually
// visible at portrait/square instead of a tiny centered band.
export function makeSocialCuts(mp4) {
  if (!fs.existsSync(mp4)) return
  const FFMPEG = path.join(DEMO_DIR, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
  const run = (args) => spawnSync(FFMPEG, ['-y', ...args], { encoding: 'utf8' })
  const dir = path.dirname(mp4)
  const b = path.basename(mp4, '.mp4')
  const allowed = new Set(['9x16', '1x1', '16x9'])
  const wanted = String(env('SOCIAL_FORMATS', '9x16,1x1,16x9'))
    .split(',')
    .map((s) => s.trim())
    .filter((s) => allowed.has(s))
  const targets = [['9x16', 1080, 1920], ['1x1', 1080, 1080], ['16x9', 1920, 1080]].filter(([n]) => wanted.includes(n))
  const caption = String(env('SOCIAL_CAPTION', '')).replace(/'/g, '')
  const brand = String(env('SOCIAL_BRAND', '')).replace(/'/g, '')
  const safe = env('SOCIAL_SAFE_ZONE', '1') !== '0'
  const cards = env('SOCIAL_CARDS', '1') !== '0'
  const maxSecs = {
    '9x16': Number(env('SOCIAL_MAX_SEC_9x16', 30)),
    '1x1': Number(env('SOCIAL_MAX_SEC_1x1', 45)),
    '16x9': Number(env('SOCIAL_MAX_SEC_16x9', 60)),
  }
  const { ui, uib } = FONTS

  for (const [name, W, H] of targets) {
    const body = path.join(dir, `${b}-${name}-body.mp4`)
    const out = path.join(dir, `${b}-${name}.mp4`)
    const outTmp = path.join(dir, `${b}-${name}.tmp.mp4`)
    const intro = path.join(dir, `${b}-${name}-intro.mp4`)
    const outro = path.join(dir, `${b}-${name}-outro.mp4`)
    const max = Math.max(5, Number.isFinite(maxSecs[name]) ? maxSecs[name] : 30)

    // bg = same video zoomed to COVER + blur; fg = original fit.
    const parts = [
      `[0:v]split=2[bgsrc][fgsrc]`,
      `[bgsrc]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:2,eq=brightness=-0.05[bg]`,
      `[fgsrc]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[base]`,
    ]
    let chain = '[base]'
    if (safe) {
      const mx = Math.round(W * 0.08), my = Math.round(H * 0.08)
      parts.push(`${chain}drawbox=x=${mx}:y=${my}:w=${W - 2 * mx}:h=${H - 2 * my}:color=white@0.22:t=2[safe]`)
      chain = '[safe]'
    }
    if (caption) {
      parts.push(`${chain}drawtext=fontfile=${uib}:text='${caption}':fontcolor=white:fontsize=${Math.max(30, Math.round(H * 0.035))}:x=(w-text_w)/2:y=h*0.86:box=1:boxcolor=0x14294a@0.6:boxborderw=20[cap]`)
      chain = '[cap]'
    }
    if (brand) {
      parts.push(`${chain}drawtext=fontfile=${ui}:text='${brand}':fontcolor=white@0.88:fontsize=${Math.max(18, Math.round(H * 0.024))}:x=w-text_w-40:y=32[br]`)
      chain = '[br]'
    }
    parts.push(`${chain}format=yuv420p[out]`)
    const rBody = run(['-ss', '0', '-t', String(max), '-i', mp4, '-filter_complex', parts.join(';'), '-map', '[out]', '-c:v', 'libx264', '-movflags', '+faststart', body])
    if (rBody.status !== 0) {
      for (const tmp of [out, outTmp, body, intro, outro]) fs.rmSync(tmp, { force: true })
      console.log(`  variant ${name} failed`)
      continue
    }
    if (!cards) {
      fs.rmSync(out, { force: true })
      fs.renameSync(body, out)
      console.log(`  variant: ${path.basename(out)}`)
      continue
    }

    const title = name === '9x16' ? 'Shorts/Reels' : name === '1x1' ? 'Square Feed' : 'Widescreen'
    const cardFilter = `color=c=0x14294a:s=${W}x${H}:d=1.2,drawtext=fontfile=${uib}:text='${title}':fontcolor=white:fontsize=${Math.max(44, Math.round(H * 0.06))}:x=(w-text_w)/2:y=(h-text_h)/2-20,drawtext=fontfile=${ui}:text='textile-designer.ai':fontcolor=0xbcd6c8:fontsize=${Math.max(24, Math.round(H * 0.032))}:x=(w-text_w)/2:y=(h-text_h)/2+40,format=yuv420p`
    const rIntro = run(['-f', 'lavfi', '-i', cardFilter, '-c:v', 'libx264', intro])
    const rOutro = run(['-f', 'lavfi', '-i', cardFilter, '-c:v', 'libx264', outro])
    if (rIntro.status !== 0 || rOutro.status !== 0) {
      // If cards fail, keep a valid body-only social export rather than leaving a broken file.
      fs.rmSync(out, { force: true })
      fs.renameSync(body, out)
      for (const tmp of [intro, outro, outTmp]) fs.rmSync(tmp, { force: true })
      console.log(`  variant: ${path.basename(out)} (body only; card render failed)`)
      continue
    }
    const r = run(['-i', intro, '-i', body, '-i', outro, '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[out]', '-map', '[out]', '-c:v', 'libx264', '-movflags', '+faststart', outTmp])
    if (r.status === 0) {
      fs.rmSync(out, { force: true })
      fs.renameSync(outTmp, out)
      console.log(`  variant: ${path.basename(out)}`)
    } else {
      fs.rmSync(out, { force: true })
      fs.renameSync(body, out)
      fs.rmSync(outTmp, { force: true })
      console.log(`  variant: ${path.basename(out)} (body only; concat failed)`)
    }
    for (const tmp of [intro, outro, body]) fs.rmSync(tmp, { force: true })
  }
}

export { sleep }
