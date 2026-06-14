/**
 * Bottom Accumulation Score — single source of truth.
 *
 * This module is the ONE place where the Bottom Score model is both
 * implemented and documented. It is consumed by:
 *   - the signal engine (web/src/services/engine.ts),
 *   - the server-side compute pipeline (web/netlify/functions/lib/compute.ts),
 *   - the Factors UI (web/src/views/models/BottomFactors.tsx).
 *
 * The tiered scoring rules live exactly once, inside each sub-score's
 * `evaluate`/`rules`. The numeric model output (`scoreBottomAccumulation`) is
 * DERIVED from those same sub-scores, so the live signal, the charts and the
 * Factors page can never drift apart.
 *
 * See BOTTOM_ACCUM_SCORE.md for the prose design doc.
 */

/** A signal row: an open record of field → value. */
export type ScoreRow = Record<string, unknown>;

export type BottomFactorKey =
  | 'onchain'
  | 'capitulation'
  | 'liquidity'
  | 'macro'
  | 'setup'
  | 'repair';

export interface SubRule {
  /** Human-readable threshold for this tier (the condition that earns the points). */
  when: string;
  points: number;
}

export interface SubScore {
  label: string;
  /** Maximum points this sub-component can contribute. */
  max: number;
  /** Tiered rules in priority order; the first matching tier earns its points. */
  rules: SubRule[];
  /** The current input value(s) for this sub-component, formatted for display. */
  input: (d: ScoreRow) => string;
  /** Points earned now + the index of the matching rule (-1 = none / no data). */
  evaluate: (d: ScoreRow) => { points: number; activeIndex: number };
}

export interface BottomFactor {
  key: BottomFactorKey;
  label: string;
  /** Maximum points for the factor (the sub-scores are capped at this total). */
  max: number;
  /** Latest-row field name holding the live, capped factor score (for the UI badge). */
  field: string;
  purpose: string;
  interpretation: string;
  /** Chart-section ids that visualise this factor's inputs (UI casts to ChartsSection). */
  sections: string[];
  /**
   * Stable chart ids (see ChartsView) for the charts that specifically
   * contribute to THIS factor's score. When present, the Factors page renders
   * exactly these charts instead of whole sections, so each factor shows only —
   * and all of — its contributing charts. Falls back to `sections` when absent.
   */
  chartIds?: string[];
  subs: SubScore[];
  /** Optional caveat rendered under the breakdown (e.g. fallback behaviour). */
  note?: string;
  /**
   * Optional factor-level score override. Return a number to bypass the default
   * `min(max, Σ sub points)`, or `null` to fall back to that default. Used only
   * where the factor cannot be expressed as a flat sum of its display sub-scores
   * (capitulation's legacy, no-derivatives fallback).
   */
  computeScore?: (d: ScoreRow) => number | null;
}

// ── Formatting + tier helpers ───────────────────────────────────────────────

const num = (v: unknown): number => Number(v);
const fin = (v: unknown): boolean => Number.isFinite(Number(v));

function usd(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : 'n/a';
}
function ratio(a: unknown, b: unknown): string {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y) || y === 0) return 'n/a';
  return `${((x / y - 1) * 100).toFixed(0)}% vs`;
}
function pct(v: unknown, digits = 1): string {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : 'n/a';
}
/**
 * Format a fraction as a percentage. `digits` controls precision (funding rates
 * are tiny, so they need more). Rounds first, then normalizes negative zero so
 * a value like -0.00003 renders as "0.000%" rather than "-0.0%".
 */
function pct100(v: unknown, digits = 1): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return 'n/a';
  const rounded = Number((n * 100).toFixed(digits));
  const safe = rounded === 0 ? 0 : rounded;
  return `${safe.toFixed(digits)}%`;
}
function fixed(v: unknown, digits = 2): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : 'n/a';
}

/** Resolve the first matching tier from an ordered list of [test, points]. */
function tier(tests: Array<[boolean, number]>): { points: number; activeIndex: number } {
  for (let i = 0; i < tests.length; i += 1) {
    if (tests[i][0]) return { points: tests[i][1], activeIndex: i };
  }
  return { points: 0, activeIndex: -1 };
}

// ── Factor spec (the model, written once) ───────────────────────────────────

export const BOTTOM_FACTORS: BottomFactor[] = [
  {
    key: 'onchain',
    label: 'On-chain value',
    max: 20,
    field: 'BOTTOM_ONCHAIN_SCORE',
    purpose: 'Is Bitcoin cheap relative to holder cost-bases and long-term valuation?',
    interpretation:
      'High = BTC sits in historically attractive on-chain valuation zones. Low = not cheap enough to justify aggressive bottom deployment.',
    sections: ['valuation'],
    chartIds: ['val-score', 'mvrv', 'nupl', 'lth-nupl', 'holder-realized'],
    subs: [
      {
        label: 'Valuation score (VAL_SCORE)',
        max: 12,
        rules: [
          { when: 'VAL_SCORE ≥ 3 (deep value)', points: 12 },
          { when: 'VAL_SCORE ≥ 2', points: 9 },
          { when: 'VAL_SCORE ≥ 1', points: 4 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `VAL_SCORE = ${fin(d.VAL_SCORE) ? num(d.VAL_SCORE) : 'n/a'}`,
        evaluate: (d) =>
          tier([
            [num(d.VAL_SCORE) >= 3, 12],
            [num(d.VAL_SCORE) >= 2, 9],
            [num(d.VAL_SCORE) >= 1, 4],
          ]),
      },
      {
        label: 'Price vs short-term holder realized price',
        max: 4,
        rules: [
          { when: 'Price ≤ STH realized', points: 4 },
          { when: 'Price ≤ STH realized × 1.10', points: 2 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `${ratio(d.BTCUSD, d.STH_REALIZED_PRICE)} STH RP ${usd(d.STH_REALIZED_PRICE)}`,
        evaluate: (d) => {
          const p = num(d.BTCUSD);
          const sth = num(d.STH_REALIZED_PRICE);
          if (!fin(p) || !fin(sth) || sth <= 0) return { points: 0, activeIndex: -1 };
          return tier([
            [p <= sth, 4],
            [p <= sth * 1.1, 2],
          ]);
        },
      },
      {
        label: 'Price vs long-term holder realized price',
        max: 4,
        rules: [
          { when: 'Price ≤ LTH realized', points: 4 },
          { when: 'Price ≤ LTH realized × 1.25', points: 2 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `${ratio(d.BTCUSD, d.LTH_REALIZED_PRICE)} LTH RP ${usd(d.LTH_REALIZED_PRICE)}`,
        evaluate: (d) => {
          const p = num(d.BTCUSD);
          const lth = num(d.LTH_REALIZED_PRICE);
          if (!fin(p) || !fin(lth) || lth <= 0) return { points: 0, activeIndex: -1 };
          return tier([
            [p <= lth, 4],
            [p <= lth * 1.25, 2],
          ]);
        },
      },
    ],
  },
  {
    key: 'capitulation',
    label: 'Capitulation / stress',
    max: 20,
    field: 'BOTTOM_CAPITULATION_SCORE',
    purpose: 'Has enough forced selling and holder stress already occurred?',
    interpretation:
      'High = the market has absorbed meaningful pain. Low = downside stress may not be fully washed out yet.',
    sections: ['valuation'],
    chartIds: ['lth-sopr', 'addresses-in-profit', 'funding', 'oi'],
    note:
      'Holder stress (0–15) + derivatives stress (0–5), capped at 20. If neither funding nor open-interest data is available, a legacy formula using only LTH-SOPR, addresses-in-profit and drawdown is used instead.',
    // Legacy fallback (no derivatives data): different weights than the modern
    // holder-stress tiers, so it cannot be expressed as a sum of the display
    // sub-scores. When derivatives ARE present we return null → default sum.
    computeScore: (d) => {
      const hasDerivatives = fin(d.BTC_FUNDING_7D_AVG) || fin(d.BTC_OI_DRAWDOWN_90D);
      if (hasDerivatives) return null;
      const lthSopr = num(d.LTH_SOPR);
      const sip = num(d.SIP);
      const drawdown = num(d.BTC_DRAWDOWN_FROM_365D_HIGH);
      return Math.min(
        20,
        (fin(lthSopr) ? (lthSopr < 0.98 ? 9 : lthSopr < 1 ? 7 : lthSopr < 1.03 ? 3 : 0) : 0) +
          (fin(sip) ? (sip < 65 ? 6 : sip < 75 ? 4 : sip < 85 ? 2 : 0) : 0) +
          (fin(drawdown) ? (drawdown <= -0.55 ? 5 : drawdown <= -0.4 ? 3 : drawdown <= -0.25 ? 1 : 0) : 0),
      );
    },
    subs: [
      {
        label: 'LTH-SOPR (long-term holder profit ratio)',
        max: 7,
        rules: [
          { when: 'LTH-SOPR < 0.98 (holders realizing losses)', points: 7 },
          { when: 'LTH-SOPR < 1.00', points: 5 },
          { when: 'LTH-SOPR < 1.03', points: 2 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `LTH-SOPR = ${fixed(d.LTH_SOPR, 3)}`,
        evaluate: (d) => {
          const s = num(d.LTH_SOPR);
          if (!fin(s)) return { points: 0, activeIndex: -1 };
          return tier([
            [s < 0.98, 7],
            [s < 1, 5],
            [s < 1.03, 2],
          ]);
        },
      },
      {
        label: 'Percent addresses in profit (SIP)',
        max: 4,
        rules: [
          { when: 'SIP < 65%', points: 4 },
          { when: 'SIP < 75%', points: 3 },
          { when: 'SIP < 85%', points: 1 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `SIP = ${pct(d.SIP, 1)}`,
        evaluate: (d) => {
          const s = num(d.SIP);
          if (!fin(s)) return { points: 0, activeIndex: -1 };
          return tier([
            [s < 65, 4],
            [s < 75, 3],
            [s < 85, 1],
          ]);
        },
      },
      {
        label: 'Drawdown from 365-day high',
        max: 4,
        rules: [
          { when: 'Drawdown ≤ −55%', points: 4 },
          { when: 'Drawdown ≤ −40%', points: 3 },
          { when: 'Drawdown ≤ −25%', points: 1 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `Drawdown = ${pct100(d.BTC_DRAWDOWN_FROM_365D_HIGH)}`,
        evaluate: (d) => {
          const dd = num(d.BTC_DRAWDOWN_FROM_365D_HIGH);
          if (!fin(dd)) return { points: 0, activeIndex: -1 };
          return tier([
            [dd <= -0.55, 4],
            [dd <= -0.4, 3],
            [dd <= -0.25, 1],
          ]);
        },
      },
      {
        label: 'Funding (7-day average)',
        max: 3,
        rules: [
          { when: 'Funding < −0.01% (shorts paying)', points: 3 },
          { when: 'Funding ≤ 0%', points: 2 },
          { when: 'Funding < 0.01%', points: 1 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `7d funding = ${pct100(d.BTC_FUNDING_7D_AVG, 3)}`,
        evaluate: (d) => {
          const f = num(d.BTC_FUNDING_7D_AVG);
          if (!fin(f)) return { points: 0, activeIndex: -1 };
          return tier([
            [f < -0.0001, 3],
            [f <= 0, 2],
            [f < 0.0001, 1],
          ]);
        },
      },
      {
        label: 'Open-interest drawdown (90-day)',
        max: 2,
        rules: [
          { when: 'OI drawdown ≤ −35% (leverage flushed)', points: 2 },
          { when: 'OI drawdown ≤ −20%', points: 1 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `OI drawdown = ${pct100(d.BTC_OI_DRAWDOWN_90D)}`,
        evaluate: (d) => {
          const oi = num(d.BTC_OI_DRAWDOWN_90D);
          if (!fin(oi)) return { points: 0, activeIndex: -1 };
          return tier([
            [oi <= -0.35, 2],
            [oi <= -0.2, 1],
          ]);
        },
      },
    ],
  },
  {
    key: 'liquidity',
    label: 'Liquidity turn',
    max: 20,
    field: 'BOTTOM_LIQUIDITY_SCORE',
    purpose: 'Are liquidity conditions stabilizing or improving?',
    interpretation:
      'High = the liquidity backdrop is becoming supportive. Low = macro liquidity is still a headwind.',
    sections: ['liquidity'],
    chartIds: ['us-net-liquidity', 'us-net-liquidity-inputs', 'g3-assets', 'g3-components', 'g3-yoy', 'dxy-regime'],
    subs: [
      {
        label: 'US net-liquidity regime (LIQ_SCORE)',
        max: 9,
        rules: [
          { when: 'LIQ_SCORE ≥ 2', points: 9 },
          { when: 'LIQ_SCORE ≥ 1', points: 5 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `LIQ_SCORE = ${fin(d.LIQ_SCORE) ? num(d.LIQ_SCORE) : 'n/a'}`,
        evaluate: (d) =>
          tier([
            [num(d.LIQ_SCORE) >= 2, 9],
            [num(d.LIQ_SCORE) >= 1, 5],
          ]),
      },
      {
        label: 'US liquidity 13-week change',
        max: 4,
        rules: [
          { when: '13-week Δ > 0 (expanding)', points: 4 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `13w Δ = ${fin(d.US_LIQ_13W_DELTA) ? fixed(d.US_LIQ_13W_DELTA, 0) : 'n/a'}`,
        evaluate: (d) => tier([[fin(d.US_LIQ_13W_DELTA) && num(d.US_LIQ_13W_DELTA) > 0, 4]]),
      },
      {
        label: 'G3 central-bank balance sheet (YoY)',
        max: 4,
        rules: [
          { when: 'G3 YoY > 0% (expanding)', points: 4 },
          { when: 'G3 YoY > −2%', points: 2 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `G3 YoY = ${pct(d.G3_YOY, 1)}`,
        evaluate: (d) => {
          const g = num(d.G3_YOY);
          if (!fin(g)) return { points: 0, activeIndex: -1 };
          return tier([
            [g > 0, 4],
            [g > -2, 2],
          ]);
        },
      },
      {
        label: 'Dollar regime (DXY_SCORE)',
        max: 3,
        rules: [
          { when: 'DXY_SCORE ≥ 2 (weak / falling USD)', points: 3 },
          { when: 'DXY_SCORE ≥ 1', points: 2 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `DXY_SCORE = ${fin(d.DXY_SCORE) ? num(d.DXY_SCORE) : 'n/a'}`,
        evaluate: (d) =>
          tier([
            [num(d.DXY_SCORE) >= 2, 3],
            [num(d.DXY_SCORE) >= 1, 2],
          ]),
      },
    ],
  },
  {
    key: 'macro',
    label: 'Macro support',
    max: 20,
    field: 'BOTTOM_MACRO_SCORE',
    purpose: 'Avoid deploying aggressively into an unresolved macro shock.',
    interpretation:
      'High = macro conditions are not blocking deployment. Low = recession, credit or inflation-shock risk may dominate.',
    sections: ['business'],
    chartIds: ['biz-cycle', 'biz-cycle-inputs', 'ism-pmi'],
    subs: [
      {
        label: 'Business-cycle regime (BIZ_CYCLE_SCORE)',
        max: 10,
        rules: [
          { when: 'BIZ_CYCLE_SCORE ≥ 2', points: 10 },
          { when: 'BIZ_CYCLE_SCORE ≥ 1', points: 7 },
          { when: 'otherwise (base credit)', points: 2 },
        ],
        input: (d) => `BIZ_CYCLE_SCORE = ${fin(d.BIZ_CYCLE_SCORE) ? num(d.BIZ_CYCLE_SCORE) : 'n/a'}`,
        evaluate: (d) =>
          tier([
            [num(d.BIZ_CYCLE_SCORE) >= 2, 10],
            [num(d.BIZ_CYCLE_SCORE) >= 1, 7],
            [true, 2],
          ]),
      },
      {
        label: 'Sahm Rule (recession trigger)',
        max: 4,
        rules: [
          { when: 'Sahm < 0.5 (no recession trigger)', points: 4 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `Sahm = ${fixed(d.SAHM, 2)}`,
        evaluate: (d) => tier([[fin(d.SAHM) && num(d.SAHM) < 0.5, 4]]),
      },
      {
        label: 'Yield curve (10Y − 3M)',
        max: 3,
        rules: [
          { when: 'Curve ≥ 0 (not inverted)', points: 3 },
          { when: 'Curve > −0.75', points: 1 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `10Y−3M = ${fixed(d.YC_M, 2)}`,
        evaluate: (d) => {
          const y = num(d.YC_M);
          if (!fin(y)) return { points: 0, activeIndex: -1 };
          return tier([
            [y >= 0, 3],
            [y > -0.75, 1],
          ]);
        },
      },
      {
        label: 'ISM manufacturing PMI',
        max: 3,
        rules: [
          { when: 'PMI ≥ 50 (expansion)', points: 3 },
          { when: 'PMI ≥ 45', points: 1 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `ISM PMI = ${fixed(d.ISM_PMI, 1)}`,
        evaluate: (d) => {
          const p = num(d.ISM_PMI);
          if (!fin(p)) return { points: 0, activeIndex: -1 };
          return tier([
            [p >= 50, 3],
            [p >= 45, 1],
          ]);
        },
      },
    ],
  },
  {
    key: 'setup',
    label: 'Price setup / damage',
    max: 10,
    field: 'BOTTOM_PRICE_SETUP_SCORE',
    purpose: 'Is the price chart itself damaged enough to support a bottom thesis?',
    interpretation:
      'High = real price damage is visible, not just on-chain cheapness. Low = price has not been impaired enough for a strong bottom setup.',
    sections: ['system'],
    chartIds: ['price-regime', 'holder-realized'],
    subs: [
      {
        label: 'Drawdown depth (from 365-day high)',
        max: 3,
        rules: [
          { when: 'Drawdown ≤ −55%', points: 3 },
          { when: 'Drawdown ≤ −40%', points: 2 },
          { when: 'Drawdown ≤ −25%', points: 1 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `Drawdown = ${pct100(d.BTC_DRAWDOWN_FROM_365D_HIGH)}`,
        evaluate: (d) => {
          const dd = num(d.BTC_DRAWDOWN_FROM_365D_HIGH);
          if (!fin(dd)) return { points: 0, activeIndex: -1 };
          return tier([
            [dd <= -0.55, 3],
            [dd <= -0.4, 2],
            [dd <= -0.25, 1],
          ]);
        },
      },
      {
        label: 'Price below 40-week moving average',
        max: 3,
        rules: [
          { when: 'Price ≤ 40W MA × 0.80', points: 3 },
          { when: 'Price ≤ 40W MA × 0.90', points: 2 },
          { when: 'Price < 40W MA', points: 1 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `${ratio(d.BTCUSD, d.BTC_MA40W)} 40W MA ${usd(d.BTC_MA40W)}`,
        evaluate: (d) => {
          const p = num(d.BTCUSD);
          const ma = num(d.BTC_MA40W);
          if (!fin(p) || !fin(ma) || ma <= 0) return { points: 0, activeIndex: -1 };
          return tier([
            [p <= ma * 0.8, 3],
            [p <= ma * 0.9, 2],
            [p < ma, 1],
          ]);
        },
      },
      {
        label: 'Price below short-term holder realized price',
        max: 3,
        rules: [
          { when: 'Price ≤ STH RP × 0.85', points: 3 },
          { when: 'Price ≤ STH RP × 0.95', points: 2 },
          { when: 'Price < STH RP', points: 1 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `${ratio(d.BTCUSD, d.STH_REALIZED_PRICE)} STH RP ${usd(d.STH_REALIZED_PRICE)}`,
        evaluate: (d) => {
          const p = num(d.BTCUSD);
          const sth = num(d.STH_REALIZED_PRICE);
          if (!fin(p) || !fin(sth) || sth <= 0) return { points: 0, activeIndex: -1 };
          return tier([
            [p <= sth * 0.85, 3],
            [p <= sth * 0.95, 2],
            [p < sth, 1],
          ]);
        },
      },
      {
        label: 'Negative momentum (30d & 90d)',
        max: 1,
        rules: [
          { when: 'ROC30 < 0 AND ROC90 < 0', points: 1 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `ROC30 = ${pct100(d.BTC_ROC30)}, ROC90 = ${pct100(d.BTC_ROC90)}`,
        evaluate: (d) =>
          tier([[fin(d.BTC_ROC30) && fin(d.BTC_ROC90) && num(d.BTC_ROC30) < 0 && num(d.BTC_ROC90) < 0, 1]]),
      },
    ],
  },
  {
    key: 'repair',
    label: 'Price repair / confirmation',
    max: 10,
    field: 'BOTTOM_PRICE_REPAIR_SCORE',
    purpose: 'Has price started to repair — so we are not catching a falling knife?',
    interpretation:
      'High = price is reclaiming key levels and basing. Low = the chart has not begun to confirm a bottom.',
    sections: ['system'],
    chartIds: ['price-regime', 'holder-realized'],
    note: 'Base stabilization adds up to 2 points when recent lows stop breaking and/or price has held ≥8% above the 60-day low for at least 30 days (and 30-day momentum is positive).',
    subs: [
      {
        label: 'Price reclaiming 40-week moving average',
        max: 3,
        rules: [
          { when: 'Price ≥ 40W MA', points: 3 },
          { when: 'Price ≥ 40W MA × 0.90', points: 2 },
          { when: 'Price ≥ 40W MA × 0.80', points: 1 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `${ratio(d.BTCUSD, d.BTC_MA40W)} 40W MA ${usd(d.BTC_MA40W)}`,
        evaluate: (d) => {
          const p = num(d.BTCUSD);
          const ma = num(d.BTC_MA40W);
          if (!fin(p) || !fin(ma) || ma <= 0) return { points: 0, activeIndex: -1 };
          return tier([
            [p >= ma, 3],
            [p >= ma * 0.9, 2],
            [p >= ma * 0.8, 1],
          ]);
        },
      },
      {
        label: 'Price reclaiming short-term holder realized price',
        max: 3,
        rules: [
          { when: 'Price ≥ STH RP', points: 3 },
          { when: 'Price ≥ STH RP × 0.95', points: 2 },
          { when: 'Price ≥ STH RP × 0.90', points: 1 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `${ratio(d.BTCUSD, d.STH_REALIZED_PRICE)} STH RP ${usd(d.STH_REALIZED_PRICE)}`,
        evaluate: (d) => {
          const p = num(d.BTCUSD);
          const sth = num(d.STH_REALIZED_PRICE);
          if (!fin(p) || !fin(sth) || sth <= 0) return { points: 0, activeIndex: -1 };
          return tier([
            [p >= sth, 3],
            [p >= sth * 0.95, 2],
            [p >= sth * 0.9, 1],
          ]);
        },
      },
      {
        label: '30-day momentum positive',
        max: 1,
        rules: [
          { when: 'ROC30 > 0', points: 1 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `ROC30 = ${pct100(d.BTC_ROC30)}`,
        evaluate: (d) => tier([[fin(d.BTC_ROC30) && num(d.BTC_ROC30) > 0, 1]]),
      },
      {
        label: '90-day momentum positive',
        max: 1,
        rules: [
          { when: 'ROC90 > 0', points: 1 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => `ROC90 = ${pct100(d.BTC_ROC90)}`,
        evaluate: (d) => tier([[fin(d.BTC_ROC90) && num(d.BTC_ROC90) > 0, 1]]),
      },
      {
        label: 'Base stabilization',
        max: 2,
        rules: [
          { when: 'Held above 60d low ≥30d AND lows stopped breaking AND ROC30 > 0', points: 2 },
          { when: 'Either held above 60d low OR lows stopped breaking', points: 1 },
          { when: 'otherwise', points: 0 },
        ],
        input: (d) => {
          const p = num(d.BTCUSD);
          const low60 = num(d.BTC_60D_LOW);
          const since = num(d.BTC_DAYS_SINCE_60D_LOW);
          return `${fin(p) && fin(low60) ? `${((p / low60 - 1) * 100).toFixed(0)}% above 60d low` : 'n/a'}, ${fin(since) ? `${since}d since low` : 'n/a'}`;
        },
        evaluate: (d) => {
          const p = num(d.BTCUSD);
          const low60 = num(d.BTC_60D_LOW);
          const low30 = num(d.BTC_30D_LOW);
          const priorLow30 = num(d.BTC_PRIOR_30D_LOW);
          const since = num(d.BTC_DAYS_SINCE_60D_LOW);
          const roc30 = num(d.BTC_ROC30);
          const heldAboveLocalLow =
            fin(p) && fin(low60) && low60 > 0 && fin(since) && since >= 30 && p >= low60 * 1.08;
          const lowsStoppedBreaking =
            fin(low30) && fin(priorLow30) && priorLow30 > 0 && low30 >= priorLow30 * 0.98;
          return tier([
            [heldAboveLocalLow && lowsStoppedBreaking && fin(roc30) && roc30 > 0, 2],
            [heldAboveLocalLow || lowsStoppedBreaking, 1],
          ]);
        },
      },
    ],
  },
];

const FACTOR_BY_KEY: Record<BottomFactorKey, BottomFactor> = BOTTOM_FACTORS.reduce(
  (acc, f) => {
    acc[f.key] = f;
    return acc;
  },
  {} as Record<BottomFactorKey, BottomFactor>,
);

export function getBottomFactor(key: BottomFactorKey): BottomFactor {
  return FACTOR_BY_KEY[key];
}

/** Live, capped score for a single factor (the default is Σ sub points, capped at max). */
export function factorScore(factor: BottomFactor, d: ScoreRow): number {
  if (factor.computeScore) {
    const override = factor.computeScore(d);
    if (override !== null) return override;
  }
  const sum = factor.subs.reduce((acc, s) => acc + s.evaluate(d).points, 0);
  return Math.min(factor.max, sum);
}

// ── Model output ─────────────────────────────────────────────────────────────

export interface BottomScoreResult {
  onchainValue: number;
  capitulation: number;
  liquidityTurn: number;
  macroRisk: number;
  priceSetup: number;
  priceRepair: number;
  priceStructure: number;
  total: number;
  band: string;
  deployment: string;
}

/** Score bands and their suggested staged-deployment ranges (high → low). */
export interface BottomBand {
  /** Inclusive lower bound of the 0–100 total for this band. */
  min: number;
  label: string;
  deployment: string;
}

export const BOTTOM_SCORE_BANDS: BottomBand[] = [
  { min: 85, label: 'Capitulation Opportunity', deployment: '75-100%' },
  { min: 70, label: 'Strong Accumulation', deployment: '50-75%' },
  { min: 50, label: 'Accumulate Slowly', deployment: '25-40%' },
  { min: 25, label: 'Watch', deployment: '0-10%' },
  { min: 0, label: 'Avoid', deployment: '0%' },
];

/** Resolve the band (label + deployment) for a 0–100 total. */
export function bandForTotal(total: number): BottomBand {
  return BOTTOM_SCORE_BANDS.find((b) => total >= b.min) ?? BOTTOM_SCORE_BANDS[BOTTOM_SCORE_BANDS.length - 1];
}

/**
 * Compute the full Bottom Accumulation Score for a signal row. Derived entirely
 * from the `BOTTOM_FACTORS` spec above so the model has exactly one definition.
 */
export function scoreBottomAccumulation(d: ScoreRow): BottomScoreResult {
  const onchainValue = factorScore(FACTOR_BY_KEY.onchain, d);
  const capitulation = factorScore(FACTOR_BY_KEY.capitulation, d);
  const liquidityTurn = factorScore(FACTOR_BY_KEY.liquidity, d);
  const macroRisk = factorScore(FACTOR_BY_KEY.macro, d);
  const priceSetup = factorScore(FACTOR_BY_KEY.setup, d);
  const priceRepair = factorScore(FACTOR_BY_KEY.repair, d);
  const priceStructure = priceSetup + priceRepair;

  const total = onchainValue + capitulation + liquidityTurn + macroRisk + priceStructure;
  const { label: band, deployment } = bandForTotal(total);

  return { onchainValue, capitulation, liquidityTurn, macroRisk, priceSetup, priceRepair, priceStructure, total, band, deployment };
}
