/**
 * Service to fetch crypto-specific data (BTC Price and MVRV)
 */

export interface PricePoint {
  date: string;
  value: number;
}

/**
 * Fetch BTC price using a hybrid approach:
 * 1. Load historical data from a local JSON file.
 * 2. Fetch the "tail" (recent data) from the Binance API.
 */
export async function fetchBTCPrice(): Promise<PricePoint[]> {
  try {
    // 1. Load historical data
    const localResponse = await fetch('/data/btc_daily.json');
    if (!localResponse.ok) throw new Error("Local BTC history not found");
    const localData: { date: string, close: number }[] = await localResponse.json();
    
    const historicalPoints: PricePoint[] = localData.map(d => ({
      date: d.date,
      value: d.close
    }));

    // 2. Determine start point for Binance fetch (day after last local point)
    if (historicalPoints.length === 0) return [];
    
    const lastPoint = historicalPoints[historicalPoints.length - 1];
    const lastDate = new Date(lastPoint.date);
    const startMs = lastDate.getTime() + (24 * 60 * 60 * 1000); // Start next day
    const endMs = Date.now();

    // If last local point is today, just return historical
    if (startMs >= endMs) return historicalPoints;

    // 3. Fetch tail from Binance
    const binanceTail = await fetchBinanceKlines('BTCUSDT', '1d', startMs, endMs);
    
    // 4. Merge and return
    return mergeUnique(historicalPoints, binanceTail);
  } catch (error) {
    console.error("Error in hybrid BTC price fetch:", error);
    return [];
  }
}

/**
 * Fetch daily klines from Binance API with pagination
 */
async function fetchBinanceKlines(symbol: string, interval: string, startMs: number, endMs: number): Promise<PricePoint[]> {
  const limit = 1000;
  const allData: PricePoint[] = [];
  let currentStartMs = startMs;

  while (currentStartMs < endMs) {
    const params = new URLSearchParams({
      symbol,
      interval,
      limit: limit.toString(),
      startTime: currentStartMs.toString(),
      endTime: endMs.toString(),
    });

    const response = await fetch(`https://api.binance.com/api/v3/klines?${params}`);
    if (!response.ok) {
      throw new Error(`Binance API error: ${response.statusText}`);
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) break;

    for (const candle of data) {
      // candle[0] = Open time, candle[4] = Close price, candle[6] = Close time
      const time = new Date(candle[0]); // Use open time for the date of the daily bar
      const price = parseFloat(candle[4]);
      const dateStr = time.toISOString().split('T')[0];
      allData.push({ date: dateStr, value: price });
    }

    const lastOpenTime = data[data.length - 1][0];
    currentStartMs = lastOpenTime + 1;
    
    // Tiny delay to avoid rate limits
    if (currentStartMs < endMs) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return allData;
}

/**
 * Merges two arrays of PricePoints, ensuring unique dates and sorting.
 */
function mergeUnique(a: PricePoint[], b: PricePoint[]): PricePoint[] {
  const map = new Map<string, PricePoint>();
  for (const it of a) map.set(it.date, it);
  for (const it of b) {
    // b (Binance) takes precedence for overlapping dates as it's the "live" tail
    map.set(it.date, it);
  }
  return Array.from(map.values()).sort((x, y) => x.date.localeCompare(y.date));
}

/**
 * Fetch MVRV from Blockchain.info
 */
export async function fetchMVRV(): Promise<PricePoint[]> {
  const url = "https://api.blockchain.info/charts/mvrv?timespan=all&sampled=true&metadata=false&daysAverageString=1d&cors=true&format=json";
  
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Blockchain.info error");
    const data = await response.json();
    
    return data.values.map((v: any) => ({
      date: new Date(v.x * 1000).toISOString().split('T')[0],
      value: v.y
    }));
  } catch (error) {
    console.error("Error fetching MVRV:", error);
    return [];
  }
}

