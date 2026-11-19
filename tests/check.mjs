// End-to-end checks for the radar-3 entry.
// Run: node tests/check.mjs [--out <dir>]   (default: a fresh temp dir per run)
// Exits non-zero on any failure. The browser probe needs the Playwright
// Chromium at ~/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/home/hatch/workspace/makefun/tools/pw/node_modules/playwright-core/index.mjs';
import { buildDossier } from '../vendor/makefun-board.ts';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const KIT = '/home/hatch/workspace/makefun/bounties/token-radar-01/token-radar-01-kit';
const SNAPSHOT = join(KIT, 'input/snapshot.json');
const OUT_A = join(tmpdir(), 'radar3-check-a');
const OUT_B = join(tmpdir(), 'radar3-check-b');

function runMain(out) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const r = spawnSync('node', ['main.ts', '--input', SNAPSHOT, '--output', out], {
    cwd: ROOT, encoding: 'utf8', timeout: 120_000,
  });
  assert.equal(r.status, 0, `main.ts exit ${r.status}: ${r.stderr}\n${r.stdout}`);
  return r.stdout;
}

function listFiles(dir, base = dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listFiles(p, base, acc);
    else if (e.isFile()) acc.push(p.slice(base.length + 1));
  }
  return acc.sort();
}

function imageSize(buf, name) {
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: 'png' };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    // scan JPEG markers for the first SOF0/SOF2 frame header
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), type: 'jpeg' };
      }
      const len = buf.readUInt16BE(i + 2);
      i += 2 + len;
    }
  }
  throw new Error(`${name} is neither a whole PNG nor a JPEG`);
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));

test('main.ts runs twice, byte-identical, and logs a summary', () => {
  const logA = runMain(OUT_A);
  const logB = runMain(OUT_B);
  assert.match(logA, /198 rows/);
  assert.match(logA, /dossier\.json/);
  for (const rel of listFiles(OUT_A)) {
    const a = readFileSync(join(OUT_A, rel));
    const b = readFileSync(join(OUT_B, rel));
    assert.ok(a.equals(b), `${rel} differs between runs`);
  }
});

test('board.json: gate shape, ranks, values, farm steps, watchlist', () => {
  const board = JSON.parse(readFileSync(join(OUT_A, 'board.json'), 'utf8'));
  const rows = board.rows;
  assert.ok(rows.length >= 100 && rows.length <= 4000, `rows ${rows.length}`);
  assert.ok(readFileSync(join(OUT_A, 'board.json')).length <= 8 * 1024 * 1024);
  const slugs = new Set();
  rows.forEach((r, i) => {
    assert.equal(r.rank, i + 1);
    assert.ok(!slugs.has(r.slug), `dup ${r.slug}`);
    slugs.add(r.slug);
    assert.ok(snapshot.protocols.some((p) => p.slug === r.slug), `unknown slug ${r.slug}`);
    assert.ok(typeof r.name === 'string' && r.name.length > 0);
    assert.ok(Number.isInteger(r.implied_value_usd) && r.implied_value_usd > 0);
    assert.ok(r.implied_value_usd <= 100_000_000_000_000);
    assert.ok(Array.isArray(r.farm_steps) && r.farm_steps.length >= 3 && r.farm_steps.length <= 12);
    for (const s of r.farm_steps) assert.ok(s.trim().length >= 20 && s.trim().length <= 600, s);
    if (i > 0) assert.ok(r.implied_value_usd <= rows[i - 1].implied_value_usd);
  });
  assert.ok(new Set(rows.map((r) => r.implied_value_usd)).size > 1, 'all values equal');
  for (const w of snapshot.watchlist) assert.ok(slugs.has(w), `watchlist ${w} missing`);
});

test('dashboard: files within caps, no network anywhere', () => {
  const dash = join(OUT_A, 'dashboard');
  const files = listFiles(dash);
  assert.ok(files.includes('index.html'));
  assert.ok(files.some((f) => f.endsWith('.css')));
  assert.ok(files.some((f) => f.endsWith('.js')));
  assert.ok(files.length <= 400);
  let bytes = 0;
  for (const f of files) {
    assert.ok(/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(f.split('/').pop()), f);
    bytes += statSync(join(dash, f)).size;
    const text = readFileSync(join(dash, f), 'utf8');
    assert.ok(!text.includes('http://') && !text.includes('https://'), `${f} names a network address`);
  }
  assert.ok(bytes <= 4 * 1024 * 1024, `dashboard ${bytes} bytes`);
  // the dossier's source text must hold the whole dashboard: under 64 KiB
  assert.ok(bytes <= 60 * 1024, `dashboard source ${bytes} bytes is over the judge's read budget`);
  assert.ok(existsSync(join(OUT_A, 'data.js')), 'data.js beside the page');
});

test('screenshots: 3-4 whole images within the gate caps', () => {
  const shots = listFiles(join(OUT_A, 'screenshots'));
  assert.ok(shots.length >= 3 && shots.length <= 4, `shots ${shots.length}`);
  for (const name of shots) {
    const buf = readFileSync(join(OUT_A, 'screenshots', name));
    assert.ok(buf.length <= 512 * 1024, `${name} ${buf.length} bytes`);
    const { w, h } = imageSize(buf, name);
    assert.ok(Math.max(w, h) <= 1440, `${name} long side ${Math.max(w, h)}`);
    assert.ok(Math.min(w, h) >= 800, `${name} short side ${Math.min(w, h)}`);
  }
  assert.equal(shots[0], '1-board.png', 'first screenshot is the board (the cover)');
});

test('dossier.json is byte-for-byte what buildDossier writes', () => {
  const stored = readFileSync(join(OUT_A, 'dossier.json'));
  const rebuilt = buildDossier(OUT_A, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  });
  assert.ok(Buffer.from(rebuilt).equals(stored), 'dossier mismatch');
  assert.ok(stored.length <= 1.5 * 1024 * 1024, `dossier ${stored.length} bytes`);
});

test('browser probe: board renders, filter works, detail opens, sandbox re-ranks, no network', async () => {
  const browser = await chromium.launch({
    executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    const external = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('request', (r) => { if (/^https?:/.test(r.url())) external.push(r.url()); });
    await page.goto(`file://${join(OUT_A, 'dashboard/index.html')}`);
    await page.waitForSelector('tbody tr', { timeout: 10_000 });
    const rowCount = await page.locator('tbody tr').count();
    assert.equal(rowCount, 198, `rendered rows ${rowCount}`);
    // filter by category
    await page.selectOption('#category', 'Lending');
    const lending = await page.locator('tbody tr').count();
    assert.ok(lending > 0 && lending < 198, `lending rows ${lending}`);
    await page.selectOption('#category', '');
    // detail dialog for rank 1
    await page.locator('tbody tr').first().click();
    await page.waitForSelector('dialog[open]', { timeout: 5_000 });
    const detail = await page.locator('dialog[open]').innerText();
    assert.match(detail, /Implied value/);
    assert.match(detail, /Farm plan/);
    await page.keyboard.press('Escape');
    // sandbox: moving the growth slider changes the top value
    const before = await page.locator('tbody tr').first().locator('td.value').innerText();
    await page.locator('#growth-weight').fill('0.8');
    await page.waitForTimeout(300);
    const after = await page.locator('tbody tr').first().locator('td.value').innerText();
    assert.notEqual(before, after, 'sandbox did not re-rank');
    assert.deepEqual(errors, [], `console errors: ${errors.join(' | ')}`);
    assert.deepEqual(external, [], `external requests: ${external.join(' | ')}`);
  } finally {
    await browser.close();
  }
});
