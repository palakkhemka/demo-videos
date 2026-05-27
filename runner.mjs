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
  'record-bg-remove2.mjs': 'Background Removal',
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

const listImages = () => {
  const root = fs.readdirSync(ASSETS).filter((f) => IMG_RE.test(f) && !/^logo-/.test(f)).map((f) => `assets/${f}`)
  const up = fs.existsSync(UPLOADS) ? fs.readdirSync(UPLOADS).filter((f) => IMG_RE.test(f)).map((f) => `assets/uploads/${f}`) : []
  return [...root, ...up]
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

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Demo Runner · Textile Designer AI</title>
<style>
  :root{--bg:#0d1b2a;--card:#15293f;--ink:#e8eef4;--mut:#9fb3c8;--acc:#3f7d54;--acc2:#2f6fed}
  *{box-sizing:border-box} body{margin:0;font:15px/1.5 Segoe UI,system-ui,sans-serif;background:linear-gradient(135deg,#0d1b2a,#13392c);color:var(--ink)}
  .wrap{max-width:1080px;margin:0 auto;padding:28px}
  h1{font-size:22px;margin:0 0 4px} .sub{color:var(--mut);margin:0 0 22px}
  .card{background:var(--card);border:1px solid #21405e;border-radius:14px;padding:18px;margin-bottom:18px}
  label{display:block;font-weight:600;margin-bottom:8px}
  select,button,input,textarea{font:inherit}
  select{width:100%;padding:10px;border-radius:9px;background:#0d1b2a;color:var(--ink);border:1px solid #2a4a68}
  input[type=text],input[type=number]{width:100%;padding:9px 10px;border-radius:9px;background:#0d1b2a;color:var(--ink);border:1px solid #2a4a68;margin-bottom:8px}
  .field{margin-bottom:10px} .field:last-child{margin-bottom:0}
  .field .lab{font-weight:500;color:var(--mut);font-size:12px;margin-bottom:4px}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .inline{display:flex;align-items:center;gap:8px;margin:0}.inline input{width:90px;margin:0}
  .imgs{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px;margin-top:6px}
  .thumb{position:relative;border:2px solid transparent;border-radius:10px;overflow:hidden;cursor:pointer;background:#0d1b2a}
  .thumb img{width:100%;height:96px;object-fit:cover;display:block}
  .thumb.sel{border-color:var(--acc2)} .thumb .nm{font-size:11px;color:var(--mut);padding:4px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .thumb .ck{position:absolute;top:6px;left:6px;width:20px;height:20px;border-radius:50%;background:#0008;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:12px}
  .row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  button.run{background:var(--acc2);color:#fff;border:0;padding:12px 26px;border-radius:10px;font-weight:600;cursor:pointer}
  button.run:disabled{opacity:.5;cursor:default}
  .ghost{background:#0d1b2a;color:var(--ink);border:1px solid #2a4a68;padding:9px 14px;border-radius:9px;cursor:pointer}
  pre{background:#06101b;border:1px solid #21405e;border-radius:10px;padding:14px;max-height:320px;overflow:auto;font:12px/1.5 ui-monospace,Consolas,monospace;color:#bcd6c8;white-space:pre-wrap}
  .results a{display:inline-block;margin:6px 10px 0 0;color:#9fd3b1}
  input[type=file]{display:none}
  .tabs{display:flex;gap:8px;margin-bottom:18px}
  .tab{background:#0d1b2a;color:var(--mut);border:1px solid #2a4a68;padding:9px 18px;border-radius:9px;cursor:pointer;font-weight:600}
  .tab.on{background:var(--acc2);color:#fff;border-color:var(--acc2)}
  .crumb{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:16px;font-size:14px}
  .crumb a{color:#9fd3b1;cursor:pointer;text-decoration:none}
  .crumb a:hover{text-decoration:underline}
  .crumb .sep{color:var(--mut)}
  .crumb .here{color:var(--ink);font-weight:600}
  .browse{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px}
  .tile{position:relative;background:#0d1b2a;border:1px solid #21405e;border-radius:12px;overflow:hidden;cursor:pointer;transition:border-color .12s,transform .12s}
  .tile:hover{border-color:var(--acc2);transform:translateY(-2px)}
  .tile .pv{position:relative;height:140px;background:#06101b;display:flex;align-items:center;justify-content:center}
  .tile .pv img{width:100%;height:100%;object-fit:cover;display:block}
  .tile.folder .pv .fic{font-size:56px;line-height:1;filter:drop-shadow(0 4px 8px #0008)}
  .tile .badge{position:absolute;left:8px;bottom:8px;background:#000b;border-radius:6px;font-size:11px;padding:2px 7px;color:#fff}
  .tile .play{position:absolute;top:0;left:0;right:0;height:140px;display:flex;align-items:center;justify-content:center;font-size:34px;color:#fff;text-shadow:0 2px 10px #000;opacity:.8;pointer-events:none}
  .tile:hover .play{opacity:1}
  .tile .cap{padding:9px 10px 2px;font:12px/1.4 ui-monospace,Consolas,monospace;color:#cfe3d8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tile .sub2{padding:0 10px 9px;color:var(--mut);font-size:11px}
  .empty{color:var(--mut);padding:18px 0}
</style></head><body><div class="wrap">
  <h1>Demo Runner</h1><p class="sub">Pick a script, choose input image(s), run each one-by-one.</p>
  <div class="tabs"><button class="tab on" id="tabRun">Run</button><button class="tab" id="tabHist">History</button></div>
  <div id="runView">
  <div class="card">
    <label>Target site</label>
    <select id="site">
      <option value="prod" selected>Production - textile-designer.ai (.profile-prod)</option>
      <option value="dev">Local dev - localhost:3000 (.profile)</option>
    </select>
  </div>
  <div class="card"><label>Script</label><select id="script"></select></div>
  <div class="card">
    <div class="row" style="justify-content:space-between">
      <label style="margin:0">Input images <span class="sub" id="selcount"></span></label>
      <button class="ghost" id="addBtn">+ Upload images</button>
      <input type="file" id="file" accept="image/*" multiple>
    </div>
    <div class="row" style="margin-top:10px;align-items:flex-start">
      <textarea id="urls" placeholder="Paste image URL(s), one per line" style="flex:1;min-height:54px;padding:9px;border-radius:9px;background:#0d1b2a;color:var(--ink);border:1px solid #2a4a68;font:inherit;resize:vertical"></textarea>
      <button class="ghost" id="urlBtn">Fetch URLs</button>
    </div>
    <div class="imgs" id="imgs"></div>
  </div>
  <div class="card">
    <label>Target image <span class="sub">(color_transfer only)</span></label>
    <select id="target"></select>
  </div>
  <div class="card">
    <div class="row">
      <label style="margin:0"><input type="checkbox" id="headless"> headless (no window)</label>
      <button class="run" id="run">Run on selected images</button>
      <span id="status" class="sub"></span>
    </div>
    <pre id="log" style="margin-top:14px;display:none"></pre>
    <div class="results" id="results"></div>
  </div>
  </div>
  <div id="historyView" style="display:none">
    <div class="row" style="justify-content:space-between;margin-bottom:10px">
      <div id="crumb" class="crumb"></div>
      <div class="row" style="gap:8px"><button class="ghost" id="histMode"></button><button class="ghost" id="histRefresh">Refresh</button></div>
    </div>
    <div id="hist"></div>
  </div>
<script>
const $=s=>document.querySelector(s); let images=[]; const sel=new Set();
async function load(){
  const r=await (await fetch('/api/list')).json();
  $('#script').innerHTML=r.scripts.map(s=>'<option value="'+s.file+'">'+s.name+'</option>').join('');
  images=r.images;
  $('#target').innerHTML='<option value="">(none)</option>'+images.map(p=>'<option>'+p+'</option>').join('');
  renderImgs();
}
function renderImgs(){
  $('#imgs').innerHTML=images.map(p=>{
    const on=sel.has(p);
    return '<div class="thumb'+(on?' sel':'')+'" data-p="'+p+'"><div class="ck">'+(on?'✓':'')+'</div>'+
      '<img src="/file/'+encodeURIComponent(p)+'"><div class="nm">'+p.split('/').pop()+'</div></div>';
  }).join('');
  document.querySelectorAll('.thumb').forEach(t=>t.onclick=()=>{const p=t.dataset.p;sel.has(p)?sel.delete(p):sel.add(p);renderImgs();upd();});
  upd();
}
function upd(){$('#selcount').textContent=sel.size?('· '+sel.size+' selected'):'';$('#run').disabled=!sel.size;}
$('#addBtn').onclick=()=>$('#file').click();
$('#file').onchange=async e=>{
  for(const f of e.target.files){
    const b64=await new Promise(res=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.readAsDataURL(f);});
    const r=await (await fetch('/api/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.name,b64})})).json();
    if(r.path){images.push(r.path);sel.add(r.path);}
  }
  $('#target').innerHTML='<option value="">(none)</option>'+images.map(p=>'<option>'+p+'</option>').join('');
  renderImgs();
};
$('#urlBtn').onclick=async()=>{
  const urls=$('#urls').value.split(/\\s+/).map(s=>s.trim()).filter(Boolean);
  if(!urls.length)return;
  $('#urlBtn').disabled=true;$('#urlBtn').textContent='Fetching…';
  try{
    const r=await (await fetch('/api/fetch-url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({urls})})).json();
    (r.paths||[]).forEach(p=>{if(!images.includes(p))images.push(p);sel.add(p);});
    if(r.errors&&r.errors.length)alert('Could not fetch:\\n'+r.errors.join('\\n'));
    $('#urls').value='';
    $('#target').innerHTML='<option value="">(none)</option>'+images.map(p=>'<option>'+p+'</option>').join('');
    renderImgs();
  }catch(e){alert('Fetch failed: '+e);}
  $('#urlBtn').disabled=false;$('#urlBtn').textContent='Fetch URLs';
};
$('#run').onclick=()=>{
  const script=$('#script').value, imgs=[...sel].join(','), headless=$('#headless').checked?'1':'', target=$('#target').value, site=$('#site').value;
  $('#log').style.display='block';$('#log').textContent='';$('#results').innerHTML='';$('#run').disabled=true;$('#status').textContent='running…';
  const es=new EventSource('/run?script='+encodeURIComponent(script)+'&images='+encodeURIComponent(imgs)+'&headless='+headless+'&target='+encodeURIComponent(target)+'&site='+site);
  es.addEventListener('log',e=>{const l=JSON.parse(e.data).line;$('#log').textContent+=l+'\\n';$('#log').scrollTop=$('#log').scrollHeight;});
  es.addEventListener('video',e=>{const v=JSON.parse(e.data).path;$('#results').innerHTML+='<a href="/file/'+encodeURIComponent(v)+'" target="_blank">▶ '+v.split('/').pop()+'</a>';});
  es.addEventListener('done',e=>{es.close();$('#run').disabled=false;$('#status').textContent='done';browse(histPath);});
};
function tab(which){
  $('#tabRun').classList.toggle('on',which==='run');
  $('#tabHist').classList.toggle('on',which==='hist');
  $('#runView').style.display=which==='run'?'':'none';
  $('#historyView').style.display=which==='hist'?'':'none';
  if(which==='hist')browse(histPath);
}
$('#tabRun').onclick=()=>tab('run');
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
</script></div></body></html>`

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(HTML) }
  if (url.pathname === '/api/list') return sendJson(res, { scripts: listScripts(), images: listImages() })
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
        const { name, b64 } = JSON.parse(body)
        const fn = Date.now() + '-' + sanitize(name || 'upload.png')
        fs.writeFileSync(path.join(UPLOADS, fn), Buffer.from(b64, 'base64'))
        sendJson(res, { path: `assets/uploads/${fn}` })
      } catch (e) { sendJson(res, { error: String(e) }, 400) }
    })
    return
  }
  if (url.pathname === '/api/fetch-url' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', async () => {
      try {
        const { urls } = JSON.parse(body)
        const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean)
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
            fs.writeFileSync(path.join(UPLOADS, fn), buf)
            paths.push(`assets/uploads/${fn}`)
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
    const siteEnv = site === 'prod'
      ? { BASE_URL: 'https://textile-designer.ai', PROFILE: path.join(DEMO_DIR, '.profile-prod') }
      : {}
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
        env: { ...process.env, ...siteEnv, ...cardEnv, INPUT: img, DEMO_SUFFIX: suffix, DEMO_RUN_ID: runId, ...(target ? { TARGET: target } : {}), ...(headless ? { HEADLESS: '1' } : {}) },
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
  res.writeHead(404); res.end('not found')
})

server.listen(PORT, () => console.log(`Demo runner → http://localhost:${PORT}`))
