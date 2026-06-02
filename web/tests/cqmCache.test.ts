import { describe, expect, it } from 'vitest';

import {
  applyCqmFieldsToRows,
  buildCqmFieldMap,
} from '../netlify/functions/lib/cqmCache';
import {
  buildCqmWeeklyBlockFromRows,
  extractCqmSnapshotFromRow,
} from '../netlify/functions/lib/cqmSnapshot';
import { fitCQM } from '../src/utils/cqm';

describe('CQM cache helpers', () => {
  it('writes CQM fields onto matching signal rows', () => {
    const points = Array.from({ length: 400 }, (_, i) => {
      const date = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
      return { date, ts: new Date(`${date}T00:00:00Z`).getTime(), price: 50_000 + i };
    });
    const fit = fitCQM(points);
    const rows = points.slice(-3).map((point) => ({
      Date: point.date,
      BTCUSD: point.price,
    }));

    const patched = applyCqmFieldsToRows(rows, fit);
    expect(patched.patched).toBe(3);
    expect(Number(patched.rows[2].CQM_RISK)).toBeGreaterThan(0);
    expect(Number(patched.rows[2].CQM_RISK)).toBeLessThanOrEqual(1);
    expect(Number.isFinite(Number(patched.rows[2].CQM_SCORE))).toBe(true);
    expect(Number.isFinite(Number(patched.rows[2].CQM_QR_MEDIAN))).toBe(true);
  });

  it('builds a field map keyed by signal date', () => {
    const points = Array.from({ length: 400 }, (_, i) => {
      const date = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
      return { date, ts: new Date(`${date}T00:00:00Z`).getTime(), price: 40_000 + i * 10 };
    });
    const fit = fitCQM(points);
    const fieldMap = buildCqmFieldMap(fit);
    const latestDate = points[points.length - 1].date;
    expect(fieldMap.has(latestDate)).toBe(true);
  });
});

describe('CQM weekly block from cached rows', () => {
  it('compares current vs previous week using cached CQM fields', () => {
    const current = extractCqmSnapshotFromRow({
      Date: '2026-05-30',
      BTCUSD: 73_600,
      CQM_RISK: 0.27,
      CQM_SCORE: 0.14,
      CQM_QR_MEDIAN: 121_000,
      CQM_SOLID_MEDIAN: 118_000,
    });
    const previous = extractCqmSnapshotFromRow({
      Date: '2026-05-23',
      BTCUSD: 72_000,
      CQM_RISK: 0.28,
      CQM_SCORE: 0.13,
      CQM_QR_MEDIAN: 120_000,
      CQM_SOLID_MEDIAN: 117_000,
    });

    expect(current?.risk).toBe(0.27);
    expect(previous?.risk).toBe(0.28);

    const block = buildCqmWeeklyBlockFromRows(
      {
        Date: '2026-05-30',
        BTCUSD: 73_600,
        CQM_RISK: 0.27,
        CQM_SCORE: 0.14,
        CQM_QR_MEDIAN: 121_000,
      },
      {
        Date: '2026-05-23',
        BTCUSD: 72_000,
        CQM_RISK: 0.28,
        CQM_SCORE: 0.13,
        CQM_QR_MEDIAN: 120_000,
      },
    );

    expect(block.deltas.risk).toBeCloseTo(-0.01, 5);
    expect(block.dcaHint?.impliedBuyGbp).toBe(46);
    expect(block.dcaHint?.previousBuyGbp).toBe(44);
  });
});
