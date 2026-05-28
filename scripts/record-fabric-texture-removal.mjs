// Scanned Fabric Texture Removal (tab=fabric_texture_smoothener) - upload ->
// submit -> clean, texture-free version. One-click tool; the only knobs are
// the shared dpi / dpi_mode which we leave at defaults. Needs the
// fabric_texture_smoothener worker on the target site.
import { recordTool } from '../lib/demo-kit.mjs'

recordTool({
  tabId: 'fabric_texture_smoothener',
  navLabel: /scanned fabric|texture removal/i,
  outName: 'fabric-texture-removal-demo',
  displayName: 'Scanned Fabric Texture Removal',
  caption: 'Scanner weave muddying your design - clean fabric in seconds',
  doSlider: true,
  zoomInput: true,
  zoomResult: true,
}).catch((e) => { console.error(e); process.exit(1) })
