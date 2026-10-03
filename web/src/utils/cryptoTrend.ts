/**
 * CryptoTrend v2 — port of the user's TradingView Pine indicator.
 *
 * Two Wilder-smoothed moving averages (SMMA / RMA) of hl2, Alligator-style:
 *
 *   jaw  = SMMA(hl2, 29)   (slow)
 *   lips = SMMA(hl2, 16)   (fast)
 *
 *   Up      (yellow) — lips above jaw by more than the neutral band
 *   Down    (purple) — lips below jaw by more than the neutral band
 *   Neutral (orange) — lines within the band (converging / crossing)
 *
 * Neutral band, two variants:
 *   `pct` — the original: jaw/lips outside [1 − pct, 1 + pct] (pct = 1.5%).
 *   `atr` — volatility-scaled: |jaw − lips| > atrMult × ATR(atrPeriod).
 *
 * Differences from the Pine script, forced by the data:
 * - The dataset is daily closes only, so hl2 = close and the true range is
 *   |Δclose| (ATR on a synthetic OHLC where H = L = C). This understates
 *   real ATR (no intraday range), which the default multiplier absorbs.
 * - The Pine `offset = 1` on the jaw is display-only and never affected the
 *   colour, so it is ignored here.
 */

export type CryptoTrendState = 'up' | 'down' | 'neutral';
export type CryptoTrendBandMode = 'pct' | 'atr';

export const CRYPTO_TREND_DEFAULT_JAW = 29;
export const CRYPTO_TREND_DEFAULT_LIPS = 16;
export const CRYPTO_TREND_DEFAULT_BAND_MODE: CryptoTrendBandMode = 'pct';
/** Original Pine threshold: ±1.5% jaw/lips proximity. */
export const CRYPTO_TREND_DEFAULT_PCT = 0.015;
export const CRYPTO_TREND_DEFAULT_ATR_PERIOD = 14;
/**
 * 1×ATR14 on daily closes spends about as long neutral as the original 1.5%
 * rule (~25% of days since 2013), so the two modes are comparable.
 */
export const CRYPTO_TREND_DEFAULT_ATR_MULT = 1;

export interface CryptoTrendParams {
  jawLength: number;
  lipsLength: number;
  bandMode: CryptoTrendBandMode;
  /** `pct` mode: proximity threshold as a fraction (0.015 = 1.5%). */
  pct: number;
  /** `atr` mode: ATR period (Wilder smoothing, like Pine `ta.atr`). */
  atrPeriod: number;
  /** `atr` mode: band width in ATR units. */
  atrMult: number;
}

export interface CryptoTrendRow {
  date: string;
  price: number;
  /** null during warm-up (fewer than `length` bars, like Pine's na). */
  jaw: number | null;
  lips: number | null;
  atr: number | null;
  /** Neutral band around the jaw, for charting. */
  bandUpper: number | null;
  bandLower: number | null;
  state: CryptoTrendState;
}

/**
 * Pine-style SMMA: seed with the SMA of the first `length` values, then
 * smma = (prev × (length − 1) + src) / length. Returns a stateful stepper
 * that yields null until the seed window is full.
 */
function smmaStepper(length: number): (src: number) => number | null {
  let value: number | null = null;
  const seed: number[] = [];
  return (src) => {
    if (value === null) {
      seed.push(src);
      if (seed.length < length) return null;
      value = seed.reduce((a, b) => a + b, 0) / length;
      return value;
    }
    value = (value * (length - 1) + src) / length;
    return value;
  };
}

export function computeCryptoTrendSeries(
  data: Array<{ date: string; price: number }>,
  params: CryptoTrendParams,
): CryptoTrendRow[] {
  const jawLen = Math.max(1, Math.round(params.jawLength));
  const lipsLen = Math.max(1, Math.round(params.lipsLength));
  const atrLen = Math.max(1, Math.round(params.atrPeriod));
  const pct = Math.max(0, params.pct);
  const atrMult = Math.max(0, params.atrMult);

  const jawStep = smmaStepper(jawLen);
  const lipsStep = smmaStepper(lipsLen);
  const atrStep = smmaStepper(atrLen);
  let prevPrice: number | null = null;

  const out: CryptoTrendRow[] = [];
  for (const { date, price } of data) {
    if (!Number.isFinite(price) || price <= 0) continue;
    const jaw = jawStep(price);
    const lips = lipsStep(price);
    // First bar has no previous close; Pine's TR falls back to high − low (0 here).
    const atr = atrStep(prevPrice === null ? 0 : Math.abs(price - prevPrice));
    prevPrice = price;

    let state: CryptoTrendState = 'neutral';
    let bandUpper: number | null = null;
    let bandLower: number | null = null;
    if (jaw !== null && lips !== null) {
      // Direction matches the Pine colour: jaw ≥ lips → purple (down).
      const dir: CryptoTrendState = jaw >= lips ? 'down' : 'up';
      if (params.bandMode === 'pct') {
        const proximity = jaw / lips;
        if (proximity > 1 + pct || proximity < 1 - pct) state = dir;
        // Equivalent band on the lips axis: lips = jaw / (1 ∓ pct).
        bandUpper = jaw / (1 - pct);
        bandLower = jaw / (1 + pct);
      } else if (atr !== null) {
        const band = atrMult * atr;
        if (Math.abs(jaw - lips) > band) state = dir;
        bandUpper = jaw + band;
        bandLower = jaw - band;
      }
    }

    out.push({ date, price, jaw, lips, atr, bandUpper, bandLower, state });
  }
  return out;
}

export function computeCryptoTrendStates(
  data: Array<{ date: string; price: number }>,
  params: CryptoTrendParams,
): Map<string, CryptoTrendState> {
  const out = new Map<string, CryptoTrendState>();
  for (const row of computeCryptoTrendSeries(data, params)) out.set(row.date, row.state);
  return out;
}
