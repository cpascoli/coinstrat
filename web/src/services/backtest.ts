import { SignalData } from '../App';

// --- Configuration ---

export type DcaFrequency = 'daily' | 'weekly' | 'monthly';
export type OffSignalMode = 'pause' | 'sell_matching' | 'sell_all';

export interface BacktestConfig {
  startDate: string;          // YYYY-MM-DD
  dcaAmount: number;          // USD per period (e.g. 100)
  frequency: DcaFrequency;
  offSignalMode: OffSignalMode;
  macroAccel: boolean;        // enable accelerated strategy
  accelMultiplier: number;    // default 3
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
  maxDrawdown: number;       // worst peak-to-trough %
  btcAccumulated: number;
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
 * - buyBtcUsd:  how much USD to spend buying BTC (from cash reserves)
 * - sellBtcUsd: how much USD worth of BTC to sell (proceeds go to cash)
 * - sellAll:    sell entire BTC position (proceeds go to cash)
 * - deployReserves: deploy full cash balance into BTC (lump-sum re-entry)
 */
interface TradeDecision {
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
): StrategyResult {
  const state: SimState = {
    btcHeld: 0,
    cashBalance: 0,
    totalDeposited: 0,
    totalSellProceeds: 0,
    prevCoreOn: false,
  };

  // Track which sampled dates trigger actions
  const actionDates = new Set(sampledData.map(d => d.Date));

  // Build series on ALL daily data for smooth charting,
  // but only execute deposits + trades on sampled dates.
  const series: SeriesPoint[] = [];
  let soldAllAlready = false;

  for (const d of allDailyData) {
    const price = d.BTCUSD;
    if (!Number.isFinite(price) || price <= 0) continue;

    if (actionDates.has(d.Date)) {
      // 1. Deposit DCA amount as cash (equal funding for all strategies)
      state.cashBalance += config.dcaAmount;
      state.totalDeposited += config.dcaAmount;

      // 2. Get the strategy's decision
      const decision = decisionLogic(d, state);

      // 3. Execute sells first (to free up cash)
      if (decision.sellAll) {
        if (!soldAllAlready && state.btcHeld > 0) {
          const proceeds = state.btcHeld * price;
          state.totalSellProceeds += proceeds;
          state.cashBalance += proceeds;
          state.btcHeld = 0;
          soldAllAlready = true;
        }
      } else if (decision.sellBtcUsd > 0) {
        const btcToSell = Math.min(decision.sellBtcUsd / price, state.btcHeld);
        if (btcToSell > 0) {
          const proceeds = btcToSell * price;
          state.btcHeld -= btcToSell;
          state.totalSellProceeds += proceeds;
          state.cashBalance += proceeds;
        }
        soldAllAlready = false;
      } else {
        soldAllAlready = false;
      }

      // 4. Execute buys (deploy reserves first, then regular buy)
      if (decision.deployReserves && state.cashBalance > 0) {
        // Lump-sum: convert entire cash reserve to BTC
        const lumpBtc = state.cashBalance / price;
        state.btcHeld += lumpBtc;
        state.cashBalance = 0;
      } else if (decision.buyBtcUsd > 0) {
        // Buy up to what cash allows
        const spendUsd = Math.min(decision.buyBtcUsd, state.cashBalance);
        if (spendUsd > 0) {
          const btcBought = spendUsd / price;
          state.btcHeld += btcBought;
          state.cashBalance -= spendUsd;
        }
      }

      // Track CORE state for next iteration
      state.prevCoreOn = d.ACCUM_ON === 1;
    }

    const portfolioValue = state.btcHeld * price + state.cashBalance;

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
    btcAccumulated: state.btcHeld,
  };
}

// --- Public API ---

export function runBacktest(
  data: SignalData[],
  config: BacktestConfig,
): StrategyResult[] {
  // 1. Filter data to start date
  const filtered = data.filter(d => d.Date >= config.startDate);
  if (filtered.length === 0) return [];

  // 2. Sample for DCA periods
  const sampled = sampleByFrequency(filtered, config.frequency);

  // 3. Baseline DCA — always buy immediately, never hold cash
  const baseline = runStrategy(
    'Baseline DCA',
    sampled,
    filtered,
    config,
    (_d, _state) => ({
      buyBtcUsd: config.dcaAmount,
      sellBtcUsd: 0,
      sellAll: false,
      deployReserves: false,
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
          // Cash sits as dry powder (already deposited above)
          return { buyBtcUsd: 0, sellBtcUsd: 0, sellAll: false, deployReserves: false };
        case 'sell_matching':
          // Sell DCA-amount worth of BTC (proceeds become more dry powder)
          return { buyBtcUsd: 0, sellBtcUsd: config.dcaAmount, sellAll: false, deployReserves: false };
        case 'sell_all':
          // Sell entire BTC position (maximum dry powder)
          return { buyBtcUsd: 0, sellBtcUsd: 0, sellAll: true, deployReserves: false };
        default:
          return { buyBtcUsd: 0, sellBtcUsd: 0, sellAll: false, deployReserves: false };
      }
    },
  );

  const results = [baseline, coinstrat];

  // 5. Optionally run CoinStrat + MACRO 3x
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
          // MACRO multiplier: spend 3x DCA if MACRO is also ON (capped by cash)
          const multiplier = macroOn ? config.accelMultiplier : 1;
          return {
            buyBtcUsd: config.dcaAmount * multiplier,
            sellBtcUsd: 0,
            sellAll: false,
            deployReserves: coreJustFlipped,
          };
        }

        // CORE is OFF
        switch (config.offSignalMode) {
          case 'pause':
            return { buyBtcUsd: 0, sellBtcUsd: 0, sellAll: false, deployReserves: false };
          case 'sell_matching':
            return { buyBtcUsd: 0, sellBtcUsd: config.dcaAmount, sellAll: false, deployReserves: false };
          case 'sell_all':
            return { buyBtcUsd: 0, sellBtcUsd: 0, sellAll: true, deployReserves: false };
          default:
            return { buyBtcUsd: 0, sellBtcUsd: 0, sellAll: false, deployReserves: false };
        }
      },
    );
    results.push(accelerated);
  }

  return results;
}
