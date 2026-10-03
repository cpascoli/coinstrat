import { scoreBottomAccumulation } from '../../../src/utils/bottomScore';

export interface DatedValue {
  date: string;
  value: number;
}

export interface BackfillRow {
  Date: string;
  [key: string]: unknown;
}

/**
 * ISM Manufacturing PMI prints missing from the cache because the Investing.com
 * fetch has been failing. Dates are the first US business day of the following
 * month, matching how earlier prints are stored.
 * July 2026 = 55.6 (released 3 Aug). August 2026 = 54.6 (released 1 Sep).
 */
export const ISM_MANUFACTURING_BACKFILL: DatedValue[] = [
  { date: '2026-08-03', value: 55.6 },
  { date: '2026-09-01', value: 54.6 },
];
/**
 * Last day the August print applies. The September print was released on
 * 2026-10-01; forward-filling past this date would overwrite real later prints.
 */
export const ISM_BACKFILL_TO = '2026-09-30';

/** LTH NUPL was forward-filled flat at 0.37 across this week. */
export const LTH_NUPL_BACKFILL_FROM = '2026-08-28';
export const LTH_NUPL_BACKFILL_TO = '2026-09-04';

/** Addresses-in-profit was stuck at 54.9 while BGeometrics profit_loss moved. */
export const SIP_BACKFILL_FROM = '2026-07-28';
export const SIP_BACKFILL_TO = '2026-08-16';

const VALUE_EPSILON = 1e-4;

const BOTTOM_FIELDS = [
  ['BOTTOM_ONCHAIN_SCORE', 'onchainValue'],
  ['BOTTOM_CAPITULATION_SCORE', 'capitulation'],
  ['BOTTOM_LIQUIDITY_SCORE', 'liquidityTurn'],
  ['BOTTOM_MACRO_SCORE', 'macroRisk'],
  ['BOTTOM_PRICE_SETUP_SCORE', 'priceSetup'],
  ['BOTTOM_PRICE_REPAIR_SCORE', 'priceRepair'],
  ['BOTTOM_STRUCTURE_SCORE', 'priceStructure'],
  ['BOTTOM_ACCUM_SCORE', 'total'],
  ['BOTTOM_ACCUM_BAND', 'band'],
  ['BOTTOM_DEPLOYMENT_RANGE', 'deployment'],
] as const;

export interface ChartBackfillCounts {
  rows: BackfillRow[];
  ismPatched: number;
  lthNuplPatched: number;
  sipPatched: number;
  bottomPatched: number;
}

export function forwardFillOnDates(dates: string[], series: DatedValue[]): Map<string, number> {
  const points = new Map<string, number>();
  for (const point of series) {
    if (Number.isFinite(point.value)) points.set(point.date, point.value);
  }

  let last = Number.NaN;
  const filled = new Map<string, number>();
  for (const date of dates) {
    const value = points.get(date);
    if (value !== undefined) last = value;
    if (Number.isFinite(last)) filled.set(date, last);
  }
  return filled;
}

function valuesDiffer(current: unknown, next: number): boolean {
  return typeof current !== 'number' || !Number.isFinite(current) || Math.abs(current - next) > VALUE_EPSILON;
}

function inWindow(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

function withBottomScore(row: BackfillRow): { row: BackfillRow; changed: boolean } {
  const bottom = scoreBottomAccumulation(row);
  const next: BackfillRow = { ...row };
  let changed = false;
  for (const [field, key] of BOTTOM_FIELDS) {
    const value = bottom[key];
    if (next[field] !== value) {
      next[field] = value;
      changed = true;
    }
  }
  return { row: next, changed };
}

/**
 * Patch three known cache holes without rewriting the rest of each series.
 * ISM uses the published monthly prints. LTH NUPL and addresses-in-profit use
 * the BGeometrics files the refresh already fetches, forward-filled onto the
 * cache calendar, and only inside the dates that were stuck.
 */
export function applyChartGapBackfill(
  rows: BackfillRow[],
  input: {
    lthNupl: DatedValue[];
    profitLoss: DatedValue[];
    ismReleases?: DatedValue[];
  },
): ChartBackfillCounts {
  const dates = rows.map((row) => row.Date);
  const ismReleases = input.ismReleases ?? ISM_MANUFACTURING_BACKFILL;
  const ismStart = ismReleases[0]?.date ?? ISM_MANUFACTURING_BACKFILL[0].date;
  const ismFilled = forwardFillOnDates(dates, ismReleases);
  const nuplFilled = forwardFillOnDates(dates, input.lthNupl);
  const sipFilled = forwardFillOnDates(dates, input.profitLoss);

  let ismPatched = 0;
  let lthNuplPatched = 0;
  let sipPatched = 0;
  let bottomPatched = 0;

  const nextRows = rows.map((row) => {
    let next: BackfillRow = row;
    const date = row.Date;

    // Bottom score reads both ISM (macro sub-score) and SIP (on-chain), so
    // rescore when either one changes.
    let rescore = false;

    const ism = ismFilled.get(date);
    if (inWindow(date, ismStart, ISM_BACKFILL_TO) && ism !== undefined && valuesDiffer(row.ISM_PMI, ism)) {
      next = { ...next, ISM_PMI: ism };
      ismPatched += 1;
      rescore = true;
    }

    if (inWindow(date, LTH_NUPL_BACKFILL_FROM, LTH_NUPL_BACKFILL_TO)) {
      const nupl = nuplFilled.get(date);
      if (nupl !== undefined && valuesDiffer(row.LTH_NUPL, nupl)) {
        next = { ...next, LTH_NUPL: nupl };
        lthNuplPatched += 1;
      }
    }

    if (inWindow(date, SIP_BACKFILL_FROM, SIP_BACKFILL_TO)) {
      const sip = sipFilled.get(date);
      if (sip !== undefined && valuesDiffer(row.SIP, sip)) {
        next = { ...next, SIP: sip };
        sipPatched += 1;
        rescore = true;
      }
    }

    if (rescore) {
      const scored = withBottomScore(next);
      if (scored.changed) {
        next = scored.row;
        bottomPatched += 1;
      }
    }

    return next;
  });

  return { rows: nextRows, ismPatched, lthNuplPatched, sipPatched, bottomPatched };
}
