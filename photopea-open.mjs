// Standalone Photopea test: Start using Photopea -> Open from computer -> PSD.
//
// Usage:  node photopea-open.mjs
//   INPUT=assets/people-sep (1).psd

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { finalizeVideo, sleep } from './lib/demo-kit.mjs'
import { openPsdInPhotopea } from './lib/photopea.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HEADLESS = process.env.HEADLESS === '1'
const VIEWPORT = { width: 1920, height: 1080 }

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

const PSD = process.env.INPUT ? path.resolve(__dirname, process.env.INPUT) : defaultPsd()

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
  if (!PSD || !fs.existsSync(PSD)) { console.log('no PSD found - set INPUT=...'); return }
  console.log('PSD:', PSD)
  const dir = path.join(__dirname, 'output', 'photopea-test')
  fs.mkdirSync(dir, { recursive: true })

  const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS, args: ['--start-maximized'] })
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, acceptDownloads: true, recordVideo: { dir, size: VIEWPORT } })
  await ctx.addInitScript(CURSOR)
  const page = await ctx.newPage()
  const glide = async (loc) => { const b = await loc.boundingBox().catch(() => null); if (b) { await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 22 }); await sleep(250) } await loc.click({ timeout: 8000 }).catch(() => {}) }

  try {
    await openPsdInPhotopea(page, PSD, {
      glide,
      sleep,
      screenshotPath: path.join(dir, 'photopea-test-final.png'),
    })
    console.log('done')
  } finally {
    await ctx.close().catch(() => {})
    await browser.close().catch(() => {})
  }

  await finalizeVideo({ dir, outName: 'photopea-test', titleUrl: 'www.photopea.com', displayName: 'Color Layers in Photopea', caption: 'Editable color layers - open anywhere', viewport: VIEWPORT })
}

main().catch((e) => { console.error(e); process.exit(1) })
