/** Front-page sections written daily. `legacy` rows (pre-sections) are never generated. */
export type NewsSection = 'market' | 'development' | 'culture' | 'opinion';

export const NEWS_SECTIONS: readonly NewsSection[] = ['market', 'development', 'culture', 'opinion'];

/**
 * `primary`: first-party project sources (release notes, Optech, Delving) and
 * established Bitcoin outlets doing original reporting.
 * `secondary`: aggregators and community posts (Google News, Hacker News,
 * Stacker News, Nostr) — useful colour, but not enough on their own.
 */
export type SourceTrust = 'primary' | 'secondary';

export interface SourceItem {
  url: string;
  title: string;
  /** Human-readable outlet / origin, e.g. "Bitcoin Optech" or "Nostr · npub1…". */
  source: string;
  section: NewsSection;
  /** ISO timestamp of first publication (never the "updated" time); null when unknown. */
  publishedAt: string | null;
  trust: SourceTrust;
  excerpt?: string;
}
