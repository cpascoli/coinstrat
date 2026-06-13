import type { ChartsSection } from '../views/ChartsView';

/**
 * The Indicators catalog. Each category maps to a ChartsView `section`, so the
 * chart components remain authored once in ChartsView and are reused both here
 * (canonical `/indicators/:id` pages) and inside model factor tabs as contextual
 * compositions.
 */
export interface IndicatorCategoryDef {
  /** URL segment, e.g. /indicators/valuation */
  id: string;
  label: string;
  blurb: string;
  section: ChartsSection;
}

export const INDICATOR_CATEGORIES: IndicatorCategoryDef[] = [
  {
    id: 'valuation',
    label: 'Valuation & On-chain',
    blurb: 'MVRV, NUPL, realized prices, LTH-SOPR and SIP — on-chain value and holder behaviour.',
    section: 'valuation',
  },
  {
    id: 'liquidity',
    label: 'Liquidity',
    blurb: 'US net liquidity, G3 central-bank balance sheets and the liquidity regime.',
    section: 'liquidity',
  },
  {
    id: 'business',
    label: 'Business Cycle',
    blurb: 'Sahm rule, yield curve and ISM PMI — the macro/business-cycle backdrop.',
    section: 'business',
  },
  {
    id: 'usd',
    label: 'US Dollar',
    blurb: 'DXY level, moving averages and the persistence-filtered USD regime.',
    section: 'usd',
  },
];

export function getIndicatorCategory(id: string | undefined): IndicatorCategoryDef | null {
  if (!id) return null;
  return INDICATOR_CATEGORIES.find((c) => c.id === id) ?? null;
}
