// Branded intro/outro card renderer (pure ffmpeg, no browser). Used by the
// standalone record-intro-outro.mjs script and available for reuse elsewhere.
//
// Layouts (1920x1080):
//   classic      - gradient + centered logo, title + subtitle below center
//   center       - big centered title + subtitle, small logo near the top
//   lower-third  - full-bleed background, title/subtitle in a boxed lower band,
//                  logo top-left (great with a background image)
//   split        - logo on the left, title + subtitle stacked on the right
//
// Background can be the brand gradient, a solid color, or an image.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { FONTS, FONT_PATHS } from '../config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEMO_DIR = path.join(__dirname, '..')
const FFMPEG = path.join(DEMO_DIR, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
const LOGO = path.join(DEMO_DIR, 'assets', 'logo-main.png')

export const CARD_LAYOUTS = ['classic', 'center', 'lower-third', 'split']

// Make user text safe inside an ffmpeg drawtext text='...' token (no shell is
// involved - spawnSync uses an arg array). Inside single quotes only ' and \
// are special; % triggers strftime so strip it too. Newlines collapse to space.
const escText = (s) => String(s || '')
  .replace(/[\r\n]+/g, ' ')
  .replace(/\\/g, '')
  .replace(/'/g, '’')
  .replace(/%/g, '')
  .trim()

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

export function renderCard({
  out, dur = 3, title = '', subtitle = '',
  layout = 'classic', bg = 'gradient', bgImage = '', bgColor = '14294a',
  showLogo = true, W = 1920, H = 1080,
  ffmpeg = FFMPEG, logo = LOGO,
}) {
  const { ui, uib } = FONTS
  if (process.env.LOG_FONTS === '1') console.log('[fonts/card]', FONT_PATHS.ui, FONT_PATHS.uib)
  const rawT = escText(title), rawS = escText(subtitle)

  // ---- inputs ----
  const inputs = []
  if (bg === 'image' && bgImage) inputs.push('-loop', '1', '-t', String(dur), '-i', bgImage)
  else if (bg === 'solid') inputs.push('-f', 'lavfi', '-i', `color=c=0x${String(bgColor).replace(/^0x/, '')}:s=${W}x${H}:d=${dur}`)
  else inputs.push('-f', 'lavfi', '-i', `gradients=s=${W}x${H}:c0=0x14294a:c1=0x2f6a4a:d=${dur}`)
  const useLogo = showLogo && !!logo
  if (useLogo) inputs.push('-loop', '1', '-t', String(dur), '-i', logo)

  // ---- background normalize ----
  const steps = []
  if (bg === 'image' && bgImage) steps.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},eq=brightness=-0.22:saturation=1.05[bgn]`)
  else steps.push(`[0:v]scale=${W}:${H}[bgn]`)
  let cur = '[bgn]'

  const draw = (font, text, size, color, x, y, extra = '') =>
    `drawtext=fontfile=${font}:text='${text}':fontcolor=${color}:fontsize=${size}:x=${x}:y=${y}:fix_bounds=1${extra}`
  const cx = '(W-text_w)/2' // horizontally centered

  // ---- per-layout placement ----
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
  } else { // classic
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
  const fade = `fade=t=in:st=0:d=0.4,fade=t=out:st=${(dur - 0.5).toFixed(2)}:d=0.5`
  steps.push(`${cur}${titleDraw}${subDraw},${fade},format=yuv420p[out]`)

  return spawnSync(ffmpeg, ['-y', ...inputs, '-filter_complex', steps.join(';'),
    '-map', '[out]', '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out], { encoding: 'utf8' })
}
