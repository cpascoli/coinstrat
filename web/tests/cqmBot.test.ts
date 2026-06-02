import { describe, expect, it, vi } from 'vitest';

vi.mock('../netlify/functions/lib/auth', () => ({
  serviceSupabase: {},
}));

describe('CQM bot frequency guard', () => {
  it('allows a daily scheduled run inside the small cron drift grace window', async () => {
    const { computeFrequencyGuard } = await import('../netlify/functions/lib/cqmBot');
    const guard = computeFrequencyGuard(
      'daily',
      {
        triggered_at: '2026-05-27T11:37:26.396Z',
      } as any,
      new Date('2026-05-28T11:37:00.000Z'),
    );

    expect(guard.canExecute).toBe(true);
    expect(guard.nextSlotAt).toBe('2026-05-28T11:37:26.396Z');
  });

  it('still blocks runs that are materially earlier than the configured cadence', async () => {
    const { computeFrequencyGuard } = await import('../netlify/functions/lib/cqmBot');
    const guard = computeFrequencyGuard(
      'daily',
      {
        triggered_at: '2026-05-27T11:37:26.396Z',
      } as any,
      new Date('2026-05-28T11:31:00.000Z'),
    );

    expect(guard.canExecute).toBe(false);
  });
});

describe('CQM bot execution lease date', () => {
  it('uses today when there is no prior order', async () => {
    const { computeExecutionLeaseDate } = await import('../netlify/functions/lib/cqmBot');
    const date = computeExecutionLeaseDate('daily', null, new Date('2026-05-31T00:08:51.000Z'));
    expect(date).toBe('2026-05-31');
  });

  it('uses the UTC date of the next cadence slot for concurrent dedupe', async () => {
    const { computeExecutionLeaseDate } = await import('../netlify/functions/lib/cqmBot');
    const lastOrder = { triggered_at: '2026-05-30T00:08:55.991701+00:00' } as any;
    const date = computeExecutionLeaseDate(
      'daily',
      lastOrder,
      new Date('2026-05-31T00:08:51.000Z'),
    );
    expect(date).toBe('2026-05-31');
  });

  it('matches the same lease date for overlapping invocations on the same slot', async () => {
    const { computeExecutionLeaseDate } = await import('../netlify/functions/lib/cqmBot');
    const lastOrder = { triggered_at: '2026-05-30T00:08:55.991701+00:00' } as any;
    const first = computeExecutionLeaseDate(
      'daily',
      lastOrder,
      new Date('2026-05-31T00:08:35.000Z'),
    );
    const second = computeExecutionLeaseDate(
      'daily',
      lastOrder,
      new Date('2026-05-31T00:08:51.000Z'),
    );
    expect(first).toBe(second);
    expect(first).toBe('2026-05-31');
  });
});
