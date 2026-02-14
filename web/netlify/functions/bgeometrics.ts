import { Handler } from '@netlify/functions';
import fetch from 'node-fetch';

/**
 * Netlify Function to proxy BGeometrics JSON data.
 * Supports:
 *   /.netlify/functions/bgeometrics?file=lth_sopr
 *   /api/bgeometrics/lth_sopr  (via redirect)
 *
 * The file parameter maps to https://charts.bgeometrics.com/files/<file>.json
 */

const ALLOWED_FILES = new Set(['lth_sopr', 'lth_nupl']);

export const handler: Handler = async (event) => {
  // Extract file name from query or path
  const fileFromQuery = event.queryStringParameters?.file;
  const fileFromPath = (() => {
    const p = (event.path || '').split('?')[0];
    const parts = p.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    if (!last || last.toLowerCase() === 'bgeometrics') return undefined;
    return last;
  })();

  const file = fileFromQuery || fileFromPath;

  if (!file) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing file parameter' }),
    };
  }

  if (!ALLOWED_FILES.has(file)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `File not allowed: ${file}. Allowed: ${[...ALLOWED_FILES].join(', ')}` }),
    };
  }

  const url = `https://charts.bgeometrics.com/files/${file}.json`;

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
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600', // cache 1h; data updates daily
      },
      body: JSON.stringify(data),
    };
  } catch (error) {
    console.error('Error fetching from BGeometrics:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch data from BGeometrics' }),
    };
  }
};
