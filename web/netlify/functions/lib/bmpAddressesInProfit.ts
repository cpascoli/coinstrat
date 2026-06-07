import fetch from 'node-fetch';

export interface DataPoint {
  date: string;
  value: number;
}

const BMP_DASH_URL =
  'https://www.bitcoinmagazinepro.com/django_plotly_dash/app/addresses_in_profit/_dash-update-component';

const BMP_DASH_BODY = {
  output: 'chart.figure',
  outputs: { id: 'chart', property: 'figure' },
  inputs: [
    { id: 'url', property: 'pathname', value: '/charts/percent-addresses-in-profit/' },
    { id: 'display', property: 'children', value: 'sm 726px' },
  ],
  changedPropIds: ['url.pathname', 'display.children'],
};

function parsePlotlyDate(x: string | number): string {
  if (typeof x === 'string') return x.slice(0, 10);
  return new Date(x).toISOString().split('T')[0];
}

/** Parse BMP Dash "Percent Addresses in Profit" chart response into daily %. */
export function parseBmpAddressesInProfitResponse(json: unknown): DataPoint[] {
  const trace = (json as any)?.response?.chart?.figure?.data?.[0];
  if (!trace?.x || !trace?.customdata) return [];

  const xs: Array<string | number> = trace.x;
  const customdata: Array<[number]> = trace.customdata;
  const n = Math.min(xs.length, customdata.length);
  const today = new Date().toISOString().split('T')[0];
  const out: DataPoint[] = [];

  for (let i = 0; i < n; i++) {
    const date = parsePlotlyDate(xs[i]);
    if (date > today) continue;

    const raw = customdata[i]?.[0];
    if (raw == null || !Number.isFinite(raw)) continue;

    const value = raw <= 1.5 ? raw * 100 : raw;
    out.push({ date, value });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Fetch "Percent Addresses in Profit" from Bitcoin Magazine Pro (daily %). */
export async function fetchBmpAddressesInProfit(): Promise<DataPoint[]> {
  const res = await fetch(BMP_DASH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; PowerWallet/1.0)',
      Referer: 'https://www.bitcoinmagazinepro.com/charts/percent-addresses-in-profit/',
      Origin: 'https://www.bitcoinmagazinepro.com',
    },
    body: JSON.stringify(BMP_DASH_BODY),
  });

  if (!res.ok) {
    throw new Error(`BMP addresses-in-profit: HTTP ${res.status}`);
  }

  const json = await res.json();
  return parseBmpAddressesInProfitResponse(json);
}
