import { SignalData } from '../App';
import {
  computeCqmDynamicTrade,
  CQM_DEFAULT_MAX_CASH_FRACTION,
  CQM_DEFAULT_SELL_THRESHOLD,
} from '../utils/cqmSizing';
import {
  computeLliStates,
  parseLliPeriods,
  LLI_DEFAULT_MODE,
  LLI_DEFAULT_PERIODS,
  LLI_DEFAULT_FAST_PERIOD,
  LLI_DEFAULT_SLOW_PERIOD,
  LLI_DEFAULT_ATR_PERIOD,
  LLI_DEFAULT_ATR_MULT,
  type LliMode,
  type LliState,
} from '../utils/larssonLine';
import {
  computeCryptoTrendStates,
  CRYPTO_TREND_DEFAULT_JAW,
  CRYPTO_TREND_DEFAULT_LIPS,
  CRYPTO_TREND_DEFAULT_BAND_MODE,
  CRYPTO_TREND_DEFAULT_PCT,
  CRYPTO_TREND_DEFAULT_ATR_PERIOD,
  CRYPTO_TREND_DEFAULT_ATR_MULT,
  type CryptoTrendBandMode,
  type CryptoTrendState,
} from '../utils/cryptoTrend';

// --- Configuration ---

export type DcaFrequency = 'daily' | 'weekly' | 'monthly';
export type OffSignalMode = 'pause' | 'sell_matching' | 'sell_all';

// Hybrid EMA trend strategy defaults. The paper suggests 12/26-day EMAs; a
// grid sweep across six BTC cycle windows (scripts/ema-sweep.mts, 2026-07)
// found 8/200 @ 1% saturation the most robust risk-adjusted combo: best
// worst-window result vs Baseline DCA, lowest turnover, and positive in the
// two most recent windows. 5/100 maximizes mean outperformance but with a
// worse downside. 12/26 @ 5% underperformed Baseline DCA in 5 of 6 windows.
export const EMA_DEFAULT_FAST_PERIOD = 8;
export const EMA_DEFAULT_SLOW_PERIOD = 200;
/**
 * Signal magnitude |EMA_fast − EMA_slow| / price at which the allocation
 * saturates (fully BTC when bullish, fully cash when bearish). Small values
 * behave close to a crossover switch with a narrow proportional band around
 * the cross; the sweep favored ≤2% across every timeframe tested.
 */
export const EMA_DEFAULT_SIGNAL_SCALE = 0.01;

export interface BacktestConfig {
  startDate: string;          // YYYY-MM-DD
  endDate?: string;           // YYYY-MM-DD (inclusive). Defaults to the last available date.
  dcaAmount: number;          // USD per period (e.g. 100)
  frequency: DcaFrequency;
  offSignalMode: OffSignalMode;
  macroAccel: boolean;        // enable accelerated strategy
  accelMultiplier: number;    // default 3
  /**
   * Enable the CoinStrat Quantile Model (CQM) Risk-Weighted DCA strategy.
   *
   * Dynamic sizing (default when `cqmDynamicSizing` is true):
   *   BUY  (Risk < 50%): max(base × (1 − 2R), maxCashFraction × (0.5 − R)/0.5 × cash)
   *   HOLD (50% ≤ Risk ≤ sellThreshold): no trade
   *   SELL (Risk > sellThreshold): max(base, btcSellFraction × btcValue) × (R − sellThreshold)/(1 − sellThreshold)
   *
   * Legacy flat-fraction rule (when `cqmDynamicSizing` is false):
   *   size = max(base, cqmTradeFraction × reserve); trade = size × (1 − 2R)
   *
   * Each period still deposits `dcaAmount` of cash for equal-funding fairness.
   */
  cqmDca?: boolean;
  /**
   * Risk lookup keyed by Date (YYYY-MM-DD) → CQM risk in [0, 1]. Required
   * when `cqmDca` is true. Dates not in the map fall back to risk=0.5
   * (neutral, no trade).
   */
  cqmRiskByDate?: Map<string, number>;
  /**
   * Use the tuned dynamic sizing rule (risk-scaled cash deployment +
   * dead-zone sells). Default true. Set false to recover the legacy
   * flat `cqmTradeFraction` rule.
   */
  cqmDynamicSizing?: boolean;
  /**
   * Max fraction of cash balance deployable per period at Risk 0, tapering
   * linearly to 0 at fair value (50%). Default 6% (tuned).
   */
  cqmMaxCashFraction?: number;
  /**
   * Risk level above which sells begin (dead zone from 50% to this value).
   * Default 0.75 (tuned). Set to 1 to disable sells (buy-only).
   */
  cqmSellThreshold?: number;
  /**
   * Fraction of the relevant reserve the legacy CQM strategy is allowed to
   * deploy per period (in addition to the base DCA amount). Applied to
   * cash balance for buys and to BTC value (btcHeld × price) for sells.
   * Default: 0.01 (1%). Set to 0 to recover the original
   * `base × (1 − 2 × Risk)` rule. Ignored when `cqmDynamicSizing` is true.
   */
  cqmTradeFraction?: number;
  /**
   * Optional opening balances the simulation starts with, before any DCA
   * deposits. Both are counted as initial invested capital (cash at face value,
   * BTC at the first day's price) so Total Return stays a fair ratio.
   * Default: 0 / 0 (pure DCA from zero).
   */
  startingCash?: number;
  startingBtc?: number;
  /**
   * Allow the CQM strategy to short. It still deposits `dcaAmount` each period
   * (equal-funding with the baseline) and trades `base × (1 − 2 × Risk)`, but
   * SELLs are no longer capped by the current BTC holdings — the net BTC
   * position may go negative. Later buys wind the short back down and then build
   * a long, all on a single netted inventory (no explicit cover; idealized with
   * no borrow cost or liquidation). Total Return stays comparable to the
   * baseline because total deposits are unchanged.
   */
  cqmAllowShort?: boolean;
  /**
   * Annual yield earned on idle cash, in percent (e.g. 4 = 4% APY), accrued
   * daily. Applies to every strategy's cash balance, so cash-holding
   * strategies aren't unfairly penalized vs T-bill reality. Default 0.
   */
  cashAnnualYieldPct?: number;
  /**
   * Enable the Hybrid EMA Trend strategy (from "A Trust-Minimized
   * Multi-Oracle Architecture for Autonomous On-Chain Hedge Funds", §2.3).
   *
   * Two EMAs (fast/slow) are computed on daily closes. The trend signal is
   *   s = (EMA_fast − EMA_slow) / price
   * and the portfolio targets a BTC weight proportional to the signal:
   *   w = clamp(0.5 + s / (2 × signalScale), 0, 1)
   * Each period the strategy deposits `dcaAmount` (equal funding with the
   * other strategies) and rebalances toward w. Because the allocation scales
   * with signal strength instead of flipping all-or-nothing at the cross,
   * weak sideways signals only cause small shifts (less whipsaw).
   */
  emaDca?: boolean;
  /** Fast EMA period in days. Default 12 (paper). */
  emaFastPeriod?: number;
  /** Slow EMA period in days. Default 26 (paper). */
  emaSlowPeriod?: number;
  /**
   * Signal magnitude at which the allocation saturates (w hits 0 or 1).
   * Default 0.05 (EMA spread of 5% of price = full conviction).
   */
  emaSignalScale?: number;
  /**
   * Enable the LLI+CQM hybrid: a Larsson-Line-style three-state trend
   * filter (gold / blue / gray) gates the CQM Risk DCA sizing rule.
   *
   *   Gold — clean bullish MA order → run CQM dynamic sizing (buy / trim)
   *   Blue — clean bearish MA order → sell all BTC, stand aside in cash
   *   Gray — MAs tangled → hold; deposits accumulate as cash, no trades
   *
   * Default series is walk-forward CQM Risk (the "EQM twist": same rule,
   * valuation input instead of raw price). Set `lliSeries: 'price'` to
   * classify on BTC closes instead. Requires `cqmRiskByDate` when the
   * series is `'risk'`.
   */
  lliCqmDca?: boolean;
  /** State engine: four-EMA ribbon (default) or EMA+ATR neutral band. */
  lliMode?: LliMode;
  /** Series the MAs are computed on. Default `'risk'`. */
  lliSeries?: 'risk' | 'price';
  /** Four EMA periods for `ribbon4` mode (fast → slow). Default 8/21/55/144. */
  lliPeriods?: readonly [number, number, number, number];
  /** Min adjacent-EMA gap (risk units or USD) for a clean ribbon order. */
  lliMinGap?: number;
  /** `emaAtr` mode: fast EMA period. Default 30. */
  lliFastPeriod?: number;
  /** `emaAtr` mode: slow EMA period. Default 60. */
  lliSlowPeriod?: number;
  /** `emaAtr` mode: ATR period. Default 60. */
  lliAtrPeriod?: number;
  /** `emaAtr` mode: neutral-band width in ATR units. Default 0.3. */
  lliAtrMult?: number;
  /**
   * On a flip into gold, deploy the full cash reserve as a lump-sum
   * re-entry (mirrors CORE's flip-on deploy). Default true.
   */
  lliDeployOnGold?: boolean;
  /**
   * Enable CryptoTrend DCA (port of the "CryptoTrend v2" Pine indicator):
   * SMMA(29) "jaw" vs SMMA(16) "lips" on price with a neutral band.
   *
   *   Up      — DCA the deposit; on a flip into up, deploy the cash reserve
   *   Down    — sell all BTC, stand aside in cash
   *   Neutral — hold; deposits accumulate as cash, no trades
   */
  cryptoTrendDca?: boolean;
  cryptoTrendJaw?: number;
  cryptoTrendLips?: number;
  /** Neutral band: fixed jaw/lips % (Pine original) or ATR-scaled. */
  cryptoTrendBandMode?: CryptoTrendBandMode;
  /** `pct` mode threshold as a fraction. Default 0.015. */
  cryptoTrendPct?: number;
  cryptoTrendAtrPeriod?: number;
  cryptoTrendAtrMult?: number;
}

export {
  LLI_DEFAULT_MODE,
  LLI_DEFAULT_PERIODS,
  LLI_DEFAULT_FAST_PERIOD,
  LLI_DEFAULT_SLOW_PERIOD,
  LLI_DEFAULT_ATR_PERIOD,
  LLI_DEFAULT_ATR_MULT,
};
export type { LliMode, LliState };
export {
  CRYPTO_TREND_DEFAULT_JAW,
  CRYPTO_TREND_DEFAULT_LIPS,
  CRYPTO_TREND_DEFAULT_BAND_MODE,
  CRYPTO_TREND_DEFAULT_PCT,
  CRYPTO_TREND_DEFAULT_ATR_PERIOD,
  CRYPTO_TREND_DEFAULT_ATR_MULT,
};
export type { CryptoTrendBandMode, CryptoTrendState };

// --- Results ---

export interface SeriesPoint {
  date: string;
  portfolioValue: number;   // btcHeld * price + cashBalance
  btcHeld: number;
  cashDeployed: number;      // cumulative USD deposited into the strategy
  cashWithdrawn: number;     // cumulative USD received from sells (stays in portfolio as cash)
  btcPrice: number;
}

/** A single executed buy/sell, with the portfolio state immediately after it. */
export interface Trade {
  date: string;
  side: 'buy' | 'sell';
  btcAmount: number;        // BTC transacted (always positive magnitude)
  usdAmount: number;        // USD value transacted (always positive magnitude)
  price: number;            // BTC price at execution
  btcHeld: number;          // net BTC position after the trade (may be negative when shorting)
  cashBalance: number;      // USD cash after the trade
  portfolioValue: number;   // btcHeld * price + cashBalance after the trade
}

export interface StrategyResult {
  name: string;
  series: SeriesPoint[];
  totalInvested: number;     // total cash deposited into the strategy
  totalWithdrawn: number;    // total USD received from BTC sells (internal, stays in portfolio)
  netDeployed: number;       // invested - withdrawn
  finalBtcHeld: number;
  finalCashBalance: number;  // remaining USD cash in portfolio (dry powder)
  finalPortfolioValue: number;
  totalReturn: number;       // % return on total capital deposited
  /** Peak-to-trough on raw portfolio value (BTC + cash). Masked by ongoing DCA deposits. */
  maxDrawdown: number;
  /** Peak-to-trough on portfolio value ÷ cumulative deposits — fair for DCA windows. */
  maxReturnDrawdown: number;
  /** Net BTC position at the end. Can be negative when shorting is allowed. */
  btcAccumulated: number;
  /**
   * Money-weighted annualized return (IRR) on the deposit stream. Accounts for
   * the timing of each deposit, unlike totalReturn which treats all deposits
   * as equal regardless of when they were made.
   */
  annualizedIrr: number;
  /** totalReturn ÷ maxReturnDrawdown (risk-adjusted). NaN when DD is ~0. */
  returnOverMaxDrawdown: number;
  /** Mean USD cash balance across the window (idle capital / dry powder). */
  avgCashBalance: number;
  /** Total interest accrued on idle cash (0 unless cashAnnualYieldPct set). */
  totalInterestEarned: number;
  /** Chronological list of executed buys/sells (deposits alone are not trades). */
  trades: Trade[];
}

// --- Helpers ---

/**
 * Filter data to DCA sample points based on frequency.
 * Daily = every row, Weekly = Mondays (or nearest day after),
 * Monthly = 1st of each month (or nearest day after).
 */
function sampleByFrequency(data: SignalData[], frequency: DcaFrequency): SignalData[] {
  if (frequency === 'daily') return data;

  const sampled: SignalData[] = [];
  let lastKey = '';

  for (const d of data) {
    const dt = new Date(d.Date);
    let key: string;

    if (frequency === 'weekly') {
      // Key by ISO week: pick first available day each week (Monday = 1)
      if (dt.getUTCDay() === 1) {
        key = d.Date; // It's a Monday
      } else {
        // Find the Monday of this week
        const dayOfWeek = dt.getUTCDay();
        const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(dt);
        monday.setUTCDate(monday.getUTCDate() + diff);
        key = monday.toISOString().split('T')[0];
      }
    } else {
      // monthly: key by YYYY-MM
      key = d.Date.substring(0, 7);
    }

    if (key !== lastKey) {
      sampled.push(d);
      lastKey = key;
    }
  }

  return sampled;
}

/**
 * Compute max drawdown from a series of portfolio values.
 * Returns a positive number (e.g. 0.35 = 35% drawdown).
 */
function computeMaxDrawdown(values: number[]): number {
  let peak = -Infinity;
  let maxDD = 0;

  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (peak - v) / peak;
      if (dd > maxDD) maxDD = dd;
    }
  }

  return maxDD;
}

/**
 * Max drawdown on the return-vs-deposits equity curve (portfolio ÷ cumulative
 * deposits). Removes the upward drift from fresh DCA inflows so short windows
 * still show loss periods.
 */
function computeMaxReturnDrawdown(series: SeriesPoint[]): number {
  const equity = series
    .filter((s) => s.cashDeployed > 0)
    .map((s) => s.portfolioValue / s.cashDeployed);
  return computeMaxDrawdown(equity);
}

export interface EmaTrendPoint {
  emaFast: number;
  emaSlow: number;
  weight: number;
}

/**
 * Per-date EMAs + target BTC weight for the Hybrid EMA Trend strategy.
 *
 * Both EMAs are seeded on the first valid price and updated daily with
 * α = 2/(period+1). The trend signal s = (EMA_fast − EMA_slow)/price maps to
 * a target BTC weight w = 0.5 + s/(2 × signalScale), clamped to [0, 1] —
 * neutral (50/50) when the EMAs touch, fully BTC when the fast EMA leads by
 * signalScale of price, fully cash when it trails by the same amount.
 *
 * Computed on the full history (not the backtest window) so the EMAs are
 * already warmed up on the start date. Exported for Lab Inspect charts.
 */
export function computeEmaTrendSeries(
  data: SignalData[],
  fastPeriod: number,
  slowPeriod: number,
  signalScale: number,
): Map<string, EmaTrendPoint> {
  const out = new Map<string, EmaTrendPoint>();
  const alphaFast = 2 / (fastPeriod + 1);
  const alphaSlow = 2 / (slowPeriod + 1);
  let emaFast: number | null = null;
  let emaSlow: number | null = null;

  for (const d of data) {
    const price = d.BTCUSD;
    if (!Number.isFinite(price) || price <= 0) continue;
    emaFast = emaFast === null ? price : alphaFast * price + (1 - alphaFast) * emaFast;
    emaSlow = emaSlow === null ? price : alphaSlow * price + (1 - alphaSlow) * emaSlow;
    const signal = (emaFast - emaSlow) / price;
    const w = 0.5 + signal / (2 * signalScale);
    out.set(d.Date, {
      emaFast,
      emaSlow,
      weight: Math.max(0, Math.min(1, w)),
    });
  }

  return out;
}

function computeEmaTrendWeights(
  data: SignalData[],
  fastPeriod: number,
  slowPeriod: number,
  signalScale: number,
): Map<string, number> {
  const series = computeEmaTrendSeries(data, fastPeriod, slowPeriod, signalScale);
  const weights = new Map<string, number>();
  for (const [date, pt] of series) weights.set(date, pt.weight);
  return weights;
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface DepositFlow {
  ts: number;     // epoch ms of the deposit
  amount: number; // USD deposited (always positive)
}

/**
 * Money-weighted annualized return (IRR) of a deposit stream against the
 * final portfolio value. Solves for the daily rate r such that all deposits
 * compounded at r equal the final value, then annualizes. The objective is
 * monotonic in r (all deposits are positive), so bisection always converges.
 */
function computeAnnualizedIrr(
  flows: DepositFlow[],
  finalValue: number,
  endTs: number,
): number {
  if (flows.length === 0 || !Number.isFinite(finalValue)) return NaN;
  if (finalValue <= 0) return -1;

  const days = flows.map((f) => Math.max(0, (endTs - f.ts) / DAY_MS));
  const fv = (r: number): number => {
    let sum = 0;
    for (let i = 0; i < flows.length; i++) {
      sum += flows[i].amount * Math.pow(1 + r, days[i]);
    }
    return sum - finalValue;
  };

  let lo = -0.05; // -0.05/day ≈ total loss within months; safely below any real outcome
  let hi = 0.05;  // +0.05/day ≈ 5,000,000%+ annualized; safely above
  if (fv(lo) > 0 || fv(hi) < 0) return NaN; // outcome outside bracket (degenerate)
  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    if (fv(mid) > 0) hi = mid;
    else lo = mid;
  }
  const rDaily = (lo + hi) / 2;
  return Math.pow(1 + rDaily, 365.25) - 1;
}

// --- Strategy Simulation ---

/**
 * Equal-funding model:
 * 
 * Every DCA period, the strategy receives `dcaAmount` as a cash deposit.
 * The decision logic then determines how that cash (and any reserves) is used:
 * 
 * - Baseline: immediately convert the deposit to BTC.
 * - CoinStrat: when CORE is ON, buy BTC; when OFF, hold as cash (dry powder).
 *   On the first buy after CORE flips ON, deploy the full cash reserve.
 *   Off-signal modes (sell_matching, sell_all) convert BTC back to cash,
 *   growing the reserve for re-entry.
 * - CoinStrat + MACRO 3x: same as CoinStrat, but spend 3x DCA when MACRO is
 *   also ON (drawing from cash reserves).
 *
 * This ensures all strategies receive identical total capital, making
 * comparisons fair (same "Total Invested" across strategies).
 */

interface SimState {
  btcHeld: number;
  cashBalance: number;       // USD cash sitting in the portfolio (dry powder + sell proceeds)
  totalDeposited: number;    // cumulative USD deposited into strategy
  totalSellProceeds: number; // cumulative USD received from selling BTC (stays in portfolio)
  prevCoreOn: boolean;       // track CORE state for flip detection
}

/**
 * Decision returned by the strategy logic each DCA period.
 * - extraDeposit: additional USD to inject beyond the regular DCA deposit
 *                 (used by MACRO 3x to fund accelerated buys)
 * - buyBtcUsd:    how much USD to spend buying BTC (from cash reserves)
 * - sellBtcUsd:   how much USD worth of BTC to sell (proceeds go to cash)
 * - sellAll:      sell entire BTC position (proceeds go to cash)
 * - deployReserves: deploy full cash balance into BTC (lump-sum re-entry)
 */
interface TradeDecision {
  extraDeposit: number;
  buyBtcUsd: number;
  sellBtcUsd: number;
  sellAll: boolean;
  deployReserves: boolean;
}

function runStrategy(
  name: string,
  sampledData: SignalData[],
  allDailyData: SignalData[],
  config: BacktestConfig,
  decisionLogic: (d: SignalData, state: SimState) => TradeDecision,
  allowShort = false,
): StrategyResult {
  // Opening balances. BTC is valued at the first available price so it counts
  // as initial invested capital alongside the starting cash.
  const startingCash = Math.max(0, config.startingCash ?? 0);
  const startingBtc = Math.max(0, config.startingBtc ?? 0);
  let firstPrice = 0;
  for (const d of allDailyData) {
    const p = d.BTCUSD;
    if (Number.isFinite(p) && p > 0) {
      firstPrice = p;
      break;
    }
  }

  const state: SimState = {
    btcHeld: startingBtc,
    cashBalance: startingCash,
    totalDeposited: startingCash + startingBtc * firstPrice,
    totalSellProceeds: 0,
    prevCoreOn: false,
  };

  // Track which sampled dates trigger actions
  const actionDates = new Set(sampledData.map(d => d.Date));

  // Daily interest accrual on idle cash (0 unless cashAnnualYieldPct is set).
  const cashYieldPct = Math.max(0, config.cashAnnualYieldPct ?? 0);
  const dailyCashRate = cashYieldPct > 0 ? Math.pow(1 + cashYieldPct / 100, 1 / 365.25) - 1 : 0;
  let totalInterestEarned = 0;

  // Deposit stream for the money-weighted (IRR) return.
  const depositFlows: DepositFlow[] = [];
  if (state.totalDeposited > 0) {
    const firstTs = allDailyData.length > 0 ? new Date(allDailyData[0].Date).getTime() : 0;
    depositFlows.push({ ts: firstTs, amount: state.totalDeposited });
  }

  // Build series on ALL daily data for smooth charting,
  // but only execute deposits + trades on sampled dates.
  const series: SeriesPoint[] = [];
  const trades: Trade[] = [];
  let soldAllAlready = false;
  let cashBalanceSum = 0;

  for (const d of allDailyData) {
    const price = d.BTCUSD;
    if (!Number.isFinite(price) || price <= 0) continue;
    const dayTs = new Date(d.Date).getTime();

    // 0. Accrue daily interest on the cash held overnight.
    if (dailyCashRate > 0 && state.cashBalance > 0) {
      const interest = state.cashBalance * dailyCashRate;
      state.cashBalance += interest;
      totalInterestEarned += interest;
    }

    if (actionDates.has(d.Date)) {
      // 1. Deposit DCA amount as cash (base funding, equal across strategies)
      state.cashBalance += config.dcaAmount;
      state.totalDeposited += config.dcaAmount;
      depositFlows.push({ ts: dayTs, amount: config.dcaAmount });

      // 2. Get the strategy's decision
      const decision = decisionLogic(d, state);

      // 2b. Inject extra capital if the strategy requests it (e.g. MACRO 3x funding)
      if (decision.extraDeposit > 0) {
        state.cashBalance += decision.extraDeposit;
        state.totalDeposited += decision.extraDeposit;
        depositFlows.push({ ts: dayTs, amount: decision.extraDeposit });
      }

      // 3. Execute sells first (to free up cash)
      if (decision.sellAll) {
        if (!soldAllAlready && state.btcHeld > 0) {
          const btcSold = state.btcHeld;
          const proceeds = btcSold * price;
          state.totalSellProceeds += proceeds;
          state.cashBalance += proceeds;
          state.btcHeld = 0;
          soldAllAlready = true;
          trades.push({
            date: d.Date,
            side: 'sell',
            btcAmount: btcSold,
            usdAmount: proceeds,
            price,
            btcHeld: state.btcHeld,
            cashBalance: state.cashBalance,
            portfolioValue: state.btcHeld * price + state.cashBalance,
          });
        }
      } else if (decision.sellBtcUsd > 0) {
        // When shorting is allowed the sell is NOT capped by holdings, so the
        // net position can go negative; otherwise cap at the current balance.
        const btcToSell = allowShort
          ? decision.sellBtcUsd / price
          : Math.min(decision.sellBtcUsd / price, state.btcHeld);
        if (btcToSell > 0) {
          const proceeds = btcToSell * price;
          state.btcHeld -= btcToSell;
          state.totalSellProceeds += proceeds;
          state.cashBalance += proceeds;
          trades.push({
            date: d.Date,
            side: 'sell',
            btcAmount: btcToSell,
            usdAmount: proceeds,
            price,
            btcHeld: state.btcHeld,
            cashBalance: state.cashBalance,
            portfolioValue: state.btcHeld * price + state.cashBalance,
          });
        }
        soldAllAlready = false;
      } else {
        soldAllAlready = false;
      }

      // 4. Execute buys (deploy reserves first, then regular buy)
      if (decision.deployReserves && state.cashBalance > 0) {
        // Lump-sum: convert entire cash reserve to BTC
        const spendUsd = state.cashBalance;
        const lumpBtc = spendUsd / price;
        state.btcHeld += lumpBtc;
        state.cashBalance = 0;
        trades.push({
          date: d.Date,
          side: 'buy',
          btcAmount: lumpBtc,
          usdAmount: spendUsd,
          price,
          btcHeld: state.btcHeld,
          cashBalance: state.cashBalance,
          portfolioValue: state.btcHeld * price + state.cashBalance,
        });
      } else if (decision.buyBtcUsd > 0) {
        // Buy up to what cash allows
        const spendUsd = Math.min(decision.buyBtcUsd, state.cashBalance);
        if (spendUsd > 0) {
          const btcBought = spendUsd / price;
          state.btcHeld += btcBought;
          state.cashBalance -= spendUsd;
          trades.push({
            date: d.Date,
            side: 'buy',
            btcAmount: btcBought,
            usdAmount: spendUsd,
            price,
            btcHeld: state.btcHeld,
            cashBalance: state.cashBalance,
            portfolioValue: state.btcHeld * price + state.cashBalance,
          });
        }
      }

      // Track CORE state for next iteration
      state.prevCoreOn = d.ACCUM_ON === 1;
    }

    const portfolioValue = state.btcHeld * price + state.cashBalance;
    cashBalanceSum += state.cashBalance;

    series.push({
      date: d.Date,
      portfolioValue,
      btcHeld: state.btcHeld,
      cashDeployed: state.totalDeposited,
      cashWithdrawn: state.totalSellProceeds,
      btcPrice: price,
    });
  }

  const lastPrice = series.length > 0 ? series[series.length - 1].btcPrice : 0;
  const finalPortfolioValue = state.btcHeld * lastPrice + state.cashBalance;

  // Return on total capital deposited.
  // finalPortfolioValue includes BTC at market + any remaining cash.
  const totalReturn = state.totalDeposited > 0
    ? ((finalPortfolioValue - state.totalDeposited) / state.totalDeposited)
    : 0;
  const maxDrawdown = computeMaxDrawdown(series.map(s => s.portfolioValue));
  const maxReturnDrawdown = computeMaxReturnDrawdown(series);

  const endTs = series.length > 0 ? new Date(series[series.length - 1].date).getTime() : 0;
  const annualizedIrr = computeAnnualizedIrr(depositFlows, finalPortfolioValue, endTs);
  const returnOverMaxDrawdown = maxReturnDrawdown > 1e-6
    ? totalReturn / maxReturnDrawdown
    : NaN;
  const avgCashBalance = series.length > 0 ? cashBalanceSum / series.length : 0;

  return {
    name,
    series,
    totalInvested: state.totalDeposited,
    totalWithdrawn: state.totalSellProceeds,
    netDeployed: state.totalDeposited - state.totalSellProceeds,
    finalBtcHeld: state.btcHeld,
    finalCashBalance: state.cashBalance,
    finalPortfolioValue,
    totalReturn,
    maxDrawdown,
    maxReturnDrawdown,
    btcAccumulated: state.btcHeld,
    annualizedIrr,
    returnOverMaxDrawdown,
    avgCashBalance,
    totalInterestEarned,
    trades,
  };
}

// --- Public API ---

export function runBacktest(
  data: SignalData[],
  config: BacktestConfig,
): StrategyResult[] {
  // 1. Filter data to the [startDate, endDate] window (endDate inclusive,
  //    defaults to the full available range when omitted).
  const filtered = data.filter(
    d => d.Date >= config.startDate && (!config.endDate || d.Date <= config.endDate),
  );
  if (filtered.length === 0) return [];

  // 2. Sample for DCA periods
  const sampled = sampleByFrequency(filtered, config.frequency);

  // 3. Baseline DCA — always buy immediately, never hold cash. deployReserves
  //    keeps it fully invested, so any opening lump sum is bought on day one
  //    (no-op when there is no starting cash, e.g. the Lab default).
  const baseline = runStrategy(
    'Baseline DCA',
    sampled,
    filtered,
    config,
    (_d, _state) => ({
      extraDeposit: 0,
      buyBtcUsd: config.dcaAmount,
      sellBtcUsd: 0,
      sellAll: false,
      deployReserves: true,
    }),
  );

  // 4. CoinStrat DCA — CORE gates buys, off-signal determines sell behaviour
  const coinstrat = runStrategy(
    'CORE DCA',
    sampled,
    filtered,
    config,
    (d, state) => {
      const coreOn = d.ACCUM_ON === 1;
      const coreJustFlipped = coreOn && !state.prevCoreOn;

      if (coreOn) {
        return {
          extraDeposit: 0,
          buyBtcUsd: config.dcaAmount,
          sellBtcUsd: 0,
          sellAll: false,
          // First buy after CORE flips ON: deploy full cash reserve
          deployReserves: coreJustFlipped,
        };
      }

      // CORE is OFF — behaviour depends on offSignalMode
      switch (config.offSignalMode) {
        case 'pause':
          return { extraDeposit: 0, buyBtcUsd: 0, sellBtcUsd: 0, sellAll: false, deployReserves: false };
        case 'sell_matching':
          return { extraDeposit: 0, buyBtcUsd: 0, sellBtcUsd: config.dcaAmount, sellAll: false, deployReserves: false };
        case 'sell_all':
          return { extraDeposit: 0, buyBtcUsd: 0, sellBtcUsd: 0, sellAll: true, deployReserves: false };
        default:
          return { extraDeposit: 0, buyBtcUsd: 0, sellBtcUsd: 0, sellAll: false, deployReserves: false };
      }
    },
  );

  const results = [baseline, coinstrat];

  // 5. Optionally run CORE DCA + MACRO 3x
  //    When MACRO is ON, inject extra capital (2x DCA) to fund the 3x buy.
  //    This means Total Invested will be higher for this strategy, but
  //    Total Return % is still a valid comparison metric.
  if (config.macroAccel) {
    const accelerated = runStrategy(
      'CORE DCA + MACRO 3x',
      sampled,
      filtered,
      config,
      (d, state) => {
        const coreOn = d.ACCUM_ON === 1;
        const macroOn = d.MACRO_ON === 1;
        const coreJustFlipped = coreOn && !state.prevCoreOn;

        if (coreOn) {
          // When MACRO is ON, inject extra capital to fund 3x buy.
          // Regular deposit covers 1x; extra deposit covers the remaining 2x.
          const extra = macroOn ? config.dcaAmount * (config.accelMultiplier - 1) : 0;
          return {
            extraDeposit: extra,
            buyBtcUsd: config.dcaAmount * (macroOn ? config.accelMultiplier : 1),
            sellBtcUsd: 0,
            sellAll: false,
            deployReserves: coreJustFlipped,
          };
        }

        // CORE is OFF
        switch (config.offSignalMode) {
          case 'pause':
            return { extraDeposit: 0, buyBtcUsd: 0, sellBtcUsd: 0, sellAll: false, deployReserves: false };
          case 'sell_matching':
            return { extraDeposit: 0, buyBtcUsd: 0, sellBtcUsd: config.dcaAmount, sellAll: false, deployReserves: false };
          case 'sell_all':
            return { extraDeposit: 0, buyBtcUsd: 0, sellBtcUsd: 0, sellAll: true, deployReserves: false };
          default:
            return { extraDeposit: 0, buyBtcUsd: 0, sellBtcUsd: 0, sellAll: false, deployReserves: false };
        }
      },
    );
    results.push(accelerated);
  }

  // 6. Optionally run CQM Risk-Weighted DCA (dynamic or legacy sizing).
  if (config.cqmDca && config.cqmRiskByDate && config.cqmRiskByDate.size > 0) {
    const riskMap = config.cqmRiskByDate;
    const useDynamic = config.cqmDynamicSizing !== false;
    const tradeFraction = Math.max(0, config.cqmTradeFraction ?? 0.01);
    const maxCashFraction = config.cqmMaxCashFraction ?? CQM_DEFAULT_MAX_CASH_FRACTION;
    const sellThreshold = config.cqmSellThreshold ?? CQM_DEFAULT_SELL_THRESHOLD;
    const cqm = runStrategy(
      'CQM Risk DCA',
      sampled,
      filtered,
      config,
      (d, state) => {
        const risk = riskMap.get(d.Date);
        const r = Number.isFinite(risk) ? Math.max(0, Math.min(1, risk as number)) : 0.5;

        if (useDynamic) {
          const sized = computeCqmDynamicTrade({
            baseAmount: config.dcaAmount,
            risk: r,
            cashBalance: state.cashBalance,
            btcHeld: state.btcHeld,
            btcPrice: d.BTCUSD,
            maxCashFraction,
            sellThreshold,
          });
          return {
            extraDeposit: 0,
            buyBtcUsd: sized.buyAmount,
            sellBtcUsd: sized.sellAmount,
            sellAll: false,
            deployReserves: false,
          };
        }

        const tradeSign = 1 - 2 * r;
        if (tradeSign > 0) {
          const size = Math.max(
            config.dcaAmount,
            tradeFraction * state.cashBalance,
          );
          return {
            extraDeposit: 0,
            buyBtcUsd: size * tradeSign,
            sellBtcUsd: 0,
            sellAll: false,
            deployReserves: false,
          };
        }
        if (tradeSign < 0) {
          const btcValue = state.btcHeld * d.BTCUSD;
          const size = Math.max(
            config.dcaAmount,
            tradeFraction * btcValue,
          );
          return {
            extraDeposit: 0,
            buyBtcUsd: 0,
            sellBtcUsd: size * (-tradeSign),
            sellAll: false,
            deployReserves: false,
          };
        }
        return {
          extraDeposit: 0,
          buyBtcUsd: 0,
          sellBtcUsd: 0,
          sellAll: false,
          deployReserves: false,
        };
      },
      Boolean(config.cqmAllowShort),
    );
    results.push(cqm);
  }

  // 7. Optionally run the Hybrid EMA Trend strategy (paper §2.3): rebalance
  //    the whole portfolio toward a BTC weight proportional to the EMA-spread
  //    signal, so weak sideways signals only cause small shifts (no
  //    all-or-nothing flip at the crossover).
  if (config.emaDca) {
    const fastPeriod = Math.max(1, Math.round(config.emaFastPeriod ?? EMA_DEFAULT_FAST_PERIOD));
    const slowPeriod = Math.max(1, Math.round(config.emaSlowPeriod ?? EMA_DEFAULT_SLOW_PERIOD));
    const signalScale = Math.max(1e-6, config.emaSignalScale ?? EMA_DEFAULT_SIGNAL_SCALE);
    // Warm the EMAs on the full history so signals are valid from day one.
    const weightByDate = computeEmaTrendWeights(data, fastPeriod, slowPeriod, signalScale);

    const emaTrend = runStrategy(
      'EMA Trend DCA',
      sampled,
      filtered,
      config,
      (d, state) => {
        const w = weightByDate.get(d.Date) ?? 0.5;
        const btcValue = state.btcHeld * d.BTCUSD;
        const total = btcValue + state.cashBalance;
        const diff = w * total - btcValue; // USD to move into (+) or out of (−) BTC
        const noTrade = { extraDeposit: 0, buyBtcUsd: 0, sellBtcUsd: 0, sellAll: false, deployReserves: false };
        if (Math.abs(diff) < 0.01) return noTrade; // skip sub-cent dust trades
        return diff > 0
          ? { ...noTrade, buyBtcUsd: diff }
          : { ...noTrade, sellBtcUsd: -diff };
      },
    );
    results.push(emaTrend);
  }

  // 8. Optionally run LLI+CQM: Larsson-Line-style 3-state filter gates CQM
  //    Risk DCA. Gold runs CQM sizing; blue sells to cash; gray freezes.
  if (config.lliCqmDca) {
    const seriesMode = config.lliSeries ?? 'risk';
    const riskMap = config.cqmRiskByDate;
    if (seriesMode === 'risk' && (!riskMap || riskMap.size === 0)) {
      // Can't classify on Risk without a walk-forward map — skip silently
      // (Lab UI only enables this toggle once the map is ready).
    } else {
      const mode: LliMode = config.lliMode ?? LLI_DEFAULT_MODE;
      const seriesPoints =
        seriesMode === 'risk'
          ? data
              .filter((d) => {
                const r = riskMap!.get(d.Date);
                return Number.isFinite(r);
              })
              .map((d) => ({ date: d.Date, value: riskMap!.get(d.Date) as number }))
          : data
              .filter((d) => Number.isFinite(d.BTCUSD) && d.BTCUSD > 0)
              .map((d) => ({ date: d.Date, value: d.BTCUSD }));

      const stateByDate =
        mode === 'ribbon4'
          ? computeLliStates(seriesPoints, {
              mode: 'ribbon4',
              periods: parseLliPeriods(config.lliPeriods ?? LLI_DEFAULT_PERIODS),
              minGap: config.lliMinGap ?? (seriesMode === 'risk' ? 0.002 : 0),
            })
          : computeLliStates(seriesPoints, {
              mode: 'emaAtr',
              fastPeriod: config.lliFastPeriod ?? LLI_DEFAULT_FAST_PERIOD,
              slowPeriod: config.lliSlowPeriod ?? LLI_DEFAULT_SLOW_PERIOD,
              atrPeriod: config.lliAtrPeriod ?? LLI_DEFAULT_ATR_PERIOD,
              atrMult: config.lliAtrMult ?? LLI_DEFAULT_ATR_MULT,
            });

      const maxCashFraction = config.cqmMaxCashFraction ?? CQM_DEFAULT_MAX_CASH_FRACTION;
      const sellThreshold = config.cqmSellThreshold ?? CQM_DEFAULT_SELL_THRESHOLD;
      const deployOnGold = config.lliDeployOnGold !== false;
      let prevState: LliState = 'gray';

      const lliCqm = runStrategy(
        'LLI+CQM DCA',
        sampled,
        filtered,
        config,
        (d, state) => {
          const lli: LliState = stateByDate.get(d.Date) ?? 'gray';
          const justFlippedGold = lli === 'gold' && prevState !== 'gold';
          prevState = lli;

          const noTrade = {
            extraDeposit: 0,
            buyBtcUsd: 0,
            sellBtcUsd: 0,
            sellAll: false,
            deployReserves: false,
          };

          switch (lli) {
            case 'blue':
              // Stand aside: convert the whole BTC book to cash.
              return { ...noTrade, sellAll: state.btcHeld > 0 };
            case 'gray':
              // Tangled — keep whatever position we have; deposits pile as cash.
              return noTrade;
            case 'gold': {
              // Ride: CQM sizes the trade; on the gold flip, dump the cash
              // reserve that accumulated during blue/gray into BTC.
              if (deployOnGold && justFlippedGold && state.cashBalance > 0) {
                return { ...noTrade, deployReserves: true };
              }
              const risk = riskMap?.get(d.Date);
              const r = Number.isFinite(risk)
                ? Math.max(0, Math.min(1, risk as number))
                : 0.5;
              const sized = computeCqmDynamicTrade({
                baseAmount: config.dcaAmount,
                risk: r,
                cashBalance: state.cashBalance,
                btcHeld: state.btcHeld,
                btcPrice: d.BTCUSD,
                maxCashFraction,
                sellThreshold,
              });
              return {
                ...noTrade,
                buyBtcUsd: sized.buyAmount,
                sellBtcUsd: sized.sellAmount,
              };
            }
            default: {
              const _exhaustive: never = lli;
              return _exhaustive;
            }
          }
        },
      );
      results.push(lliCqm);
    }
  }

  // 9. Optionally run CryptoTrend DCA: jaw/lips SMMA trend filter on price.
  //    Up buys (deploying reserves on the flip), down sells to cash,
  //    neutral freezes.
  if (config.cryptoTrendDca) {
    // Warm the SMMAs on the full history so signals are valid from day one.
    const stateByDate = computeCryptoTrendStates(
      data.map((d) => ({ date: d.Date, price: d.BTCUSD })),
      {
        jawLength: config.cryptoTrendJaw ?? CRYPTO_TREND_DEFAULT_JAW,
        lipsLength: config.cryptoTrendLips ?? CRYPTO_TREND_DEFAULT_LIPS,
        bandMode: config.cryptoTrendBandMode ?? CRYPTO_TREND_DEFAULT_BAND_MODE,
        pct: config.cryptoTrendPct ?? CRYPTO_TREND_DEFAULT_PCT,
        atrPeriod: config.cryptoTrendAtrPeriod ?? CRYPTO_TREND_DEFAULT_ATR_PERIOD,
        atrMult: config.cryptoTrendAtrMult ?? CRYPTO_TREND_DEFAULT_ATR_MULT,
      },
    );
    let prevState: CryptoTrendState = 'neutral';

    const cryptoTrend = runStrategy(
      'CryptoTrend DCA',
      sampled,
      filtered,
      config,
      (d, state) => {
        const trend: CryptoTrendState = stateByDate.get(d.Date) ?? 'neutral';
        const justFlippedUp = trend === 'up' && prevState !== 'up';
        prevState = trend;
        const noTrade = { extraDeposit: 0, buyBtcUsd: 0, sellBtcUsd: 0, sellAll: false, deployReserves: false };
        switch (trend) {
          case 'up':
            return { ...noTrade, buyBtcUsd: config.dcaAmount, deployReserves: justFlippedUp };
          case 'down':
            return { ...noTrade, sellAll: state.btcHeld > 0 };
          case 'neutral':
            return noTrade;
          default: {
            const _exhaustive: never = trend;
            return _exhaustive;
          }
        }
      },
    );
    results.push(cryptoTrend);
  }

  return results;
}
