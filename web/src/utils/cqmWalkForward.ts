/**
 * Causal (walk-forward) CQM risk — no look-ahead for backtests.
 *
 * At each date t, `fitCQM` runs on prices strictly before t, then
 * `riskForPriceFair` scores the price on that day. Refits every
 * `refitEveryDays` (default 90) to balance fidelity vs speed.
 *
 * Tail calibration uses the model's auto-recalibration (trailing-median
 * anchor), which only looks at history before t — causal by construction,
 * unlike the legacy hand-tuned future anchor.
 */

import { fitCQM, riskForPriceFair, type CQMConfig } from './cqm';

export interface CqmPricePoint {
  date: string;
  ts: number;
  price: number;
}

export interface WalkForwardRiskOptions {
  /** Earliest date to emit risk for (YYYY-MM-DD). Earlier dates are skipped. */
  fromDate?: string;
  /** Calendar days between model refits. Default 90. */
  refitEveryDays?: number;
  /** Extra config passed to each causal fitCQM call. */
  fitConfig?: CQMConfig;
  /** Called after each processed day with (daysDone, daysTotal). */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Earliest date with enough history for a causal fit: fitCQM needs 365 daily
 * prices since its 2014-01-01 default start, so ~2015 is the first viable fit.
 */
export const WALK_FORWARD_DEFAULT_FROM_DATE = '2015-01-01';

const WALK_FORWARD_FIT_CONFIG: CQMConfig = {
  qrAutoCalibrate: true,
};

/**
 * Build a date → risk map using expanding-window walk-forward fits.
 * Dates before `fromDate` are omitted; dates with insufficient history
 * fall back to risk = 0.5.
 */
export function buildWalkForwardRiskMap(
  points: CqmPricePoint[],
  options: WalkForwardRiskOptions = {},
): Map<string, number> {
  const fromDate = options.fromDate ?? WALK_FORWARD_DEFAULT_FROM_DATE;
  const refitEveryDays = Math.max(1, options.refitEveryDays ?? 90);
  const fitConfig = { ...WALK_FORWARD_FIT_CONFIG, ...options.fitConfig };

  let firstIdx = points.length;
  for (let i = 0; i < points.length; i++) {
    if (points[i].date >= fromDate) {
      firstIdx = i;
      break;
    }
  }
  const total = points.length - firstIdx;

  const out = new Map<string, number>();
  let fit: ReturnType<typeof fitCQM> | null = null;
  let daysSinceRefit = Infinity;

  for (let i = firstIdx; i < points.length; i++) {
    const p = points[i];

    if (daysSinceRefit >= refitEveryDays) {
      const history = points.slice(0, i);
      // fitCQM needs ≥365 points after its own startDate filter; let it
      // decide and fall back to neutral risk until enough history exists.
      if (history.length >= 365) {
        try {
          fit = fitCQM(history, fitConfig);
          daysSinceRefit = 0;
        } catch {
          // keep the previous fit (if any); retry at the next refit slot
          daysSinceRefit = 0;
        }
      }
    }
    daysSinceRefit += 1;

    if (!fit) {
      out.set(p.date, 0.5);
      options.onProgress?.(i - firstIdx + 1, total);
      continue;
    }

    let risk = riskForPriceFair(fit, p.ts, p.price);
    if (!Number.isFinite(risk)) risk = 0.5;
    out.set(p.date, Math.max(0, Math.min(1, risk)));
    options.onProgress?.(i - firstIdx + 1, total);
  }

  return out;
}
