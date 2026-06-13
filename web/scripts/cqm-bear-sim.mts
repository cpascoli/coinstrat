/**
 * CQM Risk DCA bot — forward bear/bull scenario simulation.
 *
 * Drives the LIVE model (fitCQM + riskForPriceFair from src/utils/cqm.ts) over
 * real BTC history plus two synthetic forward price paths and applies the bot's
 * exact sizing rule:
 *
 *   target = base × (1 − 2 × Risk)     (BUY if > 0, SELL if < 0, skip if |·| < £1)
 *
 * Two scenarios (user assumptions, 7 Jun 2026):
 *   - Mid bear : bottom ~$55K end of summer 2026, choppy base, then bull.
 *   - Deep bear: bottom ~$40K end of 2026, longer base, then bull.
 *   Both bull legs: base case ~$225K cycle peak in 2029 (post-2028-halving top).
 *
 * Faithfulness notes:
 *   - Risk uses the real CQM fair-value model. The fit is refreshed every
 *     REFIT_EVERY_DAYS so the QR-50% fair value advances with sim-time (the live
 *     bot refits daily; monthly here is the speed/fidelity tradeoff).
 *   - Cycle-gamma and tail-scaling are left at their effectively-neutral
 *     production defaults, matching what the deployed bot actually does.
 *   - Prices are modelled in USD; the bot trades BTC-GBP, so USD is converted at
 *     a fixed GBPUSD. Synthetic paths are deterministic (seeded) but illustrative.
 *
 * Run: npm test -- tests/cqm-bear-sim.test.ts   (vitest loads the TS/ESM graph)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fitCQM, riskForPriceFair, snapshotAt, type CQMFit } from '../src/utils/cqm.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- tunable inputs --------------------------------------------------------

const BASE_GBP = 500;            // daily base size
const GBPUSD = 1.27;             // 1 GBP = 1.27 USD  →  BTC-GBP = BTC-USD / 1.27
const MIN_TRADE_GBP = 1;         // matches computeTarget() in the live bot
const SIM_END = '2029-12-31';
const PEAK_DATE = '2029-10-15';  // base-case cycle peak (waypoint); used for bull valuation
const REFIT_EVERY_DAYS = 90;     // re-run fitCQM this often as sim-time advances

const DAY_MS = 86_400_000;

interface RawPoint { date: string; close: number; }
interface PricePoint { date: string; ts: number; price: number; }

// Realized daily closes after btc_daily.json ends (2026-05-23), through the
// "today" anchor the user gave (2026-06-07 @ $60,716). Jun 3-6 interpolated in
// log space between the Jun 2 close and the Jun 7 anchor.
const REALIZED_TAIL: RawPoint[] = [
  { date: '2026-05-24', close: 77000.57 },
  { date: '2026-05-25', close: 77273.26 },
  { date: '2026-05-26', close: 75842.51 },
  { date: '2026-05-27', close: 74348.55 },
  { date: '2026-05-28', close: 73531.95 },
  { date: '2026-05-29', close: 73384.46 },
  { date: '2026-05-30', close: 73794.27 },
  { date: '2026-05-31', close: 73601.92 },
  { date: '2026-06-01', close: 71329.41 },
  { date: '2026-06-02', close: 67587.20 },
  { date: '2026-06-03', close: 66155 },
  { date: '2026-06-04', close: 64753 },
  { date: '2026-06-05', close: 63381 },
  { date: '2026-06-06', close: 62038 },
  { date: '2026-06-07', close: 60716 },
];

const SIM_START_DATE = '2026-06-07';
const SIM_START_PRICE = 60716;

// --- scenario price-path waypoints (USD) -----------------------------------

interface Waypoint { date: string; price: number; }

const MID_BEAR_WAYPOINTS: Waypoint[] = [
  { date: '2026-06-07', price: 60716 },
  { date: '2026-09-21', price: 55000 },   // summer bottom
  { date: '2026-12-31', price: 62000 },   // mild, choppy recovery
  { date: '2027-06-30', price: 70000 },   // slow accumulation grind
  { date: '2027-12-31', price: 90000 },   // reclaim
  { date: '2028-04-15', price: 110000 },  // ~halving
  { date: '2028-12-31', price: 150000 },  // markup
  { date: '2029-06-30', price: 200000 },
  { date: '2029-10-15', price: 225000 },  // cycle peak
  { date: '2029-12-31', price: 190000 },  // post-peak cooling
];

const DEEP_BEAR_WAYPOINTS: Waypoint[] = [
  { date: '2026-06-07', price: 60716 },
  { date: '2026-09-21', price: 50000 },   // summer leg down
  { date: '2026-12-31', price: 40000 },   // deep bottom, end of year
  { date: '2027-06-30', price: 48000 },   // long base building
  { date: '2027-12-31', price: 65000 },   // recovery underway
  { date: '2028-04-15', price: 85000 },   // ~halving
  { date: '2028-12-31', price: 140000 },  // markup
  { date: '2029-06-30', price: 195000 },
  { date: '2029-10-15', price: 225000 },  // same cycle peak
  { date: '2029-12-31', price: 185000 },
];

// Ornstein-Uhlenbeck deviation overlay → relief rallies + fast crashes around
// the waypoint trend without permanently drifting off it.
const OU_PHI = 0.94;             // persistence (~2-3 week swings)
const OU_TARGET_STD = 0.07;      // stationary std of log-deviation (~±7%, 2σ ≈ ±14%)
const OU_SIGMA = OU_TARGET_STD * Math.sqrt(1 - OU_PHI * OU_PHI);

// --- numeric / date utils --------------------------------------------------

function toTs(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime();
}
function toDateStr(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Deterministic PRNG (mulberry32) + Box-Muller normal draws. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeGauss(rng: () => number): () => number {
  return () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/** Linear interpolation of log-price across sorted waypoints. */
function trendLogAt(ts: number, wp: { ts: number; logp: number }[]): number {
  if (ts <= wp[0].ts) return wp[0].logp;
  if (ts >= wp[wp.length - 1].ts) return wp[wp.length - 1].logp;
  for (let i = 1; i < wp.length; i++) {
    if (ts <= wp[i].ts) {
      const a = wp[i - 1];
      const b = wp[i];
      const f = (ts - a.ts) / (b.ts - a.ts);
      return a.logp + f * (b.logp - a.logp);
    }
  }
  return wp[wp.length - 1].logp;
}

function buildForwardPath(waypoints: Waypoint[], seed: number): PricePoint[] {
  const wp = waypoints.map((w) => ({ ts: toTs(w.date), logp: Math.log(w.price) }));
  const gauss = makeGauss(makeRng(seed));
  const out: PricePoint[] = [];
  const startTs = toTs(SIM_START_DATE);
  const endTs = toTs(SIM_END);
  let dev = 0;
  for (let ts = startTs + DAY_MS; ts <= endTs; ts += DAY_MS) {
    dev = OU_PHI * dev + OU_SIGMA * gauss();
    const price = Math.exp(trendLogAt(ts, wp) + dev);
    out.push({ date: toDateStr(ts), ts, price: Math.max(price, 1) });
  }
  return out;
}

// --- real history ----------------------------------------------------------

function loadHistory(): PricePoint[] {
  const filePath = resolve(__dirname, '../public/data/btc_daily.json');
  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as RawPoint[];
  const byDate = new Map<string, number>();
  for (const r of raw) {
    if (Number.isFinite(r.close) && r.close > 0) byDate.set(r.date, r.close);
  }
  for (const r of REALIZED_TAIL) byDate.set(r.date, r.close);
  return [...byDate.entries()]
    .filter(([date]) => date <= SIM_START_DATE)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, close]) => ({ date, ts: toTs(date), price: close }));
}

// --- simulation ------------------------------------------------------------

interface DayRow {
  date: string;
  ts: number;
  priceUsd: number;
  fairUsd: number;
  btcGbp: number;
  risk: number;
  buyGbp: number;
  sellGbp: number;
  // cumulative state AFTER this day
  botBtc: number;
  holdBtc: number;
  grossInvestedGbp: number;
  grossSoldGbp: number;
  realizedPnlGbp: number;
  costBasisGbpRemaining: number;
}

interface SimResult {
  label: string;
  rows: DayRow[];
}

function simulate(label: string, waypoints: Waypoint[], seed: number): SimResult {
  const history = loadHistory();
  const path = buildForwardPath(waypoints, seed);

  const points: PricePoint[] = [...history];
  let fit: CQMFit = fitCQM(points);
  let daysSinceRefit = 0;

  let botBtc = 0;
  let holdBtc = 0;
  let grossInvestedGbp = 0;
  let grossSoldGbp = 0;
  let realizedPnlGbp = 0;
  let costBasisGbpRemaining = 0;

  const rows: DayRow[] = [];

  for (const p of path) {
    points.push(p);
    daysSinceRefit += 1;
    if (daysSinceRefit >= REFIT_EVERY_DAYS) {
      fit = fitCQM(points);
      daysSinceRefit = 0;
    }

    let risk = riskForPriceFair(fit, p.ts, p.price);
    if (!Number.isFinite(risk)) risk = 0.5;
    risk = clamp(risk, 0, 1);

    const fairUsd = snapshotAt(fit, p.ts)?.qrDashedMedian ?? NaN;
    const btcGbp = p.price / GBPUSD;
    const signed = Math.round(BASE_GBP * (1 - 2 * risk) * 100) / 100;

    let buyGbp = 0;
    let sellGbp = 0;

    if (signed >= MIN_TRADE_GBP) {
      buyGbp = signed;
      const btc = buyGbp / btcGbp;
      botBtc += btc;
      holdBtc += btc;
      grossInvestedGbp += buyGbp;
      costBasisGbpRemaining += buyGbp;
    } else if (signed <= -MIN_TRADE_GBP) {
      const want = -signed;
      const maxGbp = botBtc * btcGbp;
      sellGbp = Math.min(want, maxGbp);
      if (sellGbp >= MIN_TRADE_GBP && botBtc > 0) {
        const btc = sellGbp / btcGbp;
        const avgCost = costBasisGbpRemaining / botBtc;
        const costOut = btc * avgCost;
        botBtc -= btc;
        costBasisGbpRemaining -= costOut;
        grossSoldGbp += sellGbp;
        realizedPnlGbp += sellGbp - costOut;
      } else {
        sellGbp = 0;
      }
    }

    rows.push({
      date: p.date,
      ts: p.ts,
      priceUsd: p.price,
      fairUsd,
      btcGbp,
      risk,
      buyGbp,
      sellGbp,
      botBtc,
      holdBtc,
      grossInvestedGbp,
      grossSoldGbp,
      realizedPnlGbp,
      costBasisGbpRemaining,
    });
  }

  return { label, rows };
}

// --- formatting ------------------------------------------------------------

function fmtUsd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}
function fmtGbp(n: number): string {
  return `£${Math.round(n).toLocaleString('en-US')}`;
}
function fmtBtc(n: number): string {
  return `${n.toFixed(4)}`;
}
function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function quarterKey(date: string): string {
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  return `${y} Q${Math.floor((m - 1) / 3) + 1}`;
}

function rowAtOrBefore(rows: DayRow[], date: string): DayRow | null {
  let found: DayRow | null = null;
  for (const r of rows) {
    if (r.date <= date) found = r;
    else break;
  }
  return found;
}

/** Local-max row in a ±window around the base-case peak date (smooths OU noise). */
function peakRow(rows: DayRow[]): DayRow {
  const lo = toTs(PEAK_DATE) - 21 * DAY_MS;
  const hi = toTs(PEAK_DATE) + 21 * DAY_MS;
  const win = rows.filter((r) => r.ts >= lo && r.ts <= hi);
  const pool = win.length ? win : rows;
  // Use the median price in the window as the representative peak level so a
  // single noisy spike doesn't drive the valuation.
  const sorted = [...pool].sort((a, b) => a.priceUsd - b.priceUsd);
  const mid = sorted[Math.floor(sorted.length / 2)];
  // Pair the representative price with bot/hold state as of the peak date.
  const stateRow = rowAtOrBefore(rows, PEAK_DATE) ?? mid;
  return { ...stateRow, priceUsd: mid.priceUsd, btcGbp: mid.priceUsd / GBPUSD };
}

function minRow(rows: DayRow[], from: string, to: string): DayRow {
  const win = rows.filter((r) => r.date >= from && r.date <= to);
  let best = win[0];
  for (const r of win) if (r.priceUsd < best.priceUsd) best = r;
  return best;
}

// --- reporting -------------------------------------------------------------

function printQuarterTable(res: SimResult): void {
  console.log(`\n── ${res.label}: quarter-by-quarter ──`);
  console.log(
    'Quarter   QEndPx    AvgRisk  AvgBuy£  BTC+    £net      CumBTC    CumNet£    AvgCost£/BTC ($)',
  );

  const byQuarter = new Map<string, DayRow[]>();
  for (const r of res.rows) {
    const k = quarterKey(r.date);
    const arr = byQuarter.get(k) ?? [];
    arr.push(r);
    byQuarter.set(k, arr);
  }

  for (const [q, days] of byQuarter) {
    const last = days[days.length - 1];
    const avgRisk = days.reduce((a, d) => a + d.risk, 0) / days.length;
    const buyDays = days.filter((d) => d.buyGbp > 0);
    const avgBuy = buyDays.length ? buyDays.reduce((a, d) => a + d.buyGbp, 0) / buyDays.length : 0;
    const btcAdded = days.reduce((a, d) => a + (d.buyGbp > 0 ? d.buyGbp / d.btcGbp : 0), 0);
    const netThisQ =
      days.reduce((a, d) => a + d.buyGbp - d.sellGbp, 0);
    const cumNet = last.grossInvestedGbp - last.grossSoldGbp;
    const avgCostGbp = last.botBtc > 0 ? last.costBasisGbpRemaining / last.botBtc : 0;
    const avgCostUsd = avgCostGbp * GBPUSD;
    console.log(
      `${q.padEnd(9)} ${fmtUsd(last.priceUsd).padStart(8)} ${fmtPct(avgRisk).padStart(7)} ` +
        `${fmtGbp(avgBuy).padStart(7)} ${fmtBtc(btcAdded).padStart(6)} ${fmtGbp(netThisQ).padStart(8)} ` +
        `${fmtBtc(last.botBtc).padStart(8)} ${fmtGbp(cumNet).padStart(9)}  ${fmtGbp(avgCostGbp)} (${fmtUsd(avgCostUsd)})`,
    );
  }
}

function printMilestone(label: string, r: DayRow | null): void {
  if (!r) {
    console.log(`  ${label.padEnd(28)} n/a`);
    return;
  }
  const net = r.grossInvestedGbp - r.grossSoldGbp;
  const avgCostGbp = r.botBtc > 0 ? r.costBasisGbpRemaining / r.botBtc : 0;
  console.log(
    `  ${label.padEnd(28)} BTC ${fmtUsd(r.priceUsd).padStart(8)} | risk ${fmtPct(r.risk).padStart(6)} | ` +
      `stack ${fmtBtc(r.botBtc).padStart(8)} BTC | net in ${fmtGbp(net).padStart(9)} | ` +
      `avg cost ${fmtGbp(avgCostGbp)} (${fmtUsd(avgCostGbp * GBPUSD)})`,
  );
}

function monthsBetween(fromDate: string, toDate: string): number {
  return (toTs(toDate) - toTs(fromDate)) / (DAY_MS * 30.4375);
}

/**
 * Drawdown + break-even on the position itself.
 *   equity(t)  = current BTC holdings × price + cash already realized from sells
 *   invested(t)= gross GBP deployed so far
 * "Underwater" = equity < invested (your stack is worth less than the cash you
 * put in). During the bear the bot doesn't sell (risk < 50%), so bot and
 * buy-and-hold are identical here.
 */
function printDrawdownBreakeven(res: SimResult): void {
  const startDate = res.rows[0].date;

  let worstUnderwater = 0;     // most negative equity/invested - 1
  let worstDate = startDate;
  let worstPrice = res.rows[0].priceUsd;

  let peakEquity = -Infinity;  // peak-to-trough on the equity curve
  let maxPeakTroughDD = 0;
  let maxPTDate = startDate;

  let lastUnderwaterDate: string | null = null;
  let firstBreakevenDate: string | null = null;

  for (const r of res.rows) {
    const invested = r.grossInvestedGbp;
    if (invested <= 0) continue;
    const equity = r.botBtc * r.btcGbp + r.grossSoldGbp;
    const ratio = equity / invested - 1;

    if (ratio < worstUnderwater) {
      worstUnderwater = ratio;
      worstDate = r.date;
      worstPrice = r.priceUsd;
    }
    if (equity > peakEquity) peakEquity = equity;
    const ptDD = peakEquity > 0 ? (equity - peakEquity) / peakEquity : 0;
    if (ptDD < maxPeakTroughDD) {
      maxPeakTroughDD = ptDD;
      maxPTDate = r.date;
    }
    if (equity < invested) {
      lastUnderwaterDate = r.date;
    } else if (firstBreakevenDate === null) {
      firstBreakevenDate = r.date;
    }
  }

  // Sustained break-even = the day after the position is underwater for the
  // last time (it never dips back below the cash deployed afterwards).
  let sustainedBreakeven: string | null = null;
  if (lastUnderwaterDate === null) {
    sustainedBreakeven = startDate;
  } else {
    for (const r of res.rows) {
      if (r.date > lastUnderwaterDate) {
        sustainedBreakeven = r.date;
        break;
      }
    }
  }

  console.log(`\n── ${res.label}: drawdown & break-even ──`);
  console.log(
    `  Max drawdown vs capital deployed:  ${fmtPct(worstUnderwater)} on ${worstDate} ` +
      `(BTC ${fmtUsd(worstPrice)})`,
  );
  console.log(
    `  Max peak-to-trough of equity:      ${fmtPct(maxPeakTroughDD)} on ${maxPTDate} ` +
      `(inflows mask this for DCA)`,
  );
  if (firstBreakevenDate) {
    console.log(
      `  First touch of break-even:         ${firstBreakevenDate} ` +
        `(${monthsBetween(startDate, firstBreakevenDate).toFixed(1)} months in)`,
    );
  }
  if (sustainedBreakeven) {
    console.log(
      `  Sustained break-even (stays up):   ${sustainedBreakeven} ` +
        `(${monthsBetween(startDate, sustainedBreakeven).toFixed(1)} months in)`,
    );
  } else {
    console.log('  Sustained break-even:              not reached within the sim window');
  }
  console.log('  (Bot doesn\u2019t sell below 50% risk, so these match buy-and-hold through the bear.)');
}

function printBullProjection(res: SimResult): void {
  const peak = peakRow(res.rows);
  const end = res.rows[res.rows.length - 1];

  console.log(`\n── ${res.label}: bull-cycle projection (base case ~$225K peak) ──`);
  console.log(`  Base-case peak window ≈ ${PEAK_DATE}: ${fmtUsd(peak.priceUsd)} (BTC-GBP ${fmtGbp(peak.btcGbp)})`);

  const valueIf = (r: DayRow) => {
    const peakBtcGbp = peak.btcGbp;
    // Bot (auto-sells along the way): remaining stack marked at peak + cash already realized.
    const botTotalValue = r.botBtc * peakBtcGbp + r.grossSoldGbp;
    const botMoneyIn = r.grossInvestedGbp;
    const botProfit = botTotalValue - botMoneyIn;
    // Buy-and-hold the accumulated stack (same buys, no sells).
    const holdValue = r.holdBtc * peakBtcGbp;
    const holdProfit = holdValue - r.grossInvestedGbp;
    return { botTotalValue, botMoneyIn, botProfit, holdValue, holdProfit };
  };

  const atPeak = valueIf(peak);
  console.log('\n  At the cycle peak:');
  console.log(
    `    Bot (auto-sell)   value ${fmtGbp(atPeak.botTotalValue)} | invested ${fmtGbp(atPeak.botMoneyIn)} | ` +
      `profit ${fmtGbp(atPeak.botProfit)} | ROI ${fmtPct(atPeak.botProfit / atPeak.botMoneyIn)}`,
  );
  console.log(
    `    Buy & hold stack  value ${fmtGbp(atPeak.holdValue)} | invested ${fmtGbp(peak.grossInvestedGbp)} | ` +
      `profit ${fmtGbp(atPeak.holdProfit)} | ROI ${fmtPct(atPeak.holdProfit / peak.grossInvestedGbp)}`,
  );
  console.log(
    `    Bot BTC at peak ${fmtBtc(peak.botBtc)} (sold ${fmtBtc(peak.holdBtc - peak.botBtc)} into strength) | ` +
      `hold BTC ${fmtBtc(peak.holdBtc)}`,
  );

  // End-of-sim mark (post-peak cooldown).
  const endBtcGbp = end.btcGbp;
  const endBotValue = end.botBtc * endBtcGbp + end.grossSoldGbp;
  const endBotIn = end.grossInvestedGbp;
  console.log(`\n  At ${end.date} (${fmtUsd(end.priceUsd)}, post-peak):`);
  console.log(
    `    Bot (auto-sell)   value ${fmtGbp(endBotValue)} | invested ${fmtGbp(endBotIn)} | ` +
      `profit ${fmtGbp(endBotValue - endBotIn)} | ROI ${fmtPct((endBotValue - endBotIn) / endBotIn)}`,
  );
  console.log(
    `    Buy & hold stack  value ${fmtGbp(end.holdBtc * endBtcGbp)} | invested ${fmtGbp(end.grossInvestedGbp)} | ` +
      `profit ${fmtGbp(end.holdBtc * endBtcGbp - end.grossInvestedGbp)} | ` +
      `ROI ${fmtPct((end.holdBtc * endBtcGbp - end.grossInvestedGbp) / end.grossInvestedGbp)}`,
  );
}

/** Write the full daily series to JSON so the Python plotter can chart it. */
function exportJson(scenarios: SimResult[], meta: { startFair: number; startRisk: number }): void {
  const outDir = resolve(__dirname, 'output');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'cqm-bear-sim-data.json');
  const payload = {
    meta: {
      baseGbp: BASE_GBP,
      gbpUsd: GBPUSD,
      startDate: SIM_START_DATE,
      startPriceUsd: SIM_START_PRICE,
      startFairUsd: meta.startFair,
      startRisk: meta.startRisk,
      simEnd: SIM_END,
      peakDate: PEAK_DATE,
      refitEveryDays: REFIT_EVERY_DAYS,
    },
    scenarios: scenarios.map((s) => ({
      label: s.label,
      rows: s.rows.map((r) => ({
        date: r.date,
        priceUsd: r.priceUsd,
        fairUsd: r.fairUsd,
        btcGbp: r.btcGbp,
        risk: r.risk,
        buyGbp: r.buyGbp,
        sellGbp: r.sellGbp,
        botBtc: r.botBtc,
        holdBtc: r.holdBtc,
        grossInvestedGbp: r.grossInvestedGbp,
        grossSoldGbp: r.grossSoldGbp,
        costBasisGbpRemaining: r.costBasisGbpRemaining,
      })),
    })),
  };
  writeFileSync(outPath, JSON.stringify(payload));
  console.log(`\nWrote daily series → ${outPath}`);
}

export function runCqmBearSim(): void {
  console.log('CQM Risk DCA bot — forward bear/bull simulation');
  console.log('================================================');
  console.log(
    `Base £${BASE_GBP}/day · daily · GBPUSD ${GBPUSD} · target = base × (1 − 2 × Risk) · ` +
      `min trade £${MIN_TRADE_GBP}`,
  );
  console.log(`Start ${SIM_START_DATE} @ ${fmtUsd(SIM_START_PRICE)} → sim end ${SIM_END}`);

  // Sanity: model risk at the live start.
  const history = loadHistory();
  const startFit = fitCQM(history);
  const startRisk = riskForPriceFair(startFit, toTs(SIM_START_DATE), SIM_START_PRICE);
  const startFair = startFit.signals[startFit.signals.length - 1]?.qrDashedMedian ?? NaN;
  console.log(
    `Model at start: QR-50% fair ${fmtUsd(startFair)} · BTC ${fmtUsd(SIM_START_PRICE)} ` +
      `(${fmtPct(SIM_START_PRICE / startFair - 1)} vs fair) · CQM risk ${fmtPct(startRisk)} ` +
      `→ buy ${fmtGbp(BASE_GBP * (1 - 2 * startRisk))}/day`,
  );

  const scenarios: SimResult[] = [
    simulate('MID BEAR (bottom ~$55K, summer 2026)', MID_BEAR_WAYPOINTS, 0xc0ffee),
    simulate('DEEP BEAR (bottom ~$40K, end 2026)', DEEP_BEAR_WAYPOINTS, 0xbada55),
  ];

  exportJson(scenarios, { startFair, startRisk });

  for (const res of scenarios) {
    printQuarterTable(res);

    console.log(`\n── ${res.label}: key milestones ──`);
    printMilestone('Summer 2026 bottom', minRow(res.rows, '2026-06-08', '2026-10-31'));
    printMilestone('End 2026', rowAtOrBefore(res.rows, '2026-12-31'));
    printMilestone('End 2027 (base built)', rowAtOrBefore(res.rows, '2027-12-31'));
    printMilestone('End 2028 (markup)', rowAtOrBefore(res.rows, '2028-12-31'));

    printDrawdownBreakeven(res);
    printBullProjection(res);
    console.log('');
  }

  console.log('\nAssumptions & limitations');
  console.log('-------------------------');
  console.log('- Synthetic, seeded price paths pinned to the stated waypoints (illustrative,');
  console.log('  not a forecast). Relief rallies/crashes come from an OU overlay (~±7% 1σ, ~±14% 2σ).');
  console.log(`- Fixed GBPUSD = ${GBPUSD}; real FX drift will shift GBP figures.`);
  console.log(`- Risk uses the live CQM model, refit every ${REFIT_EVERY_DAYS} days (bot refits daily).`);
  console.log('- Cycle-gamma and tail-scaling at neutral production defaults, per current config.');
  console.log('- Fees, slippage and GBP funding limits are not modelled.');
}
