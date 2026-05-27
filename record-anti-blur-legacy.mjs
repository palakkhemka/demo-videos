// Anti-Blur, Legacy Mode (model_type=ultra).
// Workflow: clean start -> pick Legacy model -> upload blurry image -> zoom input
// -> submit -> result -> before/after slider (if present) -> zoom result.
// Needs the anti_blur worker running on DEV.
import { recordTool } from './lib/demo-kit.mjs'

recordTool({
  tabId: 'anti_blur',
  navLabel: /anti.?blur/i,
  outName: 'anti-blur-legacy-demo',
  displayName: 'Anti-Blur · Legacy',
  caption: 'Blurry scans ruining your prints — sharp in seconds',
  input: 'assets/blurry.jpg',
  doSlider: true,
  zoomInput: true,
  zoomResult: true,
  resultTimeoutMs: 1200000, // 20 min
  beforeSubmit: async ({ page, glideClick, sleep }) => {
    await glideClick(page.getByText('Legacy Mode', { exact: true })).catch(() => {})
    await sleep(800)
  },
}).catch((e) => { console.error(e); process.exit(1) })
