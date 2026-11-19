// Render the dashboard's screenshots with headless Chromium.
// Run: node scripts/shots.mjs <output-dir>
// Writes 1-board.png, 2-detail.png, 3-filtered.png, 4-sandbox.png into
// <output-dir>/../screenshots (the repository's screenshots/). A shot
// over 480 KiB is re-saved as JPEG quality 85 under the same stem.
import { chromium } from '/home/hatch/workspace/makefun/tools/pw/node_modules/playwright-core/index.mjs';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = process.argv[2] ?? join(ROOT, '.shot-out');
const shotsDir = join(ROOT, 'screenshots');
mkdirSync(shotsDir, { recursive: true });

const CHROME = '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';
const MAX_PNG = 480 * 1024;

async function shot(page, name, fn) {
  await fn();
  await page.waitForTimeout(400);
  const file = join(shotsDir, `${name}.png`);
  await page.screenshot({ path: file });
  let size = statSync(file).size;
  if (size > MAX_PNG) {
    const jpg = join(shotsDir, `${name}.jpg`);
    await page.screenshot({ path: jpg, type: 'jpeg', quality: 85 });
    const { rmSync } = await import('node:fs');
    rmSync(file);
    size = statSync(jpg).size;
    console.log(`shot ${name}.jpg ${size} bytes (PNG was over the budget)`);
  } else {
    console.log(`shot ${name}.png ${size} bytes`);
  }
  return size;
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const url = `file://${join(outDir, 'dashboard/index.html')}`;
  await page.goto(url);
  await page.waitForSelector('tbody tr', { timeout: 10_000 });

  await shot(page, '1-board', async () => {});
  await shot(page, '2-detail', async () => {
    await page.locator('tbody tr').first().click();
    await page.waitForSelector('dialog[open]', { timeout: 5_000 });
  });
  await page.keyboard.press('Escape');
  await shot(page, '3-filtered', async () => {
    await page.selectOption('#category', 'Lending');
    await page.locator('#watchlist-only').check();
    await page.waitForTimeout(200);
  });
  await page.selectOption('#category', '');
  await page.locator('#watchlist-only').uncheck();
  await shot(page, '4-sandbox', async () => {
    await page.locator('#growth-weight').fill('0.7');
    await page.locator('#peak-days').fill('720');
    await page.locator('#comps-pct').fill('2');
    await page.locator('.sandbox').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
  });
  if (errors.length > 0) throw new Error(`page errors while shooting: ${errors.join(' | ')}`);
} finally {
  await browser.close();
}
console.log('shots done');
