import React from 'react';
import { Anchor, Waves, Workflow, type LucideIcon } from 'lucide-react';
import type { ChartsSection } from '../views/ChartsView';
import type { BacktestVariant } from '../views/Backtest';
import type { SignalData } from '../App';
import { fitCQM, snapshotAt } from '../utils/cqm';
import Dashboard from '../views/Dashboard';
import LogicFlow from '../views/LogicFlow';
import ScoreBreakdown from '../views/ScoreBreakdown';
import CoreMacroDocs from '../views/models/docs/CoreMacroDocs';
import BottomDocs from '../views/models/docs/BottomDocs';
import CqmDocs from '../views/models/docs/CqmDocs';
import CqmOverview from '../views/models/CqmOverview';

export type ModelId = 'core-macro' | 'bottom' | 'cqm';

/**
 * A labelled group of indicator charts a model consumes, rendered in the model's
 * Factors tab as a contextual composition. When `scoreField`/`scoreMax` are set,
 * a live score-contribution badge is shown (read from the latest data row).
 */
export interface FactorGroup {
  label: string;
  blurb?: string;
  sections: ChartsSection[];
  /** Optional: latest-row field whose value is shown as the group's contribution badge. */
  scoreField?: keyof SignalData;
  /** Optional: denominator for the badge (e.g. 20 -> "14 / 20"). */
  scoreMax?: number;
}

export interface ModelState {
  headline: string;
  tone: 'pos' | 'neutral' | 'neg';
  metrics: { label: string; value: string }[];
}

export interface ModelDef {
  id: ModelId;
  name: string;
  shortName: string;
  tagline: string;
  status: 'live' | 'beta';
  Icon: LucideIcon;
  summary: string[];
  chartSections: ChartsSection[];
  factorGroups?: FactorGroup[];
  /** When set, the model exposes a Backtest tab locked to this simulator variant. */
  backtestVariant?: BacktestVariant;
  /** Optional custom Overview (core-macro reuses the rich member Dashboard). */
  OverviewComponent?: React.FC<{ current: SignalData; history: SignalData[] }>;
  overviewGated?: boolean;
  signals?: { gated: boolean; Component: React.FC<{ current: SignalData }> };
  scores?: { gated: boolean; Component: React.FC<{ current: SignalData }> };
  Docs: React.FC;
  currentState: (rows: SignalData[]) => ModelState | null;
}

function lastRow(rows: SignalData[]): SignalData | null {
  return rows && rows.length ? rows[rows.length - 1] : null;
}

const coreMacroModel: ModelDef = {
  id: 'core-macro',
  name: 'CORE + MACRO Signals',
  shortName: 'CORE/MACRO',
  tagline: 'The original accumulation engine: a valuation/price CORE switch gated by a liquidity, business-cycle and USD MACRO regime.',
  status: 'live',
  Icon: Workflow,
  summary: [
    'CORE is driven by valuation (VAL_SCORE) and the price regime; MACRO combines the liquidity and business-cycle regimes with a persistence-filtered USD gate.',
    'Together they form the master accumulation switches that pace deployment across the cycle.',
  ],
  chartSections: ['system'],
  backtestVariant: 'core-macro',
  factorGroups: [
    { label: 'Valuation & on-chain', blurb: 'Inputs to VAL_SCORE / the CORE switch.', sections: ['valuation'] },
    { label: 'Liquidity', blurb: 'Inputs to the MACRO liquidity regime.', sections: ['liquidity'] },
    { label: 'Business cycle', blurb: 'Inputs to the MACRO business-cycle regime.', sections: ['business'] },
    { label: 'US Dollar', blurb: 'The persistence-filtered USD gate.', sections: ['usd'] },
  ],
  OverviewComponent: Dashboard,
  overviewGated: false,
  signals: { gated: true, Component: LogicFlow },
  scores: { gated: true, Component: ScoreBreakdown },
  Docs: CoreMacroDocs,
  currentState: (rows) => {
    const d = lastRow(rows);
    if (!d) return null;
    const core = Number(d.CORE_ON) === 1;
    const macro = Number(d.MACRO_ON) === 1;
    const headline = core && macro ? 'CORE + MACRO ON' : core ? 'CORE ON' : macro ? 'MACRO ON' : 'Risk-off';
    return {
      headline,
      tone: core ? 'pos' : macro ? 'neutral' : 'neg',
      metrics: [
        { label: 'CORE', value: core ? 'ON' : 'OFF' },
        { label: 'MACRO', value: macro ? 'ON' : 'OFF' },
        { label: 'Valuation', value: String(d.VAL_SCORE ?? '—') },
        { label: 'Liquidity', value: String(d.LIQ_SCORE ?? '—') },
      ],
    };
  },
};

const bottomModel: ModelDef = {
  id: 'bottom',
  name: 'Bottom Accumulation Score',
  shortName: 'Bottom Score',
  tagline: 'A 0–100 composite that grades how attractive current conditions are for staged accumulation, blending on-chain value, capitulation, liquidity, macro and price structure.',
  status: 'live',
  Icon: Anchor,
  summary: [
    'The score sums five buckets (each out of 20): on-chain value, capitulation/holder stress, liquidity turn, macro risk and price structure.',
    'Higher scores indicate deeper value and stronger accumulation setups; the band and deployment range translate the score into action.',
  ],
  chartSections: ['bottom'],
  factorGroups: [
    { label: 'On-chain value', blurb: 'Valuation vs realized prices.', sections: ['valuation'], scoreField: 'BOTTOM_ONCHAIN_SCORE', scoreMax: 20 },
    { label: 'Capitulation', blurb: 'Holder stress and derivatives.', sections: ['valuation'], scoreField: 'BOTTOM_CAPITULATION_SCORE', scoreMax: 20 },
    { label: 'Liquidity turn', blurb: 'Liquidity regime and impulse.', sections: ['liquidity'], scoreField: 'BOTTOM_LIQUIDITY_SCORE', scoreMax: 20 },
    { label: 'Macro risk', blurb: 'Business-cycle backdrop.', sections: ['business'], scoreField: 'BOTTOM_MACRO_SCORE', scoreMax: 20 },
    { label: 'Price structure', blurb: 'Drawdown, trend and repair.', sections: ['system'], scoreField: 'BOTTOM_STRUCTURE_SCORE', scoreMax: 20 },
  ],
  Docs: BottomDocs,
  currentState: (rows) => {
    const d = lastRow(rows);
    if (!d) return null;
    const score = Number(d.BOTTOM_ACCUM_SCORE);
    if (!Number.isFinite(score)) return null;
    const band = d.BOTTOM_ACCUM_BAND ?? `${score.toFixed(0)} / 100`;
    return {
      headline: band,
      tone: score >= 70 ? 'pos' : score >= 50 ? 'neutral' : 'neg',
      metrics: [
        { label: 'Score', value: `${score.toFixed(0)} / 100` },
        { label: 'Band', value: String(band) },
        { label: 'Deployment', value: String(d.BOTTOM_DEPLOYMENT_RANGE ?? '—') },
      ],
    };
  },
};

const cqmModel: ModelDef = {
  id: 'cqm',
  name: 'CoinStrat Quantile Model',
  shortName: 'CQM',
  tagline: 'A quantile-regression fair-value model that maps BTC price to a 0–100% cycle risk, with quantile bands and a risk-vs-price curve.',
  status: 'live',
  Icon: Waves,
  summary: [
    'CQM fits quantile bands across BTC history and converts the latest price into a fair-value risk between 0% (deep value) and 100% (euphoric).',
    'Risk drives the CQM Risk-Weighted DCA strategy: buy more when risk is low, trim when risk is high.',
  ],
  chartSections: ['cqm'],
  backtestVariant: 'cqm',
  OverviewComponent: CqmOverview,
  overviewGated: false,
  Docs: CqmDocs,
  currentState: (rows) => {
    if (!rows || rows.length < 365) return null;
    const points: { date: string; ts: number; price: number }[] = [];
    for (const d of rows) {
      const price = Number(d.BTCUSD);
      const ts = new Date(d.Date).getTime();
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(ts)) continue;
      points.push({ date: d.Date, ts, price });
    }
    if (points.length < 365) return null;
    try {
      const fit = fitCQM(points);
      const snap = snapshotAt(fit);
      if (!snap) return null;
      const riskPct = snap.risk * 100;
      const headline = riskPct < 25 ? 'Buy zone' : riskPct < 50 ? 'Accumulate' : riskPct < 75 ? 'Trim' : 'Sell zone';
      return {
        headline,
        tone: riskPct < 50 ? 'pos' : riskPct < 75 ? 'neutral' : 'neg',
        metrics: [
          { label: 'Risk', value: `${riskPct.toFixed(1)}%` },
          { label: 'Price', value: `$${Math.round(snap.price).toLocaleString()}` },
          { label: 'QR 50%', value: `$${Math.round(snap.qrDashedMedian).toLocaleString()}` },
        ],
      };
    } catch {
      return null;
    }
  },
};

export const MODELS: ModelDef[] = [coreMacroModel, bottomModel, cqmModel];

export function getModel(id: string | undefined): ModelDef | null {
  if (!id) return null;
  return MODELS.find((m) => m.id === id) ?? null;
}

export interface ModelTab {
  id: 'overview' | 'charts' | 'factors' | 'backtest' | 'signals' | 'scores' | 'docs';
  label: string;
  /** path segment relative to /models/:id ('' for overview index) */
  segment: string;
  gated: boolean;
}

export function modelTabs(model: ModelDef): ModelTab[] {
  const tabs: ModelTab[] = [
    { id: 'overview', label: 'Overview', segment: '', gated: Boolean(model.overviewGated) },
    { id: 'charts', label: 'Charts', segment: 'charts', gated: false },
  ];
  if (model.factorGroups && model.factorGroups.length) {
    tabs.push({ id: 'factors', label: 'Factors', segment: 'factors', gated: false });
  }
  if (model.backtestVariant) {
    tabs.push({ id: 'backtest', label: 'Backtest', segment: 'backtest', gated: false });
  }
  if (model.signals) tabs.push({ id: 'signals', label: 'Signals', segment: 'signals', gated: model.signals.gated });
  if (model.scores) tabs.push({ id: 'scores', label: 'Scores', segment: 'scores', gated: model.scores.gated });
  tabs.push({ id: 'docs', label: 'Docs', segment: 'docs', gated: false });
  return tabs;
}
