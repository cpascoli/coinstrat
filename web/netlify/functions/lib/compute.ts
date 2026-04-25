/**
 * Server-side signal computation engine (incremental / append-only).
 *
 * Reads previously cached signals for historical context, fetches only
 * the recent tail from each external API, merges them, runs the full
 * signal computation (CPU-only, fast), and returns ONLY the new rows
 * that should be appended to the cache.
 */
import fetch from 'node-fetch';
// JSON is imported statically so esbuild bundles it inline — no file-system
// access at runtime and no path-resolution issues in the Lambda environment.
import btcDailyRaw from '../../../public/data/btc_daily.json';

// ── Types ───────────────────────────────────────────────────────────────

interface DataPoint {
  date: string;
  value: number;
}

export interface SignalRow {
  Date: string;
  BTCUSD: number;
  [key: string]: any;
}

// ── Math helpers ────────────────────────────────────────────────────────

function rollingMean(arr: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < window - 1) { result.push(NaN); continue; }
    const slice = arr.slice(i - window + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / window);
  }
  return result;
}

function pctChange(arr: number[], periods: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < periods || arr[i - periods] === 0 || isNaN(arr[i - periods])) {
      result.push(NaN); continue;
    }
    result.push((arr[i] / arr[i - periods]) - 1);
  }
  return result;
}

function diffArr(arr: number[], periods: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < periods || isNaN(arr[i - periods])) {
      result.push(NaN); continue;
    }
    result.push(arr[i] - arr[i - periods]);
  }
  return result;
}

// ── Server-side data fetching (recent tail only) ────────────────────────

const LOOKBACK_DAYS = 500; // covers 365-day YoY + buffer

function lookbackDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - LOOKBACK_DAYS);
  return d.toISOString().split('T')[0];
}

async function fetchFredSeries(seriesId: string, fullHistory = false): Promise<DataPoint[]> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error('FRED_API_KEY not configured');

  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${seriesId}&api_key=${apiKey}&file_type=json` +
    (fullHistory ? '' : `&observation_start=${lookbackDate()}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED ${seriesId}: HTTP ${res.status}`);
  const json = (await res.json()) as any;

  return (json.observations ?? [])
    .filter((o: any) => o.value !== '.')
    .map((o: any) => ({ date: o.date as string, value: parseFloat(o.value) }))
    .filter((o: DataPoint) => !isNaN(o.value));
}

async function fetchBtcTail(): Promise<DataPoint[]> {
  const url =
    `https://min-api.cryptocompare.com/data/v2/histoday` +
    `?fsym=BTC&tsym=USD&limit=${LOOKBACK_DAYS}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CryptoCompare BTC: HTTP ${res.status}`);
  const json = (await res.json()) as any;
  const entries = json?.Data?.Data ?? [];

  return entries
    .filter((e: any) => typeof e.close === 'number' && e.close > 0)
    .map((e: any) => ({
      date: new Date(e.time * 1000).toISOString().split('T')[0],
      value: e.close as number,
    }));
}

/**
 * Full BTC series: statically-bundled JSON history (2011-01-01 → 2025-10-19)
 * merged with a live CryptoCompare tail for any dates after the JSON's last entry.
 *
 * The JSON is imported at build time by esbuild so there is no file-system
 * access at runtime — path resolution issues in Netlify Lambda are avoided
 * entirely.
 */
export async function loadMergedBtcSeries(): Promise<DataPoint[]> {
  const local: DataPoint[] = (btcDailyRaw as Array<{ date: string; close: number }>)
    .filter((e) => typeof e.date === 'string' && Number.isFinite(e.close) && e.close > 0)
    .map((e) => ({ date: e.date, value: e.close }));

  const tail = await fetchBtcTail();

  if (local.length === 0) return [...tail].sort((a, b) => a.date.localeCompare(b.date));
  const lastLocalDate = local[local.length - 1].date;
  const tailAfter = tail
    .filter((p) => p.date > lastLocalDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  return [...local, ...tailAfter];
}

async function fetchMVRVTail(fullHistory = false): Promise<DataPoint[]> {
  const timespan = fullHistory ? 'all' : '2years';
  const url =
    'https://api.blockchain.info/charts/mvrv' +
    `?timespan=${timespan}&sampled=true&metadata=false&daysAverageString=1d&cors=true&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MVRV: HTTP ${res.status}`);
  const json = (await res.json()) as any;

  return ((json.values ?? []) as any[])
    .filter((v) => Number.isFinite(v.y))
    .map((v) => ({
      date: new Date((v.x as number) * 1000).toISOString().split('T')[0],
      value: v.y as number,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Fetch the full MVRV history from blockchain.info (all available dates,
 * sparse sampled — roughly one point every 3–4 days back to 2010).
 * Caller should apply forward-fill to cover gaps.
 */
export async function fetchMVRVFullHistory(): Promise<DataPoint[]> {
  return fetchMVRVTail(true);
}

export async function fetchBGeometrics(file: string): Promise<DataPoint[]> {
  const url = `https://charts.bgeometrics.com/files/${file}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`BGeometrics ${file}: HTTP ${res.status}`);
  const data = (await res.json()) as [number, number | null][];

  return data
    .filter(([, v]) => v !== null && Number.isFinite(v))
    .map(([ts, v]) => ({
      date: new Date(ts).toISOString().split('T')[0],
      value: v as number,
    }));
}

async function fetchISM_PMI(): Promise<DataPoint[]> {
  const baseUrl =
    'https://endpoints.investing.com/pd-instruments/v1/calendars/economic/events/173/occurrences?domain_id=1&limit=1000';

  const all: DataPoint[] = [];
  let url = baseUrl;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ISM PMI: HTTP ${res.status}`);
    const json = (await res.json()) as any;
    const occurrences: any[] = json.occurrences ?? [];

    for (const o of occurrences) {
      if (o.actual == null) continue;
      const date = o.occurrence_time?.split('T')[0];
      if (!date) continue;
      all.push({ date, value: Number(o.actual) });
    }

    if (json.next_page_cursor) {
      url = `${baseUrl}&cursor=${encodeURIComponent(json.next_page_cursor)}`;
    } else {
      break;
    }
  }

  return all.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Merge helper ────────────────────────────────────────────────────────

/**
 * Overlay a fresh API series onto the daily array.
 * Pre-seeded values (from cache) are preserved for dates before the
 * first API data point.  Once API data appears, it takes precedence
 * and is forward-filled through subsequent gaps.
 */
function overlaySeries(
  series: DataPoint[],
  daily: any[],
  allDates: string[],
  key: string,
) {
  const sMap = new Map(series.map((s) => [s.date, s.value]));
  let lastApi = NaN;

  for (let i = 0; i < allDates.length; i++) {
    const apiVal = sMap.get(allDates[i]);
    if (apiVal !== undefined && !isNaN(apiVal)) {
      lastApi = apiVal;
      daily[i][key] = apiVal;
    } else if (!isNaN(lastApi)) {
      daily[i][key] = lastApi;
    }
  }
}

// ── Main entry point ────────────────────────────────────────────────────

/**
 * Incrementally refresh signals.
 *
 * @param cachedSignals  Full cached signal history (used for raw-value
 *                       context and BTC price history pre-Binance).
 * @returns              Only the NEW rows (dates > last cached date).
 *                       Caller appends these to the cache.
 */
export async function refreshSignals(
  cachedSignals: SignalRow[],
  options?: {
    returnFullDataset?: boolean;
    fullHistory?: boolean;
  },
): Promise<SignalRow[]> {
  const returnFullDataset = options?.returnFullDataset ?? false;
  const fullHistory = options?.fullHistory ?? false;

  const lastCachedDate =
    cachedSignals.length > 0 ? cachedSignals[cachedSignals.length - 1].Date : null;

  // 1. Fetch recent tail from all APIs in parallel ─────────────────────

  const [
    walcl, tga, rrp, dxyRaw, sahm, yc, newOrders,
    btcPrices, mvrv,
    ecbAssets, bojAssets, eurUsd, jpyUsd,
    lthSopr, lthNupl, supplyInProfit, sthRealizedPrice, lthRealizedPrice,
    ismPmi,
  ] = await Promise.all([
    fetchFredSeries('WALCL', fullHistory),
    fetchFredSeries('WTREGEN', fullHistory),
    fetchFredSeries('RRPONTSYD', fullHistory),
    fetchFredSeries('DTWEXBGS', fullHistory),
    fetchFredSeries('SAHMREALTIME', fullHistory),
    fetchFredSeries('T10Y3M', fullHistory),
    fetchFredSeries('AMTMNO', fullHistory),
    loadMergedBtcSeries(),
    fetchMVRVTail(fullHistory),
    fetchFredSeries('ECBASSETSW', fullHistory),
    fetchFredSeries('JPNASSETS', fullHistory),
    fetchFredSeries('DEXUSEU', fullHistory),
    fetchFredSeries('DEXJPUS', fullHistory),
    fetchBGeometrics('lth_sopr'),
    fetchBGeometrics('lth_nupl'),
    fetchBGeometrics('profit_loss'),
    fetchBGeometrics('sth_realized_price'),
    fetchBGeometrics('lth_realized_price'),
    fetchISM_PMI(),
  ]);

  const rrpM = rrp.map((o) => ({ ...o, value: o.value * 1000 }));

  // 2. Build daily timeline ────────────────────────────────────────────

  const firstDate = cachedSignals.length > 0
    ? cachedSignals[0].Date
    : btcPrices.length > 0 ? btcPrices[0].date : null;

  if (!firstDate) return [];

  const allDates: string[] = [];
  const curr = new Date(firstDate);
  const today = new Date();
  while (curr <= today) {
    allDates.push(curr.toISOString().split('T')[0]);
    curr.setDate(curr.getDate() + 1);
  }

  const daily: any[] = allDates.map((d) => ({ Date: d }));

  // 3. Pre-seed from cached signals ────────────────────────────────────

  const cachedByDate = new Map(cachedSignals.map((s) => [s.Date, s]));
  const seedKeys = [
    'BTCUSD', 'DXY', 'SAHM', 'YC_M', 'NO', 'MVRV', 'US_LIQ', 'SIP', 'LTH_SOPR', 'LTH_NUPL',
    'STH_REALIZED_PRICE', 'LTH_REALIZED_PRICE', 'ECB_RAW', 'BOJ_RAW', 'EURUSD', 'JPYUSD', 'WALCL', 'WTREGEN', 'RRPONTSYD',
    'G3_ASSETS', 'ISM_PMI',
  ];

  for (let i = 0; i < allDates.length; i++) {
    const cached = cachedByDate.get(allDates[i]);
    if (!cached) continue;
    for (const k of seedKeys) {
      const v = cached[k];
      if (typeof v === 'number' && !isNaN(v)) daily[i][k] = v;
    }
  }

  // 4. Overlay fresh API data (recent tail) ────────────────────────────

  overlaySeries(btcPrices, daily, allDates, 'BTCUSD');
  overlaySeries(dxyRaw, daily, allDates, 'DXY');
  overlaySeries(sahm, daily, allDates, 'SAHM');
  overlaySeries(yc, daily, allDates, 'YC_M');
  overlaySeries(newOrders, daily, allDates, 'NO');
  overlaySeries(mvrv, daily, allDates, 'MVRV');
  overlaySeries(lthSopr, daily, allDates, 'LTH_SOPR');
  overlaySeries(lthNupl, daily, allDates, 'LTH_NUPL');
  overlaySeries(sthRealizedPrice, daily, allDates, 'STH_REALIZED_PRICE');
  overlaySeries(lthRealizedPrice, daily, allDates, 'LTH_REALIZED_PRICE');
  overlaySeries(supplyInProfit, daily, allDates, 'SIP');
  overlaySeries(ismPmi, daily, allDates, 'ISM_PMI');
  overlaySeries(ecbAssets, daily, allDates, 'ECB_RAW');
  overlaySeries(bojAssets, daily, allDates, 'BOJ_RAW');
  overlaySeries(eurUsd, daily, allDates, 'EURUSD');
  overlaySeries(jpyUsd, daily, allDates, 'JPYUSD');

  // WALCL / WTREGEN / RRPONTSYD are only used to compute US_LIQ;
  // overlay them separately so we know which dates have fresh components.
  overlaySeries(walcl, daily, allDates, 'WALCL');
  overlaySeries(tga, daily, allDates, 'WTREGEN');
  overlaySeries(rrpM, daily, allDates, 'RRPONTSYD');

  // Compute US_LIQ: fresh components take precedence, else keep cached
  for (const d of daily) {
    const w = d.WALCL; const t = d.WTREGEN; const r = d.RRPONTSYD;
    if (typeof w === 'number' && !isNaN(w) &&
        typeof t === 'number' && !isNaN(t) &&
        typeof r === 'number' && !isNaN(r)) {
      d.US_LIQ = w - t - r;
    }
  }

  // 5. G3 Global Liquidity (display-only) ──────────────────────────────

  for (const d of daily) {
    const fed = d.WALCL; const ecb = d.ECB_RAW; const boj = d.BOJ_RAW;
    const eur = d.EURUSD; const jpy = d.JPYUSD;

    const fedOk = typeof fed === 'number' && !isNaN(fed);
    const ecbOk = typeof ecb === 'number' && !isNaN(ecb) &&
                  typeof eur === 'number' && !isNaN(eur) && eur > 0;
    const bojOk = typeof boj === 'number' && !isNaN(boj) &&
                  typeof jpy === 'number' && !isNaN(jpy) && jpy > 0;

    if (fedOk && (ecbOk || bojOk)) {
      d.G3_ASSETS = (fedOk ? fed : 0) + (ecbOk ? ecb * eur : 0) + (bojOk ? boj * 100 / jpy : 0);
    }
  }

  const g3Vals = daily.map((d) => d.G3_ASSETS ?? NaN);
  const g3YoY = pctChange(g3Vals, 365);
  daily.forEach((d, i) => { d.G3_YOY = isNaN(g3YoY[i]) ? undefined : g3YoY[i] * 100; });

  // 6. Scores ─────────────────────────────────────────────────────────

  // -- Valuation Score (0-3) via NUPL = 1 − 1/MVRV --
  let lastVal = 0;
  for (const d of daily) {
    const mv = d.MVRV;
    if (typeof mv !== 'number' || isNaN(mv) || mv === 0) { d.VAL_SCORE = lastVal; continue; }
    const nupl = 1 - 1 / mv;
    d.NUPL = nupl;
    const sopr = d.LTH_SOPR;
    const soprOk = typeof sopr === 'number' && !isNaN(sopr);
    const cap = soprOk && sopr < 1.0;

    let sc: number;
    if (nupl < 0 && cap) sc = 3;
    else if (nupl < 0 || (nupl < 0.381924 && cap)) sc = 2;
    else if (nupl < 0.618) sc = 1;
    else sc = 0;
    d.VAL_SCORE = sc; lastVal = sc;
  }

  // -- Liquidity Score --
  const usLiq = daily.map((d) => {
    const v = d.US_LIQ;
    return typeof v === 'number' && !isNaN(v) ? v : NaN;
  });
  const usLiqYoY = pctChange(usLiq, 365);
  const usLiq13W = diffArr(usLiq, 91);

  let lastLiq = 0;
  daily.forEach((d, i) => {
    d.US_LIQ_YOY = isNaN(usLiqYoY[i]) ? undefined : usLiqYoY[i] * 100;
    d.US_LIQ_13W_DELTA = isNaN(usLiq13W[i]) ? undefined : usLiq13W[i];

    const yoy = d.US_LIQ_YOY; const delta = d.US_LIQ_13W_DELTA;
    if (yoy == null && delta == null) { d.LIQ_SCORE = lastLiq; return; }
    let sc = 0;
    if (typeof yoy === 'number' && yoy > 0) sc = 2;
    else if (typeof delta === 'number' && delta > 0) sc = 1;
    d.LIQ_SCORE = sc; lastLiq = sc;
  });

  // -- DXY Score --
  const dxyVals = daily.map((d) => typeof d.DXY === 'number' ? d.DXY : NaN);
  const dxyMA50 = rollingMean(dxyVals, 50);
  const dxyMA200 = rollingMean(dxyVals, 200);
  const dxyROC20 = pctChange(dxyVals, 20);

  let lastDxy = 1;
  daily.forEach((d, i) => {
    const roc = dxyROC20[i];
    if (typeof roc !== 'number' || isNaN(roc)) { d.DXY_SCORE = lastDxy; return; }

    let sc = 1;
    if (roc > 0.005) sc = 0;
    else if (roc < -0.005) {
      const m50 = dxyMA50[i]; const m200 = dxyMA200[i];
      sc = (typeof m50 === 'number' && !isNaN(m50) &&
            typeof m200 === 'number' && !isNaN(m200) && m50 < m200) ? 2 : 1;
    }
    d.DXY_SCORE = sc; lastDxy = sc;
  });

  // DXY persistence filter (20/30)
  const dxyFav = daily.map((d) => (d.DXY_SCORE >= 1 ? 1 : 0));
  const dxyPersist = rollingMean(dxyFav, 30);
  daily.forEach((d, i) => {
    d.DXY_SCORE_RAW = d.DXY_SCORE;
    const p = dxyPersist[i] >= 20 / 30 ? 1 : 0;
    d.DXY_SCORE = p ? d.DXY_SCORE_RAW : 0;
  });

  // -- Cycle Score --
  // NO_YOY / NO_MOM3 kept for display; scoring uses ISM PMI persistence.
  const noVals = daily.map((d) => typeof d.NO === 'number' ? d.NO : NaN);
  const noYoY = pctChange(noVals, 365);
  const noMom3 = diffArr(noVals, 90);

  let ismAbove50Days = 0;
  let ismBelow45Days = 0;

  let lastCyc = 1;
  daily.forEach((d, i) => {
    const nY = noYoY[i]; const nM = noMom3[i];
    d.NO_YOY = isNaN(nY) ? undefined : nY * 100;
    d.NO_MOM3 = isNaN(nM) ? undefined : nM;

    const pmi = d.ISM_PMI;
    const pmiOk = typeof pmi === 'number' && !isNaN(pmi);
    if (pmiOk) {
      ismAbove50Days = pmi >= 50 ? ismAbove50Days + 1 : 0;
      ismBelow45Days = pmi < 45 ? ismBelow45Days + 1 : 0;
    }
    d.ISM_PMI_ABOVE50_DAYS = ismAbove50Days;
    d.ISM_PMI_BELOW45_DAYS = ismBelow45Days;

    const sv = d.SAHM; const yv = d.YC_M;
    const sOk = typeof sv === 'number' && !isNaN(sv);
    const yOk = typeof yv === 'number' && !isNaN(yv);
    if (!sOk && !yOk && !pmiOk) { d.BIZ_CYCLE_SCORE = lastCyc; return; }

    let recessionFlags = 0;
    if (sOk && sv >= 0.5) recessionFlags++;
    if (yOk && yv < 0) recessionFlags++;
    if (pmiOk && ismBelow45Days >= 60) recessionFlags++;
    const recession = recessionFlags >= 2;
    const expansion =
      (sOk ? sv < 0.35 : true) && (yOk ? yv >= 0.75 : true) && (pmiOk ? ismAbove50Days >= 90 : true);
    d.BIZ_CYCLE_SCORE = recession ? 0 : expansion ? 2 : 1;
    lastCyc = d.BIZ_CYCLE_SCORE;
  });

  // -- BTC MA200 --
  const btcVals = daily.map((d) => typeof d.BTCUSD === 'number' ? d.BTCUSD : NaN);
  const btcMA200 = rollingMean(btcVals, 200);
  daily.forEach((d, i) => { d.BTC_MA200 = btcMA200[i]; });

  // -- Price Regime (40W MA persistence) --
  const weeklyClose: number[] = [];
  const weeklyIdx: number[] = [];
  for (let i = 0; i < daily.length; i++) {
    const dt = new Date(daily[i].Date);
    const v = Number(daily[i].BTCUSD);
    if (!Number.isFinite(v)) continue;
    if (dt.getUTCDay() === 0) { weeklyClose.push(v); weeklyIdx.push(i); }
  }

  const ma40wWeekly = rollingMean(weeklyClose, 40);
  let j = 0; let lastMA = NaN;
  for (let i = 0; i < daily.length; i++) {
    while (j < weeklyIdx.length && weeklyIdx[j] <= i) { lastMA = ma40wWeekly[j]; j++; }
    daily[i].BTC_MA40W = lastMA;
  }

  const rawOn = daily.map((d) => {
    const p = Number(d.BTCUSD); const ma = Number(d.BTC_MA40W);
    return Number.isFinite(p) && Number.isFinite(ma) && p >= ma ? 1 : 0;
  });
  const regPersist = rollingMean(rawOn, 30);
  daily.forEach((d, i) => { d.PRICE_REGIME_ON = regPersist[i] >= 20 / 30 ? 1 : 0; });

  // 7. Final aggregates (CORE, MACRO, ACCUM) ──────────────────────────

  const SIP_EUPHORIA_THRESHOLD = 95;
  const SIP_EUPHORIA_MIN_DAYS = 14;
  const SIP_DROP_THRESHOLD = 90;
  const SIP_RECLAIM_WINDOW = 45;

  let coreState = 0;
  let euphoriaStreak = 0;
  let euphoriaFlag = false;
  let observationStart = -1;
  let sipExhausted = false;

  daily.forEach((d, i) => {
    const val = d.VAL_SCORE;
    const dxy = d.DXY_SCORE;
    const pr = d.PRICE_REGIME_ON;
    const sip = d.SIP;
    const sipOk = typeof sip === 'number' && !isNaN(sip);

    if (sipOk && sip > SIP_EUPHORIA_THRESHOLD) {
      euphoriaStreak++;
      if (euphoriaStreak >= SIP_EUPHORIA_MIN_DAYS && !euphoriaFlag) euphoriaFlag = true;
    } else { euphoriaStreak = 0; }

    if (euphoriaFlag && sipOk) {
      if (observationStart === -1 && sip < SIP_DROP_THRESHOLD) {
        observationStart = i; sipExhausted = false;
      }
      if (observationStart >= 0) {
        if (sip > SIP_EUPHORIA_THRESHOLD) {
          observationStart = -1; sipExhausted = false; euphoriaStreak = 1;
        } else if (i - observationStart >= SIP_RECLAIM_WINDOW) {
          sipExhausted = true;
        }
      }
    }

    const sipExhaustedBeforeCore = sipExhausted;

    if (coreState === 0) {
      if (val >= 3 || (val >= 1 && pr === 1)) {
        coreState = 1;
        euphoriaFlag = false; euphoriaStreak = 0;
        observationStart = -1; sipExhausted = false;
      }
    } else {
      if ((pr === 0 && val <= 1) || sipExhausted) coreState = 0;
    }
    d.CORE_ON = coreState;

    d.SIP_EUPHORIA_FLAG = euphoriaFlag ? 1 : 0;
    d.SIP_EXHAUSTED = sipExhausted || sipExhaustedBeforeCore ? 1 : 0;
    d.SIP_OBS_DAYS = observationStart >= 0 ? i - observationStart : 0;

    const ab = d.LIQ_SCORE + d.BIZ_CYCLE_SCORE;
    d.AB_SCORE = ab;
    d.ABCD_SCORE = ab + d.DXY_SCORE + d.VAL_SCORE;
    d.MACRO_ON = ab >= 3 && dxy >= 1 ? 1 : 0;
    d.ACCUM_ON = d.CORE_ON;
  });

  // 8. Strip bulky intermediate fields ─────────────────────────────────

  const strip = [
    'DXY_SCORE_RAW',
  ];
  for (const d of daily) { for (const k of strip) delete d[k]; }

  // 9. Return only new rows ────────────────────────────────────────────

  if (returnFullDataset || !lastCachedDate) return daily as SignalRow[];
  return daily.filter((d) => d.Date > lastCachedDate) as SignalRow[];
}
