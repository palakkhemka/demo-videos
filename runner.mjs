// Local UI to run the demo scripts. Pick a script + one or more input images
// (preset or uploaded); it runs the script on each image one-by-one and streams
// logs, then links the produced videos.
//
// Start:  node runner.mjs   →   open http://localhost:8787

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEMO_DIR = __dirname
const ASSETS = path.join(DEMO_DIR, 'assets')
const UPLOADS = path.join(ASSETS, 'uploads')
const OUTPUT = path.join(DEMO_DIR, 'output')
const PORT = Number(process.env.PORT || 8787)
const IMG_RE = /\.(jpe?g|png|webp)$/i
fs.mkdirSync(UPLOADS, { recursive: true })

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
  fs.readdirSync(DEMO_DIR).filter((f) => /^record-.*\.mjs$/.test(f)).sort()
    .map((f) => ({ file: f, name: prettyName(f) }))

const listImages = () => {
  const root = fs.readdirSync(ASSETS).filter((f) => IMG_RE.test(f) && !/^logo-/.test(f)).map((f) => `assets/${f}`)
  const up = fs.existsSync(UPLOADS) ? fs.readdirSync(UPLOADS).filter((f) => IMG_RE.test(f)).map((f) => `assets/uploads/${f}`) : []
  return [...root, ...up]
}

const sanitize = (s) => s.replace(/[^a-z0-9._-]+/gi, '_')

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
  select,button{font:inherit}
  select{width:100%;padding:10px;border-radius:9px;background:#0d1b2a;color:var(--ink);border:1px solid #2a4a68}
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
</style></head><body><div class="wrap">
  <h1>Demo Runner</h1><p class="sub">Pick a script, choose input image(s), run each one-by-one.</p>
  <div class="card">
    <label>Target site</label>
    <select id="site">
      <option value="dev">Local dev - localhost:3000 (.profile)</option>
      <option value="prod">Production - textile-designer.ai (.profile-prod)</option>
    </select>
  </div>
  <div class="card"><label>Script</label><select id="script"></select></div>
  <div class="card">
    <div class="row" style="justify-content:space-between">
      <label style="margin:0">Input images <span class="sub" id="selcount"></span></label>
      <button class="ghost" id="addBtn">+ Upload images</button>
      <input type="file" id="file" accept="image/*" multiple>
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
$('#run').onclick=()=>{
  const script=$('#script').value, imgs=[...sel].join(','), headless=$('#headless').checked?'1':'', target=$('#target').value, site=$('#site').value;
  $('#log').style.display='block';$('#log').textContent='';$('#results').innerHTML='';$('#run').disabled=true;$('#status').textContent='running…';
  const es=new EventSource('/run?script='+encodeURIComponent(script)+'&images='+encodeURIComponent(imgs)+'&headless='+headless+'&target='+encodeURIComponent(target)+'&site='+site);
  es.addEventListener('log',e=>{const l=JSON.parse(e.data).line;$('#log').textContent+=l+'\\n';$('#log').scrollTop=$('#log').scrollHeight;});
  es.addEventListener('video',e=>{const v=JSON.parse(e.data).path;$('#results').innerHTML+='<a href="/file/'+encodeURIComponent(v)+'" target="_blank">▶ '+v.split('/').pop()+'</a>';});
  es.addEventListener('done',e=>{es.close();$('#run').disabled=false;$('#status').textContent='done';});
};
load();
</script></div></body></html>`

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(HTML) }
  if (url.pathname === '/api/list') return sendJson(res, { scripts: listScripts(), images: listImages() })
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
    if (!script || !images.length) { send('done', {}); return res.end() }

    const runOne = (i) => {
      if (i >= images.length) { send('log', { line: '\n✓ all done' }); send('done', {}); return res.end() }
      const img = images[i]
      const suffix = sanitize(img.split('/').pop().replace(IMG_RE, ''))
      send('log', { line: `\n=== ${script}  ←  ${img} ===` })
      const child = spawn(process.execPath, [path.join(DEMO_DIR, script)], {
        cwd: DEMO_DIR,
        env: { ...process.env, ...siteEnv, INPUT: img, DEMO_SUFFIX: suffix, ...(target ? { TARGET: target } : {}), ...(headless ? { HEADLESS: '1' } : {}) },
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
