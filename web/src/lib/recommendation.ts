/** Mirrors `dashboard_2026.py` / Dashboard.tsx recommendation logic. */

export type RecommendationAction = 'PAUSE' | 'BASE' | 'ACCEL';

export interface RecommendationResult {
  action: RecommendationAction;
  reason: string;
  blockers: string[];
}

export type RecommendationInput = {
  ACCUM_ON: number;
  MACRO_ON: number;
  PRICE_REGIME_ON: number;
  DXY_SCORE: number;
  LIQ_SCORE: number;
  CYCLE_SCORE: number;
  VAL_SCORE: number;
};

export function getRecommendation(current: RecommendationInput): RecommendationResult {
  const accum = current.ACCUM_ON;
  const macro = current.MACRO_ON;
  const pr = current.PRICE_REGIME_ON;
  const dxy = current.DXY_SCORE;
  const liq = current.LIQ_SCORE;
  const cyc = current.CYCLE_SCORE;
  const val = current.VAL_SCORE;

  let action: RecommendationAction = 'PAUSE';
  let reason = '';
  const blockers: string[] = [];

  if (pr === 0) blockers.push('Price below long-term trend.');
  if (dxy === 0) blockers.push('USD regime risk-off (DXY strengthening).');
  if (liq === 0) blockers.push('Liquidity contracting/worsening.');
  if (cyc === 0) blockers.push('Business cycle contraction-risk elevated.');
  if (val === 0) blockers.push('Valuation overheated.');

  if (accum === 0) {
    action = 'PAUSE';
    reason = 'Accumulation permission is OFF. Capital protection prioritized.';
  } else if (macro === 1) {
    action = 'ACCEL';
    reason = 'Accumulation permitted with Macro Accelerator active (Liquidity/Business Cycle tailwinds).';
  } else {
    action = 'BASE';
    reason = 'Base accumulation permitted. No macro acceleration detected.';
  }

  return { action, reason, blockers };
}
