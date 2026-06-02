import { describe, it } from 'vitest';
import { runCqmBotAnchorBacktest } from '../scripts/cqm-bot-backtest-anchors.mts';

describe('CQM bot anchor backtest (report)', () => {
  it('prints returns for cycle anchors, bot live start, and both sizing variants', () => {
    runCqmBotAnchorBacktest();
  });
});
