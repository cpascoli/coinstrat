import { SignalData } from '../App';
import {
  computeCqmDynamicTrade,
  CQM_DEFAULT_MAX_CASH_FRACTION,
  CQM_DEFAULT_SELL_THRESHOLD,
} from '../utils/cqmSizing';

// --- Configuration ---

export type DcaFrequency = 'daily' | 'weekly' | 'monthly';
export type OffSignalMode = 'pause' | 'sell_matching' | 'sell_all';

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
}

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

  return results;
}
