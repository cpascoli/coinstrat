import { Handler } from '@netlify/functions';
import fetch from 'node-fetch';

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
  const apiKey = process.env.FRED_API_KEY;

  if (!seriesId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing series_id parameter' }),
    };
  }

  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'FRED_API_KEY environment variable not set on Netlify' }),
    };
  }

  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: await response.text(),
      };
    }

    const data = await response.json();
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // Enable CORS for development if needed, 
        // though Netlify Functions on the same domain don't strictly need it.
        'Access-Control-Allow-Origin': '*', 
      },
      body: JSON.stringify(data),
    };
  } catch (error) {
    console.error('Error fetching from FRED:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch data from FRED API' }),
    };
  }
};

