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
