import type { Handler } from '@netlify/functions';
import { getCachedOpenInterestSeries, loadOpenInterestCache } from './lib/derivativesCache';

export const handler: Handler = async () => {
  try {
    const [series, cached] = await Promise.all([
      getCachedOpenInterestSeries(),
      loadOpenInterestCache(),
    ]);

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=900',
      },
      body: JSON.stringify({
        source: 'binance-futures',
        cached_at: cached?.timestamp ? new Date(cached.timestamp).toISOString() : null,
        count: series.length,
        data: series,
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[derivatives-open-interest]', error);
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: message }),
    };
  }
};
