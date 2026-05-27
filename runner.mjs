// Local UI to run the demo scripts. Pick a script + one or more input images
// (preset or uploaded); it runs the script on each image one-by-one and streams
// logs, then links the produced videos.
//
// Start:  node runner.mjs   →   open http://localhost:8787

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { FONT_PATHS } from './config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEMO_DIR = __dirname
const ASSETS = path.join(DEMO_DIR, 'assets')
const UPLOADS = path.join(ASSETS, 'uploads')
const OUTPUT = path.join(DEMO_DIR, 'output')
const THUMBS = path.join(OUTPUT, '.thumbs')
const FFMPEG = path.join(DEMO_DIR, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
const PORT = Number(process.env.PORT || 8787)
const IMG_RE = /\.(jpe?g|png|webp)$/i
fs.mkdirSync(UPLOADS, { recursive: true })
const INPUT_ROOT = ASSETS

function chromeExecutable() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  if (process.platform === 'win32') {
    const candidates = [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    ]
    for (const c of candidates) if (fs.existsSync(c)) return c
    return null
  }
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  return 'google-chrome'
}

// First .mp4 found anywhere under a directory (for a folder-tile preview).
function firstVideo(absDir) {
  let found = null
  const walk = (d) => {
    if (found) return
    let entries = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (found) return
      if (e.name.startsWith('.')) continue
      const ab = path.join(d, e.name)
      if (e.isDirectory()) walk(ab)
      else if (/\.mp4$/i.test(e.name)) found = ab
    }
  }
  walk(absDir)
  return found
}

// List a directory for the folder browser. flat=true returns every video found
// recursively under the path (the "all videos for this task type" view); else
// just the immediate children (the nested folder view).
function browseDir(rel, flat) {
  const clean = rel.replace(/^[/\\]+/, '')
  const abs = path.resolve(OUTPUT, clean)
  if (!abs.startsWith(OUTPUT) || !fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return { path: clean, dirs: [], files: [] }
  if (flat) {
    const files = []
    const walk = (d) => {
      let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
      for (const e of es) {
        if (e.name.startsWith('.')) continue
        const ab = path.join(d, e.name)
        if (e.isDirectory()) walk(ab)
        else if (/\.mp4$/i.test(e.name)) {
          const st = fs.statSync(ab)
          const rp = path.relative(OUTPUT, ab).replace(/\\/g, '/')
          files.push({ name: e.name, kind: 'video', path: path.relative(DEMO_DIR, ab).replace(/\\/g, '/'), mb: +(st.size / 1e6).toFixed(1), mtime: st.mtimeMs, run: (rp.split('/').find((p) => p.startsWith('run_')) || '').replace(/^run_/, '') })
        }
      }
    }
    walk(abs)
    files.sort((a, b) => b.mtime - a.mtime)
    return { path: clean, dirs: [], files, flat: true }
  }
  const dirs = [], files = []
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const ab = path.join(abs, e.name)
    const childRel = path.relative(OUTPUT, ab).replace(/\\/g, '/')
    if (e.isDirectory()) {
      const prev = firstVideo(ab)
      dirs.push({ name: e.name, path: childRel, preview: prev ? path.relative(DEMO_DIR, prev).replace(/\\/g, '/') : '', count: countVideos(ab) })
    } else {
      const kind = /\.mp4$/i.test(e.name) ? 'video' : (IMG_RE.test(e.name) ? 'image' : null)
      if (!kind) continue
      const st = fs.statSync(ab)
      files.push({ name: e.name, kind, path: path.relative(DEMO_DIR, ab).replace(/\\/g, '/'), mb: +(st.size / 1e6).toFixed(1), mtime: st.mtimeMs })
    }
  }
  dirs.sort((a, b) => (a.name < b.name ? 1 : -1)) // newest run_/name first
  files.sort((a, b) => b.mtime - a.mtime)
  return { path: clean, dirs, files }
}
function countVideos(absDir) {
  let n = 0
  const walk = (d) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return } for (const e of es) { if (e.name.startsWith('.')) continue; const ab = path.join(d, e.name); if (e.isDirectory()) walk(ab); else if (/\.mp4$/i.test(e.name)) n++ } }
  walk(absDir)
  return n
}

function browseInputs(rel) {
  const clean = String(rel || '').replace(/^[/\\]+/, '')
  const abs = path.resolve(INPUT_ROOT, clean)
  if (!abs.startsWith(INPUT_ROOT) || !fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return { path: clean, dirs: [], files: [] }
  const dirs = [], files = []
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    if (e.name === '.thumbs') continue
    const ab = path.join(abs, e.name)
    const childRel = path.relative(INPUT_ROOT, ab).replace(/\\/g, '/')
    if (e.isDirectory()) {
      const count = listImages(childRel).length
      dirs.push({ name: e.name, path: childRel, count })
    } else if (IMG_RE.test(e.name) && !/^logo-/.test(e.name)) {
      const st = fs.statSync(ab)
      files.push({ name: e.name, kind: 'image', path: path.relative(DEMO_DIR, ab).replace(/\\/g, '/'), mb: +(st.size / 1e6).toFixed(1), mtime: st.mtimeMs })
    }
  }
  dirs.sort((a, b) => (a.name < b.name ? -1 : 1))
  files.sort((a, b) => b.mtime - a.mtime)
  return { path: clean, dirs, files }
}

// The result image makes a far better poster than a video frame (a frame just
// lands on the intro/home screen). For .../run_x/videos/foo.mp4 prefer an image
// from the sibling outputs/ (the result), then input/ (the source).
function posterSource(absMp4) {
  const runDir = path.dirname(path.dirname(absMp4)) // .../run_x  (parent of videos/)
  for (const sub of ['outputs', 'input']) {
    const d = path.join(runDir, sub)
    if (fs.existsSync(d)) {
      const img = fs.readdirSync(d).find((f) => IMG_RE.test(f))
      if (img) return path.join(d, img)
    }
  }
  return null
}

// Poster for a video (cached in output/.thumbs): the result/source image if we
// can find one, else a representative video frame as a fallback.
function thumbFor(absMp4) {
  const key = sanitize(path.relative(OUTPUT, absMp4).replace(/\\/g, '/'))
  const thumb = path.join(THUMBS, `${key}.jpg`)
  const poster = posterSource(absMp4)
  const src = poster || absMp4
  const fresh = fs.existsSync(thumb) && fs.statSync(thumb).mtimeMs >= fs.statSync(src).mtimeMs
  if (!fresh) {
    fs.mkdirSync(THUMBS, { recursive: true })
    if (poster) spawnSync(FFMPEG, ['-y', '-i', poster, '-vf', 'scale=360:-2', '-frames:v', '1', thumb], { encoding: 'utf8' })
    else spawnSync(FFMPEG, ['-y', '-ss', '3', '-i', absMp4, '-vf', 'thumbnail,scale=360:-2', '-frames:v', '1', thumb], { encoding: 'utf8' })
  }
  return fs.existsSync(thumb) ? thumb : null
}

const SCRIPT_NAMES = {
  'record-bg-remove2.mjs': 'Background Removal · Model 1',
  'record-bg-remove-model2.mjs': 'Background Removal · Model 2',
  'record-bg-remove.mjs': 'Background Removal (standalone)',
  'record-anti-blur-pro.mjs': 'Anti-Blur · Pro',
  'record-anti-blur-legacy.mjs': 'Anti-Blur · Legacy',
  'record-upscale.mjs': 'Ready to Print (2× & 4×)',
  'record-vectorizer.mjs': 'Vectorizer',
  'record-dress-to-design-advanced.mjs': 'Dress to Design · Advanced',
  'record-dress-to-design-fine.mjs': 'Dress to Design · Fine Detail',
  'record-color-transfer.mjs': 'Color Transfer',
  'record-color-layering.mjs': 'Color Layering (+ Photopea)',
  'record-repeat-set.mjs': 'Repeat Set (+ seamless proof)',
  'record-repeat-checker.mjs': 'Seamless Checker',
  'record-embroidery.mjs': 'Embroidery Effect',
  'record-3d-effect.mjs': '3D Effect',
}
const prettyName = (f) =>
  SCRIPT_NAMES[f] || f.replace(/^record-/, '').replace(/\.mjs$/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const listScripts = () =>
  // record-intro-outro is driven by its own Intro/Outro tab, not the tool runner.
  fs.readdirSync(DEMO_DIR).filter((f) => /^record-.*\.mjs$/.test(f) && f !== 'record-intro-outro.mjs').sort()
    .map((f) => ({ file: f, name: prettyName(f) }))

// Option env keys forwarded from query string to the spawned script (intro/outro).
const CARD_ENV_KEYS = ['CARD_LAYOUT', 'CARD_BG', 'CARD_BG_IMAGE', 'CARD_BG_COLOR', 'CARD_LOGO', 'CARD_SOCIAL', 'INTRO_TITLE', 'INTRO_SUBTITLE', 'INTRO_SEC', 'OUTRO_TITLE', 'OUTRO_SUBTITLE', 'OUTRO_SEC']
const fontEnv = () => ({
  FONT_REGULAR: FONT_PATHS.ui,
  FONT_BOLD: FONT_PATHS.uib,
  FONT_SYMBOL: FONT_PATHS.sym,
})

const listImages = (sub = '') => {
  const root = path.resolve(INPUT_ROOT, sub || '')
  if (!root.startsWith(INPUT_ROOT) || !fs.existsSync(root)) return []
  const out = []
  const walk = (d) => {
    let es = []
    try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of es) {
      if (e.name.startsWith('.')) continue
      if (e.name === '.thumbs') continue
      const ab = path.join(d, e.name)
      if (e.isDirectory()) walk(ab)
      else if (IMG_RE.test(e.name) && !/^logo-/.test(e.name)) out.push(path.relative(DEMO_DIR, ab).replace(/\\/g, '/'))
    }
  }
  walk(root)
  return out.sort()
}

const sanitize = (s) => s.replace(/[^a-z0-9._-]+/gi, '_')

// Every produced .mp4 under output/ — the run history (newest first). Social-cut
// variants (-9x16/-1x1/-16x9) are flagged so the UI can fold them under the main.
const listHistory = () => {
  const out = []
  const walk = (d) => {
    if (!fs.existsSync(d)) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const ab = path.join(d, e.name)
      if (e.isDirectory()) walk(ab)
      else if (/\.mp4$/i.test(e.name)) {
        const st = fs.statSync(ab)
        // relOut e.g. anti-blur-pro/run_2026-.../videos/foo.mp4 -> group by the
        // top-level tool folder, surface the run_{id} segment for display.
        const relOut = path.relative(OUTPUT, ab).replace(/\\/g, '/')
        const parts = relOut.split('/')
        out.push({
          path: path.relative(DEMO_DIR, ab).replace(/\\/g, '/'),
          name: e.name,
          tool: parts[0] || 'output',
          run: (parts.find((p) => p.startsWith('run_')) || '').replace(/^run_/, ''),
          mtime: st.mtimeMs,
          mb: +(st.size / 1e6).toFixed(1),
          social: /-(9x16|1x1|16x9)\.mp4$/i.test(e.name),
        })
      }
    }
  }
  walk(OUTPUT)
  return out.sort((a, b) => b.mtime - a.mtime)
}
const extFromType = (ct) =>
  ({ 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[ct.split(';')[0].trim().toLowerCase()] || '')

function sendJson(res, obj, code = 200) {
  const b = Buffer.from(JSON.stringify(obj))
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': b.length })
  res.end(b)
}

function serveFile(res, file, type) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found') }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length })
    res.end(data)
  })
}

const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Demo Studio · Textile Designer AI</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root{
    --ink:#0c0e12;--panel:#11141b;--card:#161a22;--card2:#1b2029;
    --line:#262d39;--line2:#333c4b;--fg:#eef1f5;--mut:#8b95a4;
    --acc:#5bd6a0;--acc-d:#2f7d54;--clay:#e2a06a;
    --mono:'JetBrains Mono',ui-monospace,Consolas,monospace;
    --shadow:0 14px 44px rgba(0,0,0,.42);
  }
  *{box-sizing:border-box}
  body{margin:0;color:var(--fg);background:var(--ink);
    font:15px/1.55 'Hanken Grotesk',system-ui,sans-serif;-webkit-font-smoothing:antialiased;
    background-image:radial-gradient(900px 600px at 12% -8%,rgba(91,214,160,.10),transparent 60%),
      radial-gradient(800px 600px at 100% 0%,rgba(226,160,106,.08),transparent 55%),
      radial-gradient(700px 700px at 80% 110%,rgba(47,125,84,.10),transparent 60%);
    background-attachment:fixed}
  body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;opacity:.5;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E")}
  .app{position:relative;z-index:1;display:grid;grid-template-columns:248px 1fr;min-height:100vh}
  /* sidebar */
  .rail{position:sticky;top:0;align-self:start;height:100vh;display:flex;flex-direction:column;gap:6px;
    padding:22px 16px;background:linear-gradient(180deg,rgba(18,21,28,.9),rgba(12,14,18,.9));
    border-right:1px solid var(--line);backdrop-filter:blur(6px)}
  .brand{display:flex;align-items:center;gap:11px;padding:6px 8px 18px}
  .brand img{width:38px;height:38px;border-radius:9px;object-fit:cover;box-shadow:0 3px 12px rgba(0,0,0,.5)}
  .brand .wm{font-family:'Fraunces',serif;font-weight:600;font-size:20px;letter-spacing:.2px;line-height:1.05}
  .brand .wm small{display:block;font-family:'Hanken Grotesk';font-weight:500;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);margin-top:3px}
  .nav{display:flex;align-items:center;gap:11px;width:100%;text-align:left;cursor:pointer;
    background:transparent;color:var(--mut);border:1px solid transparent;border-radius:11px;
    padding:11px 13px;font-size:14.5px;font-weight:600;transition:.15s}
  .nav .ic{font-size:16px;width:20px;text-align:center}
  .nav:hover{color:var(--fg);background:rgba(255,255,255,.03)}
  .nav.on{color:var(--ink);background:linear-gradient(180deg,var(--acc),#46c08c);border-color:transparent;box-shadow:0 6px 18px rgba(91,214,160,.22)}
  .rail-foot{margin-top:auto;padding-top:16px;border-top:1px solid var(--line)}
  .rail-foot .lab{font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--mut);margin:0 0 7px 2px}
  /* main */
  .stage{padding:34px 40px 60px;max-width:1180px}
  .stage>*{animation:rise .5s cubic-bezier(.2,.7,.2,1) both}
  .stage>*:nth-child(2){animation-delay:.05s}.stage>*:nth-child(3){animation-delay:.1s}
  .stage>*:nth-child(4){animation-delay:.15s}.stage>*:nth-child(5){animation-delay:.2s}
  @keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  .head{margin:0 0 26px}
  .head h1{font-family:'Fraunces',serif;font-weight:600;font-size:30px;letter-spacing:.2px;margin:0}
  .head .sub{color:var(--mut);margin:5px 0 0;font-size:14px}
  .sub{color:var(--mut)}
  /* card */
  .card{position:relative;background:linear-gradient(180deg,var(--card),var(--ink));
    border:1px solid var(--line);border-radius:16px;padding:18px 20px;margin-bottom:16px;box-shadow:var(--shadow)}
  .card>label,.card>.clabel{display:block;font-family:'Fraunces',serif;font-weight:600;font-size:15.5px;letter-spacing:.2px;margin-bottom:11px;color:var(--fg)}
  label{display:block;font-weight:600;margin-bottom:8px}
  /* controls */
  select,button,input,textarea{font:inherit;color:var(--fg)}
  select{width:100%;padding:11px 12px;border-radius:11px;background:var(--card2);color:var(--fg);border:1px solid var(--line2);cursor:pointer}
  select:focus,input:focus,textarea:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 3px rgba(91,214,160,.14)}
  input[type=text],input[type=number],textarea{width:100%;padding:10px 12px;border-radius:11px;background:var(--card2);color:var(--fg);border:1px solid var(--line2);margin-bottom:8px}
  textarea{resize:vertical;font:inherit}
  .field{margin-bottom:10px} .field:last-child{margin-bottom:0}
  .field .lab{font-weight:500;color:var(--mut);font-size:12px;margin-bottom:4px}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .inline{display:flex;align-items:center;gap:8px;margin:0}.inline input{width:90px;margin:0}
  .row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  /* image select grid (run inputs) */
  .imgs{display:grid;grid-template-columns:repeat(auto-fill,minmax(124px,1fr));gap:12px;margin-top:12px}
  .thumb{position:relative;border:2px solid var(--line2);border-radius:12px;overflow:hidden;cursor:pointer;background:var(--card2);transition:.14s}
  .thumb:hover{transform:translateY(-2px);border-color:var(--acc)}
  .thumb img{width:100%;height:96px;object-fit:cover;display:block}
  .thumb.sel{border-color:var(--acc);box-shadow:0 0 0 3px rgba(91,214,160,.2)}
  .thumb .nm{font:11px var(--mono);color:var(--mut);padding:5px 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .thumb .ck{position:absolute;top:7px;left:7px;width:22px;height:22px;border-radius:50%;background:#000a;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:12px;opacity:0;transition:.12s}
  .thumb.sel .ck{opacity:1;background:var(--acc);color:var(--ink);border-color:var(--acc)}
  /* buttons */
  button.run{background:linear-gradient(180deg,var(--acc),#42bd87);color:#06231a;border:0;padding:12px 28px;border-radius:12px;font-weight:700;font-size:14.5px;cursor:pointer;box-shadow:0 8px 22px rgba(91,214,160,.25);transition:.15s}
  button.run:hover{filter:brightness(1.06);transform:translateY(-1px)}
  button.run:disabled{opacity:.45;cursor:default;box-shadow:none;transform:none;filter:none}
  .ghost{background:var(--card2);color:var(--fg);border:1px solid var(--line2);padding:9px 15px;border-radius:11px;cursor:pointer;font-weight:600;transition:.14s}
  .ghost:hover{border-color:var(--acc);color:var(--fg)}
  pre{background:#080a0e;border:1px solid var(--line);border-radius:12px;padding:15px;max-height:340px;overflow:auto;font:12px/1.55 var(--mono);color:#a9e7c8;white-space:pre-wrap}
  .results{margin-top:12px;display:flex;flex-wrap:wrap}
  .results a{display:inline-flex;align-items:center;gap:5px;margin:6px 10px 0 0;color:var(--acc);text-decoration:none;font-weight:600;font-size:13px}
  .results a:hover{text-decoration:underline}
  input[type=file]{display:none}
  /* breadcrumb + browser */
  .crumb{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:14px}
  .crumb a{color:var(--acc);cursor:pointer;text-decoration:none;font-weight:600}
  .crumb a:hover{text-decoration:underline}
  .crumb .sep{color:var(--mut)}
  .crumb .here{color:var(--fg);font-family:var(--mono);font-size:13px}
  .browse{display:grid;grid-template-columns:repeat(auto-fill,minmax(212px,1fr));gap:16px}
  .tile{position:relative;background:linear-gradient(180deg,var(--card),var(--ink));border:1px solid var(--line);border-radius:14px;overflow:hidden;cursor:pointer;transition:.14s}
  .tile:hover{border-color:var(--acc);transform:translateY(-3px);box-shadow:var(--shadow)}
  .tile .pv{position:relative;height:142px;background:#080a0e;display:flex;align-items:center;justify-content:center}
  .tile .pv img{width:100%;height:100%;object-fit:cover;display:block}
  .tile.folder .pv{background:radial-gradient(120px 80px at 50% 38%,rgba(226,160,106,.16),transparent 70%)}
  .tile.folder .pv .fic{font-size:58px;line-height:1;filter:drop-shadow(0 5px 10px #0009)}
  .tile .badge{position:absolute;left:9px;bottom:9px;background:#000c;border:1px solid var(--line2);border-radius:7px;font:11px var(--mono);padding:2px 8px;color:#fff}
  .tile .play{position:absolute;top:0;left:0;right:0;height:142px;display:flex;align-items:center;justify-content:center;font-size:36px;color:#fff;text-shadow:0 2px 12px #000;opacity:.85;pointer-events:none;transition:.14s}
  .tile:hover .play{opacity:1;transform:scale(1.08)}
  .tile .cap{padding:10px 11px 2px;font:12px var(--mono);color:#dbe6df;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tile .sub2{padding:0 11px 10px;color:var(--mut);font-size:11px}
  .empty{color:var(--mut);padding:24px 0}
  .presetGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
  .preset{background:var(--card2);border:1px solid var(--line2);border-radius:12px;padding:10px;cursor:pointer;transition:.12s}
  .preset:hover{border-color:var(--acc)}
  .preset.on{border-color:var(--acc);box-shadow:0 0 0 2px rgba(91,214,160,.2)}
  .preset .ttl{font-size:12px;font-weight:700;margin-bottom:7px}
  .pvMini{height:78px;border-radius:9px;border:1px solid #2c3442;position:relative;overflow:hidden;background:linear-gradient(140deg,#163153,#2f6a4a)}
  .pvMini.solid{background:#26425b}
  .pvMini.image{background:linear-gradient(135deg,#3a2e5d,#7a4b6f)}
  .pvMini .logo{position:absolute;top:8px;left:8px;width:16px;height:16px;border-radius:4px;background:#fff}
  .pvMini .line{position:absolute;left:10px;right:10px;height:6px;border-radius:99px;background:#ffffffb5}
  .pvMini .line.sub{background:#d7e4d8a8;height:5px}
  .pvMini.classic .line.t{top:28px}.pvMini.classic .line.sub{top:40px}
  .pvMini.center .line.t{top:34px}.pvMini.center .line.sub{top:46px}
  .pvMini.lower-third .line.t{top:52px}.pvMini.lower-third .line.sub{top:63px}
  .pvMini.split .line.t{top:26px;left:55%}.pvMini.split .line.sub{top:38px;left:55%}
  .cardPreview{height:160px;border-radius:12px;border:1px solid var(--line2);position:relative;overflow:hidden}
  .cardPreview.grad{background:linear-gradient(145deg,#14294a,#2f6a4a)}
  .cardPreview.solid{background:#26425b}
  .cardPreview.image{background:linear-gradient(135deg,#3a2e5d,#7a4b6f)}
  .cardPreview .lg{position:absolute;top:12px;left:12px;width:28px;height:28px;border-radius:7px;background:#fff}
  .cardPreview .tx{position:absolute;left:16px;right:16px;color:#fff}
  .cardPreview .tx.t{font-weight:700;font-size:18px}
  .cardPreview .tx.s{font-size:13px;color:#d4e6d8}
  .cardPreview.classic .tx.t{top:58px}.cardPreview.classic .tx.s{top:84px}
  .cardPreview.center .tx.t{top:68px;text-align:center}.cardPreview.center .tx.s{top:92px;text-align:center}
  .cardPreview.lower-third .tx.t{top:102px}.cardPreview.lower-third .tx.s{top:124px}
  .cardPreview.split .tx.t{top:56px;left:54%}.cardPreview.split .tx.s{top:82px;left:54%}
</style></head><body>
<div class="app">
  <aside class="rail">
    <div class="brand"><img src="/file/assets/logo-main.png" alt=""><div class="wm">Demo Studio<small>Textile Designer AI</small></div></div>
    <button class="nav on" id="tabRun"><span class="ic">⦿</span> Record</button>
    <button class="nav" id="tabCards"><span class="ic">▣</span> Intro/Outro</button>
    <button class="nav" id="tabHist"><span class="ic">▦</span> Library</button>
    <div class="rail-foot">
      <div class="lab">Target site</div>
      <select id="site">
        <option value="prod" selected>Production · textile-designer.ai</option>
        <option value="dev">Local dev · localhost:3000</option>
      </select>
    </div>
  </aside>
  <main class="stage">
  <div id="runView">
    <div class="head"><h1>Record a demo</h1><p class="sub">Pick a tool, choose input image(s), and capture a branded demo - run on each one by one.</p></div>
    <div class="card"><label>Tool</label><select id="script"></select></div>
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <label style="margin:0">Input images <span class="sub" id="selcount"></span></label>
        <div class="row" style="gap:8px"><button class="ghost" id="upBtn">⬆ Up</button><button class="ghost" id="mkBtn">+ Folder</button><button class="ghost" id="urlBtn">Fetch URLs</button><button class="ghost" id="addBtn">+ Upload</button></div>
        <input type="file" id="file" accept="image/*" multiple>
      </div>
      <div id="inCrumb" class="crumb" style="margin:8px 0 0"></div>
      <textarea id="urls" placeholder="Paste image URL(s), one per line" style="margin-top:10px"></textarea>
      <div class="imgs" id="imgs"></div>
    </div>
    <div class="card">
      <label>Target image <span class="sub">(color_transfer only)</span></label>
      <select id="target"></select>
    </div>
    <div class="card">
      <div class="row">
        <label style="margin:0"><input type="checkbox" id="headless"> headless (no window)</label>
        <label style="margin:0">Browser
          <select id="browser" style="width:auto;min-width:130px;margin-left:6px">
            <option value="auto" selected>Auto</option>
            <option value="chrome">Chrome</option>
            <option value="chromium">Chromium</option>
          </select>
        </label>
        <button class="ghost" id="loginBtn">Login in Chrome first</button>
        <button class="run" id="run">Run on selected images</button>
        <span id="status" class="sub"></span>
      </div>
      <div class="row" style="margin-top:10px">
        <label style="margin:0">Caption <input id="socialCaption" type="text" placeholder="Optional burned-in caption"></label>
        <label style="margin:0">Brand <input id="socialBrand" type="text" placeholder="Optional brand text"></label>
      </div>
      <pre id="log" style="margin-top:14px;display:none"></pre>
      <div class="results" id="results"></div>
    </div>
  </div>
  <div id="cardsView" style="display:none">
    <div class="head"><h1>Intro / Outro Cards</h1><p class="sub">Render standalone branded cards with layout/background controls.</p></div>
    <div class="card">
      <div class="field">
        <div class="lab">Layout presets (visual)</div>
        <div class="presetGrid" id="layoutPresets">
          <button class="preset" data-for="cardLayout" data-value="classic"><div class="ttl">Classic</div><div class="pvMini classic"><div class="logo"></div><div class="line t"></div><div class="line sub"></div></div></button>
          <button class="preset" data-for="cardLayout" data-value="center"><div class="ttl">Center</div><div class="pvMini center"><div class="logo"></div><div class="line t"></div><div class="line sub"></div></div></button>
          <button class="preset" data-for="cardLayout" data-value="lower-third"><div class="ttl">Lower Third</div><div class="pvMini lower-third"><div class="logo"></div><div class="line t"></div><div class="line sub"></div></div></button>
          <button class="preset" data-for="cardLayout" data-value="split"><div class="ttl">Split</div><div class="pvMini split"><div class="logo"></div><div class="line t"></div><div class="line sub"></div></div></button>
        </div>
      </div>
      <div class="field" style="margin-top:10px">
        <div class="lab">Background style (visual)</div>
        <div class="presetGrid" id="bgPresets">
          <button class="preset" data-for="cardBg" data-value="gradient"><div class="ttl">Gradient</div><div class="pvMini"></div></button>
          <button class="preset" data-for="cardBg" data-value="solid"><div class="ttl">Solid</div><div class="pvMini solid"></div></button>
          <button class="preset" data-for="cardBg" data-value="image"><div class="ttl">Image</div><div class="pvMini image"></div></button>
        </div>
      </div>
      <select id="cardLayout" style="display:none"><option value="classic">Classic</option><option value="center">Center</option><option value="lower-third">Lower Third</option><option value="split">Split</option></select>
      <select id="cardBg" style="display:none"><option value="gradient">Gradient</option><option value="solid">Solid</option><option value="image">Image</option></select>
      <div class="two">
        <div class="field"><div class="lab">Solid color (hex)</div><input id="cardBgColor" type="text" value="14294a"></div>
        <div class="field"><div class="lab">Background image path</div><input id="cardBgImage" type="text" placeholder="assets/your-image.jpg"></div>
      </div>
      <div class="two">
        <div class="field"><div class="lab">Audience preset</div><select id="audiencePreset">
          <option value="general">General marketing</option>
          <option value="designer">Textile / fashion designer</option>
          <option value="agency">Design agency / studio</option>
          <option value="print">Print house / production</option>
          <option value="brand">Brand / e-commerce team</option>
          <option value="freelancer">Freelancer / solo creator</option>
          <option value="enterprise">Enterprise / operations team</option>
        </select></div>
        <div class="field"><div class="lab">Preset tone</div><select id="presetTone">
          <option value="premium">Premium</option>
          <option value="bold">Bold</option>
          <option value="minimal">Minimal</option>
        </select></div>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="ghost" id="applyPreset">Apply messaging preset</button>
        <span class="sub">Fills intro/outro title + subtitle for the selected audience.</span>
      </div>
      <div class="two">
        <div class="field"><div class="lab">Intro title</div><input id="introTitle" type="text" value="Textile Designer AI"></div>
        <div class="field"><div class="lab">Intro subtitle</div><input id="introSubtitle" type="text" value="AI tools for textile & fashion design"></div>
      </div>
      <div class="two">
        <div class="field"><div class="lab">Outro title</div><input id="outroTitle" type="text" value="Visit textile-designer.ai"></div>
        <div class="field"><div class="lab">Outro subtitle</div><input id="outroSubtitle" type="text" value="Start creating today"></div>
      </div>
      <div class="row">
        <label class="inline">Intro sec <input id="introSec" type="number" step="0.1" value="3"></label>
        <label class="inline">Outro sec <input id="outroSec" type="number" step="0.1" value="3.6"></label>
        <label style="margin:0"><input type="checkbox" id="cardLogo" checked> show logo</label>
        <label style="margin:0"><input type="checkbox" id="cardSocial"> social cuts</label>
        <button class="run" id="runCards">Render intro/outro</button>
        <span id="cardsStatus" class="sub"></span>
      </div>
      <div class="field" style="margin-top:10px">
        <div class="lab">Live preview</div>
        <div class="two">
          <div id="introPreview" class="cardPreview grad classic"><div class="lg"></div><div class="tx t">Textile Designer AI</div><div class="tx s">AI tools for textile & fashion design</div></div>
          <div id="outroPreview" class="cardPreview grad classic"><div class="lg"></div><div class="tx t">Visit textile-designer.ai</div><div class="tx s">Start creating today</div></div>
        </div>
      </div>
      <pre id="cardsLog" style="margin-top:14px;display:none"></pre>
      <div class="results" id="cardsResults"></div>
    </div>
  </div>
  <div id="historyView" style="display:none">
    <div class="head"><h1>Library</h1><p class="sub">Every run, foldered by tool. Open a tool for all its videos, or switch to the nested folder view.</p></div>
    <div class="row" style="justify-content:space-between;margin-bottom:14px">
      <div id="crumb" class="crumb"></div>
      <div class="row" style="gap:8px"><button class="ghost" id="histMode"></button><button class="ghost" id="histRefresh">Refresh</button></div>
    </div>
    <div id="hist"></div>
  </div>
  </main>
</div>
<script>
const $=s=>document.querySelector(s); let images=[]; const sel=new Set(); let inPath='';
const COPY_PRESETS={
  general:{
    premium:{intro:['Textile Designer AI','Create production-ready visuals in minutes'],outro:['Visit textile-designer.ai','AI tools for textile and fashion teams']},
    bold:{intro:['From idea to print-ready fast','AI-powered textile design workflow'],outro:['Ship better designs faster','Start at textile-designer.ai']},
    minimal:{intro:['Textile Designer AI','Design faster with AI'],outro:['textile-designer.ai','Try it today']}
  },
  designer:{
    premium:{intro:['For Textile Designers','From concept to print-ready quality'],outro:['Design with speed and control','Create at textile-designer.ai']},
    bold:{intro:['Stop fixing low-res art manually','Upscale, clean, and recolor in seconds'],outro:['Design more, edit less','Start now at textile-designer.ai']},
    minimal:{intro:['For Textile Designers','Print-ready in seconds'],outro:['textile-designer.ai','Built for daily design work']}
  },
  agency:{
    premium:{intro:['For Design Studios','Deliver polished client options faster'],outro:['Win approvals sooner','Scale at textile-designer.ai']},
    bold:{intro:['More client variations, less turnaround','AI workflows for studio teams'],outro:['Ship campaigns faster','Visit textile-designer.ai']},
    minimal:{intro:['For Agencies','Faster iterations, cleaner output'],outro:['textile-designer.ai','Ready for client delivery']}
  },
  print:{
    premium:{intro:['For Print & Production Teams','Consistent quality before press'],outro:['Reduce rework and delays','Operate with textile-designer.ai']},
    bold:{intro:['No more blurry customer artwork','Auto-fix for print in seconds'],outro:['Keep production moving','Start at textile-designer.ai']},
    minimal:{intro:['For Print Teams','Cleaner files, faster approvals'],outro:['textile-designer.ai','Built for production']}
  },
  brand:{
    premium:{intro:['For Brand and E-commerce Teams','Launch more collections with consistent visuals'],outro:['Scale brand creative output','Try textile-designer.ai']},
    bold:{intro:['Create campaign-ready assets fast','AI tools for modern brand teams'],outro:['Move from brief to publish faster','Visit textile-designer.ai']},
    minimal:{intro:['For Brand Teams','More assets, less effort'],outro:['textile-designer.ai','Start creating now']}
  },
  freelancer:{
    premium:{intro:['For Freelancers','Deliver premium quality at freelance speed'],outro:['Win more projects with faster delivery','Start at textile-designer.ai']},
    bold:{intro:['Turn one concept into many outputs','AI-powered workflow for solo creators'],outro:['Create, iterate, deliver','Visit textile-designer.ai']},
    minimal:{intro:['For Freelancers','Fast edits, pro results'],outro:['textile-designer.ai','Built for solo creators']}
  },
  enterprise:{
    premium:{intro:['For Enterprise Teams','Standardized quality across design operations'],outro:['Scale creative operations','Explore textile-designer.ai']},
    bold:{intro:['Automate repetitive design production','AI workflows for high-volume teams'],outro:['Increase throughput with consistency','Start at textile-designer.ai']},
    minimal:{intro:['For Enterprise Teams','Consistent output at scale'],outro:['textile-designer.ai','Designed for operations']}
  },
};
function applyAudiencePreset(){
  const a=$('#audiencePreset').value||'general';
  const t=$('#presetTone').value||'premium';
  const p=(COPY_PRESETS[a]&&COPY_PRESETS[a][t])||COPY_PRESETS.general.premium;
  $('#introTitle').value=p.intro[0];
  $('#introSubtitle').value=p.intro[1];
  $('#outroTitle').value=p.outro[0];
  $('#outroSubtitle').value=p.outro[1];
  renderCardPreview();
}
function syncPresetButtons(groupId, selectId){
  const val=$(selectId).value;
  document.querySelectorAll(groupId+' .preset').forEach(b=>b.classList.toggle('on', b.dataset.value===val));
}
function renderCardPreview(){
  const layout=$('#cardLayout').value, bg=$('#cardBg').value, showLogo=$('#cardLogo').checked;
  const map={gradient:'grad',solid:'solid',image:'image'};
  const apply=(id,title,sub)=>{
    const el=$(id); if(!el) return;
    el.className='cardPreview '+(map[bg]||'grad')+' '+layout;
    el.querySelector('.tx.t').textContent=title;
    el.querySelector('.tx.s').textContent=sub;
    const lg=el.querySelector('.lg'); if(lg) lg.style.display=showLogo?'':'none';
  };
  apply('#introPreview',$('#introTitle').value||'Intro Title',$('#introSubtitle').value||'Intro subtitle');
  apply('#outroPreview',$('#outroTitle').value||'Outro Title',$('#outroSubtitle').value||'Outro subtitle');
}
async function load(){
  const r=await (await fetch('/api/list')).json();
  $('#script').innerHTML=r.scripts.map(s=>'<option value="'+s.file+'">'+s.name+'</option>').join('');
  images=r.images;
  $('#target').innerHTML='<option value="">(none)</option>'+images.map(p=>'<option>'+p+'</option>').join('');
  browseInputs('');
  document.querySelectorAll('.preset').forEach((b)=>b.onclick=()=>{const tgt='#'+b.dataset.for;$(tgt).value=b.dataset.value;syncPresetButtons('#layoutPresets','#cardLayout');syncPresetButtons('#bgPresets','#cardBg');renderCardPreview();});
  ['#cardLayout','#cardBg','#introTitle','#introSubtitle','#outroTitle','#outroSubtitle','#cardLogo'].forEach((id)=>$(id).addEventListener('input',renderCardPreview));
  $('#applyPreset').onclick=applyAudiencePreset;
  $('#audiencePreset').onchange=applyAudiencePreset;
  $('#presetTone').onchange=applyAudiencePreset;
  syncPresetButtons('#layoutPresets','#cardLayout');
  syncPresetButtons('#bgPresets','#cardBg');
  applyAudiencePreset();
  renderCardPreview();
}
function drawInputCrumbs(){
  const parts=inPath?inPath.split('/'):[];
  let acc='', html='<a data-p="">🏠 assets</a>';
  parts.forEach((seg,i)=>{acc=acc?acc+'/'+seg:seg;const last=i===parts.length-1;html+='<span class="sep">›</span>'+(last?'<span class="here">'+seg+'</span>':'<a data-p="'+acc+'">'+seg+'</a>');});
  $('#inCrumb').innerHTML=html;
  document.querySelectorAll('#inCrumb a').forEach(a=>a.onclick=()=>browseInputs(a.dataset.p||''));
}
function renderImgs(list=[]){
  $('#imgs').innerHTML=list.map(p=>{
    const on=sel.has(p);
    return '<div class="thumb'+(on?' sel':'')+'" data-p="'+p+'"><div class="ck">'+(on?'✓':'')+'</div>'+
      '<img src="/file/'+encodeURIComponent(p)+'"><div class="nm">'+p.split('/').pop()+'</div></div>';
  }).join('');
  document.querySelectorAll('.thumb').forEach(t=>t.onclick=()=>{const p=t.dataset.p;sel.has(p)?sel.delete(p):sel.add(p);renderImgs();upd();});
  upd();
}
async function browseInputs(p=''){
  inPath=p||'';
  const r=await (await fetch('/api/input-browse?p='+encodeURIComponent(inPath))).json();
  drawInputCrumbs();
  const files=(r.files||[]).map(f=>f.path);
  const folders=(r.dirs||[]).map(d=>'<div class="thumb" data-d="'+d.path+'" title="'+d.count+' images"><div class="ck" style="opacity:1;background:#2f6fed;color:#fff;border-color:#2f6fed">📁</div><img src="/file/assets/logo-main.png"><div class="nm">'+d.name+' ('+d.count+')</div></div>');
  const imgs=files.map(p=>{const on=sel.has(p);return '<div class="thumb'+(on?' sel':'')+'" data-p="'+p+'"><div class="ck">'+(on?'✓':'')+'</div><img src="/file/'+encodeURIComponent(p)+'"><div class="nm">'+p.split('/').pop()+'</div></div>'});
  $('#imgs').innerHTML=[...folders,...imgs].join('');
  document.querySelectorAll('.thumb[data-d]').forEach(t=>t.onclick=()=>browseInputs(t.dataset.d));
  document.querySelectorAll('.thumb[data-p]').forEach(t=>t.onclick=()=>{const p=t.dataset.p;sel.has(p)?sel.delete(p):sel.add(p);browseInputs(inPath);upd();});
  upd();
}
function upd(){$('#selcount').textContent=sel.size?('· '+sel.size+' selected'):'';$('#run').disabled=!sel.size;}
$('#upBtn').onclick=()=>{if(!inPath)return;const p=inPath.split('/');p.pop();browseInputs(p.join('/'));};
$('#mkBtn').onclick=async()=>{
  const name=prompt('New folder name');
  if(!name)return;
  const r=await (await fetch('/api/input-mkdir',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({parent:inPath,name})})).json();
  if(!r.ok&&r.error) alert(r.error);
  browseInputs(inPath);
};
$('#addBtn').onclick=()=>$('#file').click();
$('#file').onchange=async e=>{
  for(const f of e.target.files){
    const b64=await new Promise(res=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.readAsDataURL(f);});
    const uploadDir=inPath||'uploads';
    const r=await (await fetch('/api/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.name,b64,dir:uploadDir})})).json();
    if(r.path){images.push(r.path);sel.add(r.path);}
  }
  $('#target').innerHTML='<option value="">(none)</option>'+images.map(p=>'<option>'+p+'</option>').join('');
  browseInputs(inPath);
};
$('#urlBtn').onclick=async()=>{
  const urls=$('#urls').value.split(/\\s+/).map(s=>s.trim()).filter(Boolean);
  if(!urls.length)return;
  $('#urlBtn').disabled=true;$('#urlBtn').textContent='Fetching…';
  try{
    const fetchDir=inPath||'uploads';
    const r=await (await fetch('/api/fetch-url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({urls,dir:fetchDir})})).json();
    (r.paths||[]).forEach(p=>{if(!images.includes(p))images.push(p);sel.add(p);});
    if(r.errors&&r.errors.length)alert('Could not fetch:\\n'+r.errors.join('\\n'));
    $('#urls').value='';
    $('#target').innerHTML='<option value="">(none)</option>'+images.map(p=>'<option>'+p+'</option>').join('');
    browseInputs(inPath);
  }catch(e){alert('Fetch failed: '+e);}
  $('#urlBtn').disabled=false;$('#urlBtn').textContent='Fetch URLs';
};
$('#loginBtn').onclick=async()=>{
  const site=$('#site').value;
  const r=await (await fetch('/api/login-chrome?site='+encodeURIComponent(site))).json();
  if(!r.ok) alert(r.error||'Could not open Chrome');
};
$('#run').onclick=()=>{
  const script=$('#script').value, imgs=[...sel].join(','), headless=$('#headless').checked?'1':'', target=$('#target').value, site=$('#site').value, browser=$('#browser').value;
  const socialCaption=$('#socialCaption').value||'';
  const socialBrand=$('#socialBrand').value||'';
  $('#log').style.display='block';$('#log').textContent='';$('#results').innerHTML='';$('#run').disabled=true;$('#status').textContent='running…';
  const es=new EventSource('/run?script='+encodeURIComponent(script)+'&images='+encodeURIComponent(imgs)+'&headless='+headless+'&target='+encodeURIComponent(target)+'&site='+site+'&browser='+encodeURIComponent(browser)+'&socialCaption='+encodeURIComponent(socialCaption)+'&socialBrand='+encodeURIComponent(socialBrand));
  es.addEventListener('log',e=>{const l=JSON.parse(e.data).line;$('#log').textContent+=l+'\\n';$('#log').scrollTop=$('#log').scrollHeight;});
  es.addEventListener('video',e=>{const v=JSON.parse(e.data).path;$('#results').innerHTML+='<a href="/file/'+encodeURIComponent(v)+'" target="_blank">▶ '+v.split('/').pop()+'</a>';});
  es.addEventListener('done',e=>{es.close();$('#run').disabled=false;$('#status').textContent='done';browse(histPath);});
};
$('#runCards').onclick=()=>{
  const p=new URLSearchParams({
    CARD_LAYOUT:$('#cardLayout').value,
    CARD_BG:$('#cardBg').value,
    CARD_BG_COLOR:($('#cardBgColor').value||'').trim(),
    CARD_BG_IMAGE:($('#cardBgImage').value||'').trim(),
    CARD_LOGO:$('#cardLogo').checked?'1':'0',
    CARD_SOCIAL:$('#cardSocial').checked?'1':'0',
    INTRO_TITLE:$('#introTitle').value||'',
    INTRO_SUBTITLE:$('#introSubtitle').value||'',
    INTRO_SEC:$('#introSec').value||'3',
    OUTRO_TITLE:$('#outroTitle').value||'',
    OUTRO_SUBTITLE:$('#outroSubtitle').value||'',
    OUTRO_SEC:$('#outroSec').value||'3.6',
  });
  $('#cardsLog').style.display='block';$('#cardsLog').textContent='';$('#cardsResults').innerHTML='';$('#runCards').disabled=true;$('#cardsStatus').textContent='running…';
  const es=new EventSource('/run-cards?'+p.toString());
  es.addEventListener('log',e=>{const l=JSON.parse(e.data).line;$('#cardsLog').textContent+=l+'\\n';$('#cardsLog').scrollTop=$('#cardsLog').scrollHeight;});
  es.addEventListener('video',e=>{const v=JSON.parse(e.data).path;$('#cardsResults').innerHTML+='<a href="/file/'+encodeURIComponent(v)+'" target="_blank">▶ '+v.split('/').pop()+'</a>';});
  es.addEventListener('done',()=>{es.close();$('#runCards').disabled=false;$('#cardsStatus').textContent='done';browse(histPath);});
};
function tab(which){
  $('#tabRun').classList.toggle('on',which==='run');
  $('#tabCards').classList.toggle('on',which==='cards');
  $('#tabHist').classList.toggle('on',which==='hist');
  $('#runView').style.display=which==='run'?'':'none';
  $('#cardsView').style.display=which==='cards'?'':'none';
  $('#historyView').style.display=which==='hist'?'':'none';
  if(which==='hist')browse(histPath);
}
$('#tabRun').onclick=()=>tab('run');
$('#tabCards').onclick=()=>tab('cards');
$('#tabHist').onclick=()=>tab('hist');
$('#histRefresh').onclick=()=>browse(histPath,histMode);
$('#histMode').onclick=()=>browse(histPath,histMode==='flat'?'folders':'flat');
// Folder browser: navigate output/ like a file explorer. Opening a task type
// defaults to a flat "all videos" view; toggle to the nested folder view. Videos
// open in the OS default player; breadcrumb walks back up.
let histPath='', histMode='folders';
const fmt=t=>new Date(t).toLocaleString();
function crumbs(){
  const parts=histPath?histPath.split('/'):[];
  let acc='', html='<a data-p="">🏠 output</a>';
  parts.forEach((seg,i)=>{acc=acc?acc+'/'+seg:seg;const last=i===parts.length-1;
    html+='<span class="sep">›</span>'+(last?'<span class="here">'+seg+'</span>':'<a data-p="'+acc+'">'+seg+'</a>');});
  $('#crumb').innerHTML=html;
  document.querySelectorAll('#crumb a').forEach(a=>a.onclick=()=>browse(a.dataset.p));
}
async function browse(p,mode){
  histPath=p||'';
  // Root is always the tool folders. Otherwise default to flat (all videos) on
  // first open; an explicit mode (toggle/click) overrides.
  histMode = histPath==='' ? 'folders' : (mode || 'flat');
  const flat = histMode==='flat' && histPath!=='';
  $('#histMode').style.display = histPath==='' ? 'none' : '';
  $('#histMode').textContent = flat ? '🗂 Folder view' : '🎬 All videos';
  const r=await (await fetch('/api/browse?p='+encodeURIComponent(histPath)+'&flat='+(flat?'1':'0'))).json();
  crumbs();
  const folders=(r.dirs||[]).map(d=>{
    const pv=d.preview?'<img loading="lazy" src="/thumb?p='+encodeURIComponent(d.preview)+'">':'<span class="fic">📁</span>';
    const badge=d.count?'<span class="badge">'+d.count+' video'+(d.count===1?'':'s')+'</span>':'';
    return '<div class="tile folder" data-p="'+d.path+'"><div class="pv">'+pv+badge+'</div><div class="cap">'+d.name+'</div></div>';
  }).join('');
  const files=(r.files||[]).map(f=>{
    if(f.kind==='video') return '<div class="tile" data-open="'+encodeURIComponent(f.path)+'"><div class="pv"><img loading="lazy" src="/thumb?p='+encodeURIComponent(f.path)+'"></div><div class="play">▶</div><div class="cap" title="'+f.name+'">'+f.name+'</div><div class="sub2">'+fmt(f.mtime)+' · '+f.mb+' MB'+(f.run?' · '+f.run:'')+'</div></div>';
    return '<div class="tile" data-open="'+encodeURIComponent(f.path)+'"><div class="pv"><img loading="lazy" src="/file/'+encodeURIComponent(f.path)+'"></div><div class="cap" title="'+f.name+'">'+f.name+'</div></div>';
  }).join('');
  $('#hist').innerHTML=(folders||files)?('<div class="browse">'+folders+files+'</div>'):'<p class="empty">Nothing here yet.</p>';
  document.querySelectorAll('#hist .tile.folder').forEach(t=>t.onclick=()=>browse(t.dataset.p, histPath===''?'flat':histMode));
  document.querySelectorAll('#hist .tile[data-open]').forEach(t=>t.onclick=()=>fetch('/api/open?p='+t.dataset.open));
}
load();
</script></body></html>`

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(HTML) }
  if (url.pathname === '/api/list') return sendJson(res, { scripts: listScripts(), images: listImages() })
  if (url.pathname === '/api/input-browse') return sendJson(res, browseInputs(decodeURIComponent(url.searchParams.get('p') || '')))
  if (url.pathname === '/api/history') return sendJson(res, { videos: listHistory() })
  if (url.pathname === '/api/browse') return sendJson(res, browseDir(decodeURIComponent(url.searchParams.get('p') || ''), url.searchParams.get('flat') === '1'))
  if (url.pathname === '/api/open') {
    const abs = path.resolve(DEMO_DIR, decodeURIComponent(url.searchParams.get('p') || ''))
    if (!abs.startsWith(OUTPUT) || !fs.existsSync(abs)) { res.writeHead(404); return res.end('no') }
    try {
      // Launch in the OS default app (video player / image viewer), detached.
      const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', abs]]
        : process.platform === 'darwin' ? ['open', [abs]]
        : ['xdg-open', [abs]]
      spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref()
      return sendJson(res, { ok: true })
    } catch (e) { return sendJson(res, { error: String(e) }, 500) }
  }
  if (url.pathname === '/api/login-chrome') {
    const site = url.searchParams.get('site') || 'prod'
    const chrome = chromeExecutable()
    if (!chrome) return sendJson(res, { ok: false, error: 'Chrome not found. Set CHROME_PATH and retry.' }, 400)
    const isProd = site === 'prod'
    const profileDir = path.join(DEMO_DIR, isProd ? '.profile-prod' : '.profile')
    const openUrl = isProd ? 'https://textile-designer.ai/ai' : 'http://localhost:3000/ai'
    try {
      fs.mkdirSync(profileDir, { recursive: true })
      const args = [`--user-data-dir=${profileDir}`, openUrl]
      spawn(chrome, args, { detached: true, stdio: 'ignore' }).unref()
      return sendJson(res, { ok: true })
    } catch (e) {
      return sendJson(res, { ok: false, error: String(e) }, 500)
    }
  }
  if (url.pathname === '/thumb') {
    const rel = decodeURIComponent(url.searchParams.get('p') || '')
    const abs = path.resolve(DEMO_DIR, rel)
    if (!abs.startsWith(OUTPUT) || !abs.toLowerCase().endsWith('.mp4') || !fs.existsSync(abs)) { res.writeHead(404); return res.end('no') }
    const t = thumbFor(abs)
    if (t) return serveFile(res, t, 'image/jpeg')
    res.writeHead(404); return res.end('no')
  }
  if (url.pathname === '/api/upload' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try {
        const { name, b64, dir = 'uploads' } = JSON.parse(body)
        const relDir = String(dir).replace(/^[/\\]+/, '')
        const targetDir = path.resolve(INPUT_ROOT, relDir)
        if (!targetDir.startsWith(INPUT_ROOT)) return sendJson(res, { error: 'invalid dir' }, 400)
        fs.mkdirSync(targetDir, { recursive: true })
        const fn = Date.now() + '-' + sanitize(name || 'upload.png')
        fs.writeFileSync(path.join(targetDir, fn), Buffer.from(b64, 'base64'))
        sendJson(res, { path: path.relative(DEMO_DIR, path.join(targetDir, fn)).replace(/\\/g, '/') })
      } catch (e) { sendJson(res, { error: String(e) }, 400) }
    })
    return
  }
  if (url.pathname === '/api/input-mkdir' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try {
        const { parent = '', name = '' } = JSON.parse(body)
        const safeName = sanitize(String(name || '').trim())
        if (!safeName) return sendJson(res, { error: 'folder name required' }, 400)
        const parentDir = path.resolve(INPUT_ROOT, String(parent || '').replace(/^[/\\]+/, ''))
        if (!parentDir.startsWith(INPUT_ROOT)) return sendJson(res, { error: 'invalid parent' }, 400)
        const dir = path.join(parentDir, safeName)
        fs.mkdirSync(dir, { recursive: true })
        sendJson(res, { ok: true, path: path.relative(INPUT_ROOT, dir).replace(/\\/g, '/') })
      } catch (e) { sendJson(res, { error: String(e) }, 400) }
    })
    return
  }
  if (url.pathname === '/api/fetch-url' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', async () => {
      try {
        const { urls, dir = 'uploads' } = JSON.parse(body)
        const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean)
        const relDir = String(dir).replace(/^[/\\]+/, '')
        const targetDir = path.resolve(INPUT_ROOT, relDir)
        if (!targetDir.startsWith(INPUT_ROOT)) return sendJson(res, { error: 'invalid dir' }, 400)
        fs.mkdirSync(targetDir, { recursive: true })
        const paths = [], errors = []
        for (const u of list) {
          try {
            const resp = await fetch(u)
            if (!resp.ok) throw new Error('HTTP ' + resp.status)
            const ct = resp.headers.get('content-type') || ''
            const urlName = sanitize(decodeURIComponent((new URL(u).pathname.split('/').pop() || '')))
            if (ct && !ct.startsWith('image/') && !IMG_RE.test(urlName)) throw new Error('not an image (' + ct + ')')
            const buf = Buffer.from(await resp.arrayBuffer())
            const ext = extFromType(ct) || (IMG_RE.test(urlName) ? urlName.match(IMG_RE)[0] : '.png')
            const base = urlName.replace(IMG_RE, '') || 'url-image'
            const fn = Date.now() + '-' + base + ext
            const out = path.join(targetDir, fn)
            fs.writeFileSync(out, buf)
            paths.push(path.relative(DEMO_DIR, out).replace(/\\/g, '/'))
          } catch (e) { errors.push(`${u} -> ${e.message}`) }
        }
        sendJson(res, { paths, errors })
      } catch (e) { sendJson(res, { error: String(e) }, 400) }
    })
    return
  }
  if (url.pathname.startsWith('/file/')) {
    const rel = decodeURIComponent(url.pathname.slice('/file/'.length))
    const abs = path.resolve(DEMO_DIR, rel)
    if (!abs.startsWith(DEMO_DIR)) { res.writeHead(403); return res.end('no') }
    const type = abs.endsWith('.mp4') ? 'video/mp4' : abs.endsWith('.png') ? 'image/png' : abs.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
    return serveFile(res, abs, type)
  }
  if (url.pathname === '/run') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    const send = (ev, obj) => res.write(`event: ${ev}\ndata: ${JSON.stringify(obj)}\n\n`)
    const script = url.searchParams.get('script')
    const images = (url.searchParams.get('images') || '').split(',').filter(Boolean)
    const headless = url.searchParams.get('headless') === '1'
    const target = url.searchParams.get('target') || ''
    const site = url.searchParams.get('site') || 'dev'
    const browser = url.searchParams.get('browser') || 'auto'
    const socialCaption = url.searchParams.get('socialCaption') || ''
    const socialBrand = url.searchParams.get('socialBrand') || ''
    const siteEnv = site === 'prod'
      ? { BASE_URL: 'https://textile-designer.ai', PROFILE: path.join(DEMO_DIR, '.profile-prod') }
      : {}
    // Browser selection priority:
    // 1) explicit UI choice
    // 2) auto mode defaults to chrome on prod, otherwise inherit current env
    const browserEnv = browser === 'chrome' || browser === 'chromium'
      ? { BROWSER: browser }
      : (site === 'prod' ? { BROWSER: 'chrome' } : {})
    // Forward intro/outro card options (from the Intro/Outro tab) as env vars.
    const cardEnv = {}
    for (const k of CARD_ENV_KEYS) { const v = url.searchParams.get(k); if (v !== null && v !== '') cardEnv[k] = v }
    if (!script || !images.length) { send('done', {}); return res.end() }

    const runOne = (i) => {
      if (i >= images.length) { send('log', { line: '\n✓ all done' }); send('done', {}); return res.end() }
      const img = images[i]
      const suffix = sanitize(img.split('/').pop().replace(IMG_RE, ''))
      // One run_{id} folder per image run, shared by all of its artifacts.
      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
      const runId = suffix ? `${ts}-${suffix}` : ts
      send('log', { line: `\n=== ${script}  ←  ${img}  (run_${runId}) ===` })
      const child = spawn(process.execPath, [path.join(DEMO_DIR, script)], {
        cwd: DEMO_DIR,
        env: {
          ...process.env,
          ...siteEnv,
          ...browserEnv,
          ...fontEnv(),
          ...cardEnv,
          INPUT: img,
          DEMO_SUFFIX: suffix,
          DEMO_RUN_ID: runId,
          SOCIAL_CAPTION: socialCaption,
          SOCIAL_BRAND: socialBrand,
          ...(target ? { TARGET: target } : {}),
          ...(headless ? { HEADLESS: '1' } : {}),
        },
      })
      const onData = (buf) => buf.toString().split(/\r?\n/).forEach((l) => {
        if (!l) return
        send('log', { line: l })
        const m = l.match(/VIDEO:\s*(.+\.mp4)\s*$/)
        if (m) { const rel = path.relative(DEMO_DIR, m[1].trim()).replace(/\\/g, '/'); send('video', { path: rel }) }
      })
      child.stdout.on('data', onData)
      child.stderr.on('data', onData)
      child.on('close', (code) => { send('log', { line: `[exit ${code}]` }); runOne(i + 1) })
    }
    runOne(0)
    return
  }
  if (url.pathname === '/run-cards') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    const send = (ev, obj) => res.write(`event: ${ev}\ndata: ${JSON.stringify(obj)}\n\n`)
    const cardEnv = {}
    for (const k of CARD_ENV_KEYS) { const v = url.searchParams.get(k); if (v !== null && v !== '') cardEnv[k] = v }
    send('log', { line: '\n=== record-intro-outro.mjs ===' })
    const child = spawn(process.execPath, [path.join(DEMO_DIR, 'record-intro-outro.mjs')], {
      cwd: DEMO_DIR,
      env: { ...process.env, ...fontEnv(), ...cardEnv },
    })
    const onData = (buf) => buf.toString().split(/\r?\n/).forEach((l) => {
      if (!l) return
      send('log', { line: l })
      const m = l.match(/VIDEO:\s*(.+\.mp4)\s*$/)
      if (m) {
        const rel = path.relative(DEMO_DIR, m[1].trim()).replace(/\\/g, '/')
        send('video', { path: rel })
      }
    })
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('close', (code) => { send('log', { line: `[exit ${code}]` }); send('done', {}); res.end() })
    return
  }
  res.writeHead(404); res.end('not found')
})

server.listen(PORT, () => console.log(`Demo runner → http://localhost:${PORT}`))
