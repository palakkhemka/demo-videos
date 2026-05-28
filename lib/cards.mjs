// Branded intro/outro card renderer (pure ffmpeg, no browser). Used by the
// standalone record-intro-outro.mjs script and reused by every recorder via
// finalizeVideo.
//
// Two flavors of "template":
//
//   LEGACY LAYOUTS - same look, text moved around:
//     classic       gradient + centered logo, title + subtitle below center
//     center        big centered title + subtitle, small logo near the top
//     lower-third   full-bleed background, title in a boxed lower band
//     split         logo on the left, title + subtitle stacked on the right
//
//   TARGETED TEMPLATES - distinct structures for distinct purposes:
//     editorial     premium B2B sales. Full-bleed design image, magazine
//                   masthead at top with kicker line and issue/date footer.
//     case-study    designer adoption. Input -> action arrow -> output in
//                   a 3-column lockup, with a green metric strip at the
//                   bottom. Needs CS_INPUT (and CS_OUTPUT for outro).
//     reel-hook     social-first (Reels/TikTok). Huge centered punchline
//                   on a dark frame, brand-green CTA at the bottom. Outro
//                   swaps the CTA for the URL.
//     trade-show    booth loop signage. Diagonal brand wash, big lockup,
//                   tool list strip, booth/url footer. Reads at distance.
//     process-strip tutorial intro. Numbered "01 -> 02 -> 03 -> 04" step
//                   strip with the active step highlighted in brand green.
//
// renderCard() dispatches by opts.template (preferred) or opts.layout (legacy).
// Each template is its own pure function returning the ffmpeg spawnSync result,
// so failures are localized and the runner can log diffs per template.

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { FONTS, FONT_PATHS } from '../config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEMO_DIR = path.join(__dirname, '..')
const FFMPEG = path.join(DEMO_DIR, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
const LOGO = path.join(DEMO_DIR, 'assets', 'logo-main.png')

export const CARD_LAYOUTS = ['classic', 'center', 'lower-third', 'split']
export const CARD_TEMPLATES = ['editorial', 'case-study', 'reel-hook', 'trade-show', 'process-strip']
export const ALL_TEMPLATES = [...CARD_LAYOUTS, ...CARD_TEMPLATES]

// ----- shared utilities --------------------------------------------------

// Make user text safe inside an ffmpeg drawtext text='...' token (no shell is
// involved - spawnSync uses an arg array). Inside single quotes only ' and \
// are special; % triggers strftime so strip it too. Newlines collapse to \n.
const escText = (s, { keepNewlines = false } = {}) => {
  const raw = String(s || '')
  const collapsed = keepNewlines
    ? raw.replace(/\r/g, '')
    : raw.replace(/[\r\n]+/g, ' ')
  return collapsed
    .replace(/\\/g, '')
    .replace(/'/g, '’')
    .replace(/%/g, '')
    .replace(/:/g, '\\:')
    .trim()
}

const wrapText = (text, maxChars = 28, maxLines = 2) => {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  if (!words.length) return { text: '', lines: 0 }
  const lines = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (next.length <= maxChars || !cur) cur = next
    else { lines.push(cur); cur = w }
    if (lines.length >= maxLines) break
  }
  if (lines.length < maxLines && cur) lines.push(cur)
  if (lines.length > maxLines) lines.length = maxLines
  if (words.join(' ').length > lines.join(' ').length) {
    const i = lines.length - 1
    lines[i] = lines[i].replace(/[.,!?;:]+$/, '') + '…'
  }
  return { text: lines.join('\\n'), lines: lines.length }
}

const draw = (font, text, size, color, x, y, extra = '') =>
  `drawtext=fontfile=${font}:text='${text}':fontcolor=${color}:fontsize=${size}:x=${x}:y=${y}:fix_bounds=1${extra}`

const fadeFilter = (dur) => `fade=t=in:st=0:d=0.4,fade=t=out:st=${(dur - 0.5).toFixed(2)}:d=0.5`

const todayMonthYear = () => {
  const d = new Date()
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
  return `${months[d.getMonth()]} ${d.getFullYear()}`
}

const run = (args) => spawnSync(FFMPEG, ['-y', ...args], { encoding: 'utf8' })

// ----- dispatcher --------------------------------------------------------

export function renderCard(opts) {
  const tpl = opts.template || opts.layout || 'classic'
  if (process.env.LOG_FONTS === '1') console.log('[fonts/card]', FONT_PATHS.ui, FONT_PATHS.uib)
  switch (tpl) {
    case 'editorial':     return renderEditorial(opts)
    case 'case-study':    return renderCaseStudy(opts)
    case 'reel-hook':     return renderReelHook(opts)
    case 'trade-show':    return renderTradeShow(opts)
    case 'process-strip': return renderProcessStrip(opts)
    default:              return renderLegacy(opts)
  }
}

// ----- legacy 4 layouts (unchanged) --------------------------------------

function renderLegacy({
  out, dur = 3, title = '', subtitle = '',
  layout = 'classic', bg = 'gradient', bgImage = '', bgColor = '14294a',
  showLogo = true, W = 1920, H = 1080,
  ffmpeg = FFMPEG, logo = LOGO,
}) {
  const { ui, uib } = FONTS
  const rawT = escText(title), rawS = escText(subtitle)
  const inputs = []
  if (bg === 'image' && bgImage) inputs.push('-loop', '1', '-t', String(dur), '-i', bgImage)
  else if (bg === 'solid') inputs.push('-f', 'lavfi', '-i', `color=c=0x${String(bgColor).replace(/^0x/, '')}:s=${W}x${H}:d=${dur}`)
  else inputs.push('-f', 'lavfi', '-i', `gradients=s=${W}x${H}:c0=0x14294a:c1=0x2f6a4a:d=${dur}`)
  const useLogo = showLogo && !!logo
  if (useLogo) inputs.push('-loop', '1', '-t', String(dur), '-i', logo)

  const steps = []
  if (bg === 'image' && bgImage) steps.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},eq=brightness=-0.22:saturation=1.05[bgn]`)
  else steps.push(`[0:v]scale=${W}:${H}[bgn]`)
  let cur = '[bgn]'

  const cx = '(W-text_w)/2'
  let logoScale = 300, logoX = '(W-w)/2', logoY = '(H-h)/2-160', titleDraw = '', subDraw = ''
  if (layout === 'center') {
    const titleSize = 96, subSize = 42
    const T = wrapText(rawT, 22, 2), S = wrapText(rawS, 34, 2)
    const tH = Math.round(titleSize * 1.15), sH = Math.round(subSize * 1.2)
    const tBlock = Math.max(1, T.lines) * tH
    const sBlock = Math.max(0, S.lines) * sH
    const blockTop = Math.round(H / 2 - (tBlock + (S.lines ? 22 : 0) + sBlock) / 2)
    logoScale = 150; logoX = '(W-w)/2'; logoY = '110'
    titleDraw = draw(uib, T.text, titleSize, 'white', cx, String(blockTop), ':line_spacing=10')
    subDraw = S.lines ? ',' + draw(ui, S.text, subSize, '0xbcd6c8', cx, String(blockTop + tBlock + 22), ':line_spacing=8') : ''
  } else if (layout === 'lower-third') {
    const titleSize = 74, subSize = 38
    const T = wrapText(rawT, 34, 2), S = wrapText(rawS, 48, 2)
    const tH = Math.round(titleSize * 1.15)
    const tBlock = Math.max(1, T.lines) * tH
    const yTitle = H - 330
    const ySub = yTitle + tBlock + 18
    logoScale = 130; logoX = '80'; logoY = '70'
    const boxT = ':box=1:boxcolor=0x14294a@0.55:boxborderw=30'
    const boxS = ':box=1:boxcolor=0x14294a@0.55:boxborderw=18'
    titleDraw = draw(uib, T.text, titleSize, 'white', '120', String(yTitle), `${boxT}:line_spacing=8`)
    subDraw = S.lines ? ',' + draw(ui, S.text, subSize, '0xbcd6c8', '120', String(ySub), `${boxS}:line_spacing=6`) : ''
  } else if (layout === 'split') {
    const titleSize = 72, subSize = 36
    const T = wrapText(rawT, 22, 3), S = wrapText(rawS, 30, 2)
    const tH = Math.round(titleSize * 1.15), sH = Math.round(subSize * 1.2)
    const tBlock = Math.max(1, T.lines) * tH
    const sBlock = Math.max(0, S.lines) * sH
    const blockTop = Math.round(H / 2 - (tBlock + (S.lines ? 18 : 0) + sBlock) / 2)
    logoScale = 360; logoX = 'W*0.22-w/2'; logoY = '(H-h)/2'
    titleDraw = draw(uib, T.text, titleSize, 'white', 'W*0.46', String(blockTop), ':line_spacing=8')
    subDraw = S.lines ? ',' + draw(ui, S.text, subSize, '0xbcd6c8', 'W*0.46', String(blockTop + tBlock + 18), ':line_spacing=6') : ''
  } else {
    const titleSize = 80, subSize = 36
    const T = wrapText(rawT, 28, 2), S = wrapText(rawS, 42, 2)
    const tH = Math.round(titleSize * 1.15), sH = Math.round(subSize * 1.2)
    const tBlock = Math.max(1, T.lines) * tH
    const sBlock = Math.max(0, S.lines) * sH
    const blockTop = Math.round(H / 2 + 70 - (tBlock + (S.lines ? 18 : 0) + sBlock) / 2)
    logoScale = 300; logoX = '(W-w)/2'; logoY = '(H-h)/2-160'
    titleDraw = draw(uib, T.text, titleSize, 'white', cx, String(blockTop), ':line_spacing=8')
    subDraw = S.lines ? ',' + draw(ui, S.text, subSize, '0xbcd6c8', cx, String(blockTop + tBlock + 18), ':line_spacing=6') : ''
  }

  if (useLogo) {
    steps.push(`[1:v]scale=${logoScale}:${logoScale}:force_original_aspect_ratio=decrease[lg]`)
    steps.push(`${cur}[lg]overlay=${logoX}:${logoY}[bgl]`)
    cur = '[bgl]'
  }
  steps.push(`${cur}${titleDraw}${subDraw},${fadeFilter(dur)},format=yuv420p[out]`)
  return run([...inputs, '-filter_complex', steps.join(';'), '-map', '[out]', '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out])
}

// ----- editorial ---------------------------------------------------------
// Magazine cover. Full-bleed design image dimmed at the top, masthead text on
// top of the dim band, optional issue/date footer with a brand-green wordmark.
// Falls back to a solid color if no bgImage is provided.

function renderEditorial({
  out, dur = 3, title = '', subtitle = '',
  bgImage = '', bgColor = '14294a',
  kicker = '', issue = '', date = '',
  showLogo = true, W = 1920, H = 1080, logo = LOGO,
}) {
  const { ui, uib } = FONTS
  const T = wrapText(title, 26, 2)
  const k = escText(kicker || 'TEXTILE DESIGNER AI · QUARTERLY').toUpperCase()
  const sub = escText(subtitle)
  const iss = escText(issue || 'VOL 04').toUpperCase()
  const dat = escText(date || todayMonthYear()).toUpperCase()

  const inputs = []
  if (bgImage) inputs.push('-loop', '1', '-t', String(dur), '-i', bgImage)
  else inputs.push('-f', 'lavfi', '-i', `color=c=0x${String(bgColor).replace(/^0x/, '')}:s=${W}x${H}:d=${dur}`)
  const useLogo = showLogo && !!logo && fs.existsSync(logo)
  if (useLogo) inputs.push('-loop', '1', '-t', String(dur), '-i', logo)

  const steps = []
  // Cover-fill background, slightly dimmed and pulled toward editorial mood.
  if (bgImage) {
    steps.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},eq=brightness=-0.18:saturation=0.92[bg0]`)
  } else {
    steps.push(`[0:v]scale=${W}:${H}[bg0]`)
  }
  // Top dim band so the masthead is legible regardless of the underlying image.
  steps.push(`[bg0]drawbox=x=0:y=0:w=${W}:h=${Math.round(H * 0.42)}:color=black@0.45:t=fill[bg1]`)
  // Bottom dim band for the footer line.
  steps.push(`[bg1]drawbox=x=0:y=${H - 110}:w=${W}:h=110:color=black@0.55:t=fill[bg2]`)

  let cur = '[bg2]'
  // Brand wordmark in the top-right of the masthead.
  if (useLogo) {
    steps.push(`[1:v]scale=120:120:force_original_aspect_ratio=decrease[lg]`)
    steps.push(`${cur}[lg]overlay=${W}-w-72:60[bg3]`)
    cur = '[bg3]'
  }

  // Hairline rule under the masthead.
  steps.push(`${cur}drawbox=x=80:y=${Math.round(H * 0.28) - 8}:w=${W - 160}:h=2:color=white@0.6:t=fill[bg4]`)
  cur = '[bg4]'

  const kickerY = 90
  const titleY = Math.round(H * 0.28) + 10
  const subY = Math.round(H * 0.50)
  const footerY = H - 70

  const titleSize = T.lines === 2 ? 96 : 130
  const overlay =
    draw(ui, k, 22, 'white@0.92', '80', String(kickerY), ':line_spacing=4') + ',' +
    draw(uib, T.text, titleSize, 'white', '80', String(titleY), ':line_spacing=12') +
    (sub ? ',' + draw(ui, escText(subtitle), 32, '0xbcd6c8', '80', String(subY)) : '') + ',' +
    draw(ui, `${iss}    •    ${dat}`, 22, 'white@0.85', '80', String(footerY)) + ',' +
    draw(uib, 'textile-designer.ai', 24, '0x5bd6a0', String(W - 80) + '-text_w', String(footerY))

  steps.push(`${cur}${overlay},${fadeFilter(dur)},format=yuv420p[out]`)
  return run([...inputs, '-filter_complex', steps.join(';'), '-map', '[out]', '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out])
}

// ----- case-study --------------------------------------------------------
// Input -> action -> output, with a green metric strip below. For intros where
// outputImage is missing we paint a dashed "OUTPUT" placeholder. The action
// label sits in a small dark pill between the two image boxes.

function renderCaseStudy({
  out, dur = 3, title = '',
  inputImage = '', outputImage = '',
  action = '', metric = '',
  bg = 'gradient', bgColor = '0c1117',
  showLogo = true, W = 1920, H = 1080, logo = LOGO,
}) {
  const { ui, uib } = FONTS
  const tEsc = escText(title || 'Real designer workflow')
  const aEsc = escText(action || 'AI step').toUpperCase()
  const mEsc = escText(metric || 'Minutes, not hours · ready for print')

  const inputs = []
  if (bg === 'image' && inputImage) inputs.push('-f', 'lavfi', '-i', `gradients=s=${W}x${H}:c0=0x0c1117:c1=0x14294a:d=${dur}`)
  else if (bg === 'solid') inputs.push('-f', 'lavfi', '-i', `color=c=0x${String(bgColor).replace(/^0x/, '')}:s=${W}x${H}:d=${dur}`)
  else inputs.push('-f', 'lavfi', '-i', `gradients=s=${W}x${H}:c0=0x0c1117:c1=0x14294a:d=${dur}`)

  const haveIn = inputImage && fs.existsSync(inputImage)
  const haveOut = outputImage && fs.existsSync(outputImage)
  if (haveIn) inputs.push('-loop', '1', '-t', String(dur), '-i', inputImage)
  if (haveOut) inputs.push('-loop', '1', '-t', String(dur), '-i', outputImage)
  const useLogo = showLogo && !!logo && fs.existsSync(logo)
  if (useLogo) inputs.push('-loop', '1', '-t', String(dur), '-i', logo)

  // Indexing depends on what we actually loaded.
  let idx = 1
  const inIdx = haveIn ? idx++ : -1
  const outIdx = haveOut ? idx++ : -1
  const logoIdx = useLogo ? idx++ : -1

  const CELL = 520
  const cellY = 290
  const leftX = 200
  const rightX = W - leftX - CELL

  const steps = [`[0:v]scale=${W}:${H}[bg0]`]
  let cur = '[bg0]'

  // Place the two image cells (or placeholders).
  const placeImg = (streamIdx, x, y, label) => {
    if (streamIdx >= 0) {
      steps.push(`[${streamIdx}:v]scale=${CELL}:${CELL}:force_original_aspect_ratio=decrease,pad=${CELL}:${CELL}:(ow-iw)/2:(oh-ih)/2:color=0x14294a[img${streamIdx}]`)
      steps.push(`${cur}[img${streamIdx}]overlay=${x}:${y}[after${streamIdx}]`)
      cur = `[after${streamIdx}]`
    } else {
      // Dashed placeholder box.
      steps.push(`${cur}drawbox=x=${x}:y=${y}:w=${CELL}:h=${CELL}:color=white@0.18:t=4[ph${label}]`)
      cur = `[ph${label}]`
      steps.push(`${cur}drawtext=fontfile=${ui}:text='${label}':fontcolor=white@0.5:fontsize=44:x=${x}+${CELL}/2-text_w/2:y=${y}+${CELL}/2-text_h/2[pht${label}]`)
      cur = `[pht${label}]`
    }
  }
  placeImg(inIdx, leftX, cellY, 'INPUT')
  placeImg(outIdx, rightX, cellY, 'OUTPUT')

  // Arrow + action pill between the boxes.
  const pillW = 320, pillH = 84
  const pillX = Math.round((W - pillW) / 2)
  const pillY = Math.round(cellY + CELL / 2 - pillH / 2)
  steps.push(`${cur}drawbox=x=${pillX}:y=${pillY}:w=${pillW}:h=${pillH}:color=0x5bd6a0:t=fill[pill0]`)
  steps.push(`[pill0]drawtext=fontfile=${uib}:text='${aEsc}':fontcolor=0x0c1117:fontsize=32:x=${pillX}+${pillW}/2-text_w/2:y=${pillY}+${pillH}/2-text_h/2[pill1]`)
  steps.push(`[pill1]drawtext=fontfile=${uib}:text='→':fontcolor=0x0c1117:fontsize=42:x=${pillX}+${pillW}-46:y=${pillY}+${pillH}/2-text_h/2[pill2]`)
  cur = '[pill2]'

  // Title at top, metric strip at bottom.
  steps.push(`${cur}drawtext=fontfile=${uib}:text='${tEsc}':fontcolor=white:fontsize=58:x=(W-text_w)/2:y=90[t1]`)
  const stripY = H - 170, stripH = 88
  steps.push(`[t1]drawbox=x=120:y=${stripY}:w=${W - 240}:h=${stripH}:color=0x5bd6a0@0.94:t=fill[strip]`)
  steps.push(`[strip]drawtext=fontfile=${uib}:text='${mEsc}':fontcolor=0x0c1117:fontsize=32:x=(W-text_w)/2:y=${stripY}+${stripH}/2-text_h/2[strip1]`)
  cur = '[strip1]'

  if (logoIdx >= 0) {
    steps.push(`[${logoIdx}:v]scale=70:70:force_original_aspect_ratio=decrease[lg]`)
    steps.push(`${cur}[lg]overlay=80:90[withlogo]`)
    cur = '[withlogo]'
  }

  steps.push(`${cur}${fadeFilter(dur).replace(/^/, 'drawbox=enable=0,').replace(/^drawbox=enable=0,/, '')}format=yuv420p[out]`)
  // Re-add the fade properly (the awkward replace above is a no-op safety guard).
  // Cleaner: pop and re-push.
  steps.pop()
  steps.push(`${cur}${fadeFilter(dur)},format=yuv420p[out]`)

  return run([...inputs, '-filter_complex', steps.join(';'), '-map', '[out]', '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out])
}

// ----- reel-hook ---------------------------------------------------------
// Social hook screen. Dark frame, huge punchline middle-of-frame, brand-green
// CTA at the bottom. The same layout works for the intro (hook) and the outro
// (CTA + url) - which one to show is controlled by `cta` and `punchline`.

function renderReelHook({
  out, dur = 3,
  punchline = '', cta = '',
  bgColor = '0c0e12',
  showLogo = true, W = 1920, H = 1080, logo = LOGO,
}) {
  const { ui, uib } = FONTS
  const P = wrapText(punchline || 'Designed in seconds.', 18, 3)
  const c = escText(cta || 'Watch what happens ↓')

  const inputs = ['-f', 'lavfi', '-i', `color=c=0x${String(bgColor).replace(/^0x/, '')}:s=${W}x${H}:d=${dur}`]
  const useLogo = showLogo && !!logo && fs.existsSync(logo)
  if (useLogo) inputs.push('-loop', '1', '-t', String(dur), '-i', logo)

  const steps = [`[0:v]scale=${W}:${H}[bg0]`]
  // Thin brand-green frame border for the social-card aesthetic.
  steps.push(`[bg0]drawbox=x=72:y=72:w=${W - 144}:h=${H - 144}:color=0x5bd6a0@0.35:t=4[bg1]`)

  let cur = '[bg1]'
  // Big punchline. Centered both ways. Auto-fit by line count.
  const titleSize = P.lines === 1 ? 168 : P.lines === 2 ? 132 : 104
  steps.push(`${cur}drawtext=fontfile=${uib}:text='${P.text}':fontcolor=white:fontsize=${titleSize}:x=(W-text_w)/2:y=(H-text_h)/2:line_spacing=22:fix_bounds=1[t1]`)
  // CTA at the bottom in brand green.
  steps.push(`[t1]drawtext=fontfile=${uib}:text='${c}':fontcolor=0x5bd6a0:fontsize=48:x=(W-text_w)/2:y=${H - 200}[t2]`)
  cur = '[t2]'
  if (useLogo) {
    steps.push(`[1:v]scale=64:64:force_original_aspect_ratio=decrease[lg]`)
    steps.push(`${cur}[lg]overlay=100:${H - 130}[t3]`)
    steps.push(`[t3]drawtext=fontfile=${ui}:text='textile-designer.ai':fontcolor=white@0.85:fontsize=22:x=180:y=${H - 110}[t4]`)
    cur = '[t4]'
  }
  steps.push(`${cur}${fadeFilter(dur)},format=yuv420p[out]`)
  return run([...inputs, '-filter_complex', steps.join(';'), '-map', '[out]', '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out])
}

// ----- trade-show --------------------------------------------------------
// Booth-loop signage. Diagonal brand gradient, big centered lockup, a single
// row of tool names separated by middle-dots, booth/url at the bottom.
// Tool names come as a single CSV string ("Anti-Blur,Vectorize,Color Match").

function renderTradeShow({
  out, dur = 3, title = '', subtitle = '',
  tools = '', booth = '',
  showLogo = true, W = 1920, H = 1080, logo = LOGO,
}) {
  const { ui, uib } = FONTS
  const t = escText(title || 'Textile Designer AI')
  const tag = escText(subtitle || 'AI tools for textile & fashion design')
  const toolList = String(tools || 'Anti-Blur,Vectorize,Color Match,Repeat Set')
    .split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6)
  const toolJoined = escText(toolList.join('  •  '))
  const b = escText(booth || 'textile-designer.ai')

  // Diagonal gradient via two color sources blended with geq, faked via
  // gradients=type=2 (radial) — falls back to a linear gradient on the
  // current build; visually still reads as a brand wash.
  const inputs = ['-f', 'lavfi', '-i', `gradients=s=${W}x${H}:c0=0x14294a:c1=0x5bd6a0:x0=0:y0=0:x1=${W}:y1=${H}:d=${dur}`]
  const useLogo = showLogo && !!logo && fs.existsSync(logo)
  if (useLogo) inputs.push('-loop', '1', '-t', String(dur), '-i', logo)

  const steps = [`[0:v]scale=${W}:${H}[bg0]`]
  let cur = '[bg0]'
  if (useLogo) {
    steps.push(`[1:v]scale=200:200:force_original_aspect_ratio=decrease[lg]`)
    steps.push(`${cur}[lg]overlay=(W-w)/2:170[bg1]`)
    cur = '[bg1]'
  }
  steps.push(`${cur}drawtext=fontfile=${uib}:text='${t}':fontcolor=white:fontsize=88:x=(W-text_w)/2:y=400[t1]`)
  steps.push(`[t1]drawtext=fontfile=${ui}:text='${tag}':fontcolor=white@0.92:fontsize=32:x=(W-text_w)/2:y=510[t2]`)
  // Tool chips strip (single line of joined names with a pill background).
  const stripY = 640, stripH = 80
  steps.push(`[t2]drawbox=x=160:y=${stripY}:w=${W - 320}:h=${stripH}:color=white@0.16:t=fill[strip0]`)
  steps.push(`[strip0]drawtext=fontfile=${uib}:text='${toolJoined}':fontcolor=white:fontsize=30:x=(W-text_w)/2:y=${stripY}+${stripH}/2-text_h/2[strip1]`)
  // Footer.
  steps.push(`[strip1]drawtext=fontfile=${uib}:text='${b}':fontcolor=white:fontsize=34:x=(W-text_w)/2:y=${H - 120}[t3]`)
  cur = '[t3]'
  steps.push(`${cur}${fadeFilter(dur)},format=yuv420p[out]`)
  return run([...inputs, '-filter_complex', steps.join(';'), '-map', '[out]', '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out])
}

// ----- process-strip -----------------------------------------------------
// Tutorial-intro structure. Top title, middle row of numbered step boxes
// connected by arrows, caption below. The active step (0-indexed) is painted
// in brand green; the others use a low-contrast tile.

function renderProcessStrip({
  out, dur = 3, title = '', subtitle = '',
  steps: stepList = '', activeStep = 0,
  bg = 'gradient', bgColor = '14294a',
  showLogo = true, W = 1920, H = 1080, logo = LOGO,
}) {
  const { ui, uib } = FONTS
  const t = escText(title || 'How the demo runs')
  const sub = escText(subtitle || '')
  const labels = String(stepList || 'Upload,Adjust,Submit,Export')
    .split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5)
  const N = labels.length
  const active = Math.max(0, Math.min(N - 1, Number(activeStep) | 0))

  const inputs = []
  if (bg === 'solid') inputs.push('-f', 'lavfi', '-i', `color=c=0x${String(bgColor).replace(/^0x/, '')}:s=${W}x${H}:d=${dur}`)
  else inputs.push('-f', 'lavfi', '-i', `gradients=s=${W}x${H}:c0=0x14294a:c1=0x2f6a4a:d=${dur}`)
  const useLogo = showLogo && !!logo && fs.existsSync(logo)
  if (useLogo) inputs.push('-loop', '1', '-t', String(dur), '-i', logo)

  // Step-strip geometry: equal cells centered, arrows in the gaps.
  const CELL_W = 300, CELL_H = 160, GAP = 40
  const stripW = N * CELL_W + (N - 1) * GAP
  const stripX0 = Math.round((W - stripW) / 2)
  const stripY = Math.round((H - CELL_H) / 2)

  const ops = [`[0:v]scale=${W}:${H}[bg0]`]
  let cur = '[bg0]'
  if (useLogo) {
    ops.push(`[1:v]scale=80:80:force_original_aspect_ratio=decrease[lg]`)
    ops.push(`${cur}[lg]overlay=80:80[bg1]`)
    cur = '[bg1]'
  }
  // Title + subtitle above the strip.
  ops.push(`${cur}drawtext=fontfile=${uib}:text='${t}':fontcolor=white:fontsize=64:x=(W-text_w)/2:y=130[t1]`)
  if (sub) ops.push(`[t1]drawtext=fontfile=${ui}:text='${sub}':fontcolor=0xbcd6c8:fontsize=28:x=(W-text_w)/2:y=210[t1s]`)
  cur = sub ? '[t1s]' : '[t1]'

  // Step boxes + connector arrows.
  for (let i = 0; i < N; i++) {
    const x = stripX0 + i * (CELL_W + GAP)
    const isActive = i === active
    const cellColor = isActive ? '0x5bd6a0' : 'white@0.10'
    const numColor = isActive ? '0x0c1117' : '0x5bd6a0'
    const labelColor = isActive ? '0x0c1117' : 'white'
    const num = String(i + 1).padStart(2, '0')
    const cellTag = `[c${i}]`
    ops.push(`${cur}drawbox=x=${x}:y=${stripY}:w=${CELL_W}:h=${CELL_H}:color=${cellColor}:t=fill${cellTag}`)
    cur = cellTag
    const ntag = `[n${i}]`, ltag = `[l${i}]`
    ops.push(`${cur}drawtext=fontfile=${uib}:text='${num}':fontcolor=${numColor}:fontsize=44:x=${x + 24}:y=${stripY + 24}${ntag}`)
    cur = ntag
    ops.push(`${cur}drawtext=fontfile=${uib}:text='${escText(labels[i]).toUpperCase()}':fontcolor=${labelColor}:fontsize=30:x=${x + 24}:y=${stripY + CELL_H - 56}${ltag}`)
    cur = ltag
    if (i < N - 1) {
      const arrowX = x + CELL_W + Math.round(GAP / 2)
      const arrowY = stripY + Math.round(CELL_H / 2)
      const atag = `[a${i}]`
      ops.push(`${cur}drawtext=fontfile=${uib}:text='→':fontcolor=white@0.7:fontsize=44:x=${arrowX}-text_w/2:y=${arrowY}-text_h/2${atag}`)
      cur = atag
    }
  }

  // Bottom strip with brand line.
  ops.push(`${cur}drawtext=fontfile=${ui}:text='textile-designer.ai':fontcolor=0xbcd6c8:fontsize=24:x=(W-text_w)/2:y=${H - 90}[final]`)
  cur = '[final]'
  ops.push(`${cur}${fadeFilter(dur)},format=yuv420p[out]`)
  return run([...inputs, '-filter_complex', ops.join(';'), '-map', '[out]', '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out])
}
