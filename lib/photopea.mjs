// Photopea automation: landing -> editor -> open PSD(s) -> click color_* layers.

import fs from 'node:fs'
import path from 'node:path'

/** On-screen pill banner for demo recordings (works on photopea.com). */
export function createPageBanner(page) {
  const banner = async (text, color = '#2f6fed', subtitle = '') => {
    await page.evaluate(({ text, color, subtitle }) => {
      document.getElementById('tr-banner')?.remove()
      const b = document.createElement('div')
      b.id = 'tr-banner'
      b.style.cssText =
        'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:2147483500;' +
        'background:' + color + ';color:#fff;font:600 22px Segoe UI,system-ui,sans-serif;' +
        'padding:12px 28px;border-radius:16px;box-shadow:0 6px 24px rgba(0,0,0,.45);' +
        'text-align:center;max-width:min(92vw,720px);line-height:1.35'
      if (subtitle) {
        b.innerHTML =
          '<div>' + text + '</div>' +
          '<div style="font-weight:400;font-size:16px;margin-top:6px;opacity:.93">' + subtitle + '</div>'
      } else {
        b.textContent = text
      }
      document.body.appendChild(b)
    }, { text, color, subtitle })
  }
  const clearBanner = () => page.evaluate(() => document.getElementById('tr-banner')?.remove())
  return { banner, clearBanner }
}

async function show(onBanner, text, color, subtitle) {
  if (onBanner) await onBanner(text, color, subtitle)
}

/** @param {import('playwright-core').Page} page */
export async function bootPhotopea(page, { glide, sleep, onBanner }) {
  await show(onBanner, 'Opening Photopea…', '#2f6fed', 'Free browser editor, works with your PSD')
  await page.goto('https://www.photopea.com/', { waitUntil: 'domcontentloaded' })
  const startBtn = page.getByRole('button', { name: /start using photopea/i }).first()
  if (await startBtn.count().catch(() => 0)) {
    await show(onBanner, 'Starting Photopea…', '#2f6fed', 'One click, no install')
    await glide(startBtn).catch(() => {})
    await sleep(2000)
  }
  return page.waitForFunction(
    () => !!(window.Photopea || (window.app && window.app.open)),
    null,
    { timeout: 30000 },
  ).then(() => true).catch(() => false)
}

/** First PSD: "Open from computer" on the landing / welcome screen. */
export async function openFromComputer(page, psdPath, { glide, sleep, onBanner, label = 'PSD' }) {
  const base = path.basename(psdPath)
  await show(onBanner, 'Opening from computer…', '#2f6fed', `Loading ${label} · ${base}`)
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 15000 }).catch(() => null)
  const openBtn = page.getByRole('button', { name: /open from computer/i }).first()
  if (await openBtn.count().catch(() => 0)) await glide(openBtn).catch(() => {})
  else await page.getByRole('button', { name: /^open$/i }).first().click({ timeout: 5000 }).catch(() => {})
  await show(onBanner, 'Loading document…', '#2f6fed', 'Parsing layers, this can take a moment')
  const chooser = await chooserPromise
  if (chooser) await chooser.setFiles(psdPath).catch(() => {})
  else await page.setInputFiles('input[type="file"]', psdPath).catch(() => {})
  await sleep(5000)
}

/** Second PSD: File -> Open (editor menu). */
export async function openFromFileMenu(page, psdPath, { glide, sleep, onBanner, label = 'PSD' }) {
  const base = path.basename(psdPath)
  await show(onBanner, 'File → Open…', '#2f6fed', `Adding ${label} · ${base}`)
  const armChooser = () => page.waitForEvent('filechooser', { timeout: 15000 }).catch(() => null)

  let chooserPromise = armChooser()

  const fileMenu = page.getByText(/^File$/).first()
  if (await fileMenu.count().catch(() => 0)) {
    await glide(fileMenu).catch(() => {})
    await sleep(500)
    const openItem = page.getByText(/^Open\.\.\.$|^Open…$|^Open$/).first()
    if (await openItem.count().catch(() => 0)) {
      chooserPromise = armChooser()
      await glide(openItem).catch(() => {})
    }
  } else {
    await page.keyboard.press('Alt+F').catch(() => {})
    await sleep(400)
    chooserPromise = armChooser()
    await page.keyboard.press('o').catch(() => {})
  }

  await show(onBanner, 'Loading document…', '#2f6fed', 'Parsing layers, this can take a moment')
  const chooser = await chooserPromise
  if (chooser) await chooser.setFiles(psdPath).catch(() => {})
  else await page.setInputFiles('input[type="file"]', psdPath).catch(() => {})

  await sleep(6000)
}

/** Click color_0, color_1, … in the Layers panel (UI + optional ExtendScript). */
export async function clickColorLayers(page, { glide, sleep, max = 8, prefix = 'color_', onBanner }) {
  const names = Array.from({ length: max }, (_, i) => `${prefix}${i}`)
  await show(onBanner, 'Editable color layers', '#2f7d54', `Each swatch is its own layer (${names.length} shown)`)

  const scripted = await page.evaluate(async ({ names }) => {
    if (typeof app === 'undefined' || !app.activeDocument) return false
    const hits = []
    const walk = (layers) => {
      for (let i = 0; i < layers.length; i++) {
        const L = layers[i]
        if (L.typename === 'ArtLayer') hits.push(L)
        else if (L.layers) walk(L.layers)
      }
    }
    walk(app.activeDocument.layers)
    let n = 0
    for (const want of names) {
      const layer = hits.find((L) => L.name === want)
      if (!layer) continue
      app.activeDocument.activeLayer = layer
      n++
      await new Promise((r) => setTimeout(r, 1200))
    }
    return n > 0
  }, { names }).catch(() => false)

  if (scripted) {
    console.log('[photopea] selected layers via script')
    return
  }

  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    await show(onBanner, `Layer ${i + 1} of ${names.length}`, '#2f7d54', name)
    const row = page.getByText(name, { exact: true }).first()
    if (await row.count().catch(() => 0)) {
      await glide(row).catch(() => {})
      await sleep(1400)
      console.log('[photopea] clicked layer', name)
    }
  }
}

/**
 * Color layering demo beat: automatic PSD -> manual PSD via File -> Open -> click color_* layers.
 */
export async function demoColorLayeringInPhotopea(page, {
  autoPsd,
  manualPsd,
  layerCount = 5,
  glide,
  sleep,
  onBanner,
  clearBanner,
  screenshotPath,
} = {}) {
  if (!onBanner) {
    const b = createPageBanner(page)
    onBanner = b.banner
    clearBanner = clearBanner || b.clearBanner
  }

  const ready = await bootPhotopea(page, { glide, sleep, onBanner })
  if (!ready) console.log('[photopea] editor boot timeout (continuing)')

  if (autoPsd && fs.existsSync(autoPsd)) {
    console.log('[photopea] automatic PSD:', autoPsd)
    await show(onBanner, 'Automatic color layers', '#2f6fed', 'AI chose how many colors to separate')
    await openFromComputer(page, autoPsd, { glide, sleep, onBanner, label: 'automatic separation' })
    await clickColorLayers(page, { glide, sleep, max: layerCount, onBanner })
    if (clearBanner) await clearBanner()
    await sleep(1500)
  }

  if (manualPsd && fs.existsSync(manualPsd)) {
    console.log('[photopea] manual PSD:', manualPsd)
    await show(onBanner, `Manual · ${layerCount} color layers`, '#2f6fed', 'You control how many layers to split')
    await openFromFileMenu(page, manualPsd, { glide, sleep, onBanner, label: 'manual separation' })
    await clickColorLayers(page, { glide, sleep, max: layerCount, onBanner })
    if (clearBanner) await clearBanner()
    await sleep(1500)
  }

  await show(onBanner, 'Fully editable in Photopea', '#2f7d54', 'Export, tweak, or send to print')
  await sleep(2000)
  if (clearBanner) await clearBanner()

  if (screenshotPath) await page.screenshot({ path: screenshotPath }).catch(() => {})
  return true
}

/** @deprecated use demoColorLayeringInPhotopea or bootPhotopea + openFromComputer */
export async function openPsdInPhotopea(page, psdPath, opts = {}) {
  if (!psdPath || !fs.existsSync(psdPath)) {
    console.log('[photopea] PSD not found:', psdPath)
    return false
  }
  const { banner, clearBanner } = opts.onBanner ? { banner: opts.onBanner, clearBanner: opts.clearBanner } : createPageBanner(page)
  await bootPhotopea(page, { glide: opts.glide, sleep: opts.sleep, onBanner: banner })
  await openFromComputer(page, psdPath, { glide: opts.glide, sleep: opts.sleep, onBanner: banner })
  await banner('Layers open in Photopea, fully editable', '#2f7d54')
  if (opts.clearBanner) await opts.clearBanner()
  else await clearBanner()
  if (opts.screenshotPath) await page.screenshot({ path: opts.screenshotPath }).catch(() => {})
  return true
}

export function sortDownloadsPsds(downloadPaths) {
  return downloadPaths
    .filter((f) => /\.psd$/i.test(f))
    .sort((a, b) => {
      const na = Number(path.basename(a).match(/^(\d+)-/)?.[1] ?? 0)
      const nb = Number(path.basename(b).match(/^(\d+)-/)?.[1] ?? 0)
      return na - nb
    })
}
