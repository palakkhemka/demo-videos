// Standalone intro + outro card generator (pure ffmpeg, no browser). Driven by
// env options from the runner's Intro/Outro tab; renders both cards into the
// per-run videos/ folder and optionally makes social aspect-ratio cuts.
//
// Shared options (env):
//   CARD_TEMPLATE  classic | center | lower-third | split |
//                  editorial | case-study | reel-hook | trade-show |
//                  process-strip                                    (default classic)
//   CARD_LAYOUT    (legacy alias of CARD_TEMPLATE for the 4 layouts)
//   CARD_BG        gradient | solid | image                         (default gradient)
//   CARD_BG_IMAGE  relative path under demo/ (when CARD_BG=image OR
//                  for the `editorial` template's full-bleed background)
//   CARD_BG_COLOR  hex like 14294a (when CARD_BG=solid)
//   CARD_LOGO      1|0 show the logo (default 1)
//   CARD_SOCIAL    1|0 also make 9x16/1x1/16x9 cuts (default 0)
//   INTRO_TITLE / INTRO_SUBTITLE / INTRO_SEC
//   OUTRO_TITLE / OUTRO_SUBTITLE / OUTRO_SEC
//
// Per-template extras (env). Apply to BOTH intro and outro unless suffixed
// with _INTRO or _OUTRO:
//   editorial:     CARD_KICKER, CARD_ISSUE, CARD_DATE
//   case-study:    CARD_INPUT_IMG, CARD_OUTPUT_IMG, CARD_ACTION, CARD_METRIC
//                  (intro typically leaves CARD_OUTPUT_IMG empty so the
//                   placeholder OUTPUT box is shown)
//   reel-hook:     CARD_PUNCHLINE, INTRO_CTA, OUTRO_CTA
//   trade-show:    CARD_TOOLS (CSV), CARD_BOOTH
//   process-strip: CARD_STEPS (CSV), CARD_ACTIVE_STEP

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderCard, ALL_TEMPLATES } from '../lib/cards.mjs'
import { makeSocialCuts, runPaths } from '../lib/demo-kit.mjs'
import { FONT_PATHS } from '../config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d)

// Resolve the chosen template (new CARD_TEMPLATE wins; CARD_LAYOUT is legacy).
const rawTpl = env('CARD_TEMPLATE', env('CARD_LAYOUT', 'classic'))
const template = ALL_TEMPLATES.includes(rawTpl) ? rawTpl : 'classic'
if (!ALL_TEMPLATES.includes(rawTpl)) console.warn(`[intro-outro] unknown template "${rawTpl}" — falling back to classic`)

const bg = env('CARD_BG', 'gradient')
const bgImage = env('CARD_BG_IMAGE', '') ? path.resolve(__dirname, '..', env('CARD_BG_IMAGE')) : ''
const bgColor = env('CARD_BG_COLOR', '14294a')
const showLogo = env('CARD_LOGO', '1') !== '0'
const social = env('CARD_SOCIAL', '0') === '1'

// Template-specific extras.
const kicker = env('CARD_KICKER', '')
const issue = env('CARD_ISSUE', '')
const date = env('CARD_DATE', '')
const csInput = env('CARD_INPUT_IMG', '') ? path.resolve(__dirname, '..', env('CARD_INPUT_IMG')) : ''
const csOutput = env('CARD_OUTPUT_IMG', '') ? path.resolve(__dirname, '..', env('CARD_OUTPUT_IMG')) : ''
const csAction = env('CARD_ACTION', '')
const csMetric = env('CARD_METRIC', '')
const punchline = env('CARD_PUNCHLINE', '')
const tsTools = env('CARD_TOOLS', '')
const tsBooth = env('CARD_BOOTH', '')
const psSteps = env('CARD_STEPS', '')
const psActive = Number(env('CARD_ACTIVE_STEP', '0'))

const rp = runPaths('intro-outro')
// Keep a copy of the chosen background image with the run, for reference.
if (bgImage && fs.existsSync(bgImage)) { try { fs.copyFileSync(bgImage, path.join(rp.input, path.basename(bgImage))) } catch {} }
if (csInput && fs.existsSync(csInput)) { try { fs.copyFileSync(csInput, path.join(rp.input, `cs-input-${path.basename(csInput)}`)) } catch {} }
if (csOutput && fs.existsSync(csOutput)) { try { fs.copyFileSync(csOutput, path.join(rp.input, `cs-output-${path.basename(csOutput)}`)) } catch {} }

const cards = [
  {
    kind: 'intro',
    title: env('INTRO_TITLE', 'Textile Designer AI'),
    subtitle: env('INTRO_SUBTITLE', 'AI tools for textile & fashion design'),
    dur: Number(env('INTRO_SEC', '3')),
    cta: env('INTRO_CTA', 'Watch what happens ↓'),
    // Intro of case-study typically only knows the input, so leave output empty
    // to draw the OUTPUT placeholder box.
    outputImage: '',
  },
  {
    kind: 'outro',
    title: env('OUTRO_TITLE', 'Visit textile-designer.ai'),
    subtitle: env('OUTRO_SUBTITLE', 'Start creating today'),
    dur: Number(env('OUTRO_SEC', '3.6')),
    cta: env('OUTRO_CTA', 'Try it free → textile-designer.ai'),
    outputImage: csOutput,
  },
]

console.log('[fonts] regular:', FONT_PATHS.ui, '| bold:', FONT_PATHS.uib)
console.log(`[intro-outro] template=${template} bg=${bg} logo=${showLogo}`)

for (const c of cards) {
  const out = path.join(rp.videos, `${c.kind}-${template}.mp4`)
  console.log(`[intro-outro] rendering ${c.kind} -> ${path.basename(out)}`)
  const r = renderCard({
    out,
    dur: c.dur,
    title: c.title,
    subtitle: c.subtitle,
    template,
    layout: template, // legacy renderers also use this key
    bg,
    bgImage,
    bgColor,
    showLogo,
    // editorial
    kicker, issue, date,
    // case-study
    inputImage: csInput,
    outputImage: c.outputImage,
    action: csAction,
    metric: csMetric,
    // reel-hook
    punchline,
    cta: c.cta,
    // trade-show
    tools: tsTools,
    booth: tsBooth,
    // process-strip
    steps: psSteps,
    activeStep: psActive,
  })
  if (r.status === 0) {
    console.log(`VIDEO: ${out}`)
    if (social) makeSocialCuts(out)
  } else {
    console.log(`[intro-outro] ${c.kind} failed:\n`, (r.stderr || '').split('\n').slice(-12).join('\n'))
  }
}
