/** Parse a feed or API date into an ISO string, or null when unusable. */
export function toIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * First-publication date. `published` / `pubDate` wins; `updated` is ignored
 * so a later edit cannot make an old story look new.
 */
export function pickPublishedAt(
  published: string | null | undefined,
  _updated?: string | null,
): string | null {
  return toIsoDate(published ?? null);
}

export function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith('utm_') || key === 'fbclid' || key === 'gclid') {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function mentionsBitcoin(text: string): boolean {
  return /\b(bitcoin|btc|lightning|nostr)\b/i.test(text);
}
