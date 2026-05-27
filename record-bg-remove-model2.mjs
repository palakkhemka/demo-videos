// Background Removal (bg_remove) using Model 2. Needs the GPU bg_remove worker.
import { recordTool } from './lib/demo-kit.mjs'

recordTool({
  tabId: 'bg_remove',
  navLabel: 'Background Removal',
  outName: 'bg-remove-model2-demo',
  displayName: 'Background Removal · Model 2',
  modelLabel: 'Model 2',
  doSlider: true,
}).catch((e) => { console.error(e); process.exit(1) })
