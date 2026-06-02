import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
const mockStoreGet = vi.fn().mockResolvedValue(null);
const mockStoreSetJSON = vi.fn().mockResolvedValue(undefined);

vi.mock('node-fetch', () => ({
  default: (...args: unknown[]) => mockFetch(...args),
}));

vi.mock('../netlify/functions/lib/store', () => ({
  signalsStore: () => ({
    get: mockStoreGet,
    setJSON: mockStoreSetJSON,
  }),
}));

describe('fetchFredSeriesBatch', () => {
  beforeEach(() => {
    vi.stubEnv('FRED_API_KEY', 'test-key');
    mockFetch.mockReset();
    mockStoreGet.mockReset();
    mockStoreGet.mockResolvedValue(null);
    mockStoreSetJSON.mockReset();
    mockStoreSetJSON.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns empty arrays for failed series without throwing', async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue({ ok: false, status: 429 });

    const { fetchFredSeriesBatch } = await import('../netlify/functions/lib/fredClient');
    const resultPromise = fetchFredSeriesBatch(['WALCL', 'WTREGEN']);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.get('WALCL')).toEqual([]);
    expect(result.get('WTREGEN')).toEqual([]);
    vi.useRealTimers();
  });

  it('parses successful FRED observations', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          observations: [
            { date: '2026-05-30', value: '123.4' },
            { date: '2026-05-31', value: '.' },
          ],
        }),
    });

    const { fetchFredSeriesBatch } = await import('../netlify/functions/lib/fredClient');
    const result = await fetchFredSeriesBatch(['WALCL']);

    expect(result.get('WALCL')).toEqual([{ date: '2026-05-30', value: 123.4 }]);
    expect(mockStoreSetJSON).toHaveBeenCalled();
  });
});
