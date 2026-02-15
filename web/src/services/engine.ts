import { fetchFredSeries, FredObservation } from './fred';
import { fetchBTCPrice, fetchMVRV, fetchLTH_SOPR, fetchNUPL, PricePoint } from './crypto';
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
    walcl, tga, rrp, dxyRaw, sahm, yc, newOrders, btcPrice, mvrv,
    ecbAssets, bojAssets, eurUsd, jpyUsd,
    lthSopr, nupl
  ] = await Promise.all([
    fetchFredSeries("WALCL"),
    fetchFredSeries("WTREGEN"),
    fetchFredSeries("RRPONTSYD"),
    fetchFredSeries("DTWEXBGS"),
    fetchFredSeries("SAHMREALTIME"),
    fetchFredSeries("T10Y3M"),
    fetchFredSeries("AMTMNO"),
    fetchBTCPrice(),
    fetchMVRV(),
    // G3 Global Liquidity: ECB + BOJ balance sheets + FX rates for USD conversion
    fetchFredSeries("ECBASSETSW"),  // ECB total assets, millions EUR, weekly
    fetchFredSeries("JPNASSETS"),   // BOJ total assets, 100M JPY, monthly
    fetchFredSeries("DEXUSEU"),     // USD per EUR, daily
    fetchFredSeries("DEXJPUS"),     // JPY per USD, daily
    // On-chain valuation metrics from BGeometrics
    fetchLTH_SOPR(),                // Long-Term Holder SOPR, daily
    fetchNUPL(),                    // Net Unrealized Profit/Loss, daily
  ]);

  // Unit normalization:
  // - WALCL and WTREGEN are in "millions of USD" on FRED.
  // - RRPONTSYD is in "billions of USD" on FRED (see series page).
  // To keep US_LIQ = WALCL - WTREGEN - RRP comparable, convert RRPONTSYD to millions.
  const rrpM = rrp.map((o) => ({ ...o, value: o.value * 1000 }));

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
  fillSeries(rrpM, "RRPONTSYD");
  fillSeries(dxyRaw, "DXY");
  fillSeries(sahm, "SAHM");
  fillSeries(yc, "YC_M");
  fillSeries(newOrders, "NO");
  fillSeries(mvrv, "MVRV");

  // On-chain valuation series (LTH_SOPR used in VAL_SCORE; NUPL display-only)
  fillSeries(lthSopr, "LTH_SOPR");
  fillSeries(nupl, "NUPL");

  // G3 Global Liquidity raw series
  fillSeries(ecbAssets, "ECB_RAW");   // millions EUR
  fillSeries(bojAssets, "BOJ_RAW");   // 100M JPY
  fillSeries(eurUsd, "EURUSD");       // USD per EUR
  fillSeries(jpyUsd, "JPYUSD");       // JPY per USD

  const dailyData = allDates.map(d => dateMap.get(d));

  // 2b. Compute G3 Global Liquidity (display-only, not used in scoring)
  //     G3_ASSETS = Fed (WALCL, M USD) + ECB (M EUR * USD/EUR) + BOJ (100M JPY * 100 / JPY per USD)
  //     All converted to millions USD for consistency with US_LIQ.
  dailyData.forEach(d => {
    const fed = d.WALCL;
    const ecb = d.ECB_RAW;
    const boj = d.BOJ_RAW;
    const eur = d.EURUSD;
    const jpy = d.JPYUSD;

    const fedOk = typeof fed === 'number' && !isNaN(fed);
    const ecbOk = typeof ecb === 'number' && !isNaN(ecb) &&
                  typeof eur === 'number' && !isNaN(eur) && eur > 0;
    const bojOk = typeof boj === 'number' && !isNaN(boj) &&
                  typeof jpy === 'number' && !isNaN(jpy) && jpy > 0;

    // Individual components in millions USD
    d.FED_USD = fedOk ? fed : NaN;
    d.ECB_USD = ecbOk ? ecb * eur : NaN;
    d.BOJ_USD = bojOk ? boj * 100 / jpy : NaN;

    // G3 composite: require at least Fed + one other CB to be meaningful
    if (fedOk && (ecbOk || bojOk)) {
      d.G3_ASSETS = (fedOk ? d.FED_USD : 0) +
                    (ecbOk ? d.ECB_USD : 0) +
                    (bojOk ? d.BOJ_USD : 0);
    } else {
      d.G3_ASSETS = NaN;
    }
  });

  // G3 YoY (365-day percent change)
  const g3Vals = dailyData.map(d => d.G3_ASSETS);
  const g3YoY = pctChange(g3Vals, 365);
  dailyData.forEach((d, i) => {
    d.G3_YOY = isNaN(g3YoY[i]) ? NaN : g3YoY[i] * 100;
  });

  // 3. Compute Scores
  //    When an input is NaN (series hasn't started yet, or API failure),
  //    carry forward the last valid score for that factor and log a warning.
  let nanWarnings = 0;
  const warnNaN = (factor: string, date: string) => {
    nanWarnings++;
    // Limit console noise: only log the first few per factor
    if (nanWarnings <= 5) {
      console.warn(`[Engine] NaN input for ${factor} on ${date} — carrying forward last valid score.`);
    } else if (nanWarnings === 6) {
      console.warn(`[Engine] Suppressing further NaN warnings (${nanWarnings}+ occurrences). Early-history scores may be approximate.`);
    }
  };

  // -- Valuation Score (4-tier: 0–3) --
  // Combines MVRV (stock metric) with LTH SOPR (flow metric).
  // Score 3 = extreme conviction (deep value + capitulation); enters CORE unconditionally.
  // Score 2 = strong (deep value OR capitulation); enters CORE with price regime confirmation.
  // Score 1 = fair/neutral; MVRV between entry zone and euphoria. Not sufficient for CORE
  //           entry, but CORE stays ON through hysteresis during normal bull markets.
  // Score 0 = euphoria/overheated (MVRV ≥ 3.5); triggers CORE exit when paired with DXY headwind.
  //
  // The overheated threshold is set at 3.5 rather than 1.8 because MVRV historically
  // crosses 1.8 early in bull markets and stays above it for months/years. Cycle peaks
  // have clustered around 3.5–5+ (2013: ~6, 2017: ~4.5, 2021: ~3.8).
  let lastValScore = 0;
  dailyData.forEach(d => {
    const mvrv = d.MVRV;
    if (typeof mvrv !== 'number' || isNaN(mvrv)) {
      warnNaN('MVRV (VAL_SCORE)', d.Date);
      d.VAL_SCORE = lastValScore;
      return;
    }

    const sopr = d.LTH_SOPR;
    const soprOk = typeof sopr === 'number' && !isNaN(sopr);
    const capitulating = soprOk && sopr < 1.0;

    let score: number;
    if (mvrv < 1.0 && capitulating) {
      score = 3; // extreme deep value: both MVRV and LTH SOPR confirm bottom
    } else if (mvrv < 1.0 || (mvrv < 1.8 && capitulating)) {
      score = 2; // strong: deep MVRV alone, or fair MVRV + capitulation
    } else if (mvrv < 3.5) {
      score = 1; // fair/neutral: not cheap, not euphoric — normal bull market range
    } else {
      score = 0; // euphoria/overheated: MVRV ≥ 3.5 — near cycle peaks
    }

    d.VAL_SCORE = score;
    lastValScore = score;
  });

  // -- Liquidity Score --
  // We need YoY (approx 365 days) and 13-week delta (approx 91 days)
  // Propagate NaN honestly: if any component is NaN, the composite is NaN.
  const usLiq = dailyData.map(d => {
    const w = d.WALCL;
    const t = d.WTREGEN;
    const r = d.RRPONTSYD;
    if (typeof w !== 'number' || isNaN(w) ||
        typeof t !== 'number' || isNaN(t) ||
        typeof r !== 'number' || isNaN(r)) {
      return NaN;
    }
    return w - t - r;
  });
  const usLiqYoY = pctChange(usLiq, 365);
  const usLiq13W = diff(usLiq, 91);
  
  let lastLiqScore = 0;
  dailyData.forEach((d, i) => {
    d.US_LIQ = usLiq[i];
    d.US_LIQ_YOY = isNaN(usLiqYoY[i]) ? NaN : usLiqYoY[i] * 100;
    d.US_LIQ_13W_DELTA = usLiq13W[i];
    
    const yoy = d.US_LIQ_YOY;
    const delta13w = d.US_LIQ_13W_DELTA;
    if ((typeof yoy !== 'number' || isNaN(yoy)) && (typeof delta13w !== 'number' || isNaN(delta13w))) {
      warnNaN('US_LIQ (LIQ_SCORE)', d.Date);
      d.LIQ_SCORE = lastLiqScore;
      return;
    }
    
    let score = 0;
    if (typeof yoy === 'number' && !isNaN(yoy) && yoy > 0) score = 2;
    else if (typeof delta13w === 'number' && !isNaN(delta13w) && delta13w > 0) score = 1;
    d.LIQ_SCORE = score;
    lastLiqScore = score;
  });

  // -- DXY Score --
  const dxyVals = dailyData.map(d => d.DXY);
  const dxyMA50 = rollingMean(dxyVals, 50);
  const dxyMA200 = rollingMean(dxyVals, 200);
  const dxyROC20 = pctChange(dxyVals, 20);

  let lastDxyScore = 1;
  dailyData.forEach((d, i) => {
    // Expose inputs for UI diagnostics / rule verification
    d.DXY_MA50 = dxyMA50[i];
    d.DXY_MA200 = dxyMA200[i];
    d.DXY_ROC20 = dxyROC20[i]; // fraction (e.g. 0.01 = +1%)

    const roc = dxyROC20[i];
    if (typeof roc !== 'number' || isNaN(roc)) {
      warnNaN('DXY_ROC20 (DXY_SCORE)', d.Date);
      d.DXY_SCORE = lastDxyScore;
      return;
    }

    let score = 1; // neutral
    if (roc > 0.005) score = 0;
    else if (roc < -0.005) {
      const ma50 = dxyMA50[i];
      const ma200 = dxyMA200[i];
      score = (typeof ma50 === 'number' && !isNaN(ma50) &&
               typeof ma200 === 'number' && !isNaN(ma200) &&
               ma50 < ma200) ? 2 : 1;
    }
    d.DXY_SCORE = score;
    lastDxyScore = score;
  });

  // -- DXY Persistence Filter (20/30 days, analogous to PRICE_REGIME) --
  // The raw DXY_SCORE is saved as DXY_SCORE_RAW for diagnostics.
  // The effective DXY_SCORE used in signals requires the favorable condition
  // (DXY_SCORE_RAW >= 1) to have held for at least 20 of the last 30 days.
  // This prevents brief DXY pauses from triggering premature CORE entry.
  const dxyFavorableRaw = dailyData.map(d => (d.DXY_SCORE >= 1 ? 1 : 0));
  const dxyPersistence = rollingMean(dxyFavorableRaw, 30);
  dailyData.forEach((d, i) => {
    d.DXY_SCORE_RAW = d.DXY_SCORE; // preserve unfiltered score
    const persist = dxyPersistence[i] >= (20 / 30) ? 1 : 0;
    d.DXY_PERSIST = persist;
    // If persistence not met, force score to 0 (headwind); otherwise keep raw score
    d.DXY_SCORE = persist ? d.DXY_SCORE_RAW : 0;
  });

  // -- Cycle Score (V2) --
  const noVals = dailyData.map(d => d.NO);
  const noYoY = pctChange(noVals, 365);
  const noMom3 = diff(noVals, 90);

  let lastCycleScore = 1;
  dailyData.forEach((d, i) => {
    const sahmVal = d.SAHM;
    const ycVal = d.YC_M;
    const noY = noYoY[i];
    const noM = noMom3[i];

    d.NO_YOY = isNaN(noY) ? NaN : noY * 100;
    d.NO_MOM3 = noM;

    // Check if critical inputs are NaN
    const sahmOk = typeof sahmVal === 'number' && !isNaN(sahmVal);
    const ycOk = typeof ycVal === 'number' && !isNaN(ycVal);
    const noYoyOk = typeof noY === 'number' && !isNaN(noY);
    const noMomOk = typeof noM === 'number' && !isNaN(noM);

    if (!sahmOk && !ycOk && !noYoyOk) {
      // All major cycle inputs are NaN — carry forward
      warnNaN('SAHM/YC/NO (CYCLE_SCORE)', d.Date);
      d.CYCLE_SCORE = lastCycleScore;
      return;
    }

    // Evaluate with available data; treat missing sub-indicators as non-triggering
    const isRecessionRisk =
      (sahmOk && sahmVal >= 0.5) ||
      (ycOk && ycVal < 0) ||
      (noYoyOk && noMomOk && noY < 0 && noM <= 0);
    const isExpansion =
      (sahmOk ? sahmVal < 0.35 : true) &&
      (ycOk ? ycVal >= 0.75 : true) &&
      (noYoyOk ? noY >= 0 : true);
    
    d.CYCLE_SCORE = isRecessionRisk ? 0 : (isExpansion ? 2 : 1);
    lastCycleScore = d.CYCLE_SCORE;
  });

  // -- Price Regime (40W MA Persistence) --
  const btcVals = dailyData.map(d => d.BTCUSD);

  // Build a 40-week moving average based on weekly closes, then forward-fill to daily
  // (matches dashboard_2026.py: btc_w = resample("W").last(); ma40 = rolling(40).mean(); ffill to daily)
  const weeklyClose: number[] = [];
  const weeklyIdx: number[] = [];

  for (let i = 0; i < dailyData.length; i++) {
    const dt = new Date(dailyData[i].Date);
    const v = Number(dailyData[i].BTCUSD);
    if (!Number.isFinite(v)) continue;

    // Week ending Sunday (UTC) – consistent and deterministic for the browser.
    if (dt.getUTCDay() === 0) {
      weeklyClose.push(v);
      weeklyIdx.push(i);
    }
  }

  const ma40wWeekly = rollingMean(weeklyClose, 40);
  let j = 0;
  let lastMA = NaN;

  for (let i = 0; i < dailyData.length; i++) {
    while (j < weeklyIdx.length && weeklyIdx[j] <= i) {
      lastMA = ma40wWeekly[j];
      j++;
    }
    dailyData[i].BTC_MA40W = lastMA;
  }

  // Raw condition: BTC > MA40W
  // Define PRICE_REGIME as the raw trend state:
  //   1 if BTCUSD >= BTC_MA40W
  //   0 if BTCUSD <  BTC_MA40W
  const rawOn = dailyData.map((d) => {
    const p = Number(d.BTCUSD);
    const ma = Number((d as any).BTC_MA40W);
    if (!Number.isFinite(p) || !Number.isFinite(ma)) return 0;
    const state = p >= ma ? 1 : 0;
    (d as any).PRICE_REGIME = state;
    return state;
  });

  // Persistence: require 20 of last 30 days ON
  const regimePersistence = rollingMean(rawOn, 30);
  dailyData.forEach((d, i) => {
    d.PRICE_REGIME_ON = regimePersistence[i] >= (20 / 30) ? 1 : 0;
  });

  // 4. Final Aggregates (CORE_ON, MACRO_ON, ACCUM_ON)
  let coreState = 0;
  dailyData.forEach((d, i) => {
    const val = d.VAL_SCORE;
    const dxy = d.DXY_SCORE;
    const pr = d.PRICE_REGIME_ON;

    if (coreState === 0) {
      // Entry: extreme conviction (VAL=3) enters unconditionally;
      //        VAL >= 1 with uptrend confirmation enters — this allows re-entry
      //        during bull market pullbacks (score 1 = MVRV < 3.5).
      //        Both paths require DXY not in headwind.
      const entryOk = ((val >= 3) || (val >= 1 && pr === 1)) && dxy >= 1;
      if (entryOk) coreState = 1;
    } else {
      // Exit path 1: bearish regime + valuation not extreme (≤ 2)
      // Exit path 2: overheated valuation (VAL=0) + USD strengthening (DXY=0)
      const exitOk = (pr === 0 && val <= 2) || (val === 0 && dxy === 0);
      if (exitOk) coreState = 0;
    }
    d.CORE_ON = coreState;

    const abScore = d.LIQ_SCORE + d.CYCLE_SCORE;
    d.MACRO_ON = (abScore >= 3 && dxy >= 1) ? 1 : 0;
    d.ACCUM_ON = d.CORE_ON;
  });

  if (nanWarnings > 0) {
    console.warn(`[Engine] Signal computation complete with ${nanWarnings} NaN carry-forward(s). Early-history scores may be approximate.`);
  } else {
    console.log("[Engine] Signal computation complete — no NaN carry-forwards needed.");
  }

  return dailyData as SignalData[];
}

