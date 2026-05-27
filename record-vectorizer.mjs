// Vectorizer - raster art -> editable vector file. Needs the vectorizer worker.
// Output is a vector file (SVG/EPS) or a clean raster (PNG), so there is no
// before/after raster slider (doSlider:false) and a raster side-by-side would
// not be meaningful for the vector formats. Instead the demo showcases the
// OUTPUT FORMATS by driving the real format pickers in a beforeSubmit hook,
// then submits the headline SVG run so the video still ends on a real result.
//
// Why a single recordTool + beforeSubmit (not a multi-run createDemoSession):
//   - recordTool keeps the standard intro/frame/outro pipeline in one pass.
//   - The vectorizer UI does not render output_format as one generic ParamInput
//     button group / dropdown. It is a hand-rolled two-level picker in
//     web/src/app/ai/tabs/PngToSvgTab.js:
//       * a top section toggle: "PHOTOSHOP-READY VECTOR FILE" (sets png/eps) vs
//         "ILLUSTRATOR-READY VECTOR FILE" (sets svg/eps)
//       * inside each section an OutputFormatToggle of two buttons:
//           Illustrator section -> "SVG" (svg) | "EPS" (eps)
//           Photoshop  section -> "PNG" (png) | "SHARP EDGED FILE" (eps)
//     So all three schema formats (svg|eps|png) are reachable by clicking those
//     buttons. We cycle through them on camera (PNG, EPS, then back to SVG) to
//     demonstrate the choices, and also bump the Line Quality select to show the
//     detail levels (Rough/Balanced/Smooth/Ultra Smooth = coarse/medium/fine/
//     superFine). Downloading each format is unnecessary for a "show the formats"
//     demo and recordTool does not expose download capture anyway.
//
// Usage: node record-vectorizer.mjs   (leave the window alone)
import { recordTool } from './lib/demo-kit.mjs'

recordTool({
  tabId: 'vectorizer',
  navLabel: /vectorizer/i,
  outName: 'vectorizer-demo',
  doSlider: false,
  zoomResult: true, // hold on the crisp vector result at the end
  caption: 'Turn pixel art into clean editable vectors',
  // Showcase the output formats and the line-quality detail levels before the
  // headline SVG submit. Every selector below is matched against the real
  // rendered text in PngToSvgTab.js; each click is best-effort (.catch) so a
  // label tweak never aborts the whole recording.
  beforeSubmit: async ({ page, glideClick, sleep }) => {
    // Helper: the section toggle buttons live at the top; the per-section
    // OutputFormatToggle buttons render their value uppercased (PNG/SVG/EPS) or
    // the literal "SHARP EDGED FILE" for the Photoshop-side EPS option.
    const clickByName = async (re) => {
      await glideClick(page.getByRole('button', { name: re }).first()).catch(() => {})
      await sleep(900)
    }

    // 1) PHOTOSHOP-READY section -> PNG: a clean raster, no vector paths.
    await clickByName(/photoshop[-\s]?ready/i)
    await clickByName(/^png$/i)

    // 2) Same section -> "SHARP EDGED FILE" (this is the EPS output_format).
    await clickByName(/sharp\s*edged/i)

    // 3) ILLUSTRATOR-READY section -> EPS, then back to SVG (the default and the
    //    headline output). Switching sections re-renders the toggle, so re-grab.
    await clickByName(/illustrator[-\s]?ready/i)
    await clickByName(/^eps$/i)
    await clickByName(/^svg$/i)

    // 4) Detail / line-quality levels. In the SVG (Illustrator) layout this is a
    //    NextUI <Select> (hint.variant:'select') whose options are the
    //    line_fit_tolerance enum relabelled: Rough=coarse, Balanced=medium,
    //    Smooth=fine, Ultra Smooth=superFine. Open it, hover a couple of
    //    options to show the choices, and settle on Ultra Smooth (superFine) for
    //    the cleanest curves on the submitted run.
    const qualityTrigger = page
      .getByRole('button', { name: /rough|balanced|smooth|ultra smooth/i })
      .first()
    await glideClick(qualityTrigger).catch(() => {})
    await sleep(700)
    // NextUI Select renders its options in a popover listbox as role=option.
    await glideClick(page.getByRole('option', { name: /^smooth$/i }).first()).catch(() => {})
    await sleep(500)
    // Re-open and choose Ultra Smooth (superFine) as the final detail level.
    await glideClick(qualityTrigger).catch(() => {})
    await sleep(600)
    await glideClick(page.getByRole('option', { name: /ultra smooth/i }).first()).catch(() => {})
    await sleep(800)
  },
}).catch((e) => { console.error(e); process.exit(1) })
