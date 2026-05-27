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
output videos. Outputs land in `output/<tool>/`.

### Single script (CLI)

```bash
# dev
node record-bg-remove2.mjs
# prod, custom input
BASE_URL=https://textile-designer.ai PROFILE=.profile-prod INPUT=assets/input.jpg node record-bg-remove2.mjs
```

## Configuration

All in `config.mjs`, overridable by env var:

| Env | Default | Purpose |
|-----|---------|---------|
| `BASE_URL` | `http://localhost:3000` | target site |
| `PROFILE` / `PROFILE_PROD` | `.profile` / `.profile-prod` | logged-in Chrome profile dir |
| `INPUT` | `assets/input.jpg` | input image |
| `TARGET` | `assets/colors-target.jpg` | 2nd image (color_transfer) |
| `HEADLESS` | off | `1` = no window |
| `RESULT_TIMEOUT_MS` | `1200000` | wait for the worker result (20 min) |
| `MAX_PROC_SEC` | `2.5` | compress the processing wait to ~this |
| `VIEWPORT_W/H` | `1920/1080` | recording size |
| `PAGE_ZOOM` | `0.8` | page zoom so the tool fits |
| `FONT_REGULAR/BOLD/SYMBOL` | platform default | ffmpeg fonts (see below) |

## Tools

`record-bg-remove2.mjs` (Background Removal), `record-anti-blur-pro/-legacy.mjs`,
`record-upscale.mjs` (2× & 4×), `record-vectorizer.mjs`,
`record-dress-to-design-advanced/-fine.mjs`, `record-color-transfer.mjs`,
`record-color-layering.mjs` (+ Photopea), `record-embroidery.mjs`,
`record-3d-effect.mjs`, `record-repeat-set.mjs` (+ seamless-checker proof),
`record-repeat-checker.mjs`.

Each tool runs against the site's real worker, so its worker must be live (prod
workers always are). Runs spend real credits on the logged-in org.

## Fonts

The ffmpeg titlebar/caption fonts default to Windows paths. On **Mac/Linux**, set
font env vars to TTF paths **without spaces**, e.g.:

```bash
FONT_REGULAR=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf \
FONT_BOLD=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf \
FONT_SYMBOL=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf \
node record-bg-remove2.mjs
```

## Notes

- `assets/` holds sample inputs + the brand logo; `assets/uploads/`, `output/`,
  `node_modules/`, and `.profile*/` are git-ignored.
- ffmpeg ships via `ffmpeg-static` (bundled, no system install needed).
