// Standalone Photopea pipeline (test): open photopea.com -> "Start using
// Photopea" -> "Open from computer" -> feed a PSD -> show the preserved layers.
// Uses an existing color_layering PSD by default. Public site, no login.
//
// Usage:  node photopea-open.mjs
//   INPUT=path/to/file.psd  to override the PSD.

import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { finalizeVideo, sleep } from './lib/demo-kit.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HEADLESS = process.env.HEADLESS === '1'
const VIEWPORT = { width: 1920, height: 1080 }

function defaultPsd() {
  const d = path.join(__dirname, 'output', 'color-layering', 'downloads')
  if (!fs.existsSync(d)) return null
  const psds = fs.readdirSync(d).filter((f) => /\.psd$/i.test(f))
    .map((f) => ({ p: path.join(d, f), t: fs.statSync(path.join(d, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  return psds[0]?.p || null
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

  // Serve the PSD locally (CORS) so Photopea can fetch it by URL. http://localhost
  // is exempt from mixed-content blocking, so https Photopea can load it.
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/octet-stream' })
    fs.createReadStream(PSD).pipe(res)
  })
  await new Promise((r) => server.listen(0, r))
  const psdUrl = `http://localhost:${server.address().port}/layers.psd`

  try {
    // Photopea URL-config API: open the PSD by URL on load.
    const cfg = encodeURIComponent(JSON.stringify({ files: [psdUrl] }))
    await page.goto(`https://www.photopea.com/#${cfg}`, { waitUntil: 'domcontentloaded' })
    await sleep(22000) // Photopea boots + fetches + parses the PSD into layers
    await page.screenshot({ path: path.join(dir, 'photopea-test-final.png') }).catch(() => {})
    console.log('opened via URL config:', psdUrl)
    console.log('done')
  } finally {
    await ctx.close().catch(() => {}); await browser.close().catch(() => {}); server.close()
  }

  await finalizeVideo({ dir, outName: 'photopea-test', titleUrl: 'www.photopea.com', displayName: 'Color Layers in Photopea', caption: 'Editable color layers - open anywhere', viewport: VIEWPORT })
}

main().catch((e) => { console.error(e); process.exit(1) })
