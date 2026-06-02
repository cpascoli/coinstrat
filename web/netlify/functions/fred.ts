import { Handler } from '@netlify/functions';
import { fetchFredJsonBody } from './lib/fredClient';

/**
 * Netlify Function to proxy FRED API requests.
 * This bypasses CORS and keeps the API Key secure on the server.
 */
export const handler: Handler = async (event) => {
  // Support both:
  // - /.netlify/functions/fred?series_id=WALCL
  // - /.netlify/functions/fred/WALCL  (used by /api/fred/* redirect)
  const seriesIdFromQuery = event.queryStringParameters?.series_id;
  const seriesIdFromPath = (() => {
    const p = (event.path || '').split('?')[0];
    const parts = p.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    // If the last segment is literally "fred", there is no series id in the path.
    if (!last || last.toLowerCase() === 'fred') return undefined;
    return last;
  })();

  const seriesId = seriesIdFromQuery || seriesIdFromPath;

  if (!seriesId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing series_id parameter' }),
    };
  }

  if (!process.env.FRED_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'FRED_API_KEY environment variable not set on Netlify' }),
    };
  }

  try {
    const body = await fetchFredJsonBody(seriesId);
    return {
      statusCode: 200,
      headers: fredResponseHeaders(),
      body,
    };
  } catch (error) {
    console.error('Error fetching from FRED:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch data from FRED API' }),
    };
  }
};

function fredResponseHeaders(stale = false) {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': stale
      ? 'public, max-age=60, stale-while-revalidate=3600'
      : 'public, max-age=3600, s-maxage=3600',
  };
}
