import React from 'react';
import { SignalData } from '../App';
import { Binary, ShieldCheck, Zap, ToggleRight, CheckSquare, XCircle, ArrowDown } from 'lucide-react';

interface Props {
  current: SignalData;
}

const LogicFlow: React.FC<Props> = ({ current }) => {
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3 border-b pb-4">
        <Binary className="h-8 w-8 text-blue-600" />
        <h2 className="text-3xl font-black text-slate-800 tracking-tight">Signal Synthesis Logic</h2>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Core Logic Section */}
        <div className="space-y-6">
          <SectionHeader 
            icon={<ShieldCheck className="text-blue-500" />} 
            title="CORE_ON: The Strategic Engine" 
            status={current.CORE_ON === 1}
          />
          
          <div className="rounded-xl border bg-white p-6 shadow-sm space-y-4">
            <p className="text-sm text-slate-600 leading-relaxed">
              The <strong>CORE_ON</strong> signal is a state-machine that manages "Value-led" accumulation. 
              It allows entry when BTC is objectively cheap, or when price momentum confirms a bottom in fair-value.
            </p>
            
            <div className="space-y-3">
              <LogicStep 
                title="Entry Condition" 
                logic="(VAL=2) OR (VAL=1 AND PRICE_REGIME=1)" 
                active={current.CORE_ON === 1} 
              />
              <ArrowDown className="mx-auto h-4 w-4 text-slate-300" />
              <LogicStep 
                title="Risk Filter" 
                logic="DXY_SCORE ≥ 1" 
                active={current.DXY_SCORE >= 1} 
              />
              <ArrowDown className="mx-auto h-4 w-4 text-slate-300" />
              <LogicStep 
                title="Exit Condition" 
                logic="DXY_SCORE = 0 AND PRICE_REGIME = 0" 
                active={current.DXY_SCORE === 0 && current.PRICE_REGIME_ON === 0} 
                isExit
              />
            </div>
          </div>
        </div>

        {/* Macro Accelerator Section */}
        <div className="space-y-6">
          <SectionHeader 
            icon={<Zap className="text-amber-500" />} 
            title="MACRO_ON: The Tactical Accelerator" 
            status={current.MACRO_ON === 1}
          />

          <div className="rounded-xl border bg-white p-6 shadow-sm space-y-4">
            <p className="text-sm text-slate-600 leading-relaxed">
              The <strong>MACRO_ON</strong> signal is a high-conviction "Throttle" that activates when 
              liquidity and the business cycle are perfectly aligned for risk assets.
            </p>

            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-100">
                <div className="text-xs font-bold text-slate-400 mb-2 uppercase">Accelerator Formula</div>
                <div className="text-lg font-mono font-bold text-slate-800">
                  (LIQ + CYCLE ≥ 3) AND (DXY ≥ 1)
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <StatusLight label="LIQ_SCORE" value={current.LIQ_SCORE} />
                <StatusLight label="CYCLE_SCORE" value={current.CYCLE_SCORE_V2} />
                <StatusLight label="DXY_SCORE" value={current.DXY_SCORE} />
                <StatusLight label="RESULT" value={current.MACRO_ON === 1 ? 'ON' : 'OFF'} isResult />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Final Aggregate Section */}
      <div className="rounded-2xl border bg-slate-900 p-8 text-white shadow-xl">
        <div className="flex items-center gap-4 mb-6">
          <ToggleRight className="h-10 w-10 text-blue-400" />
          <div>
            <h2 className="text-2xl font-bold">ACCUM_ON: Final Permission</h2>
            <p className="text-slate-400 text-sm italic">"The definitive binary switch for capital deployment"</p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-center justify-center gap-8 py-4">
          <FinalBadge label="CORE ENGINE" active={current.CORE_ON === 1} />
          <div className="text-3xl font-black text-slate-700">OR</div>
          <FinalBadge label="MACRO ACCELERATOR" active={current.MACRO_ON === 1} />
          <div className="text-3xl font-black text-slate-700 md:rotate-0 rotate-90">=</div>
          <div className={`rounded-2xl px-12 py-6 text-center border-4 ${
            current.ACCUM_ON === 1 ? 'border-green-500/50 bg-green-500/10' : 'border-red-500/50 bg-red-500/10'
          }`}>
            <div className="text-sm font-bold uppercase tracking-widest mb-1">Final Signal</div>
            <div className={`text-5xl font-black ${current.ACCUM_ON === 1 ? 'text-green-400' : 'text-red-400'}`}>
              {current.ACCUM_ON === 1 ? 'ON' : 'OFF'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const SectionHeader = ({ icon, title, status }: any) => (
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-3">
      {icon}
      <h3 className="text-xl font-bold text-slate-800">{title}</h3>
    </div>
    <div className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-black uppercase tracking-widest ${
      status ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
    }`}>
      {status ? <CheckSquare className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {status ? 'Active' : 'Idle'}
    </div>
  </div>
);

const LogicStep = ({ title, logic, active, isExit }: any) => (
  <div className={`rounded-lg border-2 p-3 text-center transition-all ${
    active ? (isExit ? 'border-red-200 bg-red-50' : 'border-blue-200 bg-blue-50') : 'border-slate-100 bg-white opacity-60'
  }`}>
    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{title}</div>
    <div className={`text-sm font-mono font-bold ${active ? 'text-slate-800' : 'text-slate-500'}`}>{logic}</div>
  </div>
);

const StatusLight = ({ label, value, isResult }: any) => (
  <div className="flex flex-col items-center justify-center p-3 rounded-lg bg-slate-50 border border-slate-100">
    <div className="text-[10px] font-bold text-slate-400 mb-1">{label}</div>
    <div className={`text-lg font-black ${
      isResult 
        ? (value === 'ON' ? 'text-green-600' : 'text-slate-400')
        : (value === 0 ? 'text-red-500' : value === 1 ? 'text-blue-500' : 'text-green-600')
    }`}>
      {value}
    </div>
  </div>
);

const FinalBadge = ({ label, active }: any) => (
  <div className={`rounded-xl px-6 py-4 text-center border-2 transition-all ${
    active ? 'border-blue-500/50 bg-blue-500/10 text-white' : 'border-slate-700 bg-slate-800 text-slate-500'
  }`}>
    <div className="text-[10px] font-bold uppercase tracking-widest mb-1 opacity-70">{label}</div>
    <div className="text-lg font-black">{active ? 'ENABLED' : 'DISABLED'}</div>
  </div>
);

export default LogicFlow;

