import React, { useMemo } from 'react';
import { SignalData } from '../App';
import { Layers, Wind, Landmark, Gauge } from 'lucide-react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Divider,
  Grid,
  Stack,
  Typography,
} from '@mui/material';

interface Props {
  current: SignalData;
}

const ScoreBreakdown: React.FC<Props> = ({ current }) => {
  const liqScore = current.LIQ_SCORE;
  const cycleScore = current.CYCLE_SCORE;
  const dxyScore = current.DXY_SCORE;
  const valScore = current.VAL_SCORE;

  // Raw values (filled by engine.ts)
  const walcl = current.WALCL as number | undefined;
  const tga = current.WTREGEN as number | undefined;
  const rrp = current.RRPONTSYD as number | undefined;
  const usLiq = current.US_LIQ;
  const usLiqYoY = current.US_LIQ_YOY;
  const usLiq13w = current.US_LIQ_13W_DELTA;

  const sahm = current.SAHM;
  const yc = current.YC_M;
  const no = current.NO as number | undefined;
  const noYoy = current.NO_YOY;
  const noMom3 = (current as any).NO_MOM3 as number | undefined;

  const dxy = (current as any).DXY as number | undefined;
  const dxyMA50 = (current as any).DXY_MA50 as number | undefined;
  const dxyMA200 = (current as any).DXY_MA200 as number | undefined;
  const dxyRoc20 = (current as any).DXY_ROC20 as number | undefined; // fraction
  const dxyScoreRaw = (current as any).DXY_SCORE_RAW as number | undefined;
  const dxyPersist = (current as any).DXY_PERSIST as number | undefined;

  const mvrv = current.MVRV;
  const lthSopr = (current as any).LTH_SOPR as number | undefined;
  const btcMa40w = (current as any).BTC_MA40W as number | undefined;
  const priceRegime = (current as any).PRICE_REGIME as number | undefined;

  const dxyRoc20Pct = useMemo(() => (typeof dxyRoc20 === 'number' ? dxyRoc20 * 100 : undefined), [dxyRoc20]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Layers className="h-8 w-8 text-blue-400" />
        <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: -0.5 }}>
          Factor Deep-Dive
        </Typography>
      </Box>

      <Grid container spacing={2.5}>
        {/* Valuation (1st) */}
        <Grid item xs={12} md={6}>
          <FactorCard
            icon={<Landmark className="h-6 w-6 text-violet-300" />}
            title="BTC Valuation (VAL_SCORE)"
            score={valScore}
            description="4-tier valuation combining MVRV (stock metric) with LTH SOPR (flow metric). Score 3 = extreme bottom conviction."
            formula="MVRV + LTH SOPR capitulation thresholds"
          >
            <Grid container spacing={1.25}>
              <Grid item xs={12}>
                <RuleRow
                  ok={typeof mvrv === 'number' && mvrv < 1.0 && typeof lthSopr === 'number' && lthSopr < 1.0}
                  label="MVRV < 1.0 AND LTH SOPR < 1.0"
                  result="Score 3 (Extreme Deep Value — unconditional CORE entry)"
                />
              </Grid>
              <Grid item xs={12}>
                <RuleRow
                  ok={valScore === 2}
                  label="(MVRV < 1.0 AND SOPR ≥ 1) OR (MVRV < 1.8 AND SOPR < 1)"
                  result="Score 2 (Strong — CORE entry with PRICE_REGIME)"
                />
              </Grid>
              <Grid item xs={12}>
                <RuleRow
                  ok={valScore === 1}
                  label="MVRV < 3.5 (and not score 2 or 3)"
                  result="Score 1 (Fair / Neutral — CORE entry with PRICE_REGIME)"
                />
              </Grid>
              <Grid item xs={12}>
                <RuleRow ok={typeof mvrv === 'number' && mvrv >= 3.5} label="MVRV ≥ 3.5" result="Score 0 (Euphoria — triggers CORE exit)" tone="danger" />
              </Grid>
            </Grid>

            <Divider sx={{ my: 2 }} />

            <Grid container spacing={1.25}>
              <Grid item xs={6}>
                <MetricRow label="MVRV" value={fmtNum(mvrv, 2)} />
              </Grid>
              <Grid item xs={6}>
                <MetricRow label="LTH SOPR" value={fmtNum(lthSopr, 3)} />
              </Grid>
            </Grid>
          </FactorCard>
        </Grid>

        {/* BTC Regime (2nd) */}
        <Grid item xs={12} md={6}>
          <FactorCard
            icon={<Landmark className="h-6 w-6 text-amber-300" />}
            title="BTC Regime (PRICE_REGIME)"
            score={typeof priceRegime === 'number' ? priceRegime : current.PRICE_REGIME_ON}
            description="Trend filter based on BTCUSD vs the 40-week moving average."
            formula="PRICE_REGIME = 1 if BTCUSD ≥ BTC_MA40W, else 0"
          >
            <Grid container spacing={1.25}>
              <Grid item xs={12}>
                <RuleRow
                  ok={typeof current.BTCUSD === 'number' && typeof btcMa40w === 'number' && current.BTCUSD >= btcMa40w}
                  label="BTCUSD ≥ BTC_MA40W"
                  result="PRICE_REGIME = 1 (Bullish)"
                />
              </Grid>
              <Grid item xs={12}>
                <RuleRow
                  ok={typeof current.BTCUSD === 'number' && typeof btcMa40w === 'number' && current.BTCUSD < btcMa40w}
                  label="BTCUSD < BTC_MA40W"
                  result="PRICE_REGIME = 0 (Bearish)"
                  tone="danger"
                />
              </Grid>
            </Grid>

            <Divider sx={{ my: 2 }} />

            <Grid container spacing={1.25}>
              <Grid item xs={6}>
                <MetricRow label="BTCUSD" value={fmtUsd(current.BTCUSD)} />
              </Grid>
              <Grid item xs={6}>
                <MetricRow label="BTC_MA40W" value={fmtUsd(btcMa40w)} />
              </Grid>
              <Grid item xs={6}>
                <MetricRow label="PRICE_REGIME" value={fmtInt(priceRegime)} />
              </Grid>
              <Grid item xs={6}>
                <MetricRow label="PRICE_REGIME (20/30)" value={fmtInt(current.PRICE_REGIME_ON)} />
              </Grid>
            </Grid>
          </FactorCard>
        </Grid>

        {/* US Liquidity (3rd) */}
        <Grid item xs={12} md={6}>
          <FactorCard
            icon={<Wind className="h-6 w-6 text-blue-300" />}
            title="US Liquidity (LIQ_SCORE)"
            score={liqScore}
            description="Net liquidity impulse in the US system."
            formula="US_LIQ = WALCL − WTREGEN − RRPONTSYD"
          >
            <Grid container spacing={1.25}>
              <Grid item xs={12}>
                <RuleRow ok={typeof usLiqYoY === 'number' && usLiqYoY > 0} label="US_LIQ YoY > 0" result="Score 2 (Expanding)" />
              </Grid>
              <Grid item xs={12}>
                <RuleRow
                  ok={
                    typeof usLiqYoY === 'number' && typeof usLiq13w === 'number' && usLiqYoY <= 0 && usLiq13w > 0
                  }
                  label="US_LIQ YoY ≤ 0 AND 13W Δ > 0"
                  result="Score 1 (Inflecting Up)"
                />
              </Grid>
              <Grid item xs={12}>
                <RuleRow ok label="Otherwise" result="Score 0 (Contracting)" muted />
              </Grid>
            </Grid>

            <Divider sx={{ my: 2 }} />

            <Grid container spacing={1.25}>
              <Grid item xs={12}>
                <MetricRow label="US_LIQ" value={fmtTrillions(usLiq)} />
              </Grid>
              <Grid item xs={6}>
                <MetricRow label="US_LIQ YoY" value={fmtPct(usLiqYoY)} />
              </Grid>
              <Grid item xs={6}>
                <MetricRow label="US_LIQ 13W Δ" value={fmtAbbrev(usLiq13w)} />
              </Grid>
              <Grid item xs={4}>
                <MetricRow label="WALCL" value={fmtTrillions(walcl)} />
              </Grid>
              <Grid item xs={4}>
                <MetricRow label="WTREGEN" value={fmtTrillions(tga)} />
              </Grid>
              <Grid item xs={4}>
                <MetricRow label="RRPONTSYD" value={fmtTrillions(rrp)} />
              </Grid>
            </Grid>
          </FactorCard>
        </Grid>

        {/* Business Cycle (4th) */}
        <Grid item xs={12} md={6}>
          <FactorCard
            icon={<Landmark className="h-6 w-6 text-emerald-300" />}
            title="Business Cycle (BIZ_CYCLE_SCORE)"
            score={cycleScore}
            description="Business cycle nowcast: Sahm + Yield Curve + New Orders."
            formula="Recession risk if (SAHM≥0.50) OR (YC<0) OR (NO_YOY<0 AND NO_MOM3≤0)"
          >
            <Grid container spacing={1.25}>
              <Grid item xs={12}>
                <RuleRow
                  ok={
                    typeof sahm === 'number' &&
                    typeof yc === 'number' &&
                    typeof noYoy === 'number' &&
                    sahm < 0.35 &&
                    yc >= 0.75 &&
                    noYoy >= 0
                  }
                  label="SAHM < 0.35 AND YC ≥ 0.75 AND NO_YOY ≥ 0"
                  result="Score 2 (Expansion)"
                />
              </Grid>
              <Grid item xs={12}>
                <RuleRow
                  ok={
                    (typeof sahm === 'number' && sahm >= 0.5) ||
                    (typeof yc === 'number' && yc < 0) ||
                    (typeof noYoy === 'number' && typeof noMom3 === 'number' && noYoy < 0 && noMom3 <= 0)
                  }
                  label="SAHM ≥ 0.50 OR YC < 0 OR (NO_YOY<0 AND NO_MOM3≤0)"
                  result="Score 0 (Recession Risk)"
                  tone="danger"
                />
              </Grid>
              <Grid item xs={12}>
                <RuleRow ok label="Otherwise" result="Score 1 (Stabilizing)" muted />
              </Grid>
            </Grid>

            <Divider sx={{ my: 2 }} />

            <Grid container spacing={1.25}>
              <Grid item xs={6}>
                <MetricRow label="SAHM" value={fmtNum(sahm, 2)} />
              </Grid>
              <Grid item xs={6}>
                <MetricRow label="YC (10Y-3M)" value={fmtNum(yc, 2)} />
              </Grid>
              <Grid item xs={6}>
                <MetricRow label="New Orders (NO)" value={fmtNum(no, 1)} />
              </Grid>
              <Grid item xs={6}>
                <MetricRow label="NO_YOY" value={fmtPct(noYoy)} />
              </Grid>
              <Grid item xs={12}>
                <MetricRow label="NO_MOM3 (approx)" value={fmtNum(noMom3, 2)} />
              </Grid>
            </Grid>
          </FactorCard>
        </Grid>

        {/* USD Regime (5th) */}
        <Grid item xs={12} md={6}>
          <FactorCard
            icon={<Gauge className="h-6 w-6 text-amber-300" />}
            title="USD Regime (DXY_SCORE)"
            score={dxyScore}
            description="USD headwind/tailwind using a broad trade‑weighted USD proxy (FRED: DTWEXBGS), with a 20/30 persistence filter."
            formula="Raw score from ROC20 ± 0.5% + MA crossover → 20/30 persistence filter"
          >
            <Grid container spacing={1.25}>
              <Grid item xs={12}>
                <RuleRow
                  ok={typeof dxyRoc20 === 'number' && dxyRoc20 < -0.005 && typeof dxyMA50 === 'number' && typeof dxyMA200 === 'number' && dxyMA50 < dxyMA200}
                  label="ROC20 < -0.5% AND MA50 < MA200"
                  result="Raw Score 2 (USD weakening / supportive)"
                />
              </Grid>
              <Grid item xs={12}>
                <RuleRow ok={typeof dxyRoc20 === 'number' && dxyRoc20 > 0.005} label="ROC20 > +0.5%" result="Raw Score 0 (USD strengthening / headwind)" tone="danger" />
              </Grid>
              <Grid item xs={12}>
                <RuleRow ok label="Otherwise" result="Raw Score 1 (Neutral)" muted />
              </Grid>
            </Grid>

            <Divider sx={{ my: 2 }} />

            <Grid container spacing={1.25}>
              <Grid item xs={12}>
                <RuleRow
                  ok={typeof dxyPersist === 'number' && dxyPersist === 1}
                  label="DXY_SCORE_RAW ≥ 1 for ≥ 20/30 days"
                  result="DXY_PERSIST = 1 → effective score = raw score"
                />
              </Grid>
              <Grid item xs={12}>
                <RuleRow
                  ok={typeof dxyPersist === 'number' && dxyPersist === 0}
                  label="DXY_SCORE_RAW ≥ 1 for < 20/30 days"
                  result="DXY_PERSIST = 0 → effective score forced to 0"
                  tone="danger"
                />
              </Grid>
            </Grid>

            <Divider sx={{ my: 2 }} />

            <Grid container spacing={1.25}>
              <Grid item xs={6}>
                <MetricRow label="USD index (DTWEXBGS)" value={fmtNum(dxy, 2)} />
              </Grid>
              <Grid item xs={6}>
                <MetricRow label="ROC20" value={fmtPct(dxyRoc20Pct)} />
              </Grid>
              <Grid item xs={6}>
                <MetricRow label="MA50" value={fmtNum(dxyMA50, 2)} />
              </Grid>
              <Grid item xs={6}>
                <MetricRow label="MA200" value={fmtNum(dxyMA200, 2)} />
              </Grid>
              <Grid item xs={4}>
                <MetricRow label="DXY_SCORE_RAW" value={fmtInt(dxyScoreRaw)} />
              </Grid>
              <Grid item xs={4}>
                <MetricRow label="DXY_PERSIST" value={fmtInt(dxyPersist)} />
              </Grid>
              <Grid item xs={4}>
                <MetricRow label="DXY_SCORE (eff.)" value={fmtInt(dxyScore)} />
              </Grid>
            </Grid>
          </FactorCard>
        </Grid>

      </Grid>
    </Box>
  );
};

function FactorCard(props: {
  icon: React.ReactNode;
  title: string;
  score: number;
  description: string;
  formula: string;
  children: React.ReactNode;
}) {
  const { icon, title, score, description, formula, children } = props;

  const scoreColor = score === 0 ? 'error' : score === 1 ? 'primary' : 'success';

  return (
    <Card>
      <CardHeader
        avatar={icon}
        title={<Typography sx={{ fontWeight: 900 }}>{title}</Typography>}
        subheader={description}
        action={<Chip label={`SCORE ${score}`} color={scoreColor as any} variant="filled" size="small" />}
      />
      <Divider />
      <CardContent>
        <Stack spacing={1.25}>
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, px: 2, py: 1.25, bgcolor: 'rgba(2,6,23,0.15)' }}>
            <Typography variant="overline" color="text.secondary">
              Calculation / proxy
            </Typography>
            <Typography
              variant="body2"
              sx={{
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                fontWeight: 800,
              }}
            >
              {formula}
            </Typography>
          </Box>
          {children}
        </Stack>
      </CardContent>
    </Card>
  );
}

function RuleRow(props: { ok: boolean; label: string; result: string; tone?: 'default' | 'danger'; muted?: boolean }) {
  const { ok, label, result, tone = 'default', muted } = props;
  const color = muted ? 'default' : ok ? (tone === 'danger' ? 'error' : 'success') : 'default';

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, px: 2, py: 1.25, bgcolor: 'rgba(2,6,23,0.10)' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1.5}>
        <Typography variant="body2" color={muted ? 'text.secondary' : 'text.primary'} sx={{ fontWeight: 700 }}>
          {label}
        </Typography>
        <Chip size="small" label={ok && !muted ? 'TRUE' : muted ? '—' : 'FALSE'} color={color as any} variant={ok && !muted ? 'filled' : 'outlined'} />
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {result}
      </Typography>
    </Box>
  );
}

function MetricRow(props: { label: string; value: string }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, px: 2, py: 1.25, bgcolor: 'rgba(2,6,23,0.06)' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1.5}>
        <Typography variant="overline" color="text.secondary">
          {props.label}
        </Typography>
        <Typography
          variant="body2"
          sx={{
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontWeight: 800,
          }}
        >
          {props.value}
        </Typography>
      </Stack>
    </Box>
  );
}

function fmtNum(x: any, digits = 2): string {
  if (typeof x !== 'number' || !isFinite(x)) return 'n/a';
  return x.toFixed(digits);
}

function fmtUsd(x: any): string {
  const v = Number(x);
  if (!Number.isFinite(v)) return 'n/a';
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtInt(x: any): string {
  const v = Number(x);
  if (!Number.isFinite(v)) return 'n/a';
  return String(Math.trunc(v));
}

function fmtPct(x: any): string {
  if (typeof x !== 'number' || !isFinite(x)) return 'n/a';
  return `${x.toFixed(2)}%`;
}

function fmtAbbrev(x: any): string {
  if (typeof x !== 'number' || !isFinite(x)) return 'n/a';
  const abs = Math.abs(x);
  if (abs >= 1e12) return `${(x / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  return x.toFixed(2);
}

function fmtTrillions(x: any): string {
  if (typeof x !== 'number' || !isFinite(x)) return 'n/a';
  return `$${(x / 1e6).toFixed(2)}T`;
}

export default ScoreBreakdown;

