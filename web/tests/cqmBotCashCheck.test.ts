import { describe, expect, it } from 'vitest';
import {
  assessCoinbaseGbp,
  coinbaseGbpWarningText,
} from '../src/utils/cqmBotCashCheck';

describe('assessCoinbaseGbp', () => {
  it('is unknown when Coinbase GBP has not loaded', () => {
    expect(assessCoinbaseGbp({
      gbp: null,
      targetSide: 'BUY',
      targetAmountGbp: 315.34,
      baseAmountGbp: 500,
    })).toEqual({ status: 'unknown' });
    expect(assessCoinbaseGbp({
      gbp: undefined,
      targetSide: 'BUY',
      targetAmountGbp: 315.34,
    }).status).toBe('unknown');
  });

  it('treats a loaded £0 balance as short, not unknown', () => {
    expect(assessCoinbaseGbp({
      gbp: 0,
      targetSide: 'BUY',
      targetAmountGbp: 315.34,
    }).status).toBe('short_for_buy');
  });

  it('flags a buy when exchange GBP is below the target', () => {
    expect(assessCoinbaseGbp({
      gbp: 35,
      targetSide: 'BUY',
      targetAmountGbp: 315.34,
      baseAmountGbp: 500,
    })).toEqual({
      status: 'short_for_buy',
      gbp: 35,
      requiredGbp: 315.34,
      shortfallGbp: 280.34,
    });
  });

  it('uses the buy target, not the base, when a buy is due', () => {
    const check = assessCoinbaseGbp({
      gbp: 400,
      targetSide: 'BUY',
      targetAmountGbp: 306.57,
      baseAmountGbp: 500,
    });
    expect(check.status).toBe('ok');
  });

  it('treats equal pence as sufficient', () => {
    expect(assessCoinbaseGbp({
      gbp: 315.34,
      targetSide: 'BUY',
      targetAmountGbp: 315.34,
    }).status).toBe('ok');
  });

  it('compares on rounded pence so float noise does not false-alarm', () => {
    expect(assessCoinbaseGbp({
      gbp: 315.339999999,
      targetSide: 'BUY',
      targetAmountGbp: 315.34,
    }).status).toBe('ok');
  });

  it('warns on hold when GBP is below the base amount', () => {
    expect(assessCoinbaseGbp({
      gbp: 35,
      targetSide: 'NONE',
      targetAmountGbp: 0,
      baseAmountGbp: 500,
    })).toEqual({
      status: 'low_for_next_buy',
      gbp: 35,
      requiredGbp: 500,
      shortfallGbp: 465,
    });
  });

  it('does not warn on sells when GBP is low', () => {
    expect(assessCoinbaseGbp({
      gbp: 35,
      targetSide: 'SELL',
      targetAmountGbp: 500,
      baseAmountGbp: 500,
    }).status).toBe('ok');
  });
});

describe('coinbaseGbpWarningText', () => {
  it('explains a short buy with the deposit shortfall', () => {
    const text = coinbaseGbpWarningText({
      status: 'short_for_buy',
      gbp: 35,
      requiredGbp: 315.34,
      shortfallGbp: 280.34,
    });
    expect(text).toContain('£35.00');
    expect(text).toContain('£315.34');
    expect(text).toContain('£280.34');
    expect(text).toMatch(/insufficient funds/i);
  });

  it('returns null when cash is sufficient', () => {
    expect(coinbaseGbpWarningText({ status: 'ok' })).toBeNull();
    expect(coinbaseGbpWarningText({ status: 'unknown' })).toBeNull();
  });
});
