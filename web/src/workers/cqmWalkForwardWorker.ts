/**
 * Web Worker: computes the causal walk-forward CQM risk map off the main
 * thread (the expanding-window refits take ~1–2 minutes on full BTC history).
 * Posts { type: 'progress', done, total } updates and a final
 * { type: 'result', entries } message with the date → risk pairs.
 */

import {
  buildWalkForwardRiskMap,
  type CqmPricePoint,
  type WalkForwardRiskOptions,
} from '../utils/cqmWalkForward';

export interface WalkForwardWorkerRequest {
  points: CqmPricePoint[];
  options?: Omit<WalkForwardRiskOptions, 'onProgress'>;
}

export type WalkForwardWorkerResponse =
  | { type: 'progress'; done: number; total: number }
  | { type: 'result'; entries: Array<[string, number]> }
  | { type: 'error'; message: string };

const PROGRESS_EVERY_DAYS = 30;

self.onmessage = (event: MessageEvent<WalkForwardWorkerRequest>) => {
  const { points, options } = event.data;
  try {
    let lastReported = 0;
    const map = buildWalkForwardRiskMap(points, {
      ...options,
      onProgress: (done, total) => {
        if (done - lastReported >= PROGRESS_EVERY_DAYS || done === total) {
          lastReported = done;
          const msg: WalkForwardWorkerResponse = { type: 'progress', done, total };
          self.postMessage(msg);
        }
      },
    });
    const msg: WalkForwardWorkerResponse = { type: 'result', entries: Array.from(map.entries()) };
    self.postMessage(msg);
  } catch (err) {
    const msg: WalkForwardWorkerResponse = {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(msg);
  }
};
