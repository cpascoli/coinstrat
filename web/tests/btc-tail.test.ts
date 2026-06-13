/**
 * Live integration check for the BTC price tail sources (Kraken primary,
 * Coinbase fallback) that feed the signal-cache refresh. Hits real public
 * APIs, so it is gated:
 *
 *   BTC_TAIL=1 npx vitest run tests/btc-tail.test.ts
 */
import { describe, it, expect } from 'vitest';
import { loadMergedBtcSeries } from '../netlify/functions/lib/compute';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('BTC price tail (live)', () => {
  it.runIf(process.env.BTC_TAIL === '1')('merged series is fresh and well-formed', async () => {
    const series = await loadMergedBtcSeries();
    expect(series.length).toBeGreaterThan(3000);

    // Strictly increasing dates, positive prices.
    for (let i = 1; i < series.length; i++) {
      expect(series[i].date > series[i - 1].date).toBe(true);
      expect(series[i].value).toBeGreaterThan(0);
    }

    // The tail must reach within 2 days of now (UTC), i.e. the live fetch worked.
    const last = series[series.length - 1];
    const ageDays = (Date.now() - new Date(last.date).getTime()) / DAY_MS;
    expect(ageDays).toBeLessThan(2);

    console.log(`Last BTC point: ${last.date} $${last.value.toLocaleString()} (${series.length} rows)`);
  }, 30_000);
});
