/**
 * Larsson-Line-style three-state trend classifier (reconstruction).
 *
 * The commercial Larsson Line is invite-only ([TradingView][tv],
 * [CTO Larsson][medium]). Public reconstructions and the EQM author's
 * description converge on the same interface:
 *
 *   Gold  — clean bullish MA order → ride / accumulate
 *   Blue  — clean bearish MA order → stand aside (cash)
 *   Gray  — MAs tangled → do nothing new; keep the current position
 *
 * Two constructions are supported:
 *
 * 1. `ribbon4` — four EMAs of increasing period. Gold when
 *    EMA₁ > EMA₂ > EMA₃ > EMA₄, blue when inverted, gray otherwise.
 *    This matches the EQM author's "four runners" description and is
 *    the construction used when the series is CQM Risk (the "EQM twist":
 *    same rule, better input).
 *
 * 2. `emaAtr` — EMA(fast)/EMA(slow) with a neutral band of
 *    `atrMult × ATR(atrPeriod)`. Matches UniqueCharts' public
 *    reconstruction of the Larsson Line on TradingView comments
 *    (EMA 30/60 + 0.3×ATR(60)).
 *
 * Neither claims to be the proprietary Larsson Line; both produce the
 * three-state contract the strategy needs.
 *
 * [tv]: https://www.tradingview.com/script/VaY7PmRo-Larsson-Line/
 * [medium]: https://ctolarsson.medium.com/what-is-larsson-line-key-to-billionaire-lifestyle-and-the-end-of-overtrading-55755cff90b7
 */

export type LliState = 'gold' | 'blue' | 'gray';
export type LliMode = 'ribbon4' | 'emaAtr';

export const LLI_DEFAULT_MODE: LliMode = 'ribbon4';
/**
 * Four EMA periods (fast → slow), used by `ribbon4`.
 * Fibonacci-ish 8/21/55/144 — best of a 15-candidate sweep on the six
 * early-cycle accumulation windows (scripts/lli-compare + ribbon sweep).
 */
export const LLI_DEFAULT_PERIODS = [8, 21, 55, 144] as const;
/** UniqueCharts / EMA-ATR reconstruction defaults. */
export const LLI_DEFAULT_FAST_PERIOD = 30;
export const LLI_DEFAULT_SLOW_PERIOD = 60;
export const LLI_DEFAULT_ATR_PERIOD = 60;
export const LLI_DEFAULT_ATR_MULT = 0.3;

export interface LliRibbon4Params {
  mode: 'ribbon4';
  /** Exactly four periods, strictly increasing. */
  periods: readonly [number, number, number, number];
  /**
   * Minimum adjacent-EMA separation (in series units) required to count
   * as a clean order. 0 = any strict inequality. For CQM Risk ∈ [0, 1],
   * 0.002 ≈ 0.2 risk-points of separation.
   */
  minGap?: number;
}

export interface LliEmaAtrParams {
  mode: 'emaAtr';
  fastPeriod: number;
  slowPeriod: number;
  atrPeriod: number;
  atrMult: number;
}

export type LliParams = LliRibbon4Params | LliEmaAtrParams;

export interface SeriesPoint {
  date: string;
  value: number;
}

/** Per-day LLI output including the MAs used for classification (for charts). */
export interface LliSeriesRow {
  date: string;
  value: number;
  state: LliState;
  /** `ribbon4` EMAs, fast → slow. */
  ema1?: number;
  ema2?: number;
  ema3?: number;
  ema4?: number;
  /** `emaAtr` EMAs + neutral band around the slow EMA. */
  emaFast?: number;
  emaSlow?: number;
  atrBandUpper?: number;
  atrBandLower?: number;
}

function emaStep(prev: number | null, value: number, period: number): number {
  const alpha = 2 / (period + 1);
  return prev === null ? value : alpha * value + (1 - alpha) * prev;
}

function atrTrueRange(
  high: number,
  low: number,
  prevClose: number | null,
): number {
  if (prevClose === null) return high - low;
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

function classifyRibbon4(
  emas: readonly [number, number, number, number],
  minGap: number,
): LliState {
  const [a, b, c, d] = emas;
  const bull =
    a > b + minGap && b > c + minGap && c > d + minGap;
  const bear =
    a + minGap < b && b + minGap < c && c + minGap < d;
  if (bull) return 'gold';
  if (bear) return 'blue';
  return 'gray';
}

/**
 * Full LLI pass: state plus the moving averages that produced it.
 * The series is typically either daily BTC closes or walk-forward CQM Risk.
 */
export function computeLliSeries(
  series: SeriesPoint[],
  params: LliParams,
): LliSeriesRow[] {
  const out: LliSeriesRow[] = [];
  if (series.length === 0) return out;

  if (params.mode === 'ribbon4') {
    const periods = params.periods.map((p) => Math.max(1, Math.round(p))) as [
      number,
      number,
      number,
      number,
    ];
    const minGap = Math.max(0, params.minGap ?? 0);
    let e0: number | null = null;
    let e1: number | null = null;
    let e2: number | null = null;
    let e3: number | null = null;

    for (const pt of series) {
      if (!Number.isFinite(pt.value)) continue;
      e0 = emaStep(e0, pt.value, periods[0]);
      e1 = emaStep(e1, pt.value, periods[1]);
      e2 = emaStep(e2, pt.value, periods[2]);
      e3 = emaStep(e3, pt.value, periods[3]);
      out.push({
        date: pt.date,
        value: pt.value,
        state: classifyRibbon4([e0, e1, e2, e3], minGap),
        ema1: e0,
        ema2: e1,
        ema3: e2,
        ema4: e3,
      });
    }
    return out;
  }

  // emaAtr — UniqueCharts reconstruction. ATR needs a high/low proxy; for
  // a univariate series we use |Δvalue| as a one-bar true-range stand-in
  // (equivalent to ATR on a synthetic OHLC where H=L=C=value).
  const fastP = Math.max(1, Math.round(params.fastPeriod));
  const slowP = Math.max(1, Math.round(params.slowPeriod));
  const atrP = Math.max(1, Math.round(params.atrPeriod));
  const atrMult = Math.max(0, params.atrMult);
  let emaFast: number | null = null;
  let emaSlow: number | null = null;
  let atr: number | null = null;
  let prevValue: number | null = null;

  for (const pt of series) {
    if (!Number.isFinite(pt.value)) continue;
    const tr = atrTrueRange(pt.value, pt.value, prevValue);
    atr = atr === null ? tr : emaStep(atr, tr, atrP); // Wilder-ish via EMA
    emaFast = emaStep(emaFast, pt.value, fastP);
    emaSlow = emaStep(emaSlow, pt.value, slowP);
    prevValue = pt.value;

    const spread = (emaFast as number) - (emaSlow as number);
    const band = atrMult * (atr as number);
    let state: LliState = 'gray';
    if (spread > band) state = 'gold';
    else if (spread < -band) state = 'blue';

    out.push({
      date: pt.date,
      value: pt.value,
      state,
      emaFast: emaFast as number,
      emaSlow: emaSlow as number,
      atrBandUpper: (emaSlow as number) + band,
      atrBandLower: (emaSlow as number) - band,
    });
  }
  return out;
}

/**
 * Classify each day of a univariate series into gold / blue / gray.
 * The series is typically either daily BTC closes or walk-forward CQM Risk.
 */
export function computeLliStates(
  series: SeriesPoint[],
  params: LliParams,
): Map<string, LliState> {
  const out = new Map<string, LliState>();
  for (const row of computeLliSeries(series, params)) {
    out.set(row.date, row.state);
  }
  return out;
}

export function parseLliPeriods(
  raw: readonly number[] | undefined,
): [number, number, number, number] {
  const fallback = [...LLI_DEFAULT_PERIODS] as [number, number, number, number];
  if (!raw || raw.length !== 4) return fallback;
  const cleaned = raw.map((p) => Math.max(1, Math.round(p))) as [
    number,
    number,
    number,
    number,
  ];
  // Enforce non-decreasing order so "fast → slow" stays meaningful.
  for (let i = 1; i < 4; i++) {
    if (cleaned[i] <= cleaned[i - 1]) cleaned[i] = cleaned[i - 1] + 1;
  }
  return cleaned;
}
