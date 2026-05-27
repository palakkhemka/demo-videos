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

## In progress
- [x] Intro/Outro: NEW layout styles + standalone script DONE (lib/cards.mjs +
      record-intro-outro.mjs, 4 layouts verified). Runner Intro/Outro TAB added
      with layout/background/title/duration controls and render logs/results.
- [x] Runner UX: DONE this round - History is now a file-explorer folder browser
      (folder tiles w/ preview + counts, breadcrumb, flat "all videos" vs nested
      toggle), thumbnails come from the run's output/input image (not a home-screen
      frame), videos open in the OS default player, target site defaults to Production.
      Input folders/collections + intro/outro tab are now shipped; broader polish remains.

## New / todo
- [ ] Vectorizer demo exercises NO formats - tool has output_format svg|eps|png +
      detail coarse..superFine + grouping. Decide what to showcase and implement.

## Todo (big, interdependent - one runner/storage redesign)
- [x] Per-run output folder structure: output/{task_type}/run_{id}/ with input/ (the
      uploaded image), outputs/ (each result), videos/ (each format incl social cuts).
      Refactor demo-kit + every script + the History scan.
- [x] Runner inputs: folder structure / collections - organize inputs into named
      folders, add inputs to a new folder (mirror the History folder UX).
- [x] Social-media cuts: further work beyond the reframe - per-platform safe zones,
      burned-in captions/branding, per-format intro/outro, Shorts/Reels durations,
      choose which formats to export. (Define specifics.)

## Blocked / parked
- [~] Photopea: integrated into color_layering via lib/photopea.mjs (Start using Photopea
      -> Open from computer). Verify on a live color_layering run with a real PSD download.

## Open questions / follow-ups
- Anti-blur Pro vs Legacy land in separate folders (anti-blur-pro / anti-blur-legacy).
  Decide if they should nest under one "anti-blur" parent folder.
- Upscale creativity selector assumes the first `input[type=number]` in Advanced is
  creativity (resemblance is second) - confirm on the next live run (it logs the value).
