// Dress to Design (outfit_extractor), Fine Detail Extractor model.
// Workflow: clean start -> pick Fine Detail + Remove Surface Work toggle
// -> upload garment photo -> zoom input -> submit -> extracted flat result.
// Needs the api_worker (outfit_extractor) on DEV. Input must be a GARMENT photo
// (drop assets/dress.jpg, or choose an image in the runner UI).
import { recordTool } from './lib/demo-kit.mjs'

recordTool({
  tabId: 'outfit_extractor',
  navLabel: /dress to design/i,
  outName: 'dress-to-design-fine-demo',
  displayName: 'Dress to Design · Fine Detail',
  caption: 'Tracing flats from garment photos — extracted in seconds',
  input: 'assets/dress.jpg',
  doSlider: false,
  zoomInput: true,
  beforeSubmit: async ({ page, glideClick, sleep }) => {
    await glideClick(page.getByText('Fine Detail Extractor', { exact: true })).catch(() => {})
    await sleep(700)
    await glideClick(page.getByText(/remove surface work/i).first()).catch(() => {})
    await sleep(700)
  },
}).catch((e) => { console.error(e); process.exit(1) })
