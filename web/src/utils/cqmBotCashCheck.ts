/**
 * Compare Coinbase Advanced Trade GBP with the bot's next buy.
 *
 * Sizing uses the virtual ledger, which can look well-funded while the
 * exchange cash account is empty. Coinbase then rejects the market order
 * with INSUFFICIENT_FUND. This check is the UI counterpart of that failure.
 */

export type CoinbaseGbpCheck =
  | { status: 'unknown' }
  | { status: 'ok' }
  | {
      status: 'short_for_buy';
      gbp: number;
      requiredGbp: number;
      shortfallGbp: number;
    }
  | {
      status: 'low_for_next_buy';
      gbp: number;
      requiredGbp: number;
      shortfallGbp: number;
    };

export interface CoinbaseGbpCheckInput {
  gbp: number | null | undefined;
  targetSide?: 'BUY' | 'SELL' | 'NONE' | null;
  targetAmountGbp?: number | null;
  baseAmountGbp?: number | null;
}

function toPence(value: number): number {
  return Math.round(value * 100);
}

function finitePositive(value: number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function shortfall(gbp: number, requiredGbp: number): number {
  return Math.max(0, Math.round((requiredGbp - gbp) * 100) / 100);
}

export function assessCoinbaseGbp(input: CoinbaseGbpCheckInput): CoinbaseGbpCheck {
  if (input.gbp == null) return { status: 'unknown' };
  const gbp = Number(input.gbp);
  if (!Number.isFinite(gbp)) return { status: 'unknown' };

  const buyAmount = input.targetSide === 'BUY'
    ? finitePositive(input.targetAmountGbp)
    : null;
  if (buyAmount != null) {
    if (toPence(gbp) < toPence(buyAmount)) {
      return {
        status: 'short_for_buy',
        gbp,
        requiredGbp: buyAmount,
        shortfallGbp: shortfall(gbp, buyAmount),
      };
    }
    return { status: 'ok' };
  }

  // Sells spend BTC, not GBP. HOLD/NONE still needs a cash buffer for the
  // next buy slot (the case that otherwise only shows up at 07:00 UTC).
  if (input.targetSide === 'SELL') return { status: 'ok' };

  const baseAmount = finitePositive(input.baseAmountGbp);
  if (baseAmount != null && toPence(gbp) < toPence(baseAmount)) {
    return {
      status: 'low_for_next_buy',
      gbp,
      requiredGbp: baseAmount,
      shortfallGbp: shortfall(gbp, baseAmount),
    };
  }

  return { status: 'ok' };
}

function formatGbp(value: number): string {
  return `£${value.toFixed(2)}`;
}

export function coinbaseGbpWarningText(check: CoinbaseGbpCheck): string | null {
  switch (check.status) {
    case 'unknown':
    case 'ok':
      return null;
    case 'short_for_buy':
      return (
        `Coinbase GBP is ${formatGbp(check.gbp)}, below today's ${formatGbp(check.requiredGbp)} buy. `
        + `Deposit at least ${formatGbp(check.shortfallGbp)} more into the Advanced Trade cash account `
        + `or Coinbase will reject the order (insufficient funds).`
      );
    case 'low_for_next_buy':
      return (
        `Coinbase GBP is ${formatGbp(check.gbp)}, below the ${formatGbp(check.requiredGbp)} base amount. `
        + `Top up the Advanced Trade cash account before the next buy slot `
        + `or the order may fail with insufficient funds.`
      );
    default: {
      const _exhaustive: never = check;
      return _exhaustive;
    }
  }
}
