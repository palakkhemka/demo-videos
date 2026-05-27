// Open a PSD in Photopea via the current site flow:
// photopea.com -> "Start using Photopea" -> "Open from computer" -> file chooser.

import fs from 'node:fs'

/**
 * @param {import('playwright-core').Page} page
 * @param {string} psdPath absolute path to .psd
 * @param {{ glide: Function, sleep: (ms:number)=>Promise<void>, onBanner?: (text:string,color?:string)=>Promise<void>, clearBanner?: ()=>Promise<void>, screenshotPath?: string }} opts
 * @returns {Promise<boolean>} true if editor booted after open attempt
 */
export async function openPsdInPhotopea(page, psdPath, { glide, sleep, onBanner, clearBanner, screenshotPath } = {}) {
  if (!psdPath || !fs.existsSync(psdPath)) {
    console.log('[photopea] PSD not found:', psdPath)
    return false
  }

  console.log('[photopea] opening:', psdPath)
  await page.goto('https://www.photopea.com/', { waitUntil: 'domcontentloaded' })

  const startBtn = page.getByRole('button', { name: /start using photopea/i }).first()
  if (await startBtn.count().catch(() => 0)) {
    await glide(startBtn).catch(() => {})
    await sleep(2000)
  }

  page.on('filechooser', (chooser) => chooser.setFiles(psdPath).catch(() => {}))
  const openBtn = page.getByRole('button', { name: /open from computer/i }).first()
  if (await openBtn.count().catch(() => 0)) {
    await glide(openBtn).catch(() => {})
  } else {
    const fallback = page.getByRole('button', { name: /^open$/i }).first()
    if (await fallback.count().catch(() => 0)) await glide(fallback).catch(() => {})
  }

  await page.setInputFiles('input[type="file"]', psdPath).catch(() => {})
  const ready = await page.waitForFunction(
    () => !!(window.Photopea || (window.app && window.app.open)),
    null,
    { timeout: 30000 },
  ).then(() => true).catch(() => false)

  if (onBanner) await onBanner('Layers open in Photopea - fully editable', '#2f7d54')
  await sleep(5000)
  if (clearBanner) await clearBanner()
  if (screenshotPath) await page.screenshot({ path: screenshotPath }).catch(() => {})

  console.log('[photopea] editor ready:', ready)
  return ready
}
