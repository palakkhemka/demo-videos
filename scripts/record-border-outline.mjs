// Border Outline (tab=edge_detection) - upload -> submit -> clean outlined result.
// Backend uses only the shared dpi triple; the tab's edge-width / tolerance /
// color-picker controls are UI-only legacy and don't affect the worker output,
// so we just submit and let the worker do its thing.
// Needs the edge_detection worker on the target site.
import { recordTool } from '../lib/demo-kit.mjs'

recordTool({
  tabId: 'edge_detection',
  navLabel: /border outline/i,
  outName: 'border-outline-demo',
  displayName: 'Border Outline',
  caption: 'Clean repeatable outlines around every motif - one click',
  doSlider: true,
  zoomInput: true,
  zoomResult: true,
}).catch((e) => { console.error(e); process.exit(1) })
