// Standalone intro + outro card generator (pure ffmpeg, no browser). Driven by
// env options from the runner's Intro/Outro tab; renders both cards into the
// per-run videos/ folder and optionally makes social aspect-ratio cuts.
//
// Options (all optional, env):
//   CARD_LAYOUT   classic | center | lower-third | split   (default classic)
//   CARD_BG       gradient | solid | image                 (default gradient)
//   CARD_BG_IMAGE relative path under demo/ (when CARD_BG=image)
//   CARD_BG_COLOR hex like 14294a (when CARD_BG=solid)
//   CARD_LOGO     1|0 show the logo (default 1)
//   CARD_SOCIAL   1|0 also make 9x16/1x1/16x9 cuts (default 0)
//   INTRO_TITLE / INTRO_SUBTITLE / INTRO_SEC
//   OUTRO_TITLE / OUTRO_SUBTITLE / OUTRO_SEC

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderCard } from './lib/cards.mjs'
import { makeSocialCuts, runPaths } from './lib/demo-kit.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d)

const layout = env('CARD_LAYOUT', 'classic')
const bg = env('CARD_BG', 'gradient')
const bgImage = env('CARD_BG_IMAGE', '') ? path.resolve(__dirname, env('CARD_BG_IMAGE')) : ''
const bgColor = env('CARD_BG_COLOR', '14294a')
const showLogo = env('CARD_LOGO', '1') !== '0'
const social = env('CARD_SOCIAL', '0') === '1'

const rp = runPaths('intro-outro')
// Keep a copy of the chosen background image with the run, for reference.
if (bg === 'image' && bgImage) { try { fs.copyFileSync(bgImage, path.join(rp.input, path.basename(bgImage))) } catch {} }

const cards = [
  { kind: 'intro', title: env('INTRO_TITLE', 'Textile Designer AI'), subtitle: env('INTRO_SUBTITLE', 'AI tools for textile & fashion design'), dur: Number(env('INTRO_SEC', '3')) },
  { kind: 'outro', title: env('OUTRO_TITLE', 'Visit textile-designer.ai'), subtitle: env('OUTRO_SUBTITLE', 'Start creating today'), dur: Number(env('OUTRO_SEC', '3.6')) },
]

for (const c of cards) {
  const out = path.join(rp.videos, `${c.kind}-${layout}.mp4`)
  console.log(`[intro-outro] rendering ${c.kind} (${layout}, bg=${bg}) -> ${path.basename(out)}`)
  const r = renderCard({ out, dur: c.dur, title: c.title, subtitle: c.subtitle, layout, bg, bgImage, bgColor, showLogo })
  if (r.status === 0) {
    console.log(`VIDEO: ${out}`)
    if (social) makeSocialCuts(out)
  } else {
    console.log(`[intro-outro] ${c.kind} failed:\n`, (r.stderr || '').split('\n').slice(-8).join('\n'))
  }
}
