export type FrontPageSection = 'market' | 'development' | 'culture' | 'opinion';

export const FRONT_PAGE_SECTIONS: readonly FrontPageSection[] = ['market', 'development', 'culture', 'opinion'];

export const SECTION_LABELS: Record<FrontPageSection, string> = {
  market: 'Markets',
  development: 'Development',
  culture: 'Culture',
  opinion: 'Analysis',
};

export interface FrontPageArticle {
  id: string;
  slug: string;
  headline: string;
  summary: string;
  body?: string | null;
  labels: string[] | null;
  published_at: string;
  section?: string | null;
  image_url?: string | null;
  image_alt?: string | null;
  sources?: Array<{ title?: string | null; url?: string | null; source?: string | null }> | null;
}

export function isFrontPageSection(value: string | null | undefined): value is FrontPageSection {
  return value === 'market' || value === 'development' || value === 'culture' || value === 'opinion';
}

/** Newest article in each front-page section; extras go to the archive. */
export function groupFrontPage<T extends FrontPageArticle>(
  rows: T[],
): { lead: Record<FrontPageSection, T | null>; archive: T[] } {
  const lead: Record<FrontPageSection, T | null> = {
    market: null,
    development: null,
    culture: null,
    opinion: null,
  };
  const archive: T[] = [];
  const sorted = [...rows].sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  for (const row of sorted) {
    const section = isFrontPageSection(row.section) ? row.section : 'market';
    if (!lead[section]) lead[section] = row;
    else archive.push(row);
  }
  return { lead, archive };
}

export function relativeAgeLabel(publishedAt: string, now = new Date()): string {
  const ms = Date.parse(publishedAt);
  if (Number.isNaN(ms)) return '';
  const days = Math.floor((now.getTime() - ms) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}
