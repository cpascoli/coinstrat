import React, { useMemo } from 'react';
import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import type { SignalData } from '../../App';
import { fitCQM, priceForRiskFair, snapshotAt } from '../../utils/cqm';
import {
  CQM_DEFAULT_MAX_CASH_FRACTION,
  CQM_DEFAULT_SELL_THRESHOLD,
  CQM_FAIR_RISK,
} from '../../utils/cqmSizing';
import { CQM_RISK_GRADIENT_CSS } from '../../utils/cqmRiskGradient';

type Band = 0 | 1 | 2 | 3;

const BANDS: { label: string; color: string; soft: string }[] = [
  { label: 'Buy zone', color: '#22c55e', soft: 'rgba(34,197,94,0.16)' },
  { label: 'Accumulate', color: '#84cc16', soft: 'rgba(132,204,22,0.16)' },
  { label: 'Trim / Hold', color: '#f59e0b', soft: 'rgba(245,158,11,0.16)' },
  { label: 'Sell zone', color: '#ef4444', soft: 'rgba(239,68,68,0.16)' },
];

function bandOf(riskPct: number): Band {
  if (riskPct < 25) return 0;
  if (riskPct < 50) return 1;
  if (riskPct < 75) return 2;
  return 3;
}

// --- SVG semicircular gauge --------------------------------------------------
// Risk 0 → 180° (left), 100 → 0° (right); upper semicircle, y-down screen space.
function polar(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
}

function arcPath(cx: number, cy: number, r: number, startPct: number, endPct: number): string {
  const a0 = 180 - 1.8 * startPct;
  const a1 = 180 - 1.8 * endPct;
  const p0 = polar(cx, cy, r, a0);
  const p1 = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

const RiskGauge: React.FC<{ riskPct: number }> = ({ riskPct }) => {
  const cx = 130;
  const cy = 132;
  const r = 104;
  const thickness = 22;
  const v = Math.max(0, Math.min(100, riskPct));
  const band = bandOf(v);
  const needle = polar(cx, cy, r - thickness / 2, 180 - 1.8 * v);
  const hub = polar(cx, cy, 0, 0);

  return (
    <Box sx={{ width: '100%', maxWidth: 320, mx: 'auto' }}>
      <svg viewBox="0 0 260 156" width="100%" role="img" aria-label={`Current CQM risk ${v.toFixed(1)} percent`}>
        {/* track */}
        <path d={arcPath(cx, cy, r, 0, 100)} fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth={thickness} strokeLinecap="butt" />
        {/* colored zones */}
        {BANDS.map((b, i) => (
          <path
            key={b.label}
            d={arcPath(cx, cy, r, i * 25, (i + 1) * 25)}
            fill="none"
            stroke={b.color}
            strokeOpacity={band === i ? 1 : 0.4}
            strokeWidth={thickness}
            strokeLinecap="butt"
          />
        ))}
        {/* needle */}
        <line x1={hub.x} y1={hub.y} x2={needle.x} y2={needle.y} stroke="#f8fafc" strokeWidth={3} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={7} fill="#0f172a" stroke="#f8fafc" strokeWidth={2.5} />
        {/* end labels */}
        <text x={cx - r} y={cy + 18} textAnchor="middle" fontSize="10" fill="#64748b">0%</text>
        <text x={cx + r} y={cy + 18} textAnchor="middle" fontSize="10" fill="#64748b">100%</text>
        {/* center readout */}
        <text x={cx} y={cy - 30} textAnchor="middle" fontSize="42" fontWeight="800" fill={BANDS[band].color}>
          {v.toFixed(0)}
          <tspan fontSize="20" fill="#94a3b8">%</tspan>
        </text>
      </svg>
    </Box>
  );
};

// --- Overview ----------------------------------------------------------------
const CqmOverview: React.FC<{ current: SignalData; history: SignalData[] }> = ({ history }) => {
  const model = useMemo(() => {
    const points: { date: string; ts: number; price: number }[] = [];
    for (const d of history) {
      const price = Number(d.BTCUSD);
      const ts = new Date(d.Date).getTime();
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(ts)) continue;
      points.push({ date: d.Date, ts, price });
    }
    if (points.length < 365) return null;
    try {
      const fit = fitCQM(points);
      const snap = snapshotAt(fit);
      if (!snap) return null;
      const levels = [0, 0.25, 0.5, 0.75, 1].map((rr) => ({
        risk: rr,
        price: priceForRiskFair(fit, snap.ts, rr),
      }));
      return { snap, levels };
    } catch {
      return null;
    }
  }, [history]);

  if (!model) {
    return (
      <Paper sx={{ p: 3 }}>
        <Typography variant="body2" color="text.secondary">
          Not enough BTC history yet to fit the CQM (needs ≥365 daily prices).
        </Typography>
      </Paper>
    );
  }

  const { snap, levels } = model;
  const riskPct = snap.risk * 100;
  const band = bandOf(riskPct);
  const premiumPct = ((snap.price / snap.qrDashedMedian) - 1) * 100;

  // Current bot stance from the live sizing rule (qualitative — no balances here).
  let stance: { verb: string; detail: string };
  if (snap.risk < CQM_FAIR_RISK) {
    const taper = (CQM_FAIR_RISK - snap.risk) / CQM_FAIR_RISK;
    const cashFracPct = CQM_DEFAULT_MAX_CASH_FRACTION * taper * 100;
    stance = {
      verb: 'Accumulating',
      detail: `Deploys up to ${cashFracPct.toFixed(1)}% of idle cash per period (floor: ${Math.max(0, 1 - 2 * snap.risk).toFixed(2)}× base DCA).`,
    };
  } else if (snap.risk <= CQM_DEFAULT_SELL_THRESHOLD) {
    stance = { verb: 'Holding', detail: 'In the 50–75% dead zone — no new buys, no sells.' };
  } else {
    const sellScale = (snap.risk - CQM_DEFAULT_SELL_THRESHOLD) / (1 - CQM_DEFAULT_SELL_THRESHOLD);
    stance = {
      verb: 'Distributing',
      detail: `Selling at ${(sellScale * 100).toFixed(0)}% of full size, scaling to 100% at peak risk.`,
    };
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Hero */}
      <Paper
        sx={{
          p: { xs: 2.5, sm: 3.5 },
          background: `radial-gradient(120% 140% at 0% 0%, ${BANDS[band].soft} 0%, rgba(15,23,42,0) 55%)`,
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gap: { xs: 2, md: 4 },
            gridTemplateColumns: { xs: '1fr', md: '320px 1fr' },
            alignItems: 'center',
          }}
        >
          <Box>
            <RiskGauge riskPct={riskPct} />
            <Stack direction="row" justifyContent="center" sx={{ mt: -1 }}>
              <Chip
                label={BANDS[band].label}
                sx={{ bgcolor: BANDS[band].soft, color: BANDS[band].color, fontWeight: 800, fontSize: 14, px: 1 }}
              />
            </Stack>
          </Box>

          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1 }}>
              CoinStrat Quantile Model · as of {snap.date}
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: -0.5, mb: 0.5 }}>
              BTC ${Math.round(snap.price).toLocaleString()}
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 2 }}>
              <Chip
                size="small"
                label={`${premiumPct >= 0 ? '+' : ''}${premiumPct.toFixed(0)}% vs fair value`}
                sx={{
                  bgcolor: premiumPct >= 0 ? 'rgba(245,158,11,0.16)' : 'rgba(34,197,94,0.16)',
                  color: premiumPct >= 0 ? '#fde68a' : '#bbf7d0',
                  fontWeight: 700,
                }}
              />
              <Chip size="small" label={`Fair value (QR 50%) $${Math.round(snap.qrDashedMedian).toLocaleString()}`} sx={{ bgcolor: 'rgba(148,163,184,0.16)', color: '#cbd5e1' }} />
            </Stack>

            <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(15,23,42,0.5)', border: '1px solid rgba(148,163,184,0.18)' }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1 }}>
                Bot stance now
              </Typography>
              <Typography variant="subtitle1" sx={{ fontWeight: 800, color: BANDS[band].color }}>
                {stance.verb}
              </Typography>
              <Typography variant="body2" color="text.secondary">{stance.detail}</Typography>
            </Box>
          </Box>
        </Box>
      </Paper>

      {/* About */}
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>About this model</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1, lineHeight: 1.8 }}>
          CQM fits quantile-regression bands across BTC&apos;s full price history and converts the latest price into a
          fair-value risk between 0% (deep value) and 100% (euphoric). Risk drives the CQM Risk-Weighted DCA strategy:
          deploy idle cash when risk is low, hold through the mid-zone, and distribute when risk is high.
        </Typography>
      </Paper>

      {/* Price map — what each risk level implies for BTC price today */}
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h6" sx={{ fontWeight: 800, mb: 0.5 }}>Price map at today&apos;s fit</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Holding the QR 50% fair value fixed, these are the BTC prices that correspond to each risk level right now.
        </Typography>
        {/* gradient scale with current marker */}
        <Box sx={{ position: 'relative', mb: 2 }}>
          <Box sx={{ height: 12, borderRadius: 6, background: CQM_RISK_GRADIENT_CSS }} />
          <Box
            sx={{
              position: 'absolute',
              top: -5,
              left: `${Math.max(0, Math.min(100, riskPct))}%`,
              transform: 'translateX(-50%)',
              width: 3,
              height: 22,
              bgcolor: '#f8fafc',
              borderRadius: 1,
              boxShadow: '0 0 0 2px rgba(15,23,42,0.6)',
            }}
          />
        </Box>
        <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(5, 1fr)' } }}>
          {levels.map((lv) => {
            const pct = lv.risk * 100;
            const c = BANDS[bandOf(Math.min(99.9, pct))].color;
            return (
              <Box key={lv.risk} sx={{ p: 1.25, borderRadius: 1.5, bgcolor: 'rgba(148,163,184,0.08)', textAlign: 'center' }}>
                <Typography variant="caption" sx={{ color: c, fontWeight: 800 }}>{pct.toFixed(0)}% risk</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>
                  {Number.isFinite(lv.price) ? `$${Math.round(lv.price).toLocaleString()}` : '—'}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Paper>

    </Box>
  );
};

export default CqmOverview;
