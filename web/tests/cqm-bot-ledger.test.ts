import { describe, it, expect } from 'vitest';
import {
  computeVirtualBalances,
  type LedgerOrderRow,
} from '../netlify/functions/lib/cqmLedger';
import { computeCqmDynamicTrade } from '../src/utils/cqmSizing';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-13T00:00:30Z');
const SETTINGS = { base_amount_gbp: 100, frequency: 'daily' as const };

function order(overrides: Partial<LedgerOrderRow>): LedgerOrderRow {
  return {
    side: 'BUY',
    triggered_at: NOW.toISOString(),
    coinbase_status: 'filled',
    target_amount_gbp: 100,
    btc_gbp_ref: 50_000,
    base_filled: null,
    quote_filled: null,
    fees_gbp: null,
    ...overrides,
  };
}

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * DAY_MS).toISOString();
}

describe('computeVirtualBalances', () => {
  it('with no orders, cash is one base deposit (current slot)', () => {
    const b = computeVirtualBalances([], SETTINGS, NOW);
    expect(b.periodsAccrued).toBe(1);
    expect(b.depositsGbp).toBe(100);
    expect(b.cashGbp).toBe(100);
    expect(b.btcHeld).toBe(0);
  });

  it('accrues one deposit per cadence slot since the first executed order', () => {
    const orders = [
      order({ triggered_at: daysAgo(10), quote_filled: 99.5, fees_gbp: 0.5, base_filled: 0.002 }),
    ];
    const b = computeVirtualBalances(orders, SETTINGS, NOW);
    // First order 10 days ago → 11 slots including today.
    expect(b.periodsAccrued).toBe(11);
    expect(b.depositsGbp).toBe(1100);
    expect(b.buysGbp).toBe(100); // quote + fees
    expect(b.cashGbp).toBe(1000);
    expect(b.btcHeld).toBeCloseTo(0.002, 10);
  });

  it('weekly cadence accrues per week', () => {
    const orders = [order({ triggered_at: daysAgo(15), quote_filled: 100, fees_gbp: 0 })];
    const b = computeVirtualBalances(
      orders,
      { base_amount_gbp: 200, frequency: 'weekly' },
      NOW,
    );
    // 15 days = 2 full weeks elapsed → 3 slots including the current one.
    expect(b.periodsAccrued).toBe(3);
    expect(b.depositsGbp).toBe(600);
    expect(b.cashGbp).toBe(500);
  });

  it('credits sell proceeds net of fees and reduces BTC held', () => {
    const orders = [
      order({ triggered_at: daysAgo(5), quote_filled: 99, fees_gbp: 1, base_filled: 0.004 }),
      order({
        side: 'SELL',
        triggered_at: daysAgo(2),
        quote_filled: 150,
        fees_gbp: 2,
        base_filled: 0.001,
      }),
    ];
    const b = computeVirtualBalances(orders, SETTINGS, NOW);
    expect(b.buysGbp).toBe(100);
    expect(b.sellsGbp).toBe(148);
    expect(b.depositsGbp).toBe(600); // 6 slots
    expect(b.cashGbp).toBe(648);
    expect(b.btcHeld).toBeCloseTo(0.003, 10);
  });

  it('falls back to target amount and reference price when fills are missing', () => {
    const orders = [
      order({ triggered_at: daysAgo(1), coinbase_status: 'open', target_amount_gbp: 80 }),
    ];
    const b = computeVirtualBalances(orders, SETTINGS, NOW);
    expect(b.buysGbp).toBe(80);
    expect(b.btcHeld).toBeCloseTo(80 / 50_000, 10);
    expect(b.cashGbp).toBe(120); // 2 deposits − 80
  });

  it('ignores pending, cancelled and failed orders', () => {
    const orders = [
      order({ triggered_at: daysAgo(3), coinbase_status: 'pending' }),
      order({ triggered_at: daysAgo(2), coinbase_status: 'cancelled' }),
      order({ triggered_at: daysAgo(1), coinbase_status: 'failed' }),
    ];
    const b = computeVirtualBalances(orders, SETTINGS, NOW);
    expect(b.periodsAccrued).toBe(1); // no executed orders → ledger starts today
    expect(b.buysGbp).toBe(0);
    expect(b.cashGbp).toBe(100);
    expect(b.btcHeld).toBe(0);
  });

  it('never reports negative cash or BTC', () => {
    const orders = [
      // Buy larger than all accrued deposits (e.g. settings were lowered later).
      order({ triggered_at: daysAgo(1), quote_filled: 5_000, fees_gbp: 10, base_filled: 0.1 }),
      order({ side: 'SELL', triggered_at: daysAgo(0), base_filled: 0.2, quote_filled: 100, fees_gbp: 1 }),
    ];
    const b = computeVirtualBalances(orders, SETTINGS, NOW);
    expect(b.cashGbp).toBeGreaterThanOrEqual(0);
    expect(b.btcHeld).toBeGreaterThanOrEqual(0);
  });
});

describe('computeCqmDynamicTrade ledger caps', () => {
  it('caps the buy at the available cash', () => {
    const r = computeCqmDynamicTrade({
      baseAmount: 100,
      risk: 0,
      cashBalance: 40, // less than base
      btcHeld: 0,
      btcPrice: 50_000,
    });
    expect(r.buyAmount).toBe(40);
  });

  it('caps the sell at the value of the BTC held', () => {
    const r = computeCqmDynamicTrade({
      baseAmount: 1_000,
      risk: 1,
      cashBalance: 0,
      btcHeld: 0.001, // £50 of BTC, far below the base-size sell
      btcPrice: 50_000,
    });
    expect(r.sellAmount).toBeCloseTo(50, 6);
  });
});
