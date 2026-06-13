import { describe, it, expect } from 'vitest';
import {
  computeCqmDynamicTrade,
  CQM_DEFAULT_MAX_CASH_FRACTION,
  CQM_DEFAULT_SELL_THRESHOLD,
} from '../src/utils/cqmSizing';

describe('computeCqmDynamicTrade', () => {
  const base = 100;

  it('at Risk 0 deploys at least base and can use cash fraction', () => {
    const r = computeCqmDynamicTrade({
      baseAmount: base,
      risk: 0,
      cashBalance: 50_000,
      btcHeld: 0,
      btcPrice: 60_000,
    });
    expect(r.buyAmount).toBeCloseTo(0.06 * 50_000, 6);
    expect(r.sellAmount).toBe(0);
  });

  it('at Risk 0.5 does nothing (dead zone start)', () => {
    const r = computeCqmDynamicTrade({
      baseAmount: base,
      risk: 0.5,
      cashBalance: 50_000,
      btcHeld: 1,
      btcPrice: 60_000,
    });
    expect(r.buyAmount).toBe(0);
    expect(r.sellAmount).toBe(0);
  });

  it('holds in dead zone between 50% and sell threshold', () => {
    const r = computeCqmDynamicTrade({
      baseAmount: base,
      risk: 0.65,
      cashBalance: 10_000,
      btcHeld: 2,
      btcPrice: 60_000,
      sellThreshold: CQM_DEFAULT_SELL_THRESHOLD,
    });
    expect(r.buyAmount).toBe(0);
    expect(r.sellAmount).toBe(0);
  });

  it('sells above sell threshold, scaled to full size at Risk 1', () => {
    const r = computeCqmDynamicTrade({
      baseAmount: base,
      risk: 1,
      cashBalance: 0,
      btcHeld: 2,
      btcPrice: 60_000,
      sellThreshold: 0.75,
    });
    expect(r.buyAmount).toBe(0);
    expect(r.sellAmount).toBeCloseTo(Math.max(base, 0.01 * 2 * 60_000), 6);
  });

  it('buy-only when sellThreshold is 1', () => {
    const r = computeCqmDynamicTrade({
      baseAmount: base,
      risk: 0.9,
      cashBalance: 5_000,
      btcHeld: 1,
      btcPrice: 60_000,
      sellThreshold: 1,
    });
    expect(r.sellAmount).toBe(0);
  });

  it('uses tuned defaults', () => {
    const r = computeCqmDynamicTrade({
      baseAmount: base,
      risk: 0,
      cashBalance: 10_000,
      btcHeld: 0,
      btcPrice: 50_000,
    });
    expect(r.buyAmount).toBeCloseTo(CQM_DEFAULT_MAX_CASH_FRACTION * 10_000, 6);
  });
});
