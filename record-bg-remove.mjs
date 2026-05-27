// Demo recording: Background Removal (bg_remove) with model1 (RMBG-2.0).
// Plain Playwright on a persistent (logged-in) context records the webm; we add
// a fake cursor, a simulated mac-style file picker, and an ffmpeg mac titlebar.
//
// Prereqs: logged in once via real Chrome into demo/.profile; GPU bg_remove
// worker running on DEV; org has credits/unlimited; dev server running.
//
// Usage (from demo/):  node record-bg-remove.mjs
// Env: BASE_URL, HEADLESS=1, PROFILE, OUT, INPUT, RESULT_TIMEOUT_MS

import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const HEADLESS = process.env.HEADLESS === '1'
const PROFILE = process.env.PROFILE || path.join(__dirname, '.profile')
const OUT = process.env.OUT || path.join(__dirname, 'output')
const INPUT = process.env.INPUT || path.join(__dirname, 'assets', 'input.jpg')
const RESULT_TIMEOUT_MS = Number(process.env.RESULT_TIMEOUT_MS || 120000)
const FFMPEG = path.join(__dirname, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
const VIEWPORT = { width: 1920, height: 1080 }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome',
    headless: HEADLESS,
    args: ['--start-maximized'],
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: VIEWPORT },
  })

  // Fake cursor overlay (follows the mouse + click ripple) so actions are visible.
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

  const glideClick = async (locator, { steps = 25, force = false } = {}) => {
    const box = await locator.boundingBox().catch(() => null)
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps })
      await sleep(250)
    }
    await locator.click({ timeout: 8000, force })
  }

  // Simulated mac-style "Open" file picker: shows a thumbnail of the input,
  // cursor clicks it then "Open", and the real file is attached afterward.
  const fakeUpload = async () => {
    const dataUrl = 'data:image/jpeg;base64,' + fs.readFileSync(INPUT).toString('base64')
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
    await glideClick(page.locator('#tr-thumb')) // select the image
    await sleep(600)
    await glideClick(page.locator('#tr-open')) // confirm
    await page.evaluate(() => document.getElementById('tr-picker')?.remove())
    await page.locator('input[type="file"]').setInputFiles(INPUT).catch(() => {}) // actually attach
  }

  try {
    // Clean start: home tab, then click into Background Removal (SPA → fresh state).
    await page.goto(`${BASE_URL}/ai?tab=home`, { waitUntil: 'domcontentloaded' })
    const navBgRemove = page.getByText('Background Removal', { exact: true }).first()
    console.log('Waiting for /ai home (log in if prompted)...')
    await navBgRemove.waitFor({ state: 'visible', timeout: 300000 })
    await sleep(1200)
    await glideClick(navBgRemove, { force: true })

    const uploadBtn = page.getByRole('button', { name: /upload image/i })
    await uploadBtn.waitFor({ state: 'visible', timeout: 30000 })
    await sleep(900)

    // model1 (default) — click the label to show the selection.
    await glideClick(page.getByText('Model 1', { exact: true })).catch(() => {})
    await sleep(900)

    // Dismiss the real OS chooser that the Upload button opens; we stage our own.
    page.on('filechooser', (chooser) => chooser.setFiles([]).catch(() => {}))
    await glideClick(uploadBtn) // visible click on "Upload Image"
    await sleep(300)
    await fakeUpload() // simulated picker + real attach
    await sleep(2400) // show the uploaded image on the canvas

    // Submit.
    const submit = page.getByRole('button', { name: /^submit$/i })
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/sqs/send-task-message'), { timeout: 30000 }).catch(() => null),
      glideClick(submit),
    ])
    console.log('submit response:', resp ? resp.status() : 'not observed')

    // Wait for actual completion — the Download button only renders on completion.
    const downloadBtn = page.getByRole('button', { name: /download/i })
    let completed = false
    try {
      await downloadBtn.first().waitFor({ state: 'visible', timeout: RESULT_TIMEOUT_MS })
      completed = true
      console.log('result ready (download button visible)')
    } catch {
      console.log('result not detected within timeout')
    }
    await sleep(1500)

    // Drag the before/after compare slider to reveal the result.
    if (completed) {
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

    await page.screenshot({ path: path.join(OUT, 'bg-remove-final.png') })
    console.log('COMPLETED:', completed)
  } finally {
    await ctx.close().catch(() => {})
  }

  // Convert the newest webm to mp4, wrapped in a mac-style titlebar + gradient.
  const webms = fs
    .readdirSync(OUT)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => ({ f, t: fs.statSync(path.join(OUT, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  if (!webms.length) return console.log('no webm produced')
  const webm = path.join(OUT, webms[0].f)
  const mp4 = path.join(OUT, 'bg-remove-demo.mp4')

  const TB = 44, PAD = 60, W = VIEWPORT.width, H = VIEWPORT.height
  const OW = W + 2 * PAD, OH = H + TB + 2 * PAD
  const sym = 'C\\:/Windows/Fonts/seguisym.ttf'
  const ui = 'C\\:/Windows/Fonts/segoeui.ttf'
  const dy = Math.round((TB - 20) / 2)
  const filter = [
    `[0:v]pad=iw:ih+${TB}:0:${TB}:color=0xf2f2f3[bar]`,
    `[bar]drawtext=fontfile=${sym}:text=●:fontcolor=0xff5f56:fontsize=20:x=24:y=${dy}` +
      `,drawtext=fontfile=${sym}:text=●:fontcolor=0xffbd2e:fontsize=20:x=50:y=${dy}` +
      `,drawtext=fontfile=${sym}:text=●:fontcolor=0x27c93f:fontsize=20:x=76:y=${dy}` +
      `,drawtext=fontfile=${ui}:text='textile-designer.ai/ai?tab=bg_remove':fontcolor=0x555555:fontsize=18:x=(w-text_w)/2:y=${dy}[chrome]`,
    `[1:v][chrome]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuv420p[out]`,
  ].join(';')

  const r = spawnSync(
    FFMPEG,
    ['-y', '-i', webm, '-f', 'lavfi', '-i', `gradients=s=${OW}x${OH}:c0=0x1f3a5f:c1=0x3f7d54:d=600`,
     '-filter_complex', filter, '-map', '[out]', '-c:v', 'libx264', '-movflags', '+faststart', mp4],
    { encoding: 'utf8' }
  )
  if (r.status === 0) console.log(`\nVIDEO: ${mp4}`)
  else console.log('ffmpeg framing failed:\n', (r.stderr || '').split('\n').slice(-8).join('\n'), `\nraw webm: ${webm}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
