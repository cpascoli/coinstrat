/**
 * Shared CQM snapshot helpers for the DCA bot and weekly newsletter.
 *
 * Loads BTCUSD history from the Netlify Blobs signal cache, runs `fitCQM()`
 * (gated 2y risk + asymmetric QR fan — same as in-app charts), and exposes
 * point-in-time snapshots for week-over-week comparisons.
 */

import { signalsStore } from './store';
import { fitCQM, snapshotAt, type CQMFit } from '../../../src/utils/cqm';

export interface BtcPricePoint {
  date: string;
  ts: number;
  price: number;
}

export interface CqmPointSnapshot {
  date: string;
  risk: number;
  score: number;
  price: number;
  qrMedian: number;
  qrDashedMedian: number;
  solidMedian: number;
}

export interface CqmWeeklyBlock {
  current: CqmPointSnapshot | null;
  previousWeek: CqmPointSnapshot | null;
  deltas: {
    risk: number | null;
    score: number | null;
    price: number | null;
  };
  stateChanges: string[];
  dcaHint: {
    baseGbp: number;
    impliedBuyGbp: number;
    previousBuyGbp: number | null;
  } | null;
}

const DEFAULT_DCA_BASE_GBP = 100;

export async function loadBtcPricePoints(): Promise<BtcPricePoint[]> {
  const store = signalsStore();
  const cached = await store.get('signals_latest', { type: 'json' }).catch(() => null) as
    | { data?: unknown[] }
    | null;

  if (!cached?.data || !Array.isArray(cached.data) || cached.data.length === 0) {
    throw new Error('Signal cache is empty — refresh signals before computing CQM.');
  }

  const points: BtcPricePoint[] = [];
  for (const row of cached.data as Array<Record<string, unknown>>) {
    const date = typeof row.Date === 'string' ? row.Date : null;
    const price = Number(row.BTCUSD);
    if (!date || !Number.isFinite(price) || price <= 0) continue;
    const ts = new Date(date).getTime();
    if (!Number.isFinite(ts)) continue;
    points.push({ date, ts, price });
  }

  if (points.length < 365) {
    throw new Error(`CQM fit requires ≥365 days of BTC history; got ${points.length}.`);
  }

  return points;
}

export function cqmSnapshotForDate(fit: CQMFit, date: string): CqmPointSnapshot | null {
  const ts = new Date(`${date}T00:00:00Z`).getTime();
  const snap = snapshotAt(fit, ts);
  if (!snap) return null;

  return {
    date: snap.date,
    risk: Number(snap.risk),
    score: Number(snap.score),
    price: Number(snap.price),
    qrMedian: Number(snap.qrMedian),
    qrDashedMedian: Number(snap.qrDashedMedian),
    solidMedian: Number(snap.solidMedian),
  };
}

export function riskBucketLabel(risk: number): string {
  const pct = risk * 100;
  if (pct < 25) return 'Cool';
  if (pct < 50) return 'Warm';
  if (pct < 75) return 'Hot';
  return 'Euphoric';
}

export function impliedDailyBuyGbp(baseGbp: number, risk: number): number {
  return Math.max(0, Math.round(baseGbp * (1 - 2 * risk) * 100) / 100);
}

function detectCqmStateChanges(
  current: CqmPointSnapshot,
  previous: CqmPointSnapshot | null,
): string[] {
  if (!previous) return [];

  const changes: string[] = [];
  const currBucket = riskBucketLabel(current.risk);
  const prevBucket = riskBucketLabel(previous.risk);
  if (currBucket !== prevBucket) {
    changes.push(`CQM risk bucket moved from ${prevBucket} to ${currBucket}.`);
  }

  const riskDeltaPp = (current.risk - previous.risk) * 100;
  if (Math.abs(riskDeltaPp) >= 5) {
    changes.push(`CQM risk moved ${riskDeltaPp > 0 ? '+' : ''}${riskDeltaPp.toFixed(1)} pp week-over-week.`);
  }

  const currAboveQr = current.price >= current.qrDashedMedian;
  const prevAboveQr = previous.price >= previous.qrDashedMedian;
  if (currAboveQr !== prevAboveQr) {
    changes.push(
      currAboveQr
        ? 'BTC crossed above the QR 50% fair-value trend line.'
        : 'BTC crossed below the QR 50% fair-value trend line.',
    );
  }

  return changes;
}

export interface CachedCqmRow {
  Date?: string;
  BTCUSD?: number;
  CQM_RISK?: number;
  CQM_SCORE?: number;
  CQM_QR_MEDIAN?: number;
  CQM_SOLID_MEDIAN?: number;
}

export function extractCqmSnapshotFromRow(
  row: CachedCqmRow | null | undefined,
): CqmPointSnapshot | null {
  if (!row?.Date) return null;

  const risk = Number(row.CQM_RISK);
  if (!Number.isFinite(risk)) return null;

  const price = Number(row.BTCUSD);
  const score = Number(row.CQM_SCORE);
  const qrMedian = Number(row.CQM_QR_MEDIAN);
  const solidMedian = Number(row.CQM_SOLID_MEDIAN);

  return {
    date: row.Date,
    risk,
    score: Number.isFinite(score) ? score : NaN,
    price: Number.isFinite(price) ? price : NaN,
    qrMedian: Number.isFinite(qrMedian) ? qrMedian : NaN,
    qrDashedMedian: Number.isFinite(qrMedian) ? qrMedian : NaN,
    solidMedian: Number.isFinite(solidMedian) ? solidMedian : NaN,
  };
}

function assembleCqmWeeklyBlock(
  current: CqmPointSnapshot | null,
  previousWeek: CqmPointSnapshot | null,
  baseGbp = DEFAULT_DCA_BASE_GBP,
): CqmWeeklyBlock {
  return {
    current,
    previousWeek,
    deltas: {
      risk: current && previousWeek ? current.risk - previousWeek.risk : null,
      score: current && previousWeek && Number.isFinite(current.score) && Number.isFinite(previousWeek.score)
        ? current.score - previousWeek.score
        : null,
      price: current && previousWeek && Number.isFinite(current.price) && Number.isFinite(previousWeek.price)
        ? current.price - previousWeek.price
        : null,
    },
    stateChanges: current ? detectCqmStateChanges(current, previousWeek) : [],
    dcaHint: current
      ? {
        baseGbp,
        impliedBuyGbp: impliedDailyBuyGbp(baseGbp, current.risk),
        previousBuyGbp: previousWeek ? impliedDailyBuyGbp(baseGbp, previousWeek.risk) : null,
      }
      : null,
  };
}

/** Read week-over-week CQM context from precomputed signal-cache fields. */
export function buildCqmWeeklyBlockFromRows(
  currentRow: CachedCqmRow,
  previousRow: CachedCqmRow | null | undefined,
  baseGbp = DEFAULT_DCA_BASE_GBP,
): CqmWeeklyBlock {
  return assembleCqmWeeklyBlock(
    extractCqmSnapshotFromRow(currentRow),
    previousRow ? extractCqmSnapshotFromRow(previousRow) : null,
    baseGbp,
  );
}

export async function buildCqmWeeklyBlock(
  currentDate: string,
  previousDate: string | null,
  baseGbp = DEFAULT_DCA_BASE_GBP,
): Promise<CqmWeeklyBlock> {
  const points = await loadBtcPricePoints();
  const fit = fitCQM(points);
  const current = cqmSnapshotForDate(fit, currentDate);
  const previousWeek = previousDate ? cqmSnapshotForDate(fit, previousDate) : null;

  return assembleCqmWeeklyBlock(current, previousWeek, baseGbp);
}
