// Photopea automation via an iframe host page.
//
// Why a host page (and not just photopea.com directly): Photopea defines `app`
// in a module-scope closure that Playwright's frame.evaluate cannot read, and
// posting messages to the top window also goes nowhere because Photopea's
// listener filters on `event.source` (it expects messages from a parent frame).
// Embedding Photopea in our own iframe gives us a parent we control - the
// canonical integration described at https://www.photopea.com/api/ - and the
// editor responds to postMessage cleanly:
//   * postMessage(stringScript)  -> runs ExtendScript, echoes via app.echoToOE
//   * postMessage(ArrayBuffer)   -> opens that buffer as a file
// Both echoes come back to our parent window via the 'message' event.

import fs from 'node:fs'
import path from 'node:path'

const IFRAME_ID = 'tr-pp'
// The `#{...}` fragment puts Photopea in API/embedded mode: the landing splash
// is skipped, the editor and its postMessage listener load immediately, and
// the parent (us) can drive the editor right away. Reference:
// https://www.photopea.com/api/ - "Skipping the front page".
const PHOTOPEA_URL = 'https://www.photopea.com/#%7B%22environment%22%3A%7B%22vmode%22%3A0%7D%7D'
const HOST_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Color Layers in Photopea</title>
<style>
  html,body{margin:0;padding:0;height:100%;background:#0e1117;overflow:hidden;font-family:Segoe UI,system-ui,sans-serif;color:#cfd3dc}
  #${IFRAME_ID}{position:absolute;inset:0;width:100%;height:100%;border:0;background:#0e1117}
</style>
</head><body>
<iframe id="${IFRAME_ID}" src="${PHOTOPEA_URL}" allow="fullscreen" referrerpolicy="no-referrer"></iframe>
</body></html>`

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

/**
 * Mac-style fake folder picker overlay - rendered on the host page so the
 * recording still has a clear "user opens a file" moment before Photopea
 * receives the bytes via postMessage. The PSD itself can't be previewed
 * (binary format), so the thumb shows a "PSD" placeholder.
 */
export async function showFakeFolderPicker(page, filePath, { glide, sleep }) {
  const fileName = path.basename(filePath)
  await page.evaluate(({ fileName }) => {
    document.getElementById('tr-picker')?.remove()
    const ov = document.createElement('div')
    ov.id = 'tr-picker'
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-family:Segoe UI,system-ui,sans-serif'
    const win = document.createElement('div')
    win.style.cssText = 'width:680px;height:460px;background:#f3f3f4;border-radius:12px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.55);display:flex;flex-direction:column'
    const thumbInner = '<div style="width:138px;height:138px;border-radius:6px;background:linear-gradient(135deg,#3c4252,#2a2f3c);display:flex;align-items:center;justify-content:center;color:#bfc4cf;font-weight:700;font-size:34px;letter-spacing:.04em;box-shadow:0 2px 8px rgba(0,0,0,.25)">PSD</div>'
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
            thumbInner +
            '<div style="margin-top:8px;font-size:12px;color:#444">' + fileName + '</div></div></div></div>' +
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
      win.querySelector('#tr-fname').textContent = fileName
    })
  }, { fileName })
  await sleep(700)
  if (glide) await glide(page.locator('#tr-thumb')).catch(() => {})
  await sleep(500)
  if (glide) await glide(page.locator('#tr-open')).catch(() => {})
  await page.evaluate(() => document.getElementById('tr-picker')?.remove())
}

/**
 * Send an ExtendScript snippet to the embedded Photopea iframe via postMessage
 * and wait for a typed reply. The script body may assign `__ret` (any
 * JSON-serializable value); the wrapper marshals it back through a per-call
 * token so concurrent messages don't get crossed.
 *
 * Returns { ok, value, error, timeout }.
 */
export async function runPhotopeaScript(page, scriptBody, { timeoutMs = 5000 } = {}) {
  const token = `tk${Math.random().toString(36).slice(2, 10)}`
  const wrapped = `
    try {
      var __ret = null;
      (function(){ ${scriptBody} })();
      app.echoToOE("ret:${token}:" + JSON.stringify(__ret));
    } catch (e) {
      app.echoToOE("err:${token}:" + (e && e.message ? e.message : String(e)));
    }
    app.echoToOE("done:${token}");
  `
  return await page.evaluate(
    ({ iframeId, script, token, timeoutMs }) => new Promise((resolve) => {
      const ifr = document.getElementById(iframeId)
      if (!ifr || !ifr.contentWindow) return resolve({ ok: false, error: 'iframe missing' })
      let ret = null, err = null, done = false, sawAutoDone = false
      const finish = (out) => {
        if (done) return
        done = true
        window.removeEventListener('message', handler)
        resolve(out)
      }
      const handler = (e) => {
        if (e.source !== ifr.contentWindow) return
        const d = e.data
        if (typeof d !== 'string') return
        if (d.startsWith(`ret:${token}:`)) {
          try { ret = JSON.parse(d.slice(`ret:${token}:`.length)) } catch { ret = null }
        } else if (d.startsWith(`err:${token}:`)) {
          err = d.slice(`err:${token}:`.length)
        } else if (d === `done:${token}`) {
          finish(err ? { ok: false, error: err } : { ok: true, value: ret })
        } else if (d === 'done') {
          // Photopea sends a bare "done" after every script. If we never see
          // our tokened done (e.g. `app` was undefined and the explicit echo
          // failed), use this as a fallback - but only as failure, since we
          // have no return value.
          sawAutoDone = true
          if (!ret && !err) {
            setTimeout(() => finish({ ok: false, error: 'no ret/err echo (app may be unavailable)' }), 150)
          }
        }
      }
      window.addEventListener('message', handler)
      try { ifr.contentWindow.postMessage(script, '*') }
      catch (e) { finish({ ok: false, error: String(e) }); return }
      setTimeout(() => finish({ ok: false, error: 'timeout', timeout: true }), timeoutMs)
    }),
    { iframeId: IFRAME_ID, script: wrapped, token, timeoutMs },
  )
}

/**
 * Boot probe: send `app.echoToOE("pp-init-<token>")` to the iframe and wait for
 * the same token to come back. This is the lightest possible smoke test for
 * the Photopea postMessage bridge - if it echoes, the editor is loaded and
 * `app` is wired up. Bypasses the token-wrapped runPhotopeaScript because that
 * relies on `app` being callable inside a try/catch (if `app` is undefined the
 * catch's own `app.echoToOE` also throws, so we never hear anything back).
 */
async function probeEditor(page, timeoutMs = 2500) {
  const token = `init-${Math.random().toString(36).slice(2, 8)}`
  return await page.evaluate(
    ({ iframeId, token, timeoutMs }) => new Promise((resolve) => {
      const ifr = document.getElementById(iframeId)
      if (!ifr || !ifr.contentWindow) return resolve(false)
      const wanted = `pp-${token}`
      const handler = (e) => {
        if (e.source !== ifr.contentWindow) return
        if (typeof e.data === 'string' && e.data === wanted) {
          window.removeEventListener('message', handler)
          resolve(true)
        }
      }
      window.addEventListener('message', handler)
      try { ifr.contentWindow.postMessage(`try { app.echoToOE(${JSON.stringify(wanted)}); } catch(e) {}`, '*') }
      catch (_) { window.removeEventListener('message', handler); return resolve(false) }
      setTimeout(() => { window.removeEventListener('message', handler); resolve(false) }, timeoutMs)
    }),
    { iframeId: IFRAME_ID, token, timeoutMs },
  )
}

/** Return the Playwright Frame pointing at photopea.com inside our iframe. */
function photopeaFrame(page) {
  return page.frames().find((f) => /photopea\.com/i.test(f.url() || '')) || null
}

export async function bootPhotopea(page, { sleep, onBanner } = {}) {
  await show(onBanner, 'Opening Photopea…', '#2f6fed', 'Free browser editor, works with your PSD')
  await page.setContent(HOST_HTML, { waitUntil: 'domcontentloaded' })

  // Photopea inside an iframe still shows its landing splash. Click
  // "Start using Photopea" inside the iframe via the Frame API - cross-origin
  // clicks work, only JS evaluation is blocked.
  await show(onBanner, 'Starting Photopea…', '#2f6fed', 'One click, no install')
  let clicked = false
  for (let i = 0; i < 40; i++) {
    const f = photopeaFrame(page)
    if (!f) {
      if (i === 0 || i === 10) console.log('[photopea] iframe frames:', page.frames().map((x) => x.url()))
      await sleep(500)
      continue
    }
    const startBtn = f.getByRole('button', { name: /start using photopea/i }).first()
    if (await startBtn.count().catch(() => 0)) {
      await startBtn.click({ timeout: 8000 }).catch((e) => console.log('[photopea] start click error:', e?.message))
      console.log('[photopea] clicked Start using Photopea (button)')
      clicked = true
      break
    }
    const fallback = f.getByText(/start using photopea/i).first()
    if (await fallback.count().catch(() => 0)) {
      await fallback.click({ timeout: 8000 }).catch((e) => console.log('[photopea] start click error:', e?.message))
      console.log('[photopea] clicked Start using Photopea (text)')
      clicked = true
      break
    }
    await sleep(500)
  }
  if (!clicked) console.log('[photopea] Start button never found in iframe')

  // Now wait for the editor's postMessage bridge to come alive.
  const deadline = Date.now() + 90000
  let attempt = 0
  while (Date.now() < deadline) {
    attempt++
    const alive = await probeEditor(page, 2000)
    if (alive) {
      console.log(`[photopea] editor ready after ${attempt} probe(s)`)
      return true
    }
    if (attempt === 4) await show(onBanner, 'Loading Photopea…', '#2f6fed', 'Still booting the editor')
    if (attempt === 12) await show(onBanner, 'Loading Photopea…', '#2f6fed', 'Editor is taking a while')
    await sleep(800)
  }
  console.log('[photopea] editor never replied - postMessage bridge unreachable')
  return false
}

/**
 * Open a PSD inside the embedded editor. Photopea opens any ArrayBuffer it
 * receives via postMessage as a file - no DOM filechooser, no "Open from
 * computer" click. We still show the fake folder picker overlay first for the
 * visual beat in the recording.
 */
export async function openFromComputer(page, psdPath, { glide, sleep, onBanner, label = 'PSD' } = {}) {
  const base = path.basename(psdPath)
  await show(onBanner, 'Opening from computer…', '#2f6fed', `Loading ${label} · ${base}`)
  await showFakeFolderPicker(page, psdPath, { glide, sleep })
  await show(onBanner, 'Loading document…', '#2f6fed', 'Parsing layers, this can take a moment')
  await postFileToEditor(page, psdPath)
  await waitForActiveDocument(page, base)
  await sleep(1500)
}

/** Second PSD: same mechanism (postMessage with bytes), different banner copy. */
export async function openFromFileMenu(page, psdPath, { glide, sleep, onBanner, label = 'PSD' } = {}) {
  const base = path.basename(psdPath)
  await show(onBanner, 'File → Open…', '#2f6fed', `Adding ${label} · ${base}`)
  await showFakeFolderPicker(page, psdPath, { glide, sleep })
  await show(onBanner, 'Loading document…', '#2f6fed', 'Parsing layers, this can take a moment')
  await postFileToEditor(page, psdPath)
  await waitForActiveDocument(page, base)
  await sleep(1500)
}

async function postFileToEditor(page, filePath) {
  const b64 = fs.readFileSync(filePath).toString('base64')
  await page.evaluate(({ iframeId, b64 }) => {
    const ifr = document.getElementById(iframeId)
    if (!ifr || !ifr.contentWindow) return
    const bin = atob(b64)
    const buf = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
    // Pass the underlying ArrayBuffer; postMessage transfers ownership via the
    // transferables list so we don't pay a copy cost for large PSDs.
    ifr.contentWindow.postMessage(buf.buffer, '*', [buf.buffer])
  }, { iframeId: IFRAME_ID, b64 })
}

async function waitForActiveDocument(page, expectedBaseName, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const r = await runPhotopeaScript(page, `
      try {
        if (app.documents.length === 0) { __ret = null; }
        else { __ret = { name: app.activeDocument.name, count: app.documents.length }; }
      } catch (e) { __ret = null; }
    `, { timeoutMs: 2000 })
    if (r && r.ok && r.value && r.value.count > 0) {
      console.log('[photopea] active document:', r.value.name, '(', r.value.count, 'total)')
      return r.value
    }
    await new Promise((res) => setTimeout(res, 800))
  }
  console.log('[photopea] document never opened within', timeoutMs, 'ms')
  return null
}

/**
 * Cycle through the color_* layers and make each one active. Matches the
 * prefix case-insensitively (worker output uses `Color_N`, older PSDs use
 * `color_N`) and walks the actual layer list rather than guessing names.
 */
export async function clickColorLayers(page, { sleep, max = 8, prefix = 'color_', onBanner } = {}) {
  await show(onBanner, 'Editable color layers', '#2f7d54', `Each swatch is its own layer (up to ${max} shown)`)

  // Get the top-level layer count first. We deliberately don't walk a recursive
  // tree in a single script - the worker output is a flat list of color layers
  // at the document root, and the giant walk-script we tried earlier hung
  // inside Photopea for reasons that weren't obvious (likely the inner function
  // declaration tripping its eval). Splitting it into one tiny script per name
  // is also easier to debug from the log.
  const countResp = await runPhotopeaScript(page, '__ret = app.activeDocument.layers.length;', { timeoutMs: 5000 })
  if (!countResp.ok || typeof countResp.value !== 'number') {
    console.log('[photopea] could not read layer count:', countResp.error)
    return 0
  }
  const total = countResp.value
  console.log('[photopea] top-level layer count:', total)

  // Read each layer's name in its own script (cheap; <50ms round-trip per).
  const names = []
  for (let i = 0; i < total; i++) {
    const r = await runPhotopeaScript(page, `__ret = app.activeDocument.layers[${i}].name;`, { timeoutMs: 3000 })
    if (r.ok && typeof r.value === 'string') names.push({ i, name: r.value })
    else { console.log('[photopea] layer', i, 'name read failed:', r.error); break }
  }
  console.log('[photopea] layers:', names.map((x) => `${x.i}=${x.name}`).join(', '))

  // Filter for the color_* prefix (case-insensitive) and sort by trailing int.
  const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$', 'i')
  const picks = names
    .map((x) => ({ i: x.i, name: x.name, n: parseInt((x.name.match(re) || [])[1], 10) }))
    .filter((x) => Number.isFinite(x.n))
    .sort((a, b) => a.n - b.n)
  console.log('[photopea] matched', prefix, '->', picks.map((p) => `[${p.i}]${p.name}`).join(', ') || '(none)')

  // Peel: hide each color layer in sequence and leave it hidden. Top-down
  // (highest trailing number first) reads more like a designer reviewing the
  // separation - the topmost color disappears, revealing the design beneath,
  // then the next, etc. By the end the canvas is empty/transparent which
  // visually proves each layer was the entire contribution of one color.
  const toPeel = picks.slice(0, max).slice().reverse()
  let peeled = 0
  for (let k = 0; k < toPeel.length; k++) {
    const { i, name } = toPeel[k]
    await show(onBanner, `Layer ${k + 1} of ${toPeel.length}`, '#2f7d54', name)
    const off = await runPhotopeaScript(page, `
      var L = app.activeDocument.layers[${i}];
      L.visible = false;
      __ret = { name: L.name, visible: L.visible };
    `, { timeoutMs: 3000 })
    if (!off.ok || !off.value || off.value.visible !== false) {
      console.log('[photopea] eye off failed for', name, off.error || off.value)
      continue
    }
    peeled++
    console.log('[photopea] peeled', name)
    await sleep(1200)
  }
  if (!peeled) console.log('[photopea] WARNING: no layers peeled')
  return peeled
}

/**
 * Color layering demo beat: automatic PSD -> manual PSD via the iframe-hosted
 * editor -> highlight each color_* layer in turn.
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

  const ready = await bootPhotopea(page, { sleep, onBanner })
  if (!ready) console.log('[photopea] editor boot timeout (continuing)')

  if (autoPsd && fs.existsSync(autoPsd)) {
    console.log('[photopea] automatic PSD:', autoPsd)
    await show(onBanner, 'Automatic color layers', '#2f6fed', 'AI chose how many colors to separate')
    await openFromComputer(page, autoPsd, { glide, sleep, onBanner, label: 'automatic separation' })
    await clickColorLayers(page, { sleep, max: layerCount, onBanner })
    if (clearBanner) await clearBanner()
    await sleep(1500)
  }

  if (manualPsd && fs.existsSync(manualPsd)) {
    console.log('[photopea] manual PSD:', manualPsd)
    await show(onBanner, `Manual · ${layerCount} color layers`, '#2f6fed', 'You control how many layers to split')
    await openFromFileMenu(page, manualPsd, { glide, sleep, onBanner, label: 'manual separation' })
    await clickColorLayers(page, { sleep, max: layerCount, onBanner })
    if (clearBanner) await clearBanner()
    await sleep(1500)
  }

  // Tail beat. Wrap in catch - by the time we get here the editor has loaded
  // and peeled two documents; Photopea sometimes navigates or detaches the
  // host page on the way out, and we still want finalizeVideo to run.
  await show(onBanner, 'Fully editable in Photopea', '#2f7d54', 'Export, tweak, or send to print').catch(() => {})
  await sleep(2000)
  if (clearBanner) await clearBanner().catch(() => {})

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
  await bootPhotopea(page, { sleep: opts.sleep, onBanner: banner })
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
