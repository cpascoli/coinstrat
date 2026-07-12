import { describe, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fitCQM, riskForPriceFairProjected, type CQMFit } from '../src/utils/cqm';
import { generateForwardPrices } from '../src/utils/cqmForwardSim';
import {
  computeCqmDynamicTrade,
  CQM_DEFAULT_MAX_CASH_FRACTION,
  CQM_DEFAULT_SELL_THRESHOLD,
} from '../src/utils/cqmSizing';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DAILY_DEPOSIT = 500;
const MONTHLY_WITHDRAWAL = 10_000;
const WITHDRAWAL_START = '2028-01-01';

interface RawPoint { date: string; close: number; }

function loadBtcPoints(): { date: string; ts: number; price: number }[] {
  const filePath = resolve(__dirname, '../public/data/btc_daily.json');
  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as RawPoint[];
  return raw
    .filter((r) => Number.isFinite(r.close) && r.close > 0)
    .map((r) => ({ date: r.date, ts: new Date(r.date).getTime(), price: r.close }));
}

function addYears(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
}
function addMonths(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

interface DayRow {
  date: string;
  price: number;
  btcHeld: number;
  cash: number;
  btcValue: number;
  portfolioValue: number;
  cumDeposits: number;
  cumWithdrawals: number;
  depositToday: number;
  withdrawalToday: number;
  risk: number;
}

interface SimOut {
  finalValue: number;
  finalBtcValue: number;
  finalCash: number;
  totalDeposited: number;
  totalWithdrawn: number;
  shortfall: boolean;
  rows: DayRow[];
}

function simulate(
  fit: CQMFit,
  path: { date: string; ts: number; price: number }[],
  startDate: string,
  record: boolean,
): SimOut {
  const depositCutoff = addMonths(startDate, 18); // deposit while date < this (≈ 2027-12)

  let btc = 0;
  let cash = 0;
  let totalDeposited = 0;
  let totalWithdrawn = 0;
  let lastMonth = '';
  let shortfall = false;
  const rows: DayRow[] = [];

  for (const p of path) {
    const price = p.price;
    const month = p.date.slice(0, 7);
    let depositToday = 0;
    let withdrawalToday = 0;

    // 1. Deposit $500/day for the first 18 months
    if (p.date < depositCutoff) {
      cash += DAILY_DEPOSIT;
      totalDeposited += DAILY_DEPOSIT;
      depositToday = DAILY_DEPOSIT;
    }

    // 2. CQM dynamic strategy (sells when risk > 75%, buys from cash otherwise)
    const r = Math.max(0, Math.min(1, riskForPriceFairProjected(fit, p.ts, price)));
    const trade = computeCqmDynamicTrade({
      baseAmount: DAILY_DEPOSIT,
      risk: r,
      cashBalance: cash,
      btcHeld: btc,
      btcPrice: price,
      maxCashFraction: CQM_DEFAULT_MAX_CASH_FRACTION,
      sellThreshold: CQM_DEFAULT_SELL_THRESHOLD,
    });
    if (trade.sellAmount > 0) {
      const btcSold = Math.min(trade.sellAmount / price, btc);
      btc -= btcSold;
      cash += btcSold * price;
    } else if (trade.buyAmount > 0) {
      const spend = Math.min(trade.buyAmount, cash);
      btc += spend / price;
      cash -= spend;
    }

    // 3. Monthly $10k withdrawal once we pass 18 months (from Jan 2028).
    //    Pull from cash first, then liquidate BTC to cover any shortfall.
    if (p.date >= WITHDRAWAL_START && month !== lastMonth) {
      lastMonth = month;
      let need = MONTHLY_WITHDRAWAL;
      const fromCash = Math.min(cash, need);
      cash -= fromCash;
      need -= fromCash;
      if (need > 0) {
        const btcValue = btc * price;
        const fromBtc = Math.min(btcValue, need);
        btc -= fromBtc / price;
        need -= fromBtc;
      }
      if (need > 0) shortfall = true;
      withdrawalToday = MONTHLY_WITHDRAWAL - need;
      totalWithdrawn += withdrawalToday;
    } else if (month !== lastMonth && p.date >= WITHDRAWAL_START) {
      lastMonth = month;
    }

    if (record) {
      rows.push({
        date: p.date,
        price,
        btcHeld: btc,
        cash,
        btcValue: btc * price,
        portfolioValue: btc * price + cash,
        cumDeposits: totalDeposited,
        cumWithdrawals: totalWithdrawn,
        depositToday,
        withdrawalToday,
        risk: r,
      });
    }
  }

  const lastPrice = path[path.length - 1].price;
  return {
    finalValue: btc * lastPrice + cash,
    finalBtcValue: btc * lastPrice,
    finalCash: cash,
    totalDeposited,
    totalWithdrawn,
    shortfall,
    rows,
  };
}

describe('CQM forward DCA with deposits then withdrawals', () => {
  it('estimates final balance and exports a representative daily series', () => {
    const points = loadBtcPoints();
    const fit = fitCQM(points);
    const last = fit.signals[fit.signals.length - 1];
    const startDate = last.date;
    const endDate = addYears(startDate, 5);

    const seeds = [0xc0ffee, 0xbada55, 0x1234, 0xfeed, 0x9999, 0x5151, 0xabcd, 0x2468,
      0x7777, 0x3030, 0xdead, 0x0f0f, 0x55aa, 0x1010, 0xb00b, 0xface];

    const runs = seeds.map((seed) => {
      const path = generateForwardPrices(fit, { endDate, seed })
        .map((p) => ({ date: p.date, ts: p.ts, price: p.price }));
      return { seed, out: simulate(fit, path, startDate, false) };
    });

    const sorted = [...runs].sort((a, b) => a.out.finalValue - b.out.finalValue);
    const median = sorted[Math.floor(sorted.length / 2)];
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const finals = sorted.map((r) => r.out.finalValue);
    const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

    const worst = sorted[0];
    const outDir = resolve(__dirname, '../scripts/output');
    mkdirSync(outDir, { recursive: true });

    const summary = {
      meanFinal: mean(finals),
      medianFinal: median.out.finalValue,
      minFinal: finals[0],
      maxFinal: finals[finals.length - 1],
    };

    // Re-run chosen scenarios with full daily recording and export each.
    const exports: Array<{ label: string; seed: number; file: string }> = [
      { label: 'median', seed: median.seed, file: 'cqm-withdrawal-sim-data.json' },
      { label: 'worst', seed: worst.seed, file: 'cqm-withdrawal-sim-worst.json' },
    ];

    console.log(`\nWindow ${startDate} → ${endDate} (BTC start ${fmt(last.price)})`);
    console.log(`Final balance: mean ${fmt(mean(finals))} · median ${fmt(median.out.finalValue)} · ` +
      `range ${fmt(finals[0])}…${fmt(finals[finals.length - 1])}`);

    for (const ex of exports) {
      const path = generateForwardPrices(fit, { endDate, seed: ex.seed })
        .map((p) => ({ date: p.date, ts: p.ts, price: p.price }));
      const sim = simulate(fit, path, startDate, true);
      const outPath = resolve(outDir, ex.file);
      writeFileSync(outPath, JSON.stringify({
        meta: {
          scenario: ex.label,
          startDate,
          endDate,
          startPrice: last.price,
          dailyDeposit: DAILY_DEPOSIT,
          depositCutoff: addMonths(startDate, 18),
          withdrawalStart: WITHDRAWAL_START,
          monthlyWithdrawal: MONTHLY_WITHDRAWAL,
          seed: ex.seed,
          summary: { ...summary, totalDeposited: sim.totalDeposited, totalWithdrawn: sim.totalWithdrawn },
        },
        rows: sim.rows,
      }));
      console.log(`[${ex.label}] final ${fmt(sim.finalValue)} · deposited ${fmt(sim.totalDeposited)} · ` +
        `withdrawn ${fmt(sim.totalWithdrawn)}${sim.shortfall ? ' · WITHDRAWAL UNDERFUNDED' : ''} → ${outPath}`);
    }
  });
});
