import React from 'react';
import { SignalData } from '../App';
import { HelpCircle, ArrowRight, Layers, Wind, Landmark, Gauge } from 'lucide-react';

interface Props {
  current: SignalData;
}

const ScoreBreakdown: React.FC<Props> = ({ current }) => {
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3 border-b pb-4">
        <Layers className="h-8 w-8 text-blue-600" />
        <h2 className="text-3xl font-black text-slate-800 tracking-tight">Factor Deep-Dive</h2>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Liquidity Score */}
        <ScoreCard 
          title="Liquidity (LIQ_SCORE)" 
          score={current.LIQ_SCORE}
          icon={<Wind className="h-6 w-6 text-blue-500" />}
          description="Measures the 'Net Liquidity' impulse in the US financial system."
          formula="Fed Assets (WALCL) - Treasury Account (TGA) - Reverse Repo (RRP)"
          rules={[
            { condition: "US_LIQ YoY > 0", result: "Score 2 (Expanding)" },
            { condition: "US_LIQ YoY ≤ 0 AND 13-week change > 0", result: "Score 1 (Inflecting Up)" },
            { condition: "Otherwise", result: "Score 0 (Contracting)" }
          ]}
        />

        {/* Cycle Score */}
        <ScoreCard 
          title="Business Cycle (CYCLE_SCORE_V2)" 
          score={current.CYCLE_SCORE_V2}
          icon={<Landmark className="h-6 w-6 text-emerald-500" />}
          description="A multi-factor 'Nowcast' of the US economic cycle."
          formula="Sahm Rule + 10Y/3M Yield Curve + Manufacturing New Orders"
          rules={[
            { condition: "Sahm < 0.35 AND YC ≥ 0.75 AND Orders YoY ≥ 0", result: "Score 2 (Expansion)" },
            { condition: "Sahm ≥ 0.50 OR YC < 0 OR Orders deteriorating", result: "Score 0 (Recession Risk)" },
            { condition: "Otherwise", result: "Score 1 (Stabilizing)" }
          ]}
        />

        {/* DXY Score */}
        <ScoreCard 
          title="USD Regime (DXY_SCORE)" 
          score={current.DXY_SCORE}
          icon={<Gauge className="h-6 w-6 text-orange-500" />}
          description="Captures the 'Global Dollar' headwind/tailwind for risk assets."
          formula="DXY price vs MA50, MA200 and 20-day Rate of Change"
          rules={[
            { condition: "DXY 20-day ROC < -0.5% (Weakening)", result: "Score 2 (Supportive)" },
            { condition: "DXY 20-day ROC > 0.5% (Strengthening)", result: "Score 0 (Headwind)" },
            { condition: "Otherwise", result: "Score 1 (Neutral)" }
          ]}
        />

        {/* Valuation Score */}
        <ScoreCard 
          title="Valuation (VAL_SCORE)" 
          score={current.VAL_SCORE}
          icon={<Landmark className="h-6 w-6 text-purple-500" />}
          description="Determines if Bitcoin is fundamentally cheap or expensive."
          formula="MVRV Ratio (Market Cap / Realized Cap)"
          rules={[
            { condition: "MVRV < 1.0", result: "Score 2 (Deep Value)" },
            { condition: "1.0 ≤ MVRV < 1.8", result: "Score 1 (Fair Value)" },
            { condition: "MVRV ≥ 1.8", result: "Score 0 (Overheated)" }
          ]}
        />
      </div>
    </div>
  );
};

const ScoreCard = ({ title, score, icon, description, formula, rules }: any) => (
  <div className="rounded-2xl border bg-white p-6 shadow-sm flex flex-col h-full">
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        {icon}
        <h3 className="font-bold text-slate-800">{title}</h3>
      </div>
      <div className={`rounded-lg px-3 py-1 text-2xl font-black ${
        score === 0 ? 'bg-red-50 text-red-600' :
        score === 1 ? 'bg-blue-50 text-blue-600' :
        'bg-green-50 text-green-600'
      }`}>
        {score}
      </div>
    </div>
    
    <p className="text-sm text-slate-600 mb-4 italic">{description}</p>
    
    <div className="mb-6 rounded-lg bg-slate-50 p-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Calculation Proxy</div>
      <div className="text-xs font-mono text-slate-700">{formula}</div>
    </div>

    <div className="space-y-2 mt-auto">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Logic Gates</div>
      {rules.map((rule: any, i: number) => (
        <div key={i} className="flex items-center justify-between text-xs p-2 rounded border border-slate-50 bg-slate-50/30">
          <span className="text-slate-500 font-medium">{rule.condition}</span>
          <ArrowRight className="h-3 w-3 text-slate-300" />
          <span className="font-bold text-slate-700">{rule.result}</span>
        </div>
      ))}
    </div>
  </div>
);

export default ScoreBreakdown;

