// Embroidery Effect — turn a design into realistic embroidery.
// Needs the api_worker (embroidery_effect) on DEV/prod.
import { recordTool } from './lib/demo-kit.mjs'

recordTool({
  tabId: 'embroidery_effect',
  navLabel: /embroidery/i,
  outName: 'embroidery-demo',
  displayName: 'Embroidery Effect',
  caption: 'Mocking up embroidery by hand — realistic stitches in seconds',
  doSlider: true,
  zoomInput: true,
  zoomResult: true,
}).catch((e) => { console.error(e); process.exit(1) })
