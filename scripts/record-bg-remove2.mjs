// Background Removal (bg_remove), model1/RMBG-2.0. Needs the GPU bg_remove worker.
import { recordTool } from '../lib/demo-kit.mjs'

recordTool({
  tabId: 'bg_remove',
  navLabel: 'Background Removal',
  outName: 'bg-remove-demo',
  displayName: 'Background Removal',
  selectModel1: true,
  doSlider: true,
}).catch((e) => { console.error(e); process.exit(1) })
