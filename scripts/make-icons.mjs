// Renders public/favicon.svg into the PNG icons the manifest needs (uses the preinstalled Playwright).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// ESM ignores NODE_PATH, so resolve Playwright through require (local or global install).
const { chromium } = createRequire(import.meta.url)('playwright');

const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const b64 = Buffer.from(svg).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
const jobs = [
  ['pwa-192.png', 192, 0],
  ['pwa-512.png', 512, 0],
  ['apple-touch-icon.png', 180, 0],
  // Maskable: keep the logo inside the 80% safe zone on a full-bleed background.
  ['pwa-maskable-512.png', 512, 0.12],
];
for (const [name, size, pad] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(
    `<html><body style="margin:0;background:#0b0f14;display:grid;place-items:center;width:${size}px;height:${size}px">
     <img src="data:image/svg+xml;base64,${b64}" width="${inner}" height="${inner}"></body></html>`,
  );
  await page.screenshot({ path: new URL(`../public/${name}`, import.meta.url).pathname, omitBackground: false });
  console.log('wrote', name);
}
await browser.close();
