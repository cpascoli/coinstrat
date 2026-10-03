import { runFrontPageGeneration, type FrontPageResult } from './frontPage';

export interface DailyNewsSource {
  title: string;
  url: string;
  source: string;
}

export interface DailyNewsResult {
  ok: boolean;
  skipped: boolean;
  reason: string;
  slug: string | null;
  date: string;
  sourceCount: number;
  run?: FrontPageResult;
}

/**
 * Compatibility wrapper around the four-section front page job.
 * Prefer `runFrontPageGeneration` for new callers.
 */
export async function runDailyNewsGeneration(referenceDate?: Date): Promise<DailyNewsResult> {
  const result = await runFrontPageGeneration({ now: referenceDate });
  const market = result.sections.market;
  const published = Object.values(result.sections).filter((section) => section.status === 'published').length;
  return {
    ok: result.ok,
    skipped: published === 0 && !result.error,
    reason: result.error ?? Object.values(result.sections).map((section) => `${section.section}: ${section.status}`).join('; '),
    slug: market.slug,
    date: result.date,
    sourceCount: published,
    run: result,
  };
}
