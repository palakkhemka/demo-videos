# Textile Designer - Demo Video Recorder

Automated, branded demo videos of the [textile-designer.ai](https://textile-designer.ai)
tools. Drives the real app in Chrome (Playwright), records the screen, and frames
each clip with a macOS-style titlebar, animated cursor, a simulated file picker, a
problem→claim caption, intro/outro cards, and a sped-up "processing" beat - then
exports social aspect-ratio cuts (9:16 / 1:1 / 16:9).

## Requirements

- **Node 20+**
- **Google Chrome** installed (the recorder uses the real Chrome channel)
- Windows (font paths default to Windows; Mac/Linux see [Fonts](#fonts))

## Setup

```bash
npm install                 # installs deps + Chromium (postinstall)
```

Then create a logged-in browser profile **once** per target site (the recorder
reuses it; Google blocks login inside automated browsers, so this manual step is
required). Use an account with credits/unlimited.

```powershell
# DEV  (-> .profile)
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="<repo>\.profile" "http://localhost:3000/ai"

# PROD (-> .profile-prod)
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="<repo>\.profile-prod" "https://textile-designer.ai/ai"
```

Log in, reach `/ai`, then **fully close** that Chrome window (it locks the profile).
`.profile*` are git-ignored - never commit them (they hold your session).

## Usage

### Runner UI (recommended)

```bash
npm run runner        # → http://localhost:8787
```

Pick **Target site** (dev/prod), a **script**, one or more **input images**
(preset or uploaded), an optional **Target image** (for color_transfer), then
**Run**. It runs the script on each image one-by-one, streams logs, and links the
output videos. Outputs land in `output/<tool>/run_<id>/{input,outputs,videos}/`.

#### Picking an intro/outro template

Next to the Run button there's a **🎬 Intro / Outro · <label>** chip. Click it
to open a modal with thumbnail tiles for every template (see [Templates](#introoutro-templates)).
Pick one, fill the template-specific fields (kicker / punch-line / steps /
etc.), apply, and every tool video you record afterwards gets wrapped with
that intro and outro. The selection persists across page reloads via
localStorage; the standalone **Intro / Outro Cards** tab can still render a
single intro/outro pair on demand.

### Single script (CLI)

```bash
# dev
node scripts/record-bg-remove2.mjs
# prod, custom input (bash)
BASE_URL=https://textile-designer.ai PROFILE=.profile-prod INPUT=assets/input.jpg node scripts/record-bg-remove2.mjs
# dev/prod on bundled Chromium instead of Chrome
BROWSER=chromium node scripts/record-bg-remove2.mjs
```

## Configuration

All in `config.mjs`, overridable by env var:

| Env | Default | Purpose |
|-----|---------|---------|
| `BASE_URL` | `http://localhost:3000` | target site |
| `PROFILE` / `PROFILE_PROD` | `.profile` / `.profile-prod` | logged-in Chrome profile dir |
| `BROWSER` | `chrome` | `chrome` (default) or `chromium` |
| `INPUT` | `assets/input.jpg` | input image |
| `TARGET` | `assets/colors-target.jpg` | 2nd image (color_transfer) |
| `HEADLESS` | off | `1` = no window |
| `RESULT_TIMEOUT_MS` | `1200000` | wait for the worker result (20 min) |
| `MAX_PROC_SEC` | `2.5` | compress the processing wait to ~this |
| `VIEWPORT_W/H` | `1920/1080` | recording size |
| `PAGE_ZOOM` | `0.8` | page zoom so the tool fits |
| `FONT_REGULAR/BOLD/SYMBOL` | platform default | ffmpeg fonts (see below) |

## Tools

All recorder scripts live under `scripts/`. Each runs against the site's real
worker, so its worker must be live (prod workers always are) and each run
spends real credits on the logged-in org.

**One-click tools (upload → submit → before/after slider):**
`record-bg-remove2.mjs` (Background Removal · Model 1),
`record-bg-remove-model2.mjs` (Model 2), `record-anti-blur-pro/-legacy.mjs`,
`record-border-outline.mjs`, `record-watermark-removal.mjs`,
`record-fabric-texture-removal.mjs`, `record-embroidery.mjs`,
`record-3d-effect.mjs`.

**Multi-knob tools (one run, custom params):**
`record-super-scaler.mjs` (Creative + Prism Shift + 4×),
`record-vectorizer.mjs` (cycles PNG/EPS/SVG + Line Quality before submit),
`record-dress-to-design-advanced/-fine.mjs`, `record-style-transfer.mjs`,
`record-color-transfer.mjs` (source + target).

**Multi-run / comparison tools:**
- `record-upscale.mjs` — 2× & 4× × low/high creativity, ends in a 2×2 loupe-magnifier compare.
- `record-super-scaler-scale-compare.mjs` — 2× / 4× / 8× on the same input, loupe compare.
- `record-design-extension.mjs` — 4 directions × 2 creativity = 8 runs, ends with two 3×3 **compass** overlays (one per creativity) placing each directional output in its actual extension direction around the original.
- `record-color-layering.mjs` — automatic vs manual color separation, then drives Photopea (via the embedded iframe in `scripts/photopea-open.mjs`) to peel each `Color_N` layer top-down.
- `record-repeat-set.mjs` — Full / Half-Drop / Half-Brick, with `record-repeat-checker.mjs` for the seamless proof.

**Card renderer:** `scripts/record-intro-outro.mjs` — pure ffmpeg, drives `lib/cards.mjs`. Called by the runner's `🎬 Intro / Outro` modal and by every tool recorder's `finalizeVideo` step.

### Intro/Outro templates

All 9 templates render through `lib/cards.mjs` and are selectable from the
runner's modal (Tool tab) or the standalone Intro/Outro tab.

| Template | Purpose | Key fields |
|---|---|---|
| `classic` / `center` / `lower-third` / `split` | Legacy logo + title + subtitle placements | `INTRO_TITLE`, `INTRO_SUBTITLE`, `OUTRO_TITLE`, `OUTRO_SUBTITLE` |
| `editorial` | Magazine cover for premium B2B (full-bleed design image + masthead) | `CARD_KICKER`, `CARD_ISSUE`, `CARD_DATE`, `CARD_BG_IMAGE` |
| `case-study` | Designer adoption: input → action pill → output split with metric strip | `CARD_INPUT_IMG`, `CARD_OUTPUT_IMG`, `CARD_ACTION`, `CARD_METRIC` |
| `reel-hook` | Social-first punch-line + CTA for Reels / TikTok / Shorts | `CARD_PUNCHLINE`, `INTRO_CTA`, `OUTRO_CTA` |
| `trade-show` | Booth-loop signage with tool list + booth/URL footer | `CARD_TOOLS` (CSV), `CARD_BOOTH` |
| `process-strip` | Tutorial: numbered "01 → 02 → 03 → 04" step strip | `CARD_STEPS` (CSV), `CARD_ACTIVE_STEP` |

When a tool video is wrapped, the template + its fields propagate from the
runner to the recorder via env vars; see `CARD_ENV_KEYS` in `runner.mjs` and
`buildCardOpts()` in `lib/demo-kit.mjs`.

## Fonts

The ffmpeg titlebar/caption fonts default to Windows paths. On **Mac/Linux**, set
font env vars to TTF paths **without spaces**, e.g.:

```bash
FONT_REGULAR=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf \
FONT_BOLD=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf \
FONT_SYMBOL=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf \
node scripts/record-bg-remove2.mjs
```

## Notes

- `assets/` holds sample inputs + the brand logo + `template-previews/`
  (rendered frames used by the runner UI modal). `assets/uploads/`, `output/`,
  `node_modules/`, and `.profile*/` are git-ignored.
- ffmpeg ships via `ffmpeg-static` (bundled, no system install needed).
- The runner UI HTML/CSS/JS lives inside a JS template literal in `runner.mjs`.
  Mind escape collapsing when editing the inline `<script>` block: `\(` `\)`
  `\d` `\.` all degrade to their bare form before the browser parses them.
  Prefer split/substring over regex for short patterns inside that script.
