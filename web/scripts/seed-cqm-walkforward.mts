/**
 * Seed the production `cqm_walkforward` blob from local BTC history.
 *
 * The full causal walk-forward pass takes ~3 min of single-threaded CPU and can
 * exceed the Netlify Lambda budget, so the reliable way to (re)seed is to
 * compute it locally and push the result straight to the blob store:
 *
 *   npx tsx scripts/seed-cqm-walkforward.mts
 *   npx netlify blobs:set signals cqm_walkforward \
 *     -i scripts/output/cqm_walkforward_payload.json --force
 *
 * After seeding, the daily signal refresh keeps the map current via the cheap
 * incremental extension (see lib/cqmWalkForwardCache.ts).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  buildWalkForwardRiskMap,
  WALK_FORWARD_DEFAULT_FROM_DATE,
  type CqmPricePoint,
} from '../src/utils/cqmWalkForward';

const REFIT_DAYS = 90;
const OUT_PATH = new URL('./output/cqm_walkforward_payload.json', import.meta.url);

const raw = JSON.parse(
  readFileSync(new URL('../public/data/btc_daily.json', import.meta.url), 'utf8'),
) as Array<{ date: string; close: number }>;

const points: CqmPricePoint[] = [];
for (const r of raw) {
  const price = Number(r.close);
  if (!r.date || !Number.isFinite(price) || price <= 0) continue;
  const ts = new Date(`${r.date}T00:00:00Z`).getTime();
  if (!Number.isFinite(ts)) continue;
  points.push({ date: r.date, ts, price });
}
points.sort((a, b) => a.date.localeCompare(b.date));
console.log('points:', points.length, 'first:', points[0]?.date, 'last:', points.at(-1)?.date);

const t0 = Date.now();
const riskMap = buildWalkForwardRiskMap(points, { refitEveryDays: REFIT_DAYS });
console.log(`compute done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const data = Array.from(riskMap.entries())
  .map(([date, risk]) => ({ date, risk }))
  .sort((a, b) => a.date.localeCompare(b.date));

const payload = {
  timestamp: Date.now(),
  refit_every_days: REFIT_DAYS,
  from_date: WALK_FORWARD_DEFAULT_FROM_DATE,
  latest_date: data.at(-1)?.date ?? null,
  count: data.length,
  data,
};

writeFileSync(OUT_PATH, JSON.stringify(payload));
console.log('wrote payload:', OUT_PATH.pathname);
console.log('count:', payload.count, 'latest_date:', payload.latest_date);
console.log('last 3:', data.slice(-3));
