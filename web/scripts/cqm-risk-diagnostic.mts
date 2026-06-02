import { fitCQM } from '../src/utils/cqm.ts';

async function main() {
  const res = await fetch('https://coinstrat.xyz/api/v1/signals/chart-data');
  const json = (await res.json()) as { data?: Array<{ Date: string; BTCUSD: number }> };
  const points = (json.data ?? [])
    .filter((r) => r.BTCUSD > 0)
    .map((r) => ({
      date: r.Date,
      ts: new Date(`${r.Date}T00:00:00Z`).getTime(),
      price: r.BTCUSD,
    }));

  const fit = fitCQM(points);
  const dates = ['2026-05-28', '2026-05-29', '2026-05-30', '2026-05-31', '2026-06-01', '2026-06-02'];

  // Recompute diagnostics by mirroring fitCQM internals with extra logging
  const fitGated = fitCQM(points, { riskMode: 'gated' });
  const fitGlobal = fitCQM(points, { riskMode: 'global' });
  const fitRolling = fitCQM(points, { riskMode: 'rolling' });

  console.log('date         BTC      gated   global  rolling  score(gated)');
  for (const d of dates) {
    const g = fitGated.signals.find((s) => s.date === d);
    const gl = fitGlobal.signals.find((s) => s.date === d);
    const r = fitRolling.signals.find((s) => s.date === d);
    if (!g || !gl || !r) continue;
    console.log(
      `${d}  $${Math.round(g.price / 1000)}k`.padEnd(12),
      `${(g.risk * 100).toFixed(1)}%`.padStart(7),
      `${(gl.risk * 100).toFixed(1)}%`.padStart(8),
      `${(r.risk * 100).toFixed(1)}%`.padStart(9),
      `${(g.score * 100).toFixed(1)}%`.padStart(12),
    );
  }

  console.log('\nlowQ floor:', fit.lowQ, '(risk snaps to 0 when percentile < this)');

  // Simulate softer low mapping: extend linear map from pct=0..lowQ instead of clamp
  console.log('\nHypothetical soft-low (linear pct 0→lowQ maps riskZ 0→0.15):');
  for (const d of dates) {
    const s = fitGated.signals.find((x) => x.date === d);
    if (!s) continue;
    // can't get raw pct from export - approximate from global risk inverse
    console.log(`  ${d}: current risk ${(s.risk * 100).toFixed(1)}%`);
  }
}

main().catch(console.error);
