import { describe, expect, it } from 'vitest';

// newsletter.ts transitively instantiates the Supabase service client at module
// load, so the env vars must exist before the (dynamic) import below runs.
process.env.SUPABASE_URL ??= 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'stub-service-role-key';
process.env.SUPABASE_ANON_KEY ??= 'stub-anon-key';
process.env.VITE_SUPABASE_URL ??= 'https://stub.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY ??= 'stub-anon-key';
process.env.RESEND_API_KEY ??= 'stub-resend-key';

const { classifyNewsTopic, selectWeeklyStories, isNearDuplicateTitle } = await import(
  '../netlify/functions/lib/newsletter'
);

type NewsTopic = import('../netlify/functions/lib/newsletter').NewsTopic;

function candidate(title: string, topic: NewsTopic, summary = '') {
  return {
    title,
    url: `https://example.com/${encodeURIComponent(title)}`,
    source: 'Example',
    summary,
    publishedAt: null,
    topic,
  };
}

const DISTINCT_MARKET_TITLES = [
  'Spot ETF inflows hit a monthly record as macro pressure eases',
  'Public miner expands hash rate with new Texas facility',
  'Sovereign wealth fund discloses first Bitcoin allocation',
  'Senate committee schedules hearing on digital asset regulation',
  'Corporate treasurer survey shows growing appetite for BTC reserves',
  'Derivatives open interest climbs while funding rates stay muted',
  'Japanese conglomerate issues bonds to finance BTC purchases',
  'Custody bank wins approval to hold Bitcoin for pension clients',
  'Options market prices in tighter range ahead of Fed decision',
  'European exchange lists its first Bitcoin yield product',
];

describe('isNearDuplicateTitle', () => {
  it('flags the same story written up by two outlets', () => {
    const a = 'Strategy adds 5,000 BTC to its treasury in latest purchase - CoinDesk';
    const b = 'Strategy buys another 5,000 BTC for corporate treasury - Cointelegraph';
    expect(isNearDuplicateTitle(a, b)).toBe(true);
  });

  it('keeps unrelated stories apart', () => {
    const a = 'Bitcoin Core 30 release adds mempool policy changes';
    const b = 'Spot ETF inflows hit a monthly record as macro eases';
    expect(isNearDuplicateTitle(a, b)).toBe(false);
  });
});

describe('classifyNewsTopic', () => {
  it('classifies by keywords over the query-topic fallback', () => {
    const dev = candidate('New soft fork proposal lands for Bitcoin Core review', 'markets');
    expect(classifyNewsTopic(dev, 'markets')).toBe('development');

    const culture = candidate('Community conference brings Bitcoin education to Nairobi', 'markets');
    expect(classifyNewsTopic(culture, 'markets')).toBe('culture');
  });

  it('falls back to the query topic when nothing matches', () => {
    const vague = candidate('A quiet week', 'culture');
    expect(classifyNewsTopic(vague, 'culture')).toBe('culture');
  });
});

describe('selectWeeklyStories', () => {
  it('drops near-duplicate stories from different outlets', () => {
    const picked = selectWeeklyStories([
      candidate('Strategy adds 5,000 BTC to its treasury in latest purchase', 'markets'),
      candidate('Strategy buys another 5,000 BTC for corporate treasury', 'markets'),
      candidate('Lightning Network capacity reaches new all-time high', 'development'),
    ]);

    const treasuryStories = picked.filter((story) => story.title.includes('5,000'));
    expect(treasuryStories).toHaveLength(1);
  });

  it('enforces topic quotas and interleaves topics at the head of the list', () => {
    const markets = DISTINCT_MARKET_TITLES.slice(0, 6).map((title) => candidate(title, 'markets'));
    const dev = [
      candidate('Bitcoin Core ships new mempool policy release', 'development'),
      candidate('Covenant soft fork proposal enters developer review', 'development'),
      candidate('Lightning wallet adds privacy-preserving payment routing', 'development'),
    ];
    const culture = [
      candidate('Grassroots circular economy grows in coastal town', 'culture'),
      candidate('Documentary on mining communities premieres at festival', 'culture'),
      candidate('Human rights foundation funds education workshops abroad', 'culture'),
    ];

    const picked = selectWeeklyStories([...markets, ...dev, ...culture]);

    expect(picked).toHaveLength(10);
    expect(picked.filter((s) => s.topic === 'markets')).toHaveLength(4);
    expect(picked.filter((s) => s.topic === 'development')).toHaveLength(3);
    expect(picked.filter((s) => s.topic === 'culture')).toHaveLength(3);
    // Head of the list (which gets excerpt enrichment) spans all three topics.
    expect(new Set(picked.slice(0, 3).map((s) => s.topic)).size).toBe(3);
  });

  it('backfills from other topics when a bucket is thin', () => {
    const markets = DISTINCT_MARKET_TITLES.map((title) => candidate(title, 'markets'));

    const picked = selectWeeklyStories(markets);

    expect(picked).toHaveLength(10);
    expect(picked.every((s) => s.topic === 'markets')).toBe(true);
  });
});
