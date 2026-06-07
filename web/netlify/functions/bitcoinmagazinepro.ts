import { Handler } from '@netlify/functions';
import { fetchBmpAddressesInProfit } from './lib/bmpAddressesInProfit';

/**
 * Proxy for Bitcoin Magazine Pro on-chain chart data.
 *   /.netlify/functions/bitcoinmagazinepro?metric=addresses_in_profit
 *   /api/bmp/addresses_in_profit  (via redirect)
 */
const ALLOWED_METRICS = new Set(['addresses_in_profit']);

export const handler: Handler = async (event) => {
  const metricFromQuery = event.queryStringParameters?.metric;
  const metricFromPath = (() => {
    const p = (event.path || '').split('?')[0];
    const parts = p.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    if (!last || last.toLowerCase() === 'bitcoinmagazinepro') return undefined;
    return last;
  })();

  const metric = metricFromQuery || metricFromPath;

  if (!metric) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing metric parameter' }),
    };
  }

  if (!ALLOWED_METRICS.has(metric)) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: `Metric not allowed: ${metric}. Allowed: ${[...ALLOWED_METRICS].join(', ')}`,
      }),
    };
  }

  try {
    const data = await fetchBmpAddressesInProfit();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
      body: JSON.stringify(data),
    };
  } catch (error) {
    console.error('Error fetching from Bitcoin Magazine Pro:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch data from Bitcoin Magazine Pro' }),
    };
  }
};
