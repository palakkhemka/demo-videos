// 3D Effect - turn a flat design into 3D with depth/shadows/emboss.
// Needs the api_worker (three_d_effect) on DEV/prod.
import { recordTool } from '../lib/demo-kit.mjs'

recordTool({
  tabId: 'three_d_effect',
  navLabel: /3d effect/i,
  outName: '3d-effect-demo',
  displayName: '3D Effect',
  caption: 'Flat designs lacking depth - 3D in seconds',
  doSlider: true,
  zoomInput: true,
  zoomResult: true,
}).catch((e) => { console.error(e); process.exit(1) })
