// Central config for the demo-video toolkit. Everything here is overridable via
// environment variables, so the same repo runs on any machine.

const env = (k, d) => process.env[k] ?? d
const P = process.platform

// --- Target site / auth profiles ---
export const BASE_URL = env('BASE_URL', 'http://localhost:3000')
export const PROD_URL = env('PROD_URL', 'https://textile-designer.ai')
// Persistent Chrome profile dirs (hold the logged-in session). Never commit them.
export const PROFILE = env('PROFILE', '.profile')
export const PROFILE_PROD = env('PROFILE_PROD', '.profile-prod')

// --- Recording ---
export const VIEWPORT = { width: Number(env('VIEWPORT_W', 1920)), height: Number(env('VIEWPORT_H', 1080)) }
export const PAGE_ZOOM = env('PAGE_ZOOM', '0.8') // page zoom so the whole tool fits
export const RESULT_TIMEOUT_MS = Number(env('RESULT_TIMEOUT_MS', 1200000)) // 20 min
export const MAX_PROC_SEC = Number(env('MAX_PROC_SEC', 2.5)) // compress processing wait to ~this
export const HEADLESS = env('HEADLESS') === '1'
export const CHROME_CHANNEL = env('CHROME_CHANNEL', 'chrome') // real Chrome (needed for the prod profile)

// --- Look (ffmpeg frame/cards) ---
export const GRADIENT = { from: env('GRADIENT_FROM', '0x1f3a5f'), to: env('GRADIENT_TO', '0x3f7d54') }
export const CARD_GRADIENT = { from: env('CARD_FROM', '0x14294a'), to: env('CARD_TO', '0x2f6a4a') }

// --- Fonts (ffmpeg drawtext). Platform defaults; override with FONT_* env vars
// to a path with no spaces. The values are escaped for the ffmpeg filtergraph. ---
const FONT_DEFAULTS = {
  win32: { ui: 'C:/Windows/Fonts/segoeui.ttf', uib: 'C:/Windows/Fonts/segoeuib.ttf', sym: 'C:/Windows/Fonts/seguisym.ttf' },
  darwin: { ui: '/System/Library/Fonts/Supplemental/Arial.ttf', uib: '/System/Library/Fonts/Supplemental/Arial Bold.ttf', sym: '/System/Library/Fonts/Apple Symbols.ttf' },
  linux: { ui: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', uib: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', sym: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf' },
}
const base = FONT_DEFAULTS[P] || FONT_DEFAULTS.linux
// ffmpeg fontfile needs ':' (drive letters) and ' ' escaped inside filtergraphs.
const escFont = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/ /g, '\\ ')
export const FONTS = {
  ui: escFont(env('FONT_REGULAR', base.ui)),
  uib: escFont(env('FONT_BOLD', base.uib)),
  sym: escFont(env('FONT_SYMBOL', base.sym)),
}
