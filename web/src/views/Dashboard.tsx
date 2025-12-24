import React from 'react';
import { SignalData } from '../App';
import { AlertTriangle, CheckCircle2, PlayCircle, PauseCircle, TrendingUp, Info, Activity } from 'lucide-react';

interface Props {
  current: SignalData;
  history: SignalData[];
}

const Dashboard: React.FC<Props> = ({ current, history }) => {
  // Determine recommendation (mirroring dashboard_2026.py logic)
  const getRecommendation = () => {
    const accum = current.ACCUM_ON;
    const macro = current.MACRO_ON;
    const pr = current.PRICE_REGIME_ON;
    const dxy = current.DXY_SCORE;
    const liq = current.LIQ_SCORE;
    const cyc = current.CYCLE_SCORE_V2;
    const val = current.VAL_SCORE;

    let action: 'PAUSE' | 'BASE' | 'ACCEL' = 'PAUSE';
    let reason = '';
    const blockers: string[] = [];

    if (pr === 0) blockers.push("Price regime OFF (below long-term trend filter).");
    if (dxy === 0) blockers.push("USD regime risk-off (DXY strengthening).");
    if (liq === 0) blockers.push("Liquidity contracting/worsening.");
    if (cyc === 0) blockers.push("Business cycle contraction-risk elevated.");
    if (val === 0) blockers.push("Valuation overheated.");

    if (accum === 0) {
      action = 'PAUSE';
      reason = "Accumulation permission is OFF. Capital protection prioritized.";
    } else if (macro === 1) {
      action = 'ACCEL';
      reason = "Accumulation permitted with Macro Accelerator active (Liquidity/Cycle tailwinds).";
    } else {
      action = 'BASE';
      reason = "Base accumulation permitted. No macro acceleration detected.";
    }

    return { action, reason, blockers };
  };

  const rec = getRecommendation();

  return (
    <div className="space-y-6">
      {/* Hero Recommendation */}
      <div className={`rounded-2xl border-2 p-8 shadow-sm transition-all ${
        rec.action === 'PAUSE' ? 'border-red-100 bg-red-50/50' : 
        rec.action === 'ACCEL' ? 'border-green-100 bg-green-50/50' : 
        'border-blue-100 bg-blue-50/50'
      }`}>
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <span className="text-sm font-bold uppercase tracking-wider text-slate-500">Current Action</span>
            <div className="mt-1 flex items-center gap-3">
              {rec.action === 'PAUSE' && <PauseCircle className="h-10 w-10 text-red-500" />}
              {rec.action === 'ACCEL' && <TrendingUp className="h-10 w-10 text-green-500" />}
              {rec.action === 'BASE' && <PlayCircle className="h-10 w-10 text-blue-500" />}
              <h1 className={`text-5xl font-black ${
                rec.action === 'PAUSE' ? 'text-red-600' : 
                rec.action === 'ACCEL' ? 'text-green-600' : 
                'text-blue-600'
              }`}>{rec.action}</h1>
            </div>
            <p className="mt-4 text-lg font-medium text-slate-700">{rec.reason}</p>
          </div>
          
          <div className="flex flex-col items-center gap-2 rounded-xl bg-white p-6 shadow-sm border border-slate-100">
            <span className="text-sm font-medium text-slate-500">BTC Price</span>
            <span className="text-3xl font-bold">${current.BTCUSD.toLocaleString()}</span>
            <div className={`flex items-center gap-1 text-sm font-bold ${current.PRICE_REGIME_ON ? 'text-green-600' : 'text-red-600'}`}>
              {current.PRICE_REGIME_ON ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              Trend {current.PRICE_REGIME_ON ? 'Positive' : 'Negative'}
            </div>
          </div>
        </div>

        {rec.blockers.length > 0 && (
          <div className="mt-8 rounded-lg bg-white/50 p-4 border border-slate-200">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-600 mb-2">
              <Info className="h-4 w-4" /> ACTIVE BLOCKERS & RISKS
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {rec.blockers.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                  {b}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Quick Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Liquidity Score" value={current.LIQ_SCORE} max={2} icon={<Activity className="text-blue-500" />} />
        <StatCard title="Business Cycle" value={current.CYCLE_SCORE_V2} max={2} icon={<TrendingUp className="text-emerald-500" />} />
        <StatCard title="USD Regime" value={current.DXY_SCORE} max={2} icon={<Activity className="text-orange-500" />} />
        <StatCard title="Valuation" value={current.VAL_SCORE} max={2} icon={<Info className="text-purple-500" />} />
      </div>

      {/* Raw Data Table Snapshot */}
      <div className="rounded-xl border bg-white overflow-hidden shadow-sm">
        <div className="border-b bg-slate-50 px-6 py-4">
          <h3 className="font-bold text-slate-700">Snapshot Metrics</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50/50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-6 py-3 font-bold">Metric</th>
                <th className="px-6 py-3 font-bold text-right">Value</th>
                <th className="px-6 py-3 font-bold text-right">Regime</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <MetricRow label="US Net Liquidity" value={`$${(current.US_LIQ / 1e6).toFixed(2)}T`} score={current.LIQ_SCORE} />
              <MetricRow label="Liquidity YoY" value={`${current.US_LIQ_YOY.toFixed(1)}%`} score={current.LIQ_SCORE} />
              <MetricRow label="Sahm Rule (Unemployment)" value={current.SAHM?.toFixed(2) ?? 'N/A'} score={current.CYCLE_SCORE_V2} />
              <MetricRow label="Yield Curve (10Y-3M)" value={current.YC_M?.toFixed(2) ?? 'N/A'} score={current.CYCLE_SCORE_V2} />
              <MetricRow label="MVRV Ratio" value={current.MVRV?.toFixed(2) ?? 'N/A'} score={current.VAL_SCORE} />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, max, icon }: any) => (
  <div className="rounded-xl border bg-white p-6 shadow-sm">
    <div className="flex items-center justify-between mb-4">
      <span className="text-sm font-bold text-slate-500 uppercase">{title}</span>
      {icon}
    </div>
    <div className="flex items-baseline gap-2">
      <span className="text-3xl font-bold">{value}</span>
      <span className="text-slate-400">/ {max}</span>
    </div>
    <div className="mt-4 h-2 w-full rounded-full bg-slate-100">
      <div 
        className={`h-full rounded-full transition-all ${
          value === 0 ? 'bg-red-400 w-1/4' : 
          value === 1 ? 'bg-blue-400 w-2/4' : 
          'bg-green-400 w-full'
        }`}
      />
    </div>
  </div>
);

const MetricRow = ({ label, value, score }: any) => (
  <tr>
    <td className="px-6 py-4 font-medium text-slate-700">{label}</td>
    <td className="px-6 py-4 text-right font-mono text-slate-600">{value}</td>
    <td className="px-6 py-4 text-right">
      <span className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${
        score === 0 ? 'bg-red-100 text-red-700' :
        score === 1 ? 'bg-blue-100 text-blue-700' :
        'bg-green-100 text-green-700'
      }`}>
        {score === 0 ? 'RISK' : score === 1 ? 'NEUTRAL' : 'OPTIMAL'}
      </span>
    </td>
  </tr>
);

export default Dashboard;

