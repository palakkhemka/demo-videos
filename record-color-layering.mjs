// Color Layering demo - single video:
//   upload -> run AUTOMATIC detection -> run MANUAL (set N layers) on same image
//   -> Photopea: open automatic PSD, File > Open manual PSD, click color_* layers.
// Needs the color_layering worker (machine10 / api_worker) on DEV.
// EXPERIMENTAL: the manual-count control + Photopea drop may need tuning when
// the worker is live and a real PSD is produced.
//
// Usage: node record-color-layering.mjs

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createDemoSession, finalizeVideo, sleep } from './lib/demo-kit.mjs'
import { createPageBanner, demoColorLayeringInPhotopea, sortDownloadsPsds } from './lib/photopea.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const INPUT = path.resolve(__dirname, process.env.INPUT || 'assets/input.jpg')
const MANUAL_LAYERS = process.env.LAYERS || '5'

async function main() {
  const s = await createDemoSession({ dirName: 'color-layering' })
  const { ctx, page, glide, fakeUpload, zoomEl, downloads, dir, t0, viewport, rp } = s
  const spans = []

  const { banner, clearBanner } = createPageBanner(page)

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

    // The "Automatic color layer detection" switch is the second NextUI Switch
    // on the panel (the first is Advanced-Q Mode). spec.default is FALSE for
    // isAutomatic, so we MUST tick it before the auto run - the old "default on"
    // comment was wrong, both runs were silently going through cluster_number
    // mode. Read aria-checked to decide whether to toggle.
    const findAutomaticSwitch = async () => {
      // Scope by the label text, then grab the switch role inside the same row.
      // Falls back to the second switch on the page if scoping fails.
      const labelLoc = page.getByText(/automatic color layer detection/i).first()
      const labelHandle = await labelLoc.elementHandle().catch(() => null)
      if (labelHandle) {
        const sw = await page.evaluateHandle((el) => {
          let n = el
          for (let i = 0; i < 6 && n; i++) {
            const s = n.querySelector?.('[role="switch"]')
            if (s) return s
            n = n.parentElement
          }
          // Last resort: second switch on the page (after Advanced-Q Mode).
          return document.querySelectorAll('[role="switch"]')[1] || null
        }, labelHandle).catch(() => null)
        if (sw) return page.locator('[role="switch"]').nth(await page.evaluate((s) => Array.from(document.querySelectorAll('[role="switch"]')).indexOf(s), sw).catch(() => 1))
      }
      return page.locator('[role="switch"]').nth(1)
    }
    const isAutomaticOn = async () => {
      const sw = await findAutomaticSwitch()
      const ac = await sw.getAttribute('aria-checked').catch(() => null)
      return ac === 'true'
    }
    const setAutomatic = async (want, label) => {
      const sw = await findAutomaticSwitch()
      for (let i = 0; i < 3; i++) {
        const on = await isAutomaticOn()
        if (on === want) return true
        await glide(sw).catch(() => {})
        await sleep(500)
      }
      const finalOn = await isAutomaticOn()
      console.log(`[color_layering] ${label}: isAutomatic=${finalOn} (wanted ${want})`)
      return finalOn === want
    }

    // Run 1: Automatic detection - flip the switch ON if it isn't already.
    await banner('Automatic color layer detection', '#2f6fed')
    await setAutomatic(true, 'pre-auto')
    await sleep(400)
    await runOnce('automatic')
    await clearBanner()

    // Run 2: Manual - flip the switch OFF, then set the cluster count.
    await banner(`Manual - ${MANUAL_LAYERS} color layers`, '#2f6fed')
    await setAutomatic(false, 'pre-manual')
    await sleep(500)
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

    // Photopea: automatic PSD -> File > Open manual PSD -> click color_0, color_1, ...
    const psds = sortDownloadsPsds(downloads)
    const autoPsd = psds[0]
    const manualPsd = psds[1]
    if (autoPsd || manualPsd) {
      await demoColorLayeringInPhotopea(page, {
        autoPsd,
        manualPsd,
        layerCount: Number(MANUAL_LAYERS) || 5,
        glide,
        sleep,
        onBanner: banner,
        clearBanner,
        screenshotPath: path.join(rp.outputs, 'color-layering-photopea.png'),
      })
      console.log('[color_layering] photopea:', { auto: autoPsd ? path.basename(autoPsd) : '-', manual: manualPsd ? path.basename(manualPsd) : '-' })
    } else {
      console.log('[color_layering] no PSD captured - skipping Photopea step')
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
    caption: 'Separating designs into editable color layers - instantly',
    viewport, t0, spans,
  })
}

main().catch((e) => { console.error(e); process.exit(1) })
