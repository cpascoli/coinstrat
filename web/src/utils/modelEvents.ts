/**
 * Cross-model "what changed recently" deriver.
 *
 * Scans the shared SignalData history for the most recent transition of each
 * tracked regime/score, plus CQM risk-band crossings (from a precomputed risk
 * series), and returns a unified, recency-sorted activity feed. Pure and cheap:
 * one backward scan per tracked field, no model refits here.
 */
import type { SignalData } from '../App';

export type EventTone = 'pos' | 'neg' | 'neutral';
export type EventModelId = 'core-macro' | 'bottom' | 'cqm';

export interface ModelEvent {
  id: string;
  model: EventModelId;
  modelName: string;
  link: string;
  date: string; // YYYY-MM-DD
  daysAgo: number;
  tone: EventTone;
  title: string;
  detail: string;
}

const DAY_MS = 86_400_000;

const MODEL_META: Record<EventModelId, { name: string; link: string }> = {
  'core-macro': { name: 'CORE + MACRO', link: '/models/core-macro' },
  bottom: { name: 'Bottom Score', link: '/models/bottom' },
  cqm: { name: 'CQM', link: '/models/cqm' },
};

function daysBetween(fromDate: string, refDate: string): number {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${refDate}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

/** Most-recent adjacent change of a numeric field (scanning from the end). */
function lastNumericChange(
  rows: SignalData[],
  key: keyof SignalData,
): { date: string; from: number; to: number } | null {
  for (let i = rows.length - 1; i > 0; i--) {
    const b = Number(rows[i][key]);
    const a = Number(rows[i - 1][key]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a !== b) return { date: rows[i].Date, from: a, to: b };
  }
  return null;
}

/** Most-recent adjacent change of a string field (e.g. Bottom band label). */
function lastStringChange(
  rows: SignalData[],
  key: keyof SignalData,
): { date: string; from: string; to: string; idx: number } | null {
  for (let i = rows.length - 1; i > 0; i--) {
    const b = rows[i][key];
    const a = rows[i - 1][key];
    if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) continue;
    if (a !== b) return { date: rows[i].Date, from: a, to: b, idx: i };
  }
  return null;
}

interface BinaryDesc {
  key: keyof SignalData;
  model: EventModelId;
  on: string;
  off: string;
  onTone: EventTone;
  offTone: EventTone;
}

const BINARY: BinaryDesc[] = [
  { key: 'CORE_ON', model: 'core-macro', on: 'Core accumulation turned ON', off: 'Core accumulation turned OFF', onTone: 'pos', offTone: 'neg' },
  { key: 'MACRO_ON', model: 'core-macro', on: 'Macro accelerator engaged', off: 'Macro accelerator stood down', onTone: 'pos', offTone: 'neutral' },
  { key: 'PRICE_REGIME_ON', model: 'core-macro', on: 'BTC reclaimed its long-term trend', off: 'BTC lost its long-term trend', onTone: 'pos', offTone: 'neg' },
];

interface ScoreDesc {
  key: keyof SignalData;
  model: EventModelId;
  label: string;
}

const SCORES: ScoreDesc[] = [
  { key: 'VAL_SCORE', model: 'core-macro', label: 'Valuation' },
  { key: 'LIQ_SCORE', model: 'core-macro', label: 'Liquidity' },
  { key: 'BIZ_CYCLE_SCORE', model: 'core-macro', label: 'Business cycle' },
  { key: 'DXY_SCORE', model: 'core-macro', label: 'Dollar regime' },
];

const CQM_BANDS = ['Buy zone', 'Accumulate', 'Trim / Hold', 'Sell zone'] as const;
function cqmBand(pct: number): 0 | 1 | 2 | 3 {
  if (pct < 25) return 0;
  if (pct < 50) return 1;
  if (pct < 75) return 2;
  return 3;
}

export interface RiskPoint {
  date: string;
  pct: number;
}

/**
 * Build the recency-sorted cross-model event feed.
 * @param history full SignalData history (chronological).
 * @param cqmRisk optional precomputed CQM risk series (0..100) per date.
 * @param limit max events to return (default 9).
 */
export function deriveModelEvents(
  history: SignalData[],
  cqmRisk?: RiskPoint[],
  limit = 9,
): ModelEvent[] {
  if (!history || history.length < 2) return [];
  const ref = history[history.length - 1].Date;
  const events: ModelEvent[] = [];

  for (const d of BINARY) {
    const c = lastNumericChange(history, d.key);
    if (!c) continue;
    const on = c.to === 1;
    events.push({
      id: `bin:${String(d.key)}`,
      model: d.model,
      modelName: MODEL_META[d.model].name,
      link: MODEL_META[d.model].link,
      date: c.date,
      daysAgo: daysBetween(c.date, ref),
      tone: on ? d.onTone : d.offTone,
      title: on ? d.on : d.off,
      detail: 'CORE + MACRO regime switch',
    });
  }

  for (const s of SCORES) {
    const c = lastNumericChange(history, s.key);
    if (!c) continue;
    const improved = c.to > c.from;
    events.push({
      id: `score:${String(s.key)}`,
      model: s.model,
      modelName: MODEL_META[s.model].name,
      link: MODEL_META[s.model].link,
      date: c.date,
      daysAgo: daysBetween(c.date, ref),
      tone: improved ? 'pos' : 'neg',
      title: `${s.label} ${improved ? 'improved' : 'weakened'}`,
      detail: `Score ${c.from} → ${c.to}`,
    });
  }

  // Bottom Score band change (string), with tone from the score delta.
  const bandChange = lastStringChange(history, 'BOTTOM_ACCUM_BAND');
  if (bandChange) {
    const before = Number(history[bandChange.idx - 1].BOTTOM_ACCUM_SCORE);
    const after = Number(history[bandChange.idx].BOTTOM_ACCUM_SCORE);
    const improved = Number.isFinite(before) && Number.isFinite(after) ? after > before : true;
    events.push({
      id: 'bottom:band',
      model: 'bottom',
      modelName: MODEL_META.bottom.name,
      link: MODEL_META.bottom.link,
      date: bandChange.date,
      daysAgo: daysBetween(bandChange.date, ref),
      tone: improved ? 'pos' : 'neg',
      title: `Bottom band: ${bandChange.from} → ${bandChange.to}`,
      detail: Number.isFinite(after) ? `Score now ${after.toFixed(0)} / 100` : 'Accumulation band shift',
    });
  }

  // CQM risk-band crossing (from the precomputed risk series).
  if (cqmRisk && cqmRisk.length > 1) {
    for (let i = cqmRisk.length - 1; i > 0; i--) {
      const to = cqmBand(cqmRisk[i].pct);
      const from = cqmBand(cqmRisk[i - 1].pct);
      if (to === from) continue;
      const rising = to > from;
      events.push({
        id: 'cqm:band',
        model: 'cqm',
        modelName: MODEL_META.cqm.name,
        link: MODEL_META.cqm.link,
        date: cqmRisk[i].date,
        daysAgo: daysBetween(cqmRisk[i].date, ref),
        tone: rising ? 'neg' : 'pos',
        title: `CQM entered ${CQM_BANDS[to]}`,
        detail: `Risk ${cqmRisk[i].pct.toFixed(0)}% (was ${CQM_BANDS[from]})`,
      });
      break;
    }
  }

  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return events.slice(0, limit);
}
