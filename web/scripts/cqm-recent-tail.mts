import { fitCQM } from '../src/utils/cqm.ts';

async function main() {
  const res = await fetch('https://coinstrat.xyz/api/v1/signals/chart-data');
  const json = (await res.json()) as { data?: Array<{ Date: string; BTCUSD: number }> };
  const rows = json.data ?? [];
  const points = rows
    .filter((r) => r.BTCUSD > 0)
    .map((r) => ({
      date: r.Date,
      ts: new Date(`${r.Date}T00:00:00Z`).getTime(),
      price: r.BTCUSD,
    }));

  const fit = fitCQM(points);
  const tail = fit.signals.filter((s) => s.date >= '2026-05-20');
  for (const s of tail) {
    const vsTrend = ((s.price / s.trendOls - 1) * 100).toFixed(1);
    console.log(
      `${s.date}  BTC $${Math.round(s.price).toLocaleString()}  risk ${(s.risk * 100).toFixed(1)}%  score ${(s.score * 100).toFixed(1)}%  vs OLS trend ${vsTrend}%`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
