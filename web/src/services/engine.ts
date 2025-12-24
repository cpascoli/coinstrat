import { fetchFredSeries, FredObservation } from './fred';
import { fetchBTCPrice, fetchMVRV, PricePoint } from './crypto';
import { SignalData } from '../App';

/**
 * The Engine orchestrates data fetching and replicates the Python logic
 * for scoring and signal generation.
 */

// --- Utility Math Helpers ---

const rollingMean = (arr: number[], window: number) => {
  const result: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < window - 1) {
      result.push(NaN);
      continue;
    }
    const slice = arr.slice(i - window + 1, i + 1);
    const sum = slice.reduce((a, b) => a + b, 0);
    result.push(sum / window);
  }
  return result;
};

const pctChange = (arr: number[], periods: number) => {
  const result: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < periods || arr[i - periods] === 0 || isNaN(arr[i - periods])) {
      result.push(NaN);
      continue;
    }
    result.push((arr[i] / arr[i - periods]) - 1);
  }
  return result;
};

const diff = (arr: number[], periods: number) => {
  const result: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < periods || isNaN(arr[i - periods])) {
      result.push(NaN);
      continue;
    }
    result.push(arr[i] - arr[i - periods]);
  }
  return result;
};

// --- Logic Implementations ---

export async function computeAllSignals(): Promise<SignalData[]> {
  console.log("Starting signal computation...");

  // 1. Fetch all raw data in parallel
  const [
    walcl, tga, rrp, dxyRaw, sahm, yc, newOrders, btcPrice, mvrv
  ] = await Promise.all([
    fetchFredSeries("WALCL"),
    fetchFredSeries("WTREGEN"),
    fetchFredSeries("RRPONTSYD"),
    fetchFredSeries("DTWEXBGS"),
    fetchFredSeries("SAHMREALTIME"),
    fetchFredSeries("T10Y3M"),
    fetchFredSeries("AMTMNO"),
    fetchBTCPrice(),
    fetchMVRV()
  ]);

  // 2. Align data to a common continuous daily timeline
  // We create a continuous range of dates from the start of BTC data to today.
  const dateMap: Map<string, any> = new Map();
  
  if (btcPrice.length === 0) return [];

  const firstDate = new Date(btcPrice[0].date);
  const lastDate = new Date(); // Go up to today
  
  const allDates: string[] = [];
  let curr = new Date(firstDate);
  while (curr <= lastDate) {
    const dStr = curr.toISOString().split('T')[0];
    allDates.push(dStr);
    dateMap.set(dStr, { Date: dStr });
    curr.setDate(curr.getDate() + 1);
  }

  // Helper to ffill data from a series into the daily map
  const fillSeries = (series: {date: string, value: number}[], key: string) => {
    let lastVal = NaN;
    const seriesMap = new Map(series.map(s => [s.date, s.value]));
    allDates.forEach(d => {
      const val = seriesMap.get(d);
      if (val !== undefined && !isNaN(val)) {
        lastVal = val;
      }
      const entry = dateMap.get(d);
      if (entry) entry[key] = lastVal;
    });
  };

  fillSeries(btcPrice, "BTCUSD");
  fillSeries(walcl, "WALCL");
  fillSeries(tga, "WTREGEN");
  fillSeries(rrp, "RRPONTSYD");
  fillSeries(dxyRaw, "DXY");
  fillSeries(sahm, "SAHM");
  fillSeries(yc, "YC_M");
  fillSeries(newOrders, "NO");
  fillSeries(mvrv, "MVRV");

  const dailyData = allDates.map(d => dateMap.get(d));

  // 3. Compute Scores
  
  // -- Valuation Score --
  dailyData.forEach(d => {
    let score = 0;
    if (d.MVRV < 1.0) score = 2;
    else if (d.MVRV < 1.8) score = 1;
    d.VAL_SCORE = score;
  });

  // -- Liquidity Score --
  // We need YoY (approx 365 days) and 13-week delta (approx 91 days)
  const usLiq = dailyData.map(d => {
    const walcl = typeof d.WALCL === 'number' && !isNaN(d.WALCL) ? d.WALCL : 0;
    const tga = typeof d.WTREGEN === 'number' && !isNaN(d.WTREGEN) ? d.WTREGEN : 0;
    const rrp = typeof d.RRPONTSYD === 'number' && !isNaN(d.RRPONTSYD) ? d.RRPONTSYD : 0;
    // If all are 0, liquidity is likely 0 which is safe for charts but not for scores
    return walcl - tga - rrp;
  });
  const usLiqYoY = pctChange(usLiq, 365);
  const usLiq13W = diff(usLiq, 91);
  
  dailyData.forEach((d, i) => {
    d.US_LIQ = usLiq[i];
    d.US_LIQ_YOY = usLiqYoY[i] * 100;
    d.US_LIQ_13W_DELTA = usLiq13W[i];
    
    let score = 0;
    if (d.US_LIQ_YOY > 0) score = 2;
    else if (d.US_LIQ_13W_DELTA > 0) score = 1;
    d.LIQ_SCORE = score;
  });

  // -- DXY Score --
  const dxyVals = dailyData.map(d => d.DXY);
  const dxyMA50 = rollingMean(dxyVals, 50);
  const dxyMA200 = rollingMean(dxyVals, 200);
  const dxyROC20 = pctChange(dxyVals, 20);

  dailyData.forEach((d, i) => {
    // Expose inputs for UI diagnostics / rule verification
    d.DXY_MA50 = dxyMA50[i];
    d.DXY_MA200 = dxyMA200[i];
    d.DXY_ROC20 = dxyROC20[i]; // fraction (e.g. 0.01 = +1%)

    let score = 1; // neutral
    const roc = dxyROC20[i];
    if (roc > 0.005) score = 0;
    else if (roc < -0.005) {
      score = (dxyMA50[i] < dxyMA200[i]) ? 2 : 1;
    }
    d.DXY_SCORE = score;
  });

  // -- Cycle Score (V2) --
  const noVals = dailyData.map(d => d.NO);
  const noYoY = pctChange(noVals, 365);
  const noMom3 = diff(noVals, 90);

  dailyData.forEach((d, i) => {
    const isRecessionRisk = (d.SAHM >= 0.5) || (d.YC_M < 0) || (noYoY[i] < 0 && noMom3[i] <= 0);
    const isExpansion = (d.SAHM < 0.35) && (d.YC_M >= 0.75) && (noYoY[i] >= 0);
    
    d.NO_YOY = noYoY[i] * 100;
    d.NO_MOM3 = noMom3[i];
    d.CYCLE_SCORE_V2 = isRecessionRisk ? 0 : (isExpansion ? 2 : 1);
  });

  // -- Price Regime (40W MA Persistence) --
  const btcVals = dailyData.map(d => d.BTCUSD);
  const btcMA200 = rollingMean(btcVals, 200); // approx 40 weeks
  
  const rawPriceRegime = btcVals.map((v, i) => v > btcMA200[i]);
  const regimePersistence = rollingMean(rawPriceRegime.map(v => v ? 1 : 0), 30);
  
  dailyData.forEach((d, i) => {
    d.PRICE_REGIME_ON = regimePersistence[i] >= (20/30) ? 1 : 0;
  });

  // 4. Final Aggregates (CORE_ON, MACRO_ON, ACCUM_ON)
  let coreState = 0;
  dailyData.forEach((d, i) => {
    const val = d.VAL_SCORE;
    const dxy = d.DXY_SCORE;
    const pr = d.PRICE_REGIME_ON;

    if (coreState === 0) {
      const entryOk = ((val === 2) || (val === 1 && pr === 1)) && dxy >= 1;
      if (entryOk) coreState = 1;
    } else {
      const exitOk = (dxy === 0 && pr === 0);
      if (exitOk) coreState = 0;
    }
    d.CORE_ON = coreState;

    const abScore = d.LIQ_SCORE + d.CYCLE_SCORE_V2;
    d.MACRO_ON = (abScore >= 3 && dxy >= 1) ? 1 : 0;
    d.ACCUM_ON = (d.CORE_ON === 1 || d.MACRO_ON === 1) ? 1 : 0;
  });

  return dailyData as SignalData[];
}

