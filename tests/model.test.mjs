// Unit tests for the radar-3 comps model (lib/model.ts).
// Run: node --test tests/model.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseSnapshot,
  comps,
  categoryMultiple,
  growthFactor,
  maturityFactor,
  ageDays,
  isPreToken,
  isRankable,
  impliedValue,
  buildBoard,
  farmSteps,
  liveRows,
  boardIssue,
} from '../lib/model.ts';

const here = dirname(fileURLToPath(import.meta.url));
const KIT = '/home/hatch/workspace/makefun/bounties/token-radar-01/token-radar-01-kit';
const snapshot = parseSnapshot(readFileSync(join(KIT, 'input/snapshot.json'), 'utf8'));
const C = comps(snapshot);
const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));

test('snapshot parses: 758 protocols, 40 on the watchlist', () => {
  assert.equal(snapshot.protocols.length, 758);
  assert.equal(snapshot.watchlist.length, 40);
  assert.equal(snapshot.floor_usd, 50_000_000);
  assert.equal(snapshot.as_of, '2026-11-14');
});

test('comps: global median near 0.214, quartiles ordered', () => {
  assert.ok(Math.abs(C.global.median - 0.214) < 0.01, `median ${C.global.median}`);
  assert.ok(C.global.p25 > 0 && C.global.p25 < C.global.median);
  assert.ok(C.global.p75 > C.global.median);
  // 128 traded protocols: 15 with mcap 0 and 1 with mcap -1 are missing records
  assert.equal(C.global.n, 128);
});

test('comps: category multiples are shrunk toward the global median', () => {
  for (const [cat, m] of C.byCategory) {
    assert.ok(m.n >= 1);
    assert.ok(m.median > 0);
    // shrunk multiple stays between the raw category median and the global one
    const lo = Math.min(m.median, C.global.median);
    const hi = Math.max(m.median, C.global.median);
    assert.ok(categoryMultiple(cat, C) >= lo - 1e-9 && categoryMultiple(cat, C) <= hi + 1e-9);
  }
  assert.equal(categoryMultiple('No Such Category', C), C.global.median);
  assert.equal(categoryMultiple(null, C), C.global.median);
});

test('growthFactor clamps and centres on 1', () => {
  assert.equal(growthFactor(null), 1);
  assert.equal(growthFactor(0), 1);
  assert.ok(Math.abs(growthFactor(100) - 1.4) < 1e-9);
  assert.ok(Math.abs(growthFactor(-50) - 0.8) < 1e-9);
  assert.ok(Math.abs(growthFactor(200) - 1.6) < 1e-9, 'clamped at +150');
  assert.ok(Math.abs(growthFactor(-100) - 0.8) < 1e-9, 'clamped at -50');
});

test('maturityFactor humps: peak near 540 days, young and old discounted', () => {
  assert.ok(Math.abs(maturityFactor(540) - 1) < 0.02, `peak ${maturityFactor(540)}`);
  assert.ok(maturityFactor(0) < 0.8, `new ${maturityFactor(0)}`);
  assert.ok(maturityFactor(2000) < maturityFactor(540));
  assert.ok(maturityFactor(2000) > 0.7);
  assert.equal(maturityFactor(null), 1);
  assert.ok(maturityFactor(90) < maturityFactor(540));
});

test('ageDays counts calendar days', () => {
  assert.equal(ageDays('2026-11-14', '2026-11-14'), 0);
  assert.equal(ageDays('2026-11-14', '2025-11-14'), 365);
  assert.equal(ageDays('2026-11-14', null), null);
});

test('isRankable excludes wrapped, staked, bridged and versioned products', () => {
  // the real snapshot entries the house rule keeps off the watchlist
  assert.equal(isRankable(bySlug.get('wbtc')), false, 'WBTC is a Bridge');
  assert.equal(isRankable(bySlug.get('usdt0')), false, 'USDT0 is a Bridge');
  assert.equal(isRankable(bySlug.get('binance-staked-eth')), false, 'Liquid Staking');
  assert.equal(isRankable(bySlug.get('coinbase-bridge')), false, 'Bridge + exchange prefix');
  const mk = (over) => ({
    slug: 'x', name: 'Plain', category: 'Dexs', chains: ['Ethereum'],
    tvl_usd: 60_000_000, change_7d: null, mcap_usd: null,
    listed_at: null, gecko_id: null, symbol: null, ...over,
  });
  assert.equal(isRankable(mk({})), true);
  assert.equal(isRankable(mk({ name: 'Wrapped Foo' })), false, 'wrapped word');
  assert.equal(isRankable(mk({ name: 'Foo Staking' })), false, 'staking word');
  assert.equal(isRankable(mk({ name: 'Binance Foo' })), false, 'exchange prefix');
  assert.equal(isRankable(mk({ category: 'Bridge' })), false);
  assert.equal(isRankable(mk({ category: 'Liquid Staking' })), false);
  assert.equal(isRankable(mk({ category: 'Liquid Restaking' })), false);
  assert.equal(isRankable(mk({ category: 'CEX' })), false);
  assert.equal(isRankable(mk({ name: 'Foo V2' })), false, 'version marker');
  assert.equal(isRankable(mk({ name: 'Foo 2.0' })), false, 'version marker');
  assert.equal(isRankable(mk({ gecko_id: 'foo', symbol: 'FOO' })), false, 'token recorded');
  assert.equal(isRankable(mk({ symbol: 'FOO' })), false, 'symbol alone');
  // the house keeps USDD (a CDP stablecoin) on the watchlist: the rule ranks it
  assert.equal(isRankable(bySlug.get('usdd')), true, 'USDD is on the watchlist');
  // every watchlist slug is rankable
  for (const slug of snapshot.watchlist) assert.equal(isRankable(bySlug.get(slug)), true, slug);
});

test('impliedValue follows the comps formula and carries an interval', () => {
  const p = bySlug.get('steakhouse-financial');
  const v = impliedValue(p, snapshot.as_of, C);
  const expected = p.tvl_usd * v.multiple * v.growth_factor * v.maturity_factor;
  assert.ok(Math.abs(v.implied - Math.round(expected)) <= 1);
  assert.ok(v.low > 0 && v.low <= v.implied && v.implied <= v.high);
  assert.ok(v.multiple > 0 && v.multiple < 5);
  assert.equal(v.age, ageDays(snapshot.as_of, p.listed_at));
});

test('impliedValue does not depend on the protocol name', () => {
  const p = bySlug.get('gauntlet');
  const renamed = { ...p, name: 'Totally Different Name', slug: 'totally-different' };
  assert.equal(impliedValue(renamed, snapshot.as_of, C).implied, impliedValue(p, snapshot.as_of, C).implied);
});

test('buildBoard: 198 rows, ranks 1..N, values non-increasing, watchlist covered', () => {
  const board = buildBoard(snapshot);
  assert.equal(board.length, 198);
  assert.deepEqual(board.map((r) => r.rank), Array.from({ length: 198 }, (_, i) => i + 1));
  for (let i = 1; i < board.length; i++) {
    assert.ok(board[i].implied_value_usd <= board[i - 1].implied_value_usd, `row ${i}`);
  }
  assert.ok(board.every((r) => r.implied_value_usd > 0 && r.implied_value_usd <= 100_000_000_000_000));
  assert.ok(new Set(board.map((r) => r.implied_value_usd)).size > 100, 'values vary');
  const slugs = new Set(board.map((r) => r.slug));
  for (const w of snapshot.watchlist) assert.ok(slugs.has(w), `watchlist ${w} missing`);
  assert.equal(boardIssue(board, snapshot), null);
  assert.ok(board.every((r) => r.watchlist === snapshot.watchlist.includes(r.slug)));
});

test('farmSteps: 8 concrete steps with cost and time, 20-600 chars', () => {
  const board = buildBoard(snapshot);
  for (const row of board) {
    assert.equal(row.farm_steps.length, 8, row.slug);
    for (const s of row.farm_steps) {
      assert.ok(s.length >= 20 && s.length <= 600, `${row.slug}: ${s.length} chars`);
      assert.ok(s.includes(row.name) || s.includes(row.primary_chain), `${row.slug}: step names the protocol or chain`);
    }
    const joined = row.farm_steps.join(' ');
    assert.ok(/\$\d/.test(joined), `${row.slug}: a step states a dollar cost`);
    assert.ok(/minute|hour|day|week/i.test(joined), `${row.slug}: a step states a time`);
  }
  // steps differ per protocol (not a canned list)
  const first = board[0].farm_steps.join('|');
  const second = board[1].farm_steps.join('|');
  assert.notEqual(first, second);
});

test('liveRows separates token-bearing protocols with real market caps', () => {
  const live = liveRows(snapshot);
  assert.ok(live.length >= 100, `live ${live.length}`);
  assert.ok(live.every((r) => r.mcap_usd > 0));
  assert.ok(live[0].mcap_usd >= live[1].mcap_usd, 'sorted by mcap desc');
  assert.ok(live.every((r) => typeof r.mcap_tvl === 'number' && r.mcap_tvl > 0));
});

test('buildBoard is deterministic', () => {
  const a = JSON.stringify(buildBoard(snapshot));
  const b = JSON.stringify(buildBoard(snapshot));
  assert.equal(a, b);
});

test('isPreToken matches the snapshot record, nothing more', () => {
  assert.equal(isPreToken(bySlug.get('steakhouse-financial')), true);
  assert.equal(isPreToken(bySlug.get('uniswap-v3')), false);
});
