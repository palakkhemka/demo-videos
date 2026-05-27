// Embroidery Effect - turn a design into realistic embroidery.
// Needs the api_worker (embroidery_effect) on DEV/prod.
import { recordTool } from './lib/demo-kit.mjs'

recordTool({
  tabId: 'embroidery_effect',
  navLabel: /embroidery/i,
  outName: 'embroidery-demo',
  displayName: 'Embroidery Effect',
  caption: 'Mocking up embroidery by hand - realistic stitches in seconds',
  doSlider: true,
  zoomInput: true,
  zoomResult: true,
  beforeSubmit: async ({ page, glideClick, sleep }) => {
    // Open the Stitch Style dropdown and pick an Indian style (change 'Kantha'
    // to Bandhani / Chikankari / etc. as desired).
    const trigger = page.getByRole('button', { name: /stitch|satin/i }).first()
    await glideClick(trigger).catch(() => {})
    await sleep(600)
    await glideClick(page.getByText('Kantha', { exact: true })).catch(() => {})
    await sleep(700)
  },
}).catch((e) => { console.error(e); process.exit(1) })

