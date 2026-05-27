// Color Layering demo — single video:
//   upload -> run AUTOMATIC detection -> run MANUAL (set N layers) on same image
//   -> open Photopea (photopea.com) and drop the resulting PSD to show the
//   separated, editable layers.
// Needs the color_layering worker (machine10 / api_worker) on DEV.
// EXPERIMENTAL: the manual-count control + Photopea drop may need tuning when
// the worker is live and a real PSD is produced.
//
// Usage: node record-color-layering.mjs

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createDemoSession, finalizeVideo, sleep } from './lib/demo-kit.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const INPUT = path.resolve(__dirname, process.env.INPUT || 'assets/input.jpg')
const MANUAL_LAYERS = process.env.LAYERS || '5'

async function main() {
  const s = await createDemoSession({ dirName: 'color-layering' })
  const { ctx, page, glide, fakeUpload, zoomEl, downloads, dir, t0, viewport } = s
  const spans = []

  const banner = async (text, color = '#2f6fed') => {
    await page.evaluate(({ text, color }) => {
      document.getElementById('tr-banner')?.remove()
      const b = document.createElement('div'); b.id = 'tr-banner'
      b.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:2147483500;background:' + color + ';color:#fff;font:600 22px Segoe UI,system-ui,sans-serif;padding:12px 26px;border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.4)'
      b.textContent = text; document.body.appendChild(b)
    }, { text, color })
  }
  const clearBanner = () => page.evaluate(() => document.getElementById('tr-banner')?.remove())

  const runOnce = async (modeLabel) => {
    const submitBtn = page.getByRole('button', { name: /^submit$/i })
    const downloadBtn = page.getByRole('button', { name: /download/i })
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /^submit$/i.test((x.textContent || '').trim()))
      return b && !b.disabled
    }, { timeout: 90000 }).catch(() => {})
    await sleep(400)
    const tSubmit = Date.now()
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/sqs/send-task-message'), { timeout: 30000 }).catch(() => null),
      glide(submitBtn),
    ])
    try { await downloadBtn.first().waitFor({ state: 'visible', timeout: 600000 }) } catch {}
    spans.push({ start: (tSubmit - t0) / 1000 + 1.0, end: (Date.now() - t0) / 1000 - 0.5 })
    await sleep(1200)
    await glide(downloadBtn.first()).catch(() => {}) // capture the PSD
    await sleep(1500)
  }

  try {
    await page.goto(`${BASE_URL}/ai?tab=home`, { waitUntil: 'domcontentloaded' })
    const nav = page.locator('button[class*="tool-row"]').filter({ hasText: /color layering/i }).first()
    console.log('[color_layering] waiting for home (log in if prompted)...')
    await nav.waitFor({ state: 'visible', timeout: 300000 })
    await sleep(1000)
    await glide(nav, { force: true }).catch(() => {})

    const uploadBtn = page.getByRole('button', { name: /upload image/i })
    try { await uploadBtn.waitFor({ state: 'visible', timeout: 18000 }) }
    catch { await page.goto(`${BASE_URL}/ai?tab=color_layering`, { waitUntil: 'domcontentloaded' }); await uploadBtn.waitFor({ state: 'visible', timeout: 30000 }) }
    await sleep(800)
    page.on('filechooser', (c) => c.setFiles(INPUT).catch(() => {})) // feed real file via tool chooser
    await glide(uploadBtn)
    await sleep(300)
    await fakeUpload(INPUT)
    await sleep(1800)
    await zoomEl(['canvas'])

    // Run 1: Automatic detection (default on)
    await banner('Automatic color layer detection', '#2f6fed')
    await runOnce('automatic')
    await clearBanner()

    // Run 2: Manual — turn automatic off and set a layer count
    await banner(`Manual — ${MANUAL_LAYERS} color layers`, '#2f6fed')
    await glide(page.getByText(/automatic color layer detection/i).first()).catch(() => {})
    await sleep(700)
    const layerInput = page.locator('input[type="number"], input[inputmode="numeric"]').first()
    if (await layerInput.count().catch(() => 0)) {
      await layerInput.fill(String(MANUAL_LAYERS)).catch(() => {})
    } else {
      const range = page.locator('input[type="range"]').first()
      const rb = await range.boundingBox().catch(() => null)
      if (rb) await page.mouse.click(rb.x + rb.width * 0.5, rb.y + rb.height / 2)
    }
    await sleep(800)
    await runOnce('manual')
    await clearBanner()

    // Open Photopea and drop the PSD to reveal the editable layers.
    const psd = [...downloads].reverse().find((f) => /\.psd$/i.test(f)) || downloads[downloads.length - 1]
    if (psd && fs.existsSync(psd)) {
      const b64 = fs.readFileSync(psd).toString('base64')
      const psdName = path.basename(psd)
      await page.goto('https://www.photopea.com', { waitUntil: 'domcontentloaded' })
      await sleep(2500)
      // Landing page → click "Start using Photopea" / "Open Photopea" to reach the editor.
      await page.getByRole('link', { name: /start using photopea|open photopea|launch/i }).first().click({ timeout: 5000 }).catch(() => {})
      await page.getByRole('button', { name: /start using photopea|open photopea|launch/i }).first().click({ timeout: 3000 }).catch(() => {})
      await sleep(6000) // let the editor boot
      await banner('Opening the PSD in Photopea — layers preserved', '#2f7d54')
      await page.evaluate(async ({ b64, name }) => {
        const bin = atob(b64)
        const arr = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
        const file = new File([arr], name, { type: 'image/vnd.adobe.photoshop' })
        const dt = new DataTransfer()
        dt.items.add(file)
        for (const t of ['dragenter', 'dragover', 'drop']) {
          document.body.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }))
        }
      }, { b64, name: psdName }).catch((e) => console.log('photopea drop failed:', e.message))
      await sleep(7000) // let it parse + render the layers panel
      await clearBanner()
      await page.screenshot({ path: path.join(dir, 'color-layering-photopea.png') }).catch(() => {})
    } else {
      console.log('[color_layering] no PSD captured — skipping Photopea step')
    }
    console.log('[color_layering] downloads:', downloads.length)
  } finally {
    await ctx.close().catch(() => {})
  }

  await finalizeVideo({
    dir,
    outName: 'color-layering-demo',
    titleUrl: 'textile-designer.ai/ai?tab=color_layering',
    displayName: 'Color Layering',
    caption: 'Separating designs into editable color layers — instantly',
    viewport, t0, spans,
  })
}

main().catch((e) => { console.error(e); process.exit(1) })
