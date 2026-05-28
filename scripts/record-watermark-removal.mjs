// Watermark Removal (tab=watermark_removal) - upload -> submit -> clean image
// with before/after slider. Despite the schema exposing a `remove_text` bool,
// useTaskSubmission.js hard-codes it to false at submit, so there's nothing
// to flip in the UI - it's a pure one-click tool. Needs the watermark_removal
// worker on the target site.
import { recordTool } from '../lib/demo-kit.mjs'

recordTool({
  tabId: 'watermark_removal',
  navLabel: /watermark removal/i,
  outName: 'watermark-removal-demo',
  displayName: 'Watermark Removal',
  caption: 'Stock-photo watermarks ruining your reference - gone in seconds',
  doSlider: true,
  zoomInput: true,
  zoomResult: true,
}).catch((e) => { console.error(e); process.exit(1) })
