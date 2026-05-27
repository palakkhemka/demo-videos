// Central config for the demo-video toolkit. Everything here is overridable via
// environment variables, so the same repo runs on any machine.

import fs from 'node:fs'
import path from 'node:path'

const env = (k, d) => process.env[k] ?? d
const P = process.platform

// --- Target site / auth profiles ---
export const BASE_URL = env('BASE_URL', 'http://localhost:3000')
export const PROD_URL = env('PROD_URL', 'https://textile-designer.ai')
export const PROFILE = env('PROFILE', '.profile')
export const PROFILE_PROD = env('PROFILE_PROD', '.profile-prod')

// --- Recording ---
export const VIEWPORT = { width: Number(env('VIEWPORT_W', 1920)), height: Number(env('VIEWPORT_H', 1080)) }
export const PAGE_ZOOM = env('PAGE_ZOOM', '0.8')
export const RESULT_TIMEOUT_MS = Number(env('RESULT_TIMEOUT_MS', 1200000))
export const MAX_PROC_SEC = Number(env('MAX_PROC_SEC', 2.5))
export const HEADLESS = env('HEADLESS') === '1'
export const CHROME_CHANNEL = env('CHROME_CHANNEL', 'chrome')

// --- Look (ffmpeg frame/cards) ---
export const GRADIENT = { from: env('GRADIENT_FROM', '0x1f3a5f'), to: env('GRADIENT_TO', '0x3f7d54') }
export const CARD_GRADIENT = { from: env('CARD_FROM', '0x14294a'), to: env('CARD_TO', '0x2f6a4a') }

// --- Fonts (ffmpeg drawtext). README: Windows Segoe defaults; override with FONT_* ---
const norm = (p) => path.resolve(p).replace(/\\/g, '/')

const FONT_CANDIDATES = {
  win32: {
    ui: ['C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/SegoeUI.ttf'],
    uib: ['C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/segoeuiz.ttf', 'C:/Windows/Fonts/SegoeUI-Semibold.ttf'],
    sym: ['C:/Windows/Fonts/seguisym.ttf', 'C:/Windows/Fonts/segoeui.ttf'],
  },
  darwin: {
    ui: ['/System/Library/Fonts/Supplemental/Arial.ttf'],
    uib: ['/System/Library/Fonts/Supplemental/Arial Bold.ttf'],
    sym: ['/System/Library/Fonts/Apple Symbols.ttf'],
  },
  linux: {
    ui: ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
    uib: ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
    sym: ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
  },
}

function pickFont(role, envKey) {
  const fromEnv = process.env[envKey]
  if (fromEnv) {
    const p = norm(fromEnv)
    if (fs.existsSync(p)) return p
    console.warn(`[fonts] ${envKey} not found: ${p}`)
  }
  const list = (FONT_CANDIDATES[P] || FONT_CANDIDATES.linux)[role] || []
  for (const c of list) {
    const p = norm(c)
    if (fs.existsSync(p)) return p
  }
  return list[0] ? norm(list[0]) : ''
}

// Unescaped paths (for logs / debugging).
export const FONT_PATHS = {
  ui: pickFont('ui', 'FONT_REGULAR'),
  uib: pickFont('uib', 'FONT_BOLD'),
  sym: pickFont('sym', 'FONT_SYMBOL'),
}

// Escaped for ffmpeg filtergraphs (drive colon + spaces).
const escFont = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/ /g, '\\ ')
export const FONTS = {
  ui: escFont(FONT_PATHS.ui),
  uib: escFont(FONT_PATHS.uib),
  sym: escFont(FONT_PATHS.sym),
}

if (process.env.LOG_FONTS === '1') {
  console.log('[fonts] regular:', FONT_PATHS.ui)
  console.log('[fonts] bold:   ', FONT_PATHS.uib)
  console.log('[fonts] symbol: ', FONT_PATHS.sym)
}
