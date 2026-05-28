// Super Scaler (tab=image_enhance) - upload -> pick the punchiest preset
// (Creative + Prism Shift + 4x) -> submit -> before/after slider.
// Needs the image_enhance worker on the target site.
import { recordTool } from '../lib/demo-kit.mjs'

recordTool({
  tabId: 'image_enhance',
  navLabel: /super scaler/i,
  outName: 'super-scaler-demo',
  displayName: 'Super Scaler',
  caption: 'Tiny scans into print-ready resolution - one click',
  doSlider: true,
  zoomInput: true,
  zoomResult: true,
  beforeSubmit: async ({ page, glideClick, sleep }) => {
    // Each row is a NextUI segmented button group rendered by ParamInput's
    // 'segmented' variant. Labels match controls/image-enhance.ts.
    const pickSegmented = async (optionLabel) => {
      const btn = page.getByRole('button', { name: new RegExp(`^${optionLabel}$`, 'i') }).first()
      if (await btn.count().catch(() => 0)) await glideClick(btn).catch(() => {})
      await sleep(400)
    }
    await pickSegmented('Creative')      // AI mode (mode_2)
    await pickSegmented('Prism Shift')   // Detail enhancement (more_detailed)
    // Processing stays at "Keep original" (default) - no click.
    await pickSegmented('4x')            // Output size
    await sleep(500)
  },
}).catch((e) => { console.error(e); process.exit(1) })
