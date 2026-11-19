// radar-3: a comps-based token launch radar.
//
// The model prices a pre-token protocol the way a buyer would price a
// company with no public shares: from what the market already pays for
// the same kind of business. For every protocol whose token trades, the
// snapshot carries its market cap and its TVL, so the ratio mcap/TVL is
// observable; the median ratio per category (shrunk toward the global
// median, so a thin category cannot set the price alone) is the comps
// multiple a pre-token protocol of that kind is worth. The implied value
// is TVL times that multiple, moved by the protocol's own seven-day
// growth and by how long it has run with no token (a hump: too young is
// unproven, too old is a protocol that may never launch). The 25th and
// 75th percentile multiples give the uncertainty interval. Nothing here
// names a protocol: every number comes from the snapshot's own figures.
export const MODEL_VERSION = 'radar-3';

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface CompsStats {
  median: number;
  p25: number;
  p75: number;
  n: number;
}

export interface Comps {
  global: CompsStats;
  byCategory: Map<string, CompsStats>;
}

export interface ValueEstimate {
  implied: number;
  low: number;
  high: number;
  multiple: number;
  multiple_low: number;
  multiple_high: number;
  growth_factor: number;
  maturity_factor: number;
  age: number | null;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  primary_chain: string;
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  multiple: number;
  multiple_low: number;
  multiple_high: number;
  low_usd: number;
  high_usd: number;
  growth_factor: number;
  maturity_factor: number;
  watchlist: boolean;
}

export interface RadarRow {
  slug: string;
  name: string;
  rank: number;
  value: number;
  low: number;
  high: number;
  category: string | null;
  chains: string[];
  primary: string;
  tvl: number;
  change: number | null;
  age: number | null;
  mult: number;
  mult_lo: number;
  mult_hi: number;
  growth: number;
  maturity: number;
  watchlist: boolean;
  steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  mcap_tvl: number;
  change_7d: number | null;
}

export interface RadarData {
  version: string;
  as_of: string;
  source: string;
  floor_usd: number;
  watchlist_count: number;
  model: {
    growth_weight: number;
    peak_days: number;
    global_multiple: number;
    global_p25: number;
    global_p75: number;
    comps: { category: string; median: number; p25: number; p75: number; n: number }[];
  };
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {}

// The model's constants, all stated here so the dashboard can show them.
export const GROWTH_WEIGHT = 0.4;
export const GROWTH_MIN = -50;
export const GROWTH_MAX = 150;
export const MATURITY_PEAK_DAYS = 540;
export const MATURITY_SIGMA = 0.85;
export const MATURITY_FLOOR = 0.72;
export const GATE_MAX_VALUE = 100_000_000_000_000;

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

function statsOf(ratios: number[]): CompsStats {
  const sorted = [...ratios].sort((a, b) => a - b);
  return {
    median: quantile(sorted, 0.5),
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
    n: sorted.length,
  };
}

/** The comps table: mcap/TVL ratios of every protocol whose token trades. */
export function comps(snapshot: Snapshot): Comps {
  const all: number[] = [];
  const byCat = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    // A zero market cap is a missing record, not a traded value.
    if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) {
      const r = p.mcap_usd / p.tvl_usd;
      all.push(r);
      const key = p.category ?? 'Uncategorised';
      const list = byCat.get(key) ?? [];
      list.push(r);
      byCat.set(key, list);
    }
  }
  const byCategory = new Map<string, CompsStats>();
  for (const [cat, ratios] of byCat) byCategory.set(cat, statsOf(ratios));
  return { global: statsOf(all), byCategory };
}

/**
 * A category's multiple, shrunk toward the global median: a category
 * with five or more traded protocols carries half the weight, a thin
 * one a quarter or a fifth, and an unseen category the global median.
 * The result always lies between the category median and the global one.
 */
export function shrink(raw: number, global: number, n: number): number {
  const w = n >= 5 ? 0.5 : n >= 2 ? 0.35 : n === 1 ? 0.2 : 0;
  return global + w * (raw - global);
}

export function categoryMultiple(category: string | null, c: Comps): number {
  const key = category ?? 'Uncategorised';
  const s = c.byCategory.get(key);
  if (!s) return c.global.median;
  return shrink(s.median, c.global.median, s.n);
}

function categoryQuantile(category: string | null, c: Comps, q: 'p25' | 'p75'): number {
  const key = category ?? 'Uncategorised';
  const s = c.byCategory.get(key);
  if (!s) return c.global[q];
  return shrink(s[q], c.global[q], s.n);
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const to = Date.parse(`${asOf}T00:00:00Z`);
  const from = Date.parse(`${listedAt}T00:00:00Z`);
  if (Number.isNaN(to) || Number.isNaN(from)) return null;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/** Seven-day growth moves value, dampened: +100% growth is worth +40%. */
export function growthFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  const g = Math.min(GROWTH_MAX, Math.max(GROWTH_MIN, change7d));
  return 1 + GROWTH_WEIGHT * (g / 100);
}

/**
 * Maturity is a hump in log-age: a protocol is worth most around
 * 540 days old (proven, still pre-token), less when brand new and less
 * again when it has run for years without issuing a token.
 */
export function maturityFactor(age: number | null): number {
  if (age === null) return 1;
  const x = Math.log(age + 30) - Math.log(MATURITY_PEAK_DAYS + 30);
  return MATURITY_FLOOR + (1 - MATURITY_FLOOR) * Math.exp(-(x * x) / (2 * MATURITY_SIGMA * MATURITY_SIGMA));
}

/** True when the snapshot records no token for the protocol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

const EXCLUDED_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Rankable means pre-token and not a wrapped, staked or bridged product
 * of a token that already trades — the house watchlist's own rule,
 * applied to every row so the board never ranks WBTC, a staked-ETH
 * product or a bridge above the protocols the radar exists to find.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const ex of EXCHANGE_PREFIXES) if (p.name.startsWith(ex)) return false;
  return true;
}

export function impliedValue(p: SnapshotProtocol, asOf: string, c: Comps): ValueEstimate {
  const age = ageDays(asOf, p.listed_at);
  const multiple = categoryMultiple(p.category, c);
  const multipleLow = categoryQuantile(p.category, c, 'p25');
  const multipleHigh = categoryQuantile(p.category, c, 'p75');
  const gf = growthFactor(p.change_7d);
  const mf = maturityFactor(age);
  const implied = Math.min(GATE_MAX_VALUE, Math.max(1, Math.round(p.tvl_usd * multiple * gf * mf)));
  const low = Math.min(GATE_MAX_VALUE, Math.max(1, Math.round(p.tvl_usd * multipleLow * gf * mf)));
  const high = Math.min(GATE_MAX_VALUE, Math.max(1, Math.round(p.tvl_usd * multipleHigh * gf * mf)));
  return {
    implied, low, high, multiple, multiple_low: multipleLow, multiple_high: multipleHigh,
    growth_factor: gf, maturity_factor: mf, age,
  };
}

// --- farm plans -------------------------------------------------------

/** Rough gas cost of one transaction on each chain, in US dollars. */
const GAS_USD: Record<string, number> = {
  Ethereum: 4.0, Solana: 0.02, Base: 0.08, Arbitrum: 0.1, Optimism: 0.08,
  Polygon: 0.05, Binance: 0.15, Avalanche: 0.3, zkSync: 0.12, Linea: 0.1,
  Scroll: 0.1, Blast: 0.08, Mantle: 0.06, Mode: 0.06, Starknet: 0.15,
};
const DEFAULT_GAS_USD = 0.5;

function gasUsd(chain: string): number {
  return GAS_USD[chain] ?? DEFAULT_GAS_USD;
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** Position size and monthly volume target by TVL tier. */
function tier(tvl: number): { size: string; size2: string; volume: string } {
  if (tvl < 25_000_000) return { size: '$250 to $500', size2: '$250', volume: '$2,000' };
  if (tvl < 250_000_000) return { size: '$500 to $2,000', size2: '$500', volume: '$10,000' };
  return { size: '$1,000 to $5,000', size2: '$1,000', volume: '$25,000' };
}

interface Playbook {
  core: string;
  second: string;
}

const PLAYBOOKS: Record<string, Playbook> = {
  Dexs: {
    core: 'swap a major stablecoin for another asset through the pool',
    second: 'add liquidity to the pool with the highest volume and keep the position open',
  },
  Lending: {
    core: 'supply a major stablecoin to the lending market and start earning interest',
    second: 'borrow a small amount against the supplied collateral to show both sides of the market',
  },
  Yield: {
    core: 'deposit into the highest-TVL vault and let the yield accrue',
    second: 'deposit into a second vault on another supported chain to spread the position',
  },
  'Yield Aggregator': {
    core: 'deposit into the highest-TVL vault and let the yield accrue',
    second: 'deposit into a second vault on another supported chain to spread the position',
  },
  CDP: {
    core: 'lock collateral and mint the protocol-issued stablecoin against it',
    second: 'use the minted stablecoin in a lending market, then repay part of the debt',
  },
  RWA: {
    core: 'buy the tokenised real-world asset the protocol issues and hold it in your wallet',
    second: 'add to the position in a second asset the protocol tokenises',
  },
  Derivatives: {
    core: 'open a small leveraged position on the most liquid market',
    second: 'close the position, then open a second one in the opposite direction',
  },
  Perps: {
    core: 'open a small perpetual position on the most liquid market',
    second: 'close the position, then open a second one in the opposite direction',
  },
  Options: {
    core: 'buy a call option on the most liquid market with a one-week expiry',
    second: 'sell a covered call against an asset you already hold',
  },
  Payments: {
    core: 'pay for a real purchase through the protocol and keep the receipt',
    second: 'set up a recurring payment through the protocol for a second month',
  },
  Insurance: {
    core: 'buy cover for a position you hold elsewhere, for the longest term on offer',
    second: 'buy a second, smaller cover on a different protocol or asset',
  },
  Restaking: {
    core: 'restake liquid staking tokens through the protocol and keep them staked',
    second: 'delegate the restaked position to a second operator the protocol lists',
  },
  'Staking Pool': {
    core: 'stake through the pool and keep the stake locked for the full term',
    second: 'add a second stake in a smaller amount on another supported chain',
  },
  'Governance Incentives': {
    core: 'lock tokens or voting power in the governance module for the longest term',
    second: 'vote on the next live proposal and keep the vote on record',
  },
  'Risk Curators': {
    core: 'deposit into the highest-TVL curated vault and let the curator manage it',
    second: 'deposit into a second curated vault with a different risk profile',
  },
  'Basis Trading': {
    core: 'open the basis trade the protocol runs and hold it through one funding cycle',
    second: 'close the trade, then reopen it at the next funding reset',
  },
  'Onchain Capital Allocator': {
    core: 'allocate capital to the highest-TVL strategy the protocol runs',
    second: 'allocate a second, smaller amount to a different strategy it lists',
  },
  'Collateral Markets': {
    core: 'supply collateral to the market with the deepest liquidity',
    second: 'borrow a small amount against it and repay it within the week',
  },
  Chain: {
    core: 'bridge funds in and use the chain-native app the protocol runs',
    second: 'use a second app on the same chain that the protocol supports',
  },
  CeDeFi: {
    core: 'deposit into the protocol’s centralised-yield product and hold the position',
    second: 'add a second deposit after the first week’s yield posts',
  },
  'Stablecoin Wrapper': {
    core: 'wrap the underlying stablecoin through the protocol and hold the wrapped form',
    second: 'unwrap half the position, then wrap it again to show both directions',
  },
};

const DEFAULT_PLAYBOOK: Playbook = {
  core: 'use the protocol’s main product with a real position and keep it open',
  second: 'use a second feature of the same product with a smaller position',
};

function playbookFor(category: string | null): Playbook {
  if (category !== null && Object.prototype.hasOwnProperty.call(PLAYBOOKS, category)) {
    return PLAYBOOKS[category];
  }
  return DEFAULT_PLAYBOOK;
}

function holdDays(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 14;
  if (age < 540) return 30;
  return 60;
}

/** Eight concrete farm steps for one protocol, each with a cost and a time. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const gas = gasUsd(chain);
  const gasText = gas >= 1 ? `$${gas.toFixed(2)}` : `$${gas.toFixed(2)}`;
  const t = tier(p.tvl_usd);
  const pb = playbookFor(p.category);
  const hold = holdDays(age);
  return [
    `Set up a fresh wallet for ${p.name} on ${chain}: fund it with ${t.size} in a major stablecoin plus about ${gasText} for gas (roughly ${gasText} per transaction on ${chain}; 10 minutes).`,
    `Open ${p.name}’s official app on ${chain} and ${pb.core} with ${t.size2} (about ${gasText} in gas; 15 to 30 minutes).`,
    `In the same session, ${pb.second} with another ${t.size2} so ${p.name} sees more than one action from the wallet (about ${gasText} in gas; 20 minutes).`,
    `Return every week and repeat the core action so ${p.name} records steady activity: aim for at least ${t.volume} of volume a month (about 20 minutes a week).`,
    `Check ${p.name}’s points or quest page each week and finish every task it lists (free except gas, about ${gasText} a task; 15 minutes).`,
    `Deepen the position once: add another ${t.size2} to ${p.name} and hold it for at least ${hold} days, so the position reads as long-term rather than a one-day farm (about ${gasText} in gas; 10 minutes).`,
    `Never sign a blind transaction for ${p.name} and never approve unlimited spending: review each signature in your wallet, keep approvals capped, and only use the protocol’s official app (5 minutes per check).`,
    `Watch ${p.name}’s TVL and announcements weekly; if TVL falls by a third or the team ships a token, re-read this plan before adding more money (10 minutes a week).`,
  ];
}

// --- board ------------------------------------------------------------

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      mcap_tvl: (p.mcap_usd as number) / p.tvl_usd,
      change_7d: p.change_7d,
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd);
}

export function buildBoard(snapshot: Snapshot, c: Comps = comps(snapshot)): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => {
      const v = impliedValue(p, snapshot.as_of, c);
      return { p, v };
    })
    .sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map(({ p, v }, i) => ({
    slug: p.slug,
    name: p.name,
    rank: i + 1,
    implied_value_usd: v.implied,
    farm_steps: farmSteps(p, v.age),
    category: p.category,
    chains: p.chains,
    primary_chain: p.chains[0] ?? 'Ethereum',
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    age_days: v.age,
    multiple: v.multiple,
    multiple_low: v.multiple_low,
    multiple_high: v.multiple_high,
    low_usd: v.low,
    high_usd: v.high,
    growth_factor: v.growth_factor,
    maturity_factor: v.maturity_factor,
    watchlist: watch.has(p.slug),
  }));
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    slug: row.slug,
    name: row.name,
    rank: row.rank,
    value: row.implied_value_usd,
    low: row.low_usd,
    high: row.high_usd,
    category: row.category,
    chains: row.chains,
    primary: row.primary_chain,
    tvl: row.tvl_usd,
    change: row.change_7d,
    age: row.age_days,
    mult: row.multiple,
    mult_lo: row.multiple_low,
    mult_hi: row.multiple_high,
    growth: row.growth_factor,
    maturity: row.maturity_factor,
    watchlist: row.watchlist,
    steps: row.farm_steps,
  };
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const c = comps(snapshot);
  const board = buildBoard(snapshot, c);
  const radar: RadarData = {
    version: MODEL_VERSION,
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    watchlist_count: snapshot.watchlist.length,
    model: {
      growth_weight: GROWTH_WEIGHT,
      peak_days: MATURITY_PEAK_DAYS,
      global_multiple: c.global.median,
      global_p25: c.global.p25,
      global_p75: c.global.p75,
      comps: [...c.byCategory.entries()]
        .map(([category, s]) => ({ category, median: s.median, p25: s.p25, p75: s.p75, n: s.n }))
        .sort((a, b) => b.n - a.n),
    },
    rows: board.map(radarRow),
    live: liveRows(snapshot),
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new SnapshotError('snapshot is not an object');
  const s = raw as Record<string, unknown>;
  if (typeof s.as_of !== 'string' || typeof s.source !== 'string') {
    throw new SnapshotError('snapshot needs as_of and source strings');
  }
  if (typeof s.floor_usd !== 'number' || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) {
    throw new SnapshotError('snapshot needs floor_usd, protocols and watchlist');
  }
  for (const p of s.protocols as Record<string, unknown>[]) {
    for (const k of ['slug', 'name', 'tvl_usd'] as const) {
      if (typeof p[k] !== 'string' && typeof p[k] !== 'number') throw new SnapshotError(`protocol lacks ${k}`);
    }
  }
  return s as unknown as Snapshot;
}

/** The first gate-shaped problem with a board, or null when it is valid. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (let i = 0; i < board.length; i++) {
    if (board[i].rank !== i + 1) return `rank ${board[i].rank} at position ${i}`;
  }
  for (let i = 0; i < board.length; i++) {
    const r = board[i];
    if (!slugs.has(r.slug)) return `row ${r.slug} is not in the snapshot`;
    if (seen.has(r.slug)) return `row ${r.slug} repeats`;
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) return `row ${r.slug} has no name`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `row ${r.slug} has a bad implied value`;
    }
    if (r.implied_value_usd > GATE_MAX_VALUE) return `row ${r.slug} exceeds the value cap`;
    if (i > 0 && r.implied_value_usd > board[i - 1].implied_value_usd) {
      return `row ${r.slug} rises above the row before it`;
    }
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `row ${r.slug} has ${r.farm_steps?.length ?? 0} farm steps`;
    }
    for (const s of r.farm_steps) {
      if (s.trim().length < 20 || s.trim().length > 600) return `row ${r.slug} has a farm step outside 20-600 characters`;
    }
  }
  if (new Set(board.map((r) => r.implied_value_usd)).size < 2 && board.length >= 2) {
    return 'every implied value is the same';
  }
  for (const w of snapshot.watchlist) if (!seen.has(w)) return `watchlist ${w} is missing`;
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
