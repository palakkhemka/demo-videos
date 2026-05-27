// Vectorizer - PNG -> SVG. Needs the vectorizer worker. Output is vector (no
// before/after slider), so doSlider is off.
import { recordTool } from './lib/demo-kit.mjs'

recordTool({
  tabId: 'vectorizer',
  navLabel: /vectorizer/i,
  outName: 'vectorizer-demo',
  doSlider: false,
}).catch((e) => { console.error(e); process.exit(1) })
