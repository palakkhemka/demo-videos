# Demo toolkit - task list

Tracks requests for the `demo/` recorder toolkit (repo: palakkhemka/demo-videos).
Status: [x] done (code-level, needs verify run)  ·  [~] in progress  ·  [ ] todo  ·  [!] blocked

## Done (code-level; verify with a live run)
- [x] Runner: paste image URL(s) -> `/api/fetch-url` downloads into uploads, runs like uploads.
- [x] Runner: History tab listing every rendered `.mp4`.
- [x] Unique timestamped output names so re-runs build real history (no overwrite).
- [x] repeat-set: "only 2 of 3 outputs" - capture each type's fresh output reliably.
- [x] repeat-set: stop the continuous-download spam (was reading the wrong array; now
      waits for the button disable->enable, downloads once, deletes stale dups).
- [x] upscale: scale factor never changed - now set via the Advanced "Select" dropdown.
- [x] upscale: creativity steps - 4 runs (2x@20%, 2x@60%, 4x@20%, 4x@60%).
- [x] upscale: side-by-side comparison of all captured outputs at the end.
- [x] Social/aspect-ratio cuts now generated for finalizeVideo tools (upscale etc.).
- [x] More logs in repeat-set and upscale.
- [x] repeat-set: keep the seamless-checker grid at 2x2 on initial load.
- [x] History: group videos into collapsible folders (one per output subfolder).
- [x] repeat-set checker: set patternType per output (Half Brick / Half Drop were
      shown as Full).
- [x] Social aspect-ratio videos: Reels-style reframe (blurred cover bg + content
      filling the width) instead of a tiny strip on a flat gradient.
- [x] Intro/Outro: NEW layout styles + standalone script (lib/cards.mjs +
      record-intro-outro.mjs, 4 layouts). Runner Intro/Outro TAB with layout/
      background/title/duration controls and render logs/results.
- [x] Runner UX: History is a file-explorer folder browser (folder tiles + preview +
      counts, breadcrumb, flat "all videos" vs nested toggle), thumbnails come from
      the run's output/input image (not a home-screen frame), videos open in the OS
      default player, target site defaults to Production. Input folders/collections
      + intro/outro tab shipped.
- [x] Per-run output folder structure: output/{task_type}/run_{id}/ with input/,
      outputs/, videos/. demo-kit + every script + the History scan refactored.
- [x] Runner inputs: folder structure / collections - named folders, add to folder
      (mirrors History folder UX).
- [x] Social-media cuts: per-platform safe zones, burned-in captions/branding,
      per-format intro/outro, choose which formats to export (SOCIAL_FORMATS env).
- [x] Vectorizer demo exercises ALL formats. record-vectorizer.mjs cycles
      Photoshop-Ready (PNG / Sharp Edged File) then Illustrator-Ready (EPS / SVG),
      bumps Line Quality through Smooth -> Ultra Smooth, then submits the SVG run.
      Implementation matches PngToSvgTab.js (verified 2026-05-28).
- [x] color-transfer: source/target upload was failing silently when the default
      TARGET path (assets/colors-target.jpg) did not exist - fakeUpload's
      fs.readFileSync threw and aborted the script before finalizeVideo, leaving an
      orphaned webm with no mp4. Now: fall back to SOURCE if TARGET is unset or
      missing, log the resolved paths, copy TARGET into run_*/input/, retry
      setInputFiles if it did not stick, wait for source/target canvas readiness
      before zoom, and log a clear "Submit never enabled" line if the uploads did
      not register.

## Decisions / closed
- Anti-blur Pro vs Legacy keep SEPARATE top-level History folders (not nested under
  one "anti-blur" parent). They share the app's `tab=anti_blur` but produce
  different model outputs/queues, and the Tool dropdown already groups them
  visually ("Anti-Blur · Pro" / "Anti-Blur · Legacy"). Nesting would require
  special-casing listHistory for a single hardcoded pair - not worth it.

## Blocked / parked
- [~] Photopea: integrated into color_layering via lib/photopea.mjs (Start using Photopea
      -> Open from computer). Verify on a live color_layering run with a real PSD download.

## Open questions / follow-ups
- Upscale creativity selector assumes the first `input[type=number]` in Advanced is
  creativity (resemblance is second) - confirm on the next live run (it logs the value).
