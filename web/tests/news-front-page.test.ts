import { describe, expect, it } from 'vitest';
import type { SourceItem } from '../netlify/functions/lib/newsSources/types';

process.env.SUPABASE_URL ??= 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'stub-service-role-key';
process.env.SUPABASE_ANON_KEY ??= 'stub-anon-key';
process.env.VITE_SUPABASE_URL ??= 'https://stub.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY ??= 'stub-anon-key';
process.env.RESEND_API_KEY ??= 'stub-resend-key';

const { pickPublishedAt } = await import('../netlify/functions/lib/newsSources/dates');
const { parseFeedItems } = await import('../netlify/functions/lib/newsSources/rss');
const { publishedAtFromNostrEvent, isUsableLongform } = await import('../netlify/functions/lib/newsSources/nostr');
const {
  assignSingleSection,
  excludeUsedUrls,
  freshnessWindowMs,
  isFresh,
  passesFreshnessBar,
  selectSectionCandidates,
} = await import('../netlify/functions/lib/newsSources/select');
const { groupFrontPage, relativeAgeLabel } = await import('../src/utils/newsFrontPage');

function item(partial: Partial<SourceItem> & Pick<SourceItem, 'url' | 'title'>): SourceItem {
  return {
    source: 'Test',
    section: 'market',
    publishedAt: '2026-10-03T06:00:00.000Z',
    trust: 'primary',
    ...partial,
  };
}

describe('RSS / Atom date selection', () => {
  it('prefers published / pubDate over updated', () => {
    const rss = `
      <rss><channel>
        <item>
          <title>Core 30 ships</title>
          <link>https://example.com/core-30</link>
          <pubDate>Thu, 02 Oct 2026 12:00:00 GMT</pubDate>
          <updated>Fri, 03 Oct 2026 09:00:00 GMT</updated>
        </item>
      </channel></rss>
    `;
    const [entry] = parseFeedItems(rss);
    expect(entry.publishedAt).toBe('2026-10-02T12:00:00.000Z');
    expect(entry.updatedAt).toBe('2026-10-03T09:00:00.000Z');
  });

  it('uses Atom published and ignores updated', () => {
    const atom = `
      <feed>
        <entry>
          <title>Optech mail</title>
          <link href="https://example.com/optech"/>
          <published>2026-10-01T08:00:00Z</published>
          <updated>2026-10-03T08:00:00Z</updated>
        </entry>
      </feed>
    `;
    const [entry] = parseFeedItems(atom);
    expect(entry.publishedAt).toBe('2026-10-01T08:00:00.000Z');
  });

  it('leaves publishedAt null when only updated is present', () => {
    expect(pickPublishedAt(null, '2026-10-03T00:00:00Z')).toBeNull();
    const atom = `
      <feed>
        <entry>
          <title>Reindexed release</title>
          <link href="https://example.com/old"/>
          <updated>2026-10-03T00:00:00Z</updated>
        </entry>
      </feed>
    `;
    const [entry] = parseFeedItems(atom);
    expect(entry.publishedAt).toBeNull();
    expect(entry.updatedAt).toBe('2026-10-03T00:00:00.000Z');
  });
});

describe('Nostr published_at', () => {
  it('prefers the published_at tag over created_at', () => {
    const iso = publishedAtFromNostrEvent({
      created_at: 1_775_000_000,
      tags: [['published_at', '1700000000']],
      content: 'x'.repeat(900),
    });
    expect(iso).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it('rejects a re-saved old long-form post as not fresh', () => {
    const publishedAt = publishedAtFromNostrEvent({
      created_at: Date.parse('2026-10-03T06:00:00Z') / 1000,
      tags: [['published_at', String(Date.parse('2026-09-01T00:00:00Z') / 1000)]],
      content: 'x'.repeat(900),
    });
    expect(isFresh(publishedAt, Date.parse('2026-10-03T06:00:00Z'), 24 * 60 * 60 * 1000)).toBe(false);
  });

  it('requires a minimum content length', () => {
    expect(isUsableLongform({ content: 'short note #bitcoin', tags: [['t', 'bitcoin']] })).toBe(false);
    expect(isUsableLongform({ content: 'long form '.repeat(200), tags: [['t', 'bitcoin']] })).toBe(true);
  });
});

describe('freshness bar and selection', () => {
  const now = new Date('2026-10-03T06:00:00.000Z');

  it('requires two fresh items including one primary', () => {
    expect(passesFreshnessBar([
      item({ url: 'https://a.test/1', title: 'Primary one', trust: 'primary' }),
    ])).toBe(false);
    expect(passesFreshnessBar([
      item({ url: 'https://a.test/1', title: 'Secondary one', trust: 'secondary' }),
      item({ url: 'https://a.test/2', title: 'Secondary two', trust: 'secondary' }),
    ])).toBe(false);
    expect(passesFreshnessBar([
      item({ url: 'https://a.test/1', title: 'Primary one', trust: 'primary' }),
      item({ url: 'https://a.test/2', title: 'Secondary two', trust: 'secondary' }),
    ])).toBe(true);
  });

  it('widens to 72 hours after 7 stale days', () => {
    expect(freshnessWindowMs(6)).toBe(24 * 60 * 60 * 1000);
    expect(freshnessWindowMs(7)).toBe(72 * 60 * 60 * 1000);
  });

  it('excludes already-used URLs', () => {
    const kept = excludeUsedUrls([
      item({ url: 'https://a.test/story?utm_source=x', title: 'Story' }),
      item({ url: 'https://a.test/other', title: 'Other' }),
    ], ['https://a.test/story']);
    expect(kept.map((row) => row.url)).toEqual(['https://a.test/other']);
  });

  it('assigns a story to a single section', () => {
    const assigned = assignSingleSection([
      item({ url: 'https://a.test/one', title: 'ETF inflows hit a record high this week', section: 'market' }),
      item({ url: 'https://b.test/one', title: 'ETF inflows hit a record high this week as funds buy', section: 'opinion' }),
      item({ url: 'https://c.test/dev', title: 'Bitcoin Core 30 release notes', section: 'development' }),
    ]);
    expect(assigned).toHaveLength(2);
    expect(assigned[0].section).toBe('market');
    expect(assigned[1].section).toBe('development');
  });

  it('drops stale items unless the 72-hour window is open', () => {
    const items = [
      item({
        url: 'https://a.test/old',
        title: 'Primary one about mining difficulty',
        publishedAt: '2026-10-01T12:00:00.000Z',
        trust: 'primary',
      }),
      item({
        url: 'https://a.test/older',
        title: 'Secondary two about miner capitulation',
        publishedAt: '2026-10-01T13:00:00.000Z',
        trust: 'secondary',
      }),
    ];
    const tight = selectSectionCandidates(items, {
      now,
      usedUrls: [],
      daysSinceLastPublish: 1,
      section: 'market',
    });
    expect(tight.clearsBar).toBe(false);

    const wide = selectSectionCandidates(items, {
      now,
      usedUrls: [],
      daysSinceLastPublish: 8,
      section: 'market',
    });
    expect(wide.clearsBar).toBe(true);
  });
});

describe('front-page grouping', () => {
  it('keeps the newest article per section and preserves carried-over dates', () => {
    const { lead, archive } = groupFrontPage([
      { id: '1', slug: 'bitcoin-market-2026-10-03', headline: 'Today market', summary: '', labels: [], published_at: '2026-10-03T06:00:00.000Z', section: 'market' },
      { id: '2', slug: 'bitcoin-market-2026-10-02', headline: 'Yesterday market', summary: '', labels: [], published_at: '2026-10-02T06:00:00.000Z', section: 'market' },
      { id: '3', slug: 'bitcoin-development-2026-09-28', headline: 'Old development', summary: '', labels: [], published_at: '2026-09-28T06:00:00.000Z', section: 'development' },
    ]);
    expect(lead.market?.slug).toBe('bitcoin-market-2026-10-03');
    expect(lead.development?.slug).toBe('bitcoin-development-2026-09-28');
    expect(lead.development?.published_at).toBe('2026-09-28T06:00:00.000Z');
    expect(archive.map((row) => row.slug)).toEqual(['bitcoin-market-2026-10-02']);
    expect(relativeAgeLabel('2026-09-28T06:00:00.000Z', new Date('2026-10-03T06:00:00.000Z'))).toBe('5 days ago');
  });
});
