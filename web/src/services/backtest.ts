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
  cashDeployed: number;      // cumulative USD spent buying
  cashWithdrawn: number;     // cumulative USD received from sells
  btcPrice: number;
}

export interface StrategyResult {
  name: string;
  series: SeriesPoint[];
  totalInvested: number;
  totalWithdrawn: number;
  netDeployed: number;        // invested - withdrawn
  finalBtcHeld: number;
  finalPortfolioValue: number;
  totalReturn: number;        // % return on total capital invested
  maxDrawdown: number;        // worst peak-to-trough %
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

interface SimState {
  btcHeld: number;
  cashDeployed: number;
  cashWithdrawn: number;
  cashBalance: number; // cash from sells, available for accounting
}

function runStrategy(
  name: string,
  sampledData: SignalData[],
  allDailyData: SignalData[],
  config: BacktestConfig,
  buyLogic: (d: SignalData, state: SimState) => { buyUsd: number; sellUsd: number; sellAll: boolean },
): StrategyResult {
  const state: SimState = {
    btcHeld: 0,
    cashDeployed: 0,
    cashWithdrawn: 0,
    cashBalance: 0,
  };

  // Track which sampled dates trigger actions
  const actionDates = new Set(sampledData.map(d => d.Date));

  // We build the series on ALL daily data for smooth charting,
  // but only execute buy/sell on sampled dates.
  const series: SeriesPoint[] = [];
  let soldAllAlready = false; // for sell_all mode: only sell once per OFF period

  for (const d of allDailyData) {
    const price = d.BTCUSD;
    if (!Number.isFinite(price) || price <= 0) continue;

    // Execute trades only on DCA sample dates
    if (actionDates.has(d.Date)) {
      const action = buyLogic(d, state);

      if (action.sellAll) {
        if (!soldAllAlready && state.btcHeld > 0) {
          // Sell entire position
          const proceeds = state.btcHeld * price;
          state.cashWithdrawn += proceeds;
          state.cashBalance += proceeds;
          state.btcHeld = 0;
          soldAllAlready = true;
        }
      } else if (action.sellUsd > 0) {
        // Sell matching amount
        const btcToSell = Math.min(action.sellUsd / price, state.btcHeld);
        const proceeds = btcToSell * price;
        state.btcHeld -= btcToSell;
        state.cashWithdrawn += proceeds;
        state.cashBalance += proceeds;
        soldAllAlready = false;
      } else if (action.buyUsd > 0) {
        // Re-invest idle cash from previous sell_all when signal turns back ON.
        // This is an internal rebalance (cash pocket -> BTC pocket), not new
        // capital, so we only touch cashBalance and btcHeld.  portfolioValue
        // stays the same at the moment of re-entry: cash goes down, BTC goes
        // up by the same amount.  Future price moves then affect returns.
        if (state.cashBalance > 0) {
          const reinvest = state.cashBalance;
          state.btcHeld += reinvest / price;
          state.cashBalance = 0;
        }

        // Buy with DCA amount (fresh capital)
        const btcBought = action.buyUsd / price;
        state.btcHeld += btcBought;
        state.cashDeployed += action.buyUsd;
        soldAllAlready = false;
      } else {
        // Pause — do nothing
        soldAllAlready = false;
      }
    }

    const portfolioValue = state.btcHeld * price + state.cashBalance;

    series.push({
      date: d.Date,
      portfolioValue,
      btcHeld: state.btcHeld,
      cashDeployed: state.cashDeployed,
      cashWithdrawn: state.cashWithdrawn,
      btcPrice: price,
    });
  }

  const lastPrice = series.length > 0 ? series[series.length - 1].btcPrice : 0;
  const finalPortfolioValue = state.btcHeld * lastPrice + state.cashBalance;
  const netDeployed = state.cashDeployed - state.cashWithdrawn;
  // Return on total capital invested.
  // finalPortfolioValue already includes cashBalance (proceeds from any sells)
  // plus remaining BTC at market price, so the formula works for all modes.
  const totalReturn = state.cashDeployed > 0
    ? ((finalPortfolioValue - state.cashDeployed) / state.cashDeployed)
    : 0;
  const maxDrawdown = computeMaxDrawdown(series.map(s => s.portfolioValue));

  return {
    name,
    series,
    totalInvested: state.cashDeployed,
    totalWithdrawn: state.cashWithdrawn,
    netDeployed,
    finalBtcHeld: state.btcHeld,
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

  // 3. Run Baseline DCA
  const baseline = runStrategy(
    'Baseline DCA',
    sampled,
    filtered,
    config,
    () => ({ buyUsd: config.dcaAmount, sellUsd: 0, sellAll: false }),
  );

  // 4. Run CoinStrat DCA
  const coinstrat = runStrategy(
    'CoinStrat DCA',
    sampled,
    filtered,
    config,
    (d, state) => {
      if (d.ACCUM_ON === 1) {
        return { buyUsd: config.dcaAmount, sellUsd: 0, sellAll: false };
      }
      // ACCUM_ON = 0
      switch (config.offSignalMode) {
        case 'pause':
          return { buyUsd: 0, sellUsd: 0, sellAll: false };
        case 'sell_matching':
          return { buyUsd: 0, sellUsd: config.dcaAmount, sellAll: false };
        case 'sell_all':
          return { buyUsd: 0, sellUsd: 0, sellAll: true };
        default:
          return { buyUsd: 0, sellUsd: 0, sellAll: false };
      }
    },
  );

  const results = [baseline, coinstrat];

  // 5. Optionally run CoinStrat + MACRO 3x
  if (config.macroAccel) {
    const accelerated = runStrategy(
      'CoinStrat + MACRO 3x',
      sampled,
      filtered,
      config,
      (d, state) => {
        if (d.ACCUM_ON === 1) {
          const multiplier = d.MACRO_ON === 1 ? config.accelMultiplier : 1;
          return { buyUsd: config.dcaAmount * multiplier, sellUsd: 0, sellAll: false };
        }
        // ACCUM_ON = 0
        switch (config.offSignalMode) {
          case 'pause':
            return { buyUsd: 0, sellUsd: 0, sellAll: false };
          case 'sell_matching':
            return { buyUsd: 0, sellUsd: config.dcaAmount, sellAll: false };
          case 'sell_all':
            return { buyUsd: 0, sellUsd: 0, sellAll: true };
          default:
            return { buyUsd: 0, sellUsd: 0, sellAll: false };
        }
      },
    );
    results.push(accelerated);
  }

  return results;
}
