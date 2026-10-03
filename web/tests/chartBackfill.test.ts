import { describe, expect, it } from 'vitest';
import {
  ISM_BACKFILL_TO,
  ISM_MANUFACTURING_BACKFILL,
  LTH_NUPL_BACKFILL_FROM,
  LTH_NUPL_BACKFILL_TO,
  SIP_BACKFILL_FROM,
  SIP_BACKFILL_TO,
  applyChartGapBackfill,
  type BackfillRow,
} from '../netlify/functions/lib/chartBackfill';
import { scoreBottomAccumulation } from '../src/utils/bottomScore';

function days(from: string, to: string, fill: (date: string) => Partial<BackfillRow>): BackfillRow[] {
  const rows: BackfillRow[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    rows.push({ Date: date, ISM_PMI: 53.3, LTH_NUPL: 0.37, SIP: 54.9, ...fill(date) });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return rows;
}

describe('applyChartGapBackfill', () => {
  const rows = days('2026-07-01', '2026-10-05', (date) => ({
    SIP: date < '2026-07-28' ? 67.2 : date >= '2026-08-17' ? 48.59 : 54.9,
    LTH_NUPL: date < '2026-08-28' ? 0.3901 : date > '2026-09-04' ? 0.3886 : 0.37,
    // A real September print (released 2026-10-01) is already in the cache.
    ISM_PMI: date >= '2026-10-01' ? 52.1 : 53.3,
    BTCUSD: 100000,
    LTH_SOPR: 1,
    MVRV: 1.5,
  }));

  const lthNupl = [
    { date: '2026-08-28', value: 0.37 },
    { date: '2026-08-29', value: 0.3748 },
    { date: '2026-09-04', value: 0.3877 },
    { date: '2026-09-05', value: 0.3886 },
  ];
  const profitLoss = [
    { date: '2026-07-27', value: 70 },
    { date: '2026-07-28', value: 41.2 },
    { date: '2026-08-16', value: 40.77 },
    { date: '2026-08-17', value: 48.59 },
  ];

  const result = applyChartGapBackfill(rows, { lthNupl, profitLoss });
  const byDate = new Map(result.rows.map((row) => [row.Date, row]));

  it('writes the July and August ISM prints from their release dates', () => {
    expect(ISM_MANUFACTURING_BACKFILL).toEqual([
      { date: '2026-08-03', value: 55.6 },
      { date: '2026-09-01', value: 54.6 },
    ]);
    expect(byDate.get('2026-08-02')?.ISM_PMI).toBe(53.3);
    expect(byDate.get('2026-08-03')?.ISM_PMI).toBe(55.6);
    expect(byDate.get('2026-08-31')?.ISM_PMI).toBe(55.6);
    expect(byDate.get('2026-09-01')?.ISM_PMI).toBe(54.6);
    expect(byDate.get('2026-09-30')?.ISM_PMI).toBe(54.6);
    expect(ISM_BACKFILL_TO).toBe('2026-09-30');
  });

  it('leaves ISM prints after the backfill window untouched', () => {
    expect(byDate.get('2026-10-01')?.ISM_PMI).toBe(52.1);
    expect(byDate.get('2026-10-05')?.ISM_PMI).toBe(52.1);
  });

  it('rescores bottom accumulation on ISM-only patched rows', () => {
    // 2026-09-10 is outside the SIP window, so only ISM changed there.
    const after = byDate.get('2026-09-10')!;
    const expected = scoreBottomAccumulation(after);
    expect(after.ISM_PMI).toBe(54.6);
    expect(after.BOTTOM_MACRO_SCORE).toBe(expected.macroRisk);
    expect(after.BOTTOM_ACCUM_SCORE).toBe(expected.total);
    // Untouched rows are not rescored.
    expect(byDate.get('2026-10-03')).toBe(rows.find((r) => r.Date === '2026-10-03'));
  });

  it('replaces the flat LTH NUPL week and leaves the surrounding days', () => {
    expect(byDate.get('2026-08-27')?.LTH_NUPL).toBe(0.3901);
    expect(byDate.get('2026-08-28')?.LTH_NUPL).toBe(0.37);
    expect(byDate.get('2026-08-29')?.LTH_NUPL).toBe(0.3748);
    expect(byDate.get('2026-09-03')?.LTH_NUPL).toBe(0.3748);
    expect(byDate.get('2026-09-04')?.LTH_NUPL).toBe(0.3877);
    expect(byDate.get('2026-09-05')?.LTH_NUPL).toBe(0.3886);
    expect(LTH_NUPL_BACKFILL_FROM).toBe('2026-08-28');
    expect(LTH_NUPL_BACKFILL_TO).toBe('2026-09-04');
  });

  it('fills the stuck addresses-in-profit stretch from profit_loss', () => {
    expect(byDate.get('2026-07-27')?.SIP).toBe(67.2);
    expect(byDate.get('2026-07-28')?.SIP).toBe(41.2);
    expect(byDate.get('2026-08-15')?.SIP).toBe(41.2);
    expect(byDate.get('2026-08-16')?.SIP).toBe(40.77);
    expect(byDate.get('2026-08-17')?.SIP).toBe(48.59);
    expect(SIP_BACKFILL_FROM).toBe('2026-07-28');
    expect(SIP_BACKFILL_TO).toBe('2026-08-16');
  });

  it('counts only the rows that actually changed', () => {
    expect(result.ismPatched).toBe(59); // 2026-08-03 → 2026-09-30
    expect(result.lthNuplPatched).toBe(7);
    expect(result.sipPatched).toBe(20);
  });
});
