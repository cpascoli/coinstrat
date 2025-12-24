/**
 * Service to fetch data from FRED (Federal Reserve Economic Data)
 */

// Since FRED API doesn't support CORS for browser-side requests,
// we generally go through a same-origin proxy (Netlify Function).
// The app can also fall back to direct fetch in development (only if explicitly configured).

export interface FredObservation {
  date: string;
  value: number;
}

export async function fetchFredSeries(seriesId: string): Promise<FredObservation[]> {
  const isDev = import.meta.env.DEV;

  // Production / Netlify: prefer the redirect-based endpoint (easier to reason about)
  // netlify.toml maps /api/fred/:series_id -> /.netlify/functions/fred?series_id=...
  const netlifyProxyUrl = `/api/fred/${encodeURIComponent(seriesId)}`;

  // Development: try Netlify Dev function path first (works when running `netlify dev`)
  const localNetlifyFnUrl = `/.netlify/functions/fred?series_id=${encodeURIComponent(seriesId)}`;

  // Development fallback (only if you *really* want to try direct calls; many browsers will block due to CORS)
  const directUrl = import.meta.env.VITE_FRED_API_KEY
    ? `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(import.meta.env.VITE_FRED_API_KEY)}&file_type=json`
    : null;

  const candidates = isDev ? [localNetlifyFnUrl, netlifyProxyUrl, directUrl].filter(Boolean) : [netlifyProxyUrl];

  try {
    let lastErr: Error | null = null;
    for (const url of candidates) {
      try {
        const response = await fetch(url as string);
        if (!response.ok) throw new Error(`FRED API error: ${response.statusText}`);
        const data = await response.json();
        return data.observations
          .map((obs: any) => ({
            date: obs.date,
            value: obs.value === '.' ? NaN : parseFloat(obs.value),
          }))
          .filter((obs: any) => !isNaN(obs.value));
      } catch (e: any) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        // try next candidate
      }
    }
    throw lastErr ?? new Error('Unknown FRED fetch failure');
    
  } catch (error) {
    console.error(`Error fetching FRED series ${seriesId}:`, error);
    return [];
  }
}

