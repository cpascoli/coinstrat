import { getStore } from '@netlify/blobs';

/**
 * Returns the "signals" Netlify Blob store.
 *
 * Auto-detection works when the function is invoked inside the Netlify
 * runtime (NETLIFY_BLOBS_CONTEXT is injected per-request).  CLI deploys
 * (`netlify deploy --prod`) sometimes omit that context, so we fall back
 * to explicit credentials via SITE_ID + NETLIFY_BLOBS_TOKEN env vars.
 */
export function signalsStore() {
  const siteID = process.env.SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;

  if (siteID && token) {
    return getStore({ name: 'signals', siteID, token });
  }

  return getStore('signals');
}
