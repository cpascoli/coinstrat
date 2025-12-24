import React from 'react';
import { BookOpen, ShieldCheck, Zap, Layers, RefreshCw } from 'lucide-react';

const Documentation: React.FC = () => {
  return (
    <div className="mx-auto max-w-4xl space-y-12">
      <div className="text-center space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg">
          <BookOpen className="h-8 w-8" />
        </div>
        <h1 className="text-4xl font-black text-slate-900 tracking-tight">Model Methodology</h1>
        <p className="text-lg text-slate-500">The Coin Strat Pre-Accumulation Framework (2026 Edition)</p>
      </div>

      <section className="space-y-6">
        <div className="flex items-center gap-3 border-b pb-2">
          <Layers className="h-6 w-6 text-blue-600" />
          <h2 className="text-2xl font-bold text-slate-800">System Architecture</h2>
        </div>
        <p className="text-slate-600 leading-relaxed">
          The Coin Strat model is a multi-factor regime-switching engine designed to navigate the highly volatile Bitcoin market. 
          Unlike traditional "Buy and Hold" strategies, this system dynamically adjusts capital exposure based on the confluence 
          of global liquidity, macroeconomic health, and crypto-native valuation metrics.
        </p>
        <div className="grid gap-6 md:grid-cols-3">
          <DocCard 
            title="Data Ingestion" 
            text="Real-time feeds from FRED (Federal Reserve), Stooq, and Blockchain.info provide the foundation."
          />
          <DocCard 
            title="Regime Scoring" 
            text="Raw data is normalized into 0-2 scores to determine if a specific factor is a headwind or tailwind."
          />
          <DocCard 
            title="Action Synthesis" 
            text="Scores are aggregated into a permission-based hierarchy (PAUSE, BASE, ACCELERATED)."
          />
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex items-center gap-3 border-b pb-2">
          <RefreshCw className="h-6 w-6 text-blue-600" />
          <h2 className="text-2xl font-bold text-slate-800">The Accumulation Hierarchy</h2>
        </div>
        
        <div className="rounded-2xl bg-slate-100 p-8 space-y-8">
          <div className="flex gap-6">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
              <ShieldCheck className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Tier 1: Core Accumulation (CORE_ON)</h3>
              <p className="text-sm text-slate-600 leading-relaxed italic">
                The "Engine." Focuses on multi-month accumulation during deep-value phases. It uses MVRV to identify 
                capitulation bottoms and the 40-week Moving Average to confirm the trend.
              </p>
            </div>
          </div>

          <div className="flex gap-6">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
              <Zap className="h-6 w-6 text-amber-500" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Tier 2: Macro Acceleration (MACRO_ON)</h3>
              <p className="text-sm text-slate-600 leading-relaxed italic">
                The "Turbo." Activates when the external environment is highly favorable. If US Net Liquidity is expanding 
                and the Business Cycle is out of the danger zone, the model permits triple-sizing the accumulation rate.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-blue-100 bg-blue-50/50 p-8">
        <h2 className="text-xl font-bold text-blue-900 mb-4">Philosophy of Capital Protection</h2>
        <p className="text-blue-800 text-sm leading-relaxed">
          The primary goal of the model is not to pick the exact bottom, but to <strong>stay out of the market during liquidity contractions.</strong> 
          By forcing a "PAUSE" when DXY (USD) is rising sharply or the Sahm Rule triggers a recession alert, the system aims to 
          preserve dry powder for the high-probability periods when liquidity is abundant.
        </p>
      </section>
    </div>
  );
};

const DocCard = ({ title, text }: any) => (
  <div className="rounded-xl border bg-white p-5 shadow-sm">
    <h4 className="font-bold text-slate-800 mb-2">{title}</h4>
    <p className="text-xs text-slate-500 leading-relaxed">{text}</p>
  </div>
);

export default Documentation;

