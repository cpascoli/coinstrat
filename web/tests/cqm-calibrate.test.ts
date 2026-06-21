/**
 * Runner for the CQM risk-mapping calibration harness.
 * Gated behind CQM_CALIB=1 so it never runs in normal CI.
 *
 *   CQM_CALIB=1 npx vitest run tests/cqm-calibrate.test.ts
 *   CQM_CALIB=1 CQM_CALIB_REFRESH=1 npx vitest run tests/cqm-calibrate.test.ts
 */
import { describe, it } from 'vitest';
import { runCqmCalibration, runCqmScenarioStress } from '../scripts/cqm-calibrate.mts';

describe('CQM mapping calibration', () => {
  it.runIf(process.env.CQM_CALIB === '1')('walk-forward sweep', () => {
    runCqmCalibration();
  }, 1_800_000);

  it.runIf(process.env.CQM_CALIB === '1')('forward scenario stress', () => {
    runCqmScenarioStress();
  }, 1_800_000);
});
