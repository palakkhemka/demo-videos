// Anti-Blur, Pro Mode (model_type=pro, auto Pro quality preset).
// Workflow: clean start -> pick Pro model -> upload blurry image -> zoom input
// -> submit -> result -> before/after slider (if present) -> zoom result.
// Needs the anti_blur worker running on DEV.
import { recordTool } from './lib/demo-kit.mjs'

recordTool({
  tabId: 'anti_blur',
  navLabel: /anti.?blur/i,
  outName: 'anti-blur-pro-demo',
  displayName: 'Anti-Blur · Pro',
  caption: 'Blurry scans ruining your prints — sharp in seconds',
  input: 'assets/anti-blur-pro-input.png',
  doSlider: true,
  zoomInput: true,
  zoomResult: true,
  resultTimeoutMs: 1200000, // 20 min
  beforeSubmit: async ({ page, glideClick, sleep }) => {
    await glideClick(page.getByText('Pro Mode', { exact: true })).catch(() => {})
    await sleep(800)
  },
}).catch((e) => { console.error(e); process.exit(1) })
