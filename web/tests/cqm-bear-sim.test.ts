import { describe, it } from 'vitest';
import { runCqmBearSim } from '../scripts/cqm-bear-sim.mts';

describe('CQM bear/bull forward simulation (report)', () => {
  it('prints mid-bear and deep-bear accumulation + bull-cycle projection', () => {
    runCqmBearSim();
  });
});
