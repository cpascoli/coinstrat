import { describe, it, expect } from 'vitest';
import type { SignalData } from '../src/App';
import { deriveModelEvents, EVENT_WINDOW_DAYS, type RiskPoint } from '../src/utils/modelEvents';

const DAY_MS = 86_400_000;
const LAST_DATE = '2026-07-10';

function isoDaysBefore(days: number): string {
  return new Date(Date.parse(`${LAST_DATE}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

/** Build `days` chronological rows ending on LAST_DATE, healthy defaults. */
function buildHistory(days: number, mutate?: (row: SignalData, daysAgo: number) => void): SignalData[] {
  const rows: SignalData[] = [];
  for (let daysAgo = days - 1; daysAgo >= 0; daysAgo--) {
    const row: SignalData = {
      Date: isoDaysBefore(daysAgo),
      BTCUSD: 60000,
      ACCUM_ON: 1,
      CORE_ON: 1,
      MACRO_ON: 0,
      PRICE_REGIME_ON: 1,
      VAL_SCORE: 2,
      DXY_SCORE: 1,
      LIQ_SCORE: 1,
      BIZ_CYCLE_SCORE: 1,
      US_LIQ: 0,
      US_LIQ_YOY: 0,
      US_LIQ_13W_DELTA: 0,
      BOTTOM_ACCUM_SCORE: 60,
      BOTTOM_ACCUM_BAND: 'Constructive',
      BOTTOM_DEPLOYMENT_RANGE: '40-60%',
    };
    mutate?.(row, daysAgo);
    rows.push(row);
  }
  return rows;
}

describe('deriveModelEvents', () => {
  it('returns empty for short history', () => {
    expect(deriveModelEvents([])).toEqual([]);
    expect(deriveModelEvents(buildHistory(1))).toEqual([]);
  });

  it('ignores transitions older than the window', () => {
    const history = buildHistory(200, (row, daysAgo) => {
      // CORE flipped on well outside the window.
      row.CORE_ON = daysAgo > EVENT_WINDOW_DAYS + 30 ? 0 : 1;
    });
    const events = deriveModelEvents(history);
    expect(events.filter((e) => e.id.startsWith('bin:CORE_ON'))).toHaveLength(0);
  });

  it('captures every qualifying transition of the same field inside the window', () => {
    const history = buildHistory(90, (row, daysAgo) => {
      // MACRO on for a 10-day stretch, then off again: two events.
      row.MACRO_ON = daysAgo <= 30 && daysAgo > 20 ? 1 : 0;
    });
    const macro = deriveModelEvents(history).filter((e) => e.id.startsWith('bin:MACRO_ON'));
    expect(macro).toHaveLength(2);
    expect(macro[0].title).toContain('stood down');
    expect(macro[1].title).toContain('engaged');
  });

  it('filters one-day blips (both legs)', () => {
    const history = buildHistory(90, (row, daysAgo) => {
      if (daysAgo === 10) row.LIQ_SCORE = 0; // single-day dip, reverts next day
    });
    const events = deriveModelEvents(history);
    expect(events.filter((e) => e.id.startsWith('score:LIQ_SCORE'))).toHaveLength(0);
  });

  it('collapses a flicker into a single durable transition instead of hiding it', () => {
    // VAL oscillates day-by-day, then settles at 1: the old value never sat
    // still around the change, but the change is real and must surface once.
    const history = buildHistory(90, (row, daysAgo) => {
      if (daysAgo === 6 || daysAgo === 4) row.VAL_SCORE = 1; // one-day flickers
      if (daysAgo <= 2) row.VAL_SCORE = 1; // durable move
    });
    const val = deriveModelEvents(history).filter((e) => e.id.startsWith('score:VAL_SCORE'));
    expect(val).toHaveLength(1);
    expect(val[0].detail).toBe('Score 2 → 1 (of 3)');
    expect(val[0].daysAgo).toBe(2);
  });

  it('keeps a fresh transition on the latest row', () => {
    const history = buildHistory(90, (row, daysAgo) => {
      if (daysAgo === 0) row.VAL_SCORE = 3;
    });
    const val = deriveModelEvents(history).filter((e) => e.id.startsWith('score:VAL_SCORE'));
    expect(val).toHaveLength(1);
    expect(val[0].tone).toBe('pos');
    expect(val[0].detail).toBe('Score 2 → 3 (of 3)');
  });

  it('emits posture changes from the recommendation logic', () => {
    const history = buildHistory(90, (row, daysAgo) => {
      // ACCUM off until 15 days ago => PAUSE -> BASE posture change.
      row.ACCUM_ON = daysAgo > 15 ? 0 : 1;
    });
    const posture = deriveModelEvents(history).filter((e) => e.id.startsWith('posture:'));
    expect(posture).toHaveLength(1);
    expect(posture[0].title).toBe('Posture changed to Base accumulation');
    expect(posture[0].tone).toBe('neutral');
    expect(posture[0].daysAgo).toBe(15);
  });

  it('emits Bottom band and deployment-range shifts', () => {
    const history = buildHistory(90, (row, daysAgo) => {
      if (daysAgo <= 8) {
        row.BOTTOM_ACCUM_SCORE = 74;
        row.BOTTOM_ACCUM_BAND = 'Strong';
        row.BOTTOM_DEPLOYMENT_RANGE = '60-80%';
      }
    });
    const events = deriveModelEvents(history);
    const band = events.find((e) => e.id.startsWith('bottom:band'));
    expect(band?.title).toBe('Bottom band: Constructive → Strong');
    expect(band?.tone).toBe('pos');
    const deploy = events.find((e) => e.id.startsWith('bottom:deploy'));
    expect(deploy?.title).toBe('Suggested deployment: 40-60% → 60-80%');
    expect(deploy?.tone).toBe('pos');
  });

  it('emits a weekly Bottom move attributed to its largest component', () => {
    const history = buildHistory(90, (row, daysAgo) => {
      row.BOTTOM_CAPITULATION_SCORE = 10;
      row.BOTTOM_ONCHAIN_SCORE = 12;
      if (daysAgo <= 3) {
        row.BOTTOM_ACCUM_SCORE = 68; // +8 vs a week ago
        row.BOTTOM_CAPITULATION_SCORE = 17; // +7, the biggest mover
        row.BOTTOM_ONCHAIN_SCORE = 13; // +1
      }
    });
    const mover = deriveModelEvents(history).find((e) => e.id.startsWith('bottom:mover'));
    expect(mover?.title).toBe('Bottom Score +8 pts this week');
    expect(mover?.detail).toBe('Led by Capitulation +7 pts');
    expect(mover?.tone).toBe('pos');
  });

  it('emits SIP exhaustion triggers', () => {
    const history = buildHistory(90, (row, daysAgo) => {
      row.SIP_EXHAUSTED = daysAgo <= 12 ? 1 : 0;
    });
    const sip = deriveModelEvents(history).filter((e) => e.id.startsWith('sip:'));
    expect(sip).toHaveLength(1);
    expect(sip[0].tone).toBe('neg');
    expect(sip[0].daysAgo).toBe(12);
  });

  it('emits every CQM band crossing in the window', () => {
    const risk: RiskPoint[] = [];
    for (let daysAgo = 89; daysAgo >= 0; daysAgo--) {
      // 30 -> crossed into Trim/Hold (60) 20d ago -> back to Accumulate (40) 5d ago.
      const pct = daysAgo > 20 ? 30 : daysAgo > 5 ? 60 : 40;
      risk.push({ date: isoDaysBefore(daysAgo), pct });
    }
    const cqm = deriveModelEvents(buildHistory(90), risk).filter((e) => e.id.startsWith('cqm:band'));
    expect(cqm).toHaveLength(2);
    expect(cqm[0].title).toBe('CQM entered Accumulate');
    expect(cqm[0].tone).toBe('pos');
    expect(cqm[1].title).toBe('CQM entered Trim / Hold');
    expect(cqm[1].tone).toBe('neg');
  });

  it('emits a weekly CQM magnitude move when no band was crossed', () => {
    const risk: RiskPoint[] = [];
    for (let daysAgo = 89; daysAgo >= 0; daysAgo--) {
      // Climbs from 55 to 62 within the Trim/Hold band over the last week.
      const pct = daysAgo >= 7 ? 55 : 62;
      risk.push({ date: isoDaysBefore(daysAgo), pct });
    }
    const events = deriveModelEvents(buildHistory(90), risk);
    expect(events.filter((e) => e.id.startsWith('cqm:band'))).toHaveLength(0);
    const move = events.find((e) => e.id.startsWith('cqm:move'));
    expect(move?.title).toBe('CQM risk climbed 7.0 pp this week');
    expect(move?.tone).toBe('neg');
  });

  it('sorts most recent first', () => {
    const history = buildHistory(90, (row, daysAgo) => {
      if (daysAgo <= 20) row.MACRO_ON = 1;
      if (daysAgo <= 5) row.VAL_SCORE = 3;
    });
    const events = deriveModelEvents(history);
    const dates = events.map((e) => e.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});
