import React, { useMemo } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  Legend, AreaChart, Area, ReferenceArea 
} from 'recharts';
import { SignalData } from '../App';
import { format } from 'date-fns';
import { Activity } from 'lucide-react';
import { Box, Paper, Typography } from '@mui/material';

interface Props {
  data: SignalData[];
}

const ChartsView: React.FC<Props> = ({ data }) => {
  // We only show the last 2 years for performance and clarity by default
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    
    return data.slice(-730).map(d => {
      let dateObj: Date;
      try {
        // Handle both "YYYY-MM-DD" and other potential formats
        dateObj = new Date(d.Date);
        if (isNaN(dateObj.getTime())) throw new Error("Invalid date");
      } catch (e) {
        dateObj = new Date(); // Fallback
      }

      return {
        ...d,
        displayDate: format(dateObj, 'MMM yy'),
        fullDate: format(dateObj, 'yyyy-MM-dd')
      };
    });
  }, [data]);

  if (!data || data.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white">
        <div className="text-center text-slate-400">
          <Activity className="mx-auto mb-2 h-8 w-8 opacity-20" />
          <p>No signal data available to chart.</p>
        </div>
      </div>
    );
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg border bg-white p-4 shadow-xl">
          <p className="mb-2 font-bold text-slate-800">{payload[0].payload.fullDate}</p>
          <div className="space-y-1">
            {payload.map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-8">
                <span className="text-xs text-slate-500" style={{ color: p.color }}>{p.name}:</span>
                <span className="text-xs font-mono font-bold text-slate-800">
                  {p.name.includes('BTC') ? `$${p.value.toLocaleString()}` : 
                   p.name.includes('LIQ') && !p.name.includes('SCORE') ? `$${(p.value / 1e6).toFixed(2)}T` : 
                   p.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Activity className="h-8 w-8 text-blue-600" />
        <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: -0.5 }}>
          Interactive Analytics
        </Typography>
      </Box>

      {/* Main Chart: BTC + Liquidity Overlay */}
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            BTC Price & US Net Liquidity
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            Log scale BTC (Left) with US Liquidity Proxy (Right)
          </Typography>
        </Box>
        
        {/* IMPORTANT: set an explicit height so Recharts never renders into a 0px container in production */}
        <Box sx={{ height: { xs: 360, sm: 460, md: 520 }, width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis 
                dataKey="displayDate" 
                interval={60} 
                tick={{ fontSize: 10, fill: '#64748b' }} 
                axisLine={false}
                tickLine={false}
              />
              <YAxis 
                yAxisId="left" 
                domain={['auto', 'auto']} 
                tick={{ fontSize: 10, fill: '#64748b' }} 
                axisLine={false}
                tickLine={false}
                tickFormatter={(val) => {
                  if (typeof val !== 'number' || isNaN(val)) return '';
                  return `$${Math.round(val/1000)}k`;
                }}
              />
              <YAxis 
                yAxisId="right" 
                orientation="right" 
                domain={['auto', 'auto']}
                tick={{ fontSize: 10, fill: '#64748b' }} 
                axisLine={false}
                tickLine={false}
                tickFormatter={(val) => {
                  if (typeof val !== 'number' || isNaN(val)) return '';
                  return `$${(val/1e6).toFixed(1)}T`;
                }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend verticalAlign="top" height={36} iconType="circle" />
              
              <Line 
                yAxisId="left"
                type="monotone" 
                dataKey="BTCUSD" 
                name="BTC Price"
                stroke="#000" 
                strokeWidth={2} 
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
              <Line 
                yAxisId="right"
                type="monotone" 
                dataKey="US_LIQ" 
                name="US Net Liquidity"
                stroke="#3b82f6" 
                strokeWidth={2} 
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Paper>

      {/* Scoring Timeline Section */}
      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
            Liquidity & Cycle Regimes
          </Typography>
          <Box sx={{ height: 280, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="displayDate" interval={120} tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 2]} ticks={[0, 1, 2]} tick={{ fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="stepAfter" dataKey="LIQ_SCORE" name="LIQ_SCORE" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} isAnimationActive={false} />
                <Area type="stepAfter" dataKey="CYCLE_SCORE_V2" name="CYCLE_SCORE" stroke="#10b981" fill="#10b981" fillOpacity={0.1} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        </Paper>

        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
            Permission Logic History
          </Typography>
          <Box sx={{ height: 280, width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="displayDate" interval={120} tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 1]} ticks={[0, 1]} tick={{ fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="stepAfter" dataKey="CORE_ON" name="CORE_ON" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} isAnimationActive={false} />
                <Area type="stepAfter" dataKey="MACRO_ON" name="MACRO_ON" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.3} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        </Paper>
      </Box>
    </Box>
  );
};

export default ChartsView;

