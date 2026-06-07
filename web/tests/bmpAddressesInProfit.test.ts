import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBmpAddressesInProfitResponse } from '../netlify/functions/lib/bmpAddressesInProfit';

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/bmp-addresses-in-profit-dash.json',
);

describe('parseBmpAddressesInProfitResponse', () => {
  it('parses daily percent addresses in profit from Plotly dash response', () => {
    const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const series = parseBmpAddressesInProfitResponse(raw);

    expect(series.length).toBeGreaterThan(5000);
    expect(series[0]).toEqual({ date: '2010-08-17', value: expect.closeTo(93.46, 1) });
    expect(series[series.length - 1].date).toBe('2026-06-04');
    expect(series[series.length - 1].value).toBeCloseTo(66.5, 0);
  });
});
