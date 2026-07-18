/**
 * Cross-model "what changed recently" deriver.
 *
 * Collects EVERY qualifying transition inside a recency window (not just the
 * last change of each dial) and returns a unified, recency-sorted activity
 * feed:
 *   - posture (recommendation) changes — PAUSE / BASE / ACCEL,
 *   - CORE / MACRO / price-regime switches,
 *   - sub-score moves (valuation, liquidity, business cycle, dollar),
 *   - Bottom Score band + deployment-range shifts, and big weekly score moves
 *     attributed to their largest component,
 *   - addresses-in-profit exhaustion triggers,
 *   - CQM risk-band crossings and big weekly risk moves,
 *
 * One-day blips are filtered by run-length debouncing: a value only "commits"
 * once it persists for 2+ consecutive observations (the latest observation
 * always counts, so a fresh change still surfaces). Transitions are the
 * boundaries between committed runs — a flicker like 2→1→2→1(stays) collapses
 * to a single durable 2→1 change instead of hiding it or spamming four events.
 *
 * Pure and cheap: compacted per-field scans over the window, no model refits.
 */
import type { SignalData } from '../App';
import { getRecommendation, type RecommendationAction } from '../lib/recommendation';

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

/** How far back the feed looks. Older transitions are not "recent". */
export const EVENT_WINDOW_DAYS = 90;

/** A value must persist this many observations to count as a real change. */
const MIN_RUN = 2;

/** Weekly move thresholds for magnitude events. */
const BOTTOM_WEEKLY_MOVE_PTS = 5;
const CQM_WEEKLY_MOVE_PP = 5;

const MAX_EVENTS = 40;
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

function isoDaysBefore(refDate: string, days: number): string {
  const ts = Date.parse(`${refDate}T00:00:00Z`) - days * DAY_MS;
  return new Date(ts).toISOString().slice(0, 10);
}

// --- compacted series + transition scan ---------------------------------------

interface Observation<T> {
  date: string;
  value: T;
}

interface Transition<T> {
  date: string;
  from: T;
  to: T;
}

function numericSeries(rows: SignalData[], key: string): Observation<number>[] {
  const out: Observation<number>[] = [];
  for (const row of rows) {
    const v = Number(row[key]);
    if (Number.isFinite(v)) out.push({ date: row.Date, value: v });
  }
  return out;
}

function stringSeries(rows: SignalData[], key: string): Observation<string>[] {
  const out: Observation<string>[] = [];
  for (const row of rows) {
    const v = row[key];
    if (typeof v === 'string' && v) out.push({ date: row.Date, value: v });
  }
  return out;
}

/**
 * Durable value changes on or after `sinceDate`, via run-length debouncing:
 * runs shorter than {@link MIN_RUN} observations are treated as noise and
 * dropped (except the final run, so a change on the latest day still shows),
 * adjacent surviving runs with equal values are merged, and the boundaries
 * between the remaining runs are the transitions.
 */
function collectTransitions<T>(series: Observation<T>[], sinceDate: string): Transition<T>[] {
  const runs: { value: T; start: string; length: number }[] = [];
  for (const obs of series) {
    const last = runs[runs.length - 1];
    if (last && last.value === obs.value) last.length += 1;
    else runs.push({ value: obs.value, start: obs.date, length: 1 });
  }

  const out: Transition<T>[] = [];
  let prev: { value: T } | null = null;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (run.length < MIN_RUN && i < runs.length - 1) continue;
    if (prev && run.value !== prev.value) {
      if (run.start >= sinceDate) out.push({ date: run.start, from: prev.value, to: run.value });
      prev = { value: run.value };
    } else if (!prev) {
      prev = { value: run.value };
    }
  }
  return out;
}

/** Value change over the trailing ~week of a compacted series. */
function weeklyDelta(series: Observation<number>[], refDate: string): number | null {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  const weekAgo = isoDaysBefore(refDate, 7);
  let ref: Observation<number> | null = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].date <= weekAgo) {
      ref = series[i];
      break;
    }
  }
  if (!ref) return null;
  return last.value - ref.value;
}

// --- event descriptors ---------------------------------------------------------

const POSTURE_LABELS: Record<RecommendationAction, string> = {
  PAUSE: 'Capital protection',
  BASE: 'Base accumulation',
  ACCEL: 'Accelerate accumulation',
};

const POSTURE_TONES: Record<RecommendationAction, EventTone> = {
  PAUSE: 'neg',
  BASE: 'neutral',
  ACCEL: 'pos',
};

interface BinaryDesc {
  key: string;
  model: EventModelId;
  on: string;
  off: string;
  onTone: EventTone;
  offTone: EventTone;
  detail: string;
}

const BINARY: BinaryDesc[] = [
  {
    key: 'CORE_ON',
    model: 'core-macro',
    on: 'Core accumulation turned ON',
    off: 'Core accumulation turned OFF',
    onTone: 'pos',
    offTone: 'neg',
    detail: 'Valuation + trend permission switch',
  },
  {
    key: 'MACRO_ON',
    model: 'core-macro',
    on: 'Macro accelerator engaged',
    off: 'Macro accelerator stood down',
    onTone: 'pos',
    offTone: 'neutral',
    detail: 'Liquidity / cycle / USD accelerator',
  },
  {
    key: 'PRICE_REGIME_ON',
    model: 'core-macro',
    on: 'BTC reclaimed its long-term trend',
    off: 'BTC lost its long-term trend',
    onTone: 'pos',
    offTone: 'neg',
    detail: 'BTC vs 40-week trend regime',
  },
];

interface ScoreDesc {
  key: string;
  model: EventModelId;
  label: string;
  max: number;
}

const SCORES: ScoreDesc[] = [
  { key: 'VAL_SCORE', model: 'core-macro', label: 'Valuation', max: 3 },
  { key: 'LIQ_SCORE', model: 'core-macro', label: 'Liquidity', max: 2 },
  { key: 'BIZ_CYCLE_SCORE', model: 'core-macro', label: 'Business cycle', max: 2 },
  { key: 'DXY_SCORE', model: 'core-macro', label: 'Dollar regime', max: 2 },
];

const BOTTOM_COMPONENTS: { key: string; label: string }[] = [
  { key: 'BOTTOM_ONCHAIN_SCORE', label: 'On-chain value' },
  { key: 'BOTTOM_CAPITULATION_SCORE', label: 'Capitulation' },
  { key: 'BOTTOM_LIQUIDITY_SCORE', label: 'Liquidity turn' },
  { key: 'BOTTOM_MACRO_SCORE', label: 'Macro support' },
  { key: 'BOTTOM_PRICE_SETUP_SCORE', label: 'Price setup' },
  { key: 'BOTTOM_PRICE_REPAIR_SCORE', label: 'Price repair' },
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

// --- main ----------------------------------------------------------------------

/**
 * Build the recency-sorted cross-model event feed (most recent first). Returns
 * every qualifying event inside the window; callers control how many to show.
 * @param history full SignalData history (chronological).
 * @param cqmRisk optional precomputed CQM risk series (0..100) per date.
 * @param windowDays lookback window (default {@link EVENT_WINDOW_DAYS}).
 */
export function deriveModelEvents(
  history: SignalData[],
  cqmRisk?: RiskPoint[],
  windowDays = EVENT_WINDOW_DAYS,
): ModelEvent[] {
  if (!history || history.length < 2) return [];
  const ref = history[history.length - 1].Date;
  const since = isoDaysBefore(ref, windowDays);
  const events: ModelEvent[] = [];

  const push = (
    id: string,
    model: EventModelId,
    date: string,
    tone: EventTone,
    title: string,
    detail: string,
  ) => {
    events.push({
      id,
      model,
      modelName: MODEL_META[model].name,
      link: MODEL_META[model].link,
      date,
      daysAgo: daysBetween(date, ref),
      tone,
      title,
      detail,
    });
  };

  // Posture (recommendation) transitions — the headline call of the dashboard.
  const postureSeries: Observation<RecommendationAction>[] = history.map((row) => ({
    date: row.Date,
    value: getRecommendation(row).action,
  }));
  for (const t of collectTransitions(postureSeries, since)) {
    push(
      `posture:${t.date}`,
      'core-macro',
      t.date,
      POSTURE_TONES[t.to],
      `Posture changed to ${POSTURE_LABELS[t.to]}`,
      `Was ${POSTURE_LABELS[t.from].toLowerCase()}`,
    );
  }

  for (const d of BINARY) {
    for (const t of collectTransitions(numericSeries(history, d.key), since)) {
      const on = t.to === 1;
      push(`bin:${d.key}:${t.date}`, d.model, t.date, on ? d.onTone : d.offTone, on ? d.on : d.off, d.detail);
    }
  }

  for (const s of SCORES) {
    for (const t of collectTransitions(numericSeries(history, s.key), since)) {
      const improved = t.to > t.from;
      push(
        `score:${s.key}:${t.date}`,
        s.model,
        t.date,
        improved ? 'pos' : 'neg',
        `${s.label} ${improved ? 'improved' : 'weakened'}`,
        `Score ${t.from} → ${t.to} (of ${s.max})`,
      );
    }
  }

  // Bottom Score: band shifts (tone from the score move at the shift).
  const bottomScores = numericSeries(history, 'BOTTOM_ACCUM_SCORE');
  const scoreByDate = new Map(bottomScores.map((o) => [o.date, o.value]));
  for (const t of collectTransitions(stringSeries(history, 'BOTTOM_ACCUM_BAND'), since)) {
    const after = scoreByDate.get(t.date);
    push(
      `bottom:band:${t.date}`,
      'bottom',
      t.date,
      typeof after === 'number' && after >= 50 ? 'pos' : 'neg',
      `Bottom band: ${t.from} → ${t.to}`,
      typeof after === 'number' ? `Score now ${after.toFixed(0)} / 100` : 'Accumulation band shift',
    );
  }

  // Bottom Score: suggested deployment-range shifts.
  for (const t of collectTransitions(stringSeries(history, 'BOTTOM_DEPLOYMENT_RANGE'), since)) {
    const fromPct = parseFloat(t.from);
    const toPct = parseFloat(t.to);
    const tone: EventTone = Number.isFinite(fromPct) && Number.isFinite(toPct)
      ? (toPct > fromPct ? 'pos' : toPct < fromPct ? 'neg' : 'neutral')
      : 'neutral';
    push(
      `bottom:deploy:${t.date}`,
      'bottom',
      t.date,
      tone,
      `Suggested deployment: ${t.from} → ${t.to}`,
      'Staging range for sidelined capital',
    );
  }

  // Bottom Score: big weekly move, attributed to its largest component mover.
  const bottomWeekly = weeklyDelta(bottomScores, ref);
  if (bottomWeekly !== null && Math.abs(bottomWeekly) >= BOTTOM_WEEKLY_MOVE_PTS) {
    let mover: { label: string; delta: number } | null = null;
    for (const c of BOTTOM_COMPONENTS) {
      const delta = weeklyDelta(numericSeries(history, c.key), ref);
      if (delta === null || delta === 0) continue;
      if (!mover || Math.abs(delta) > Math.abs(mover.delta)) mover = { label: c.label, delta };
    }
    push(
      `bottom:mover:${ref}`,
      'bottom',
      ref,
      bottomWeekly > 0 ? 'pos' : 'neg',
      `Bottom Score ${bottomWeekly > 0 ? '+' : ''}${bottomWeekly.toFixed(0)} pts this week`,
      mover ? `Led by ${mover.label} ${mover.delta > 0 ? '+' : ''}${mover.delta.toFixed(0)} pts` : 'Composite move across components',
    );
  }

  // Addresses-in-profit exhaustion trigger (euphoria follow-through failed).
  for (const t of collectTransitions(numericSeries(history, 'SIP_EXHAUSTED'), since)) {
    if (t.to !== 1) continue;
    push(
      `sip:exhausted:${t.date}`,
      'core-macro',
      t.date,
      'neg',
      'Addresses-in-profit exhaustion triggered',
      'Failed to reclaim 95% in profit within the window',
    );
  }

  // CQM: every risk-band crossing in the window, plus big weekly moves that
  // stay inside one band (which band crossings alone would miss).
  if (cqmRisk && cqmRisk.length > 1) {
    const bandSeries: Observation<number>[] = cqmRisk.map((p) => ({ date: p.date, value: cqmBand(p.pct) }));
    const pctByDate = new Map(cqmRisk.map((p) => [p.date, p.pct]));
    const crossings = collectTransitions(bandSeries, since);
    for (const t of crossings) {
      const pct = pctByDate.get(t.date);
      push(
        `cqm:band:${t.date}`,
        'cqm',
        t.date,
        t.to < t.from ? 'pos' : 'neg',
        `CQM entered ${CQM_BANDS[t.to as 0 | 1 | 2 | 3]}`,
        `Risk ${typeof pct === 'number' ? pct.toFixed(0) : '—'}% (was ${CQM_BANDS[t.from as 0 | 1 | 2 | 3]})`,
      );
    }

    const weekAgo = isoDaysBefore(ref, 7);
    const crossedThisWeek = crossings.some((t) => t.date >= weekAgo);
    const riskWeekly = weeklyDelta(cqmRisk.map((p) => ({ date: p.date, value: p.pct })), ref);
    if (!crossedThisWeek && riskWeekly !== null && Math.abs(riskWeekly) >= CQM_WEEKLY_MOVE_PP) {
      const nowPct = cqmRisk[cqmRisk.length - 1].pct;
      push(
        `cqm:move:${ref}`,
        'cqm',
        ref,
        riskWeekly < 0 ? 'pos' : 'neg',
        `CQM risk ${riskWeekly < 0 ? 'fell' : 'climbed'} ${Math.abs(riskWeekly).toFixed(1)} pp this week`,
        `Now ${nowPct.toFixed(0)}% · still ${CQM_BANDS[cqmBand(nowPct)]}`,
      );
    }
  }

  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return events.slice(0, MAX_EVENTS);
}
