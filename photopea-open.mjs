// Standalone Photopea test: open color-layering PSD(s) + click color_* layers.
//
// Usage:
//   node photopea-open.mjs
//   RUN_DIR=output/color-layering/run_...   (uses input/0-*.psd and input/1-*.psd)
//   INPUT=path/to/one.psd
//   INPUT2=path/to/manual.psd

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { finalizeVideo, sleep } from './lib/demo-kit.mjs'
import { createPageBanner, demoColorLayeringInPhotopea, sortDownloadsPsds } from './lib/photopea.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HEADLESS = process.env.HEADLESS === '1'
const VIEWPORT = { width: 1920, height: 1080 }
const LAYERS = Number(process.env.LAYERS || '5')

function resolveRunDir() {
  const raw = process.env.RUN_DIR
  if (!raw) return null
  let d = path.resolve(__dirname, raw)
  if (path.basename(d).toLowerCase() === 'outputs') d = path.dirname(d)
  if (path.basename(d).toLowerCase() === 'input') d = path.dirname(d)
  return fs.existsSync(d) ? d : null
}

function psdsFromRun(runDir) {
  const files = []
  for (const sub of ['input', 'outputs']) {
    const dir = path.join(runDir, sub)
    if (!fs.existsSync(dir)) continue
    for (const n of fs.readdirSync(dir)) {
      const ab = path.join(dir, n)
      if (fs.statSync(ab).isFile()) files.push(ab)
    }
  }
  return sortDownloadsPsds(files)
}

function defaultPsd() {
  const d = path.join(__dirname, 'output', 'color-layering')
  if (!fs.existsSync(d)) return null
  let found = null
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const ab = path.join(dir, e.name)
      if (e.isDirectory()) walk(ab)
      else if (/\.psd$/i.test(e.name)) {
        const t = fs.statSync(ab).mtimeMs
        if (!found || t > found.t) found = { p: ab, t }
      }
    }
  }
  walk(d)
  return found?.p || null
}

function resolveInputs() {
  const runDir = resolveRunDir()
  if (runDir) {
    const psds = psdsFromRun(runDir)
    console.log('[photopea-test] run dir:', runDir)
    return { autoPsd: psds[0], manualPsd: psds[1], outDir: path.join(runDir, 'outputs') }
  }
  const autoPsd = process.env.INPUT ? path.resolve(__dirname, process.env.INPUT) : defaultPsd()
  const manualPsd = process.env.INPUT2 ? path.resolve(__dirname, process.env.INPUT2) : null
  return { autoPsd, manualPsd, outDir: path.join(__dirname, 'output', 'photopea-test') }
}

const CURSOR = () => {
  if (window.__cursor) return
  window.__cursor = true
  const root = document.documentElement
  const dot = document.createElement('div')
  dot.style.cssText = 'position:fixed;z-index:2147483647;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;background:rgba(0,0,0,.30);border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.5);pointer-events:none;left:-50px;top:-50px'
  const mount = () => { if (!dot.isConnected) root.appendChild(dot) }
  mount()
  addEventListener('mousemove', (e) => { mount(); dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px' }, true)
  addEventListener('mousedown', (e) => { const r = document.createElement('div'); r.style.cssText = 'position:fixed;z-index:2147483646;left:' + e.clientX + 'px;top:' + e.clientY + 'px;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:2px solid #fff;pointer-events:none'; root.appendChild(r); r.animate([{ transform: 'scale(1)', opacity: .9 }, { transform: 'scale(4)', opacity: 0 }], { duration: 450 }); setTimeout(() => r.remove(), 470) }, true)
}

async function main() {
  const { autoPsd, manualPsd, outDir } = resolveInputs()
  if (!autoPsd && !manualPsd) {
    console.log('no PSD found - set RUN_DIR=... or INPUT=...')
    return
  }
  console.log('automatic PSD:', autoPsd || '-')
  console.log('manual PSD:', manualPsd || '-')
  fs.mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, args: ['--start-maximized'] })
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, acceptDownloads: true, recordVideo: { dir: outDir, size: VIEWPORT } })
  await ctx.addInitScript(CURSOR)
  const page = await ctx.newPage()
  const glide = async (loc) => { const b = await loc.boundingBox().catch(() => null); if (b) { await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 22 }); await sleep(250) } await loc.click({ timeout: 8000 }).catch(() => {}) }
  const { banner, clearBanner } = createPageBanner(page)

  try {
    await demoColorLayeringInPhotopea(page, {
      autoPsd,
      manualPsd,
      layerCount: LAYERS,
      glide,
      sleep,
      onBanner: banner,
      clearBanner,
      screenshotPath: path.join(outDir, 'photopea-test-final.png'),
    })
    console.log('done - screenshot:', path.join(outDir, 'photopea-test-final.png'))
  } finally {
    await ctx.close().catch(() => {})
    await browser.close().catch(() => {})
  }

  await finalizeVideo({
    dir: outDir,
    outName: 'photopea-test',
    titleUrl: 'www.photopea.com',
    displayName: 'Color Layers in Photopea',
    caption: 'Editable color layers - open anywhere',
    viewport: VIEWPORT,
  })
}

main().catch((e) => { console.error(e); process.exit(1) })
