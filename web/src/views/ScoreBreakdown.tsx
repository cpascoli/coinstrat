import React, { useMemo, useState } from 'react';
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
  Tab,
  Tabs,
  Typography,
} from '@mui/material';

const SCORE_TABS = [
  {
    label: 'Bottom Score',
    oneLiner:
      'Break down the Bottom Accumulation Score into its five 0-20 components, current score, band, and staged deployment range.',
  },
  {
    label: 'BTC Valuation',
    oneLiner:
      'Assess BTC value with on-chain metrics MVRV (average cost basis) and LTH SOPR (realized profit), from deep value to euphoria.',
  },
  {
    label: 'BTC Regime',
    oneLiner: 'Spot BTC versus its 40-week average — a simple bull vs bear trend filter for timing.',
  },
  {
    label: 'US Liquidity',
    oneLiner:
      'Net USD liquidity from the Fed balance sheet, Treasury cash, and reverse repo — impulse and direction.',
  },
  {
    label: 'Business Cycle',
    oneLiner: 'Expansion vs recession risk from the Sahm rule, yield curve, and ISM Manufacturing PMI.',
  },
  {
    label: 'USD Regime',
    oneLiner: 'Broad dollar strength or weakness as a tailwind or headwind for risk assets.',
  },
] as const;

interface Props {
  current: SignalData;
}

const ScoreBreakdown: React.FC<Props> = ({ current }) => {
  const [scoreTab, setScoreTab] = useState(0);

  const liqScore = current.LIQ_SCORE;
  const cycleScore = current.BIZ_CYCLE_SCORE;
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
  const ismPmi = (current as any).ISM_PMI as number | undefined;
  const ismPmiAbove50 = (current as any).ISM_PMI_ABOVE50_DAYS as number | undefined;
  const ismPmiBelow45 = (current as any).ISM_PMI_BELOW45_DAYS as number | undefined;

  const dxy = (current as any).DXY as number | undefined;
  const dxyMA50 = (current as any).DXY_MA50 as number | undefined;
  const dxyMA200 = (current as any).DXY_MA200 as number | undefined;
  const dxyRoc20 = (current as any).DXY_ROC20 as number | undefined; // fraction
  const dxyScoreRaw = (current as any).DXY_SCORE_RAW as number | undefined;
  const dxyPersist = (current as any).DXY_PERSIST as number | undefined;

  const mvrv = current.MVRV;
  const nupl = (current as any).NUPL as number | undefined;
  const lthSopr = (current as any).LTH_SOPR as number | undefined;
  const btcMa40w = (current as any).BTC_MA40W as number | undefined;
  const priceRegime = (current as any).PRICE_REGIME as number | undefined;

  const dxyRoc20Pct = useMemo(() => (typeof dxyRoc20 === 'number' ? dxyRoc20 * 100 : undefined), [dxyRoc20]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={0.75}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Layers className="h-8 w-8 shrink-0 text-blue-400" />
            <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: -0.5 }}>
              Factor Deep-Dive
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ pl: { xs: 0, sm: '44px' } }}>
            What feeds  bitcoin valuation, liquidity, business cycle and dollar strength scores. The inputs, rules, and tiers behind each factor.
          </Typography>
        </Stack>
      </Box>

      <Tabs
        value={scoreTab}
        onChange={(_, next: number) => setScoreTab(next)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        aria-label="Factor score categories"
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          '& .MuiTab-root': { fontWeight: 700, textTransform: 'none', minHeight: 44 },
        }}
      >
        {SCORE_TABS.map((t, i) => (
          <Tab key={t.label} id={`score-tab-${i}`} aria-controls={`score-panel-${i}`} label={t.label} />
        ))}
      </Tabs>

      <Box
        role="tabpanel"
        id={`score-panel-${scoreTab}`}
        aria-labelledby={`score-tab-${scoreTab}`}
        sx={{ pt: 2.5 }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5, maxWidth: 720, lineHeight: 1.55 }}>
          {SCORE_TABS[scoreTab].oneLiner}
        </Typography>
        {scoreTab === 0 && (
          <BottomAccumulationBreakdown current={current} />
        )}

        {scoreTab === 1 && (
          <FactorCard
            icon={<Landmark className="h-6 w-6 text-violet-300" />}
            title="BTC Valuation (VAL_SCORE)"
            score={valScore}
            description="4-tier valuation combining NUPL (derived from MVRV) with LTH SOPR (flow metric). Score 3 = extreme bottom conviction."
            formula="NUPL (= 1 − 1/MVRV) + LTH SOPR capitulation thresholds"
          >
            <Grid container spacing={1.25}>
              <Grid item xs={12}>
                <RuleRow
                  ok={typeof nupl === 'number' && nupl < 0 && typeof lthSopr === 'number' && lthSopr < 1.0}
                  label="NUPL < 0 AND LTH SOPR < 1.0"
                  result="Score 3 (Extreme Deep Value — unconditional CORE entry)"
                />
              </Grid>
              <Grid item xs={12}>
                <RuleRow
                  ok={valScore === 2}
                  label="(NUPL < 0 AND SOPR ≥ 1) OR (NUPL < 0.382 AND SOPR < 1)"
                  result="Score 2 (Strong — CORE entry with PRICE_REGIME)"
                />
              </Grid>
              <Grid item xs={12}>
                <RuleRow
                  ok={valScore === 1}
                  label="NUPL < 0.618 (and not score 2 or 3)"
                  result="Score 1 (Fair / Neutral — CORE entry with PRICE_REGIME)"
                />
              </Grid>
              <Grid item xs={12}>
                <RuleRow ok={typeof nupl === 'number' && nupl >= 0.618} label="NUPL ≥ 0.618" result="Score 0 (Euphoria — can trigger CORE exit)" tone="danger" />
              </Grid>
            </Grid>

            <Divider sx={{ my: 2 }} />

            <Grid container spacing={1.25}>
              <Grid item xs={4}>
                <MetricRow label="NUPL" value={fmtNum(nupl, 3)} />
              </Grid>
              <Grid item xs={4}>
                <MetricRow label="MVRV" value={fmtNum(mvrv, 2)} />
              </Grid>
              <Grid item xs={4}>
                <MetricRow label="LTH SOPR" value={fmtNum(lthSopr, 3)} />
              </Grid>
            </Grid>
          </FactorCard>
        )}

        {scoreTab === 2 && (
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
        )}

        {scoreTab === 3 && (
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
        )}

        {scoreTab === 4 && (
          <FactorCard
            icon={<Landmark className="h-6 w-6 text-emerald-300" />}
            title="Business Cycle (BIZ_BIZ_CYCLE_SCORE)"
            score={cycleScore}
            description="Business cycle nowcast: Sahm Rule + Yield Curve + ISM Manufacturing PMI (with persistence filters). Recession requires 2-of-3 confirmation."
            formula="Recession risk when ≥ 2 of: SAHM≥0.50, YC<0, ISM_PMI<45 for 60+ days"
          >
            <Grid container spacing={1.25}>
              <Grid item xs={12}>
                <RuleRow
                  ok={
                    typeof sahm === 'number' &&
                    typeof yc === 'number' &&
                    sahm < 0.35 &&
                    yc >= 0.75 &&
                    typeof ismPmiAbove50 === 'number' && ismPmiAbove50 >= 90
                  }
                  label="SAHM < 0.35 AND YC ≥ 0.75 AND ISM_PMI ≥ 50 for 90+ days"
                  result="Score 2 (Expansion)"
                />
              </Grid>
              <Grid item xs={12}>
                <RuleRow
                  ok={(() => {
                    let flags = 0;
                    if (typeof sahm === 'number' && sahm >= 0.5) flags++;
                    if (typeof yc === 'number' && yc < 0) flags++;
                    if (typeof ismPmiBelow45 === 'number' && ismPmiBelow45 >= 60) flags++;
                    return flags >= 2;
                  })()}
                  label="≥ 2 of 3: SAHM ≥ 0.50, YC < 0, ISM_PMI < 45 for 60+ days"
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
                <MetricRow label="ISM PMI" value={fmtNum(ismPmi, 1)} />
              </Grid>
              <Grid item xs={6}>
                <MetricRow label="PMI ≥ 50 streak" value={`${fmtInt(ismPmiAbove50)}d`} />
              </Grid>
              <Grid item xs={6}>
                <MetricRow label="PMI < 45 streak" value={`${fmtInt(ismPmiBelow45)}d`} />
              </Grid>
            </Grid>
          </FactorCard>
        )}

        {scoreTab === 5 && (
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
        )}
      </Box>
    </Box>
  );
};

function BottomAccumulationBreakdown({ current }: { current: SignalData }) {
  const band = current.BOTTOM_ACCUM_BAND ?? bottomScoreBand(current.BOTTOM_ACCUM_SCORE);
  const deployment = current.BOTTOM_DEPLOYMENT_RANGE ?? bottomDeploymentRange(current.BOTTOM_ACCUM_SCORE);
  const hasDerivatives = Number.isFinite(Number(current.BTC_FUNDING_7D_AVG)) || Number.isFinite(Number(current.BTC_OI_DRAWDOWN_90D));
  const price = Number(current.BTCUSD);
  const sthRp = Number(current.STH_REALIZED_PRICE);
  const lthRp = Number(current.LTH_REALIZED_PRICE);
  const ma40w = Number((current as any).BTC_MA40W);
  const lthSopr = Number((current as any).LTH_SOPR);
  const sip = Number((current as any).SIP);
  const drawdown = Number((current as any).BTC_DRAWDOWN_FROM_365D_HIGH);
  const funding7d = Number(current.BTC_FUNDING_7D_AVG);
  const oiDrawdown90d = Number(current.BTC_OI_DRAWDOWN_90D);
  const roc30 = Number((current as any).BTC_ROC30);
  const roc90 = Number((current as any).BTC_ROC90);
  const low60 = Number((current as any).BTC_60D_LOW);
  const low30 = Number((current as any).BTC_30D_LOW);
  const priorLow30 = Number((current as any).BTC_PRIOR_30D_LOW);
  const daysSinceLow60 = Number((current as any).BTC_DAYS_SINCE_60D_LOW);

  const valScorePoints = current.VAL_SCORE >= 3 ? 12 : current.VAL_SCORE >= 2 ? 9 : current.VAL_SCORE >= 1 ? 4 : 0;
  const btcVsSthValuePoints = Number.isFinite(price) && Number.isFinite(sthRp) && sthRp > 0
    ? price <= sthRp ? 4 : price <= sthRp * 1.1 ? 2 : 0
    : 0;
  const btcVsLthValuePoints = Number.isFinite(price) && Number.isFinite(lthRp) && lthRp > 0
    ? price <= lthRp ? 4 : price <= lthRp * 1.25 ? 2 : 0
    : 0;

  const lthSoprStressPoints = hasDerivatives
    ? (Number.isFinite(lthSopr) ? lthSopr < 0.98 ? 7 : lthSopr < 1 ? 5 : lthSopr < 1.03 ? 2 : 0 : 0)
    : (Number.isFinite(lthSopr) ? lthSopr < 0.98 ? 9 : lthSopr < 1 ? 7 : lthSopr < 1.03 ? 3 : 0 : 0);
  const sipStressPoints = hasDerivatives
    ? (Number.isFinite(sip) ? sip < 65 ? 4 : sip < 75 ? 3 : sip < 85 ? 1 : 0 : 0)
    : (Number.isFinite(sip) ? sip < 65 ? 6 : sip < 75 ? 4 : sip < 85 ? 2 : 0 : 0);
  const drawdownStressPoints = hasDerivatives
    ? (Number.isFinite(drawdown) ? drawdown <= -0.55 ? 4 : drawdown <= -0.4 ? 3 : drawdown <= -0.25 ? 1 : 0 : 0)
    : (Number.isFinite(drawdown) ? drawdown <= -0.55 ? 5 : drawdown <= -0.4 ? 3 : drawdown <= -0.25 ? 1 : 0 : 0);
  const fundingStressPoints = Number.isFinite(funding7d) ? funding7d < -0.0001 ? 3 : funding7d <= 0 ? 2 : funding7d < 0.0001 ? 1 : 0 : 0;
  const oiStressPoints = Number.isFinite(oiDrawdown90d) ? oiDrawdown90d <= -0.35 ? 2 : oiDrawdown90d <= -0.2 ? 1 : 0 : 0;

  const liquidityScorePoints = current.LIQ_SCORE >= 2 ? 9 : current.LIQ_SCORE >= 1 ? 5 : 0;
  const usLiq13wPoints = Number.isFinite(current.US_LIQ_13W_DELTA) && current.US_LIQ_13W_DELTA > 0 ? 4 : 0;
  const g3Yoy = Number((current as any).G3_YOY);
  const g3YoyPoints = Number.isFinite(g3Yoy) ? g3Yoy > 0 ? 4 : g3Yoy > -2 ? 2 : 0 : 0;
  const dxyPoints = current.DXY_SCORE >= 2 ? 3 : current.DXY_SCORE >= 1 ? 2 : 0;

  const bizCyclePoints = current.BIZ_CYCLE_SCORE >= 2 ? 10 : current.BIZ_CYCLE_SCORE >= 1 ? 7 : 2;
  const sahmValue = Number(current.SAHM);
  const ycValue = Number(current.YC_M);
  const sahmPoints = Number.isFinite(sahmValue) && sahmValue < 0.5 ? 4 : 0;
  const ycPoints = Number.isFinite(ycValue) ? ycValue >= 0 ? 3 : ycValue > -0.75 ? 1 : 0 : 0;
  const ismPmi = Number((current as any).ISM_PMI);
  const ismPoints = Number.isFinite(ismPmi) ? ismPmi >= 50 ? 3 : ismPmi >= 45 ? 1 : 0 : 0;

  const setupDrawdownDepthPoints = Number.isFinite(drawdown) ? drawdown <= -0.55 ? 3 : drawdown <= -0.4 ? 2 : drawdown <= -0.25 ? 1 : 0 : 0;
  const setupBelowMa40wPoints = Number.isFinite(price) && Number.isFinite(ma40w) && ma40w > 0
    ? price <= ma40w * 0.8 ? 3 : price <= ma40w * 0.9 ? 2 : price < ma40w ? 1 : 0
    : 0;
  const setupBelowSthRpPoints = Number.isFinite(price) && Number.isFinite(sthRp) && sthRp > 0
    ? price <= sthRp * 0.85 ? 3 : price <= sthRp * 0.95 ? 2 : price < sthRp ? 1 : 0
    : 0;
  const setupNegativeMomentumPoints = Number.isFinite(roc30) && Number.isFinite(roc90) && roc30 < 0 && roc90 < 0 ? 1 : 0;

  const repairVsMaPoints = Number.isFinite(price) && Number.isFinite(ma40w) && ma40w > 0
    ? price >= ma40w ? 3 : price >= ma40w * 0.9 ? 2 : price >= ma40w * 0.8 ? 1 : 0
    : 0;
  const repairVsSthPoints = Number.isFinite(price) && Number.isFinite(sthRp) && sthRp > 0
    ? price >= sthRp ? 3 : price >= sthRp * 0.95 ? 2 : price >= sthRp * 0.9 ? 1 : 0
    : 0;
  const repairRoc30Points = Number.isFinite(roc30) && roc30 > 0 ? 1 : 0;
  const repairRoc90Points = Number.isFinite(roc90) && roc90 > 0 ? 1 : 0;
  const heldAboveLocalLow =
    Number.isFinite(price) &&
    Number.isFinite(low60) &&
    low60 > 0 &&
    Number.isFinite(daysSinceLow60) &&
    daysSinceLow60 >= 30 &&
    price >= low60 * 1.08;
  const lowsStoppedBreaking = Number.isFinite(low30) && Number.isFinite(priorLow30) && priorLow30 > 0 && low30 >= priorLow30 * 0.98;
  const baseStabilizationPoints = heldAboveLocalLow && lowsStoppedBreaking && Number.isFinite(roc30) && roc30 > 0
    ? 2
    : (heldAboveLocalLow || lowsStoppedBreaking ? 1 : 0);

  const components: Array<{
    title: string;
    score: number | undefined;
    max?: number;
    formula: string;
    contributions: ScoreContribution[];
  }> = [
    {
      title: 'On-Chain Value',
      score: current.BOTTOM_ONCHAIN_SCORE,
      formula:
        'VAL_SCORE tier (0/4/9/12) + BTC vs STH realized price (0/2/4) + BTC vs LTH realized price (0/2/4), capped at 20.',
      contributions: [
        { label: 'VAL_SCORE', value: fmtInt(current.VAL_SCORE), points: valScorePoints, max: 12 },
        { label: 'BTC vs STH realized price', value: `${fmtUsd(current.BTCUSD)} / ${fmtUsd(current.STH_REALIZED_PRICE)}`, points: btcVsSthValuePoints, max: 4 },
        { label: 'BTC vs LTH realized price', value: `${fmtUsd(current.BTCUSD)} / ${fmtUsd(current.LTH_REALIZED_PRICE)}`, points: btcVsLthValuePoints, max: 4 },
      ],
    },
    {
      title: 'Capitulation',
      score: current.BOTTOM_CAPITULATION_SCORE,
      formula: hasDerivatives
        ? 'Holder stress, capped at 15, plus derivatives stress, capped at 5. Holder stress uses LTH SOPR, percent addresses in profit, and BTC drawdown. Derivatives stress uses 7D funding and 90D OI drawdown.'
        : 'Legacy stress score from LTH SOPR, percent addresses in profit, and BTC drawdown from the 365D high, capped at 20.',
      contributions: [
        { label: 'LTH SOPR stress', value: fmtNum((current as any).LTH_SOPR, 3), points: lthSoprStressPoints, max: hasDerivatives ? 7 : 9 },
        { label: 'Addresses-in-profit stress', value: fmtPct((current as any).SIP), points: sipStressPoints, max: hasDerivatives ? 4 : 6 },
        { label: 'BTC drawdown from 365D high', value: fmtRatioPct((current as any).BTC_DRAWDOWN_FROM_365D_HIGH), points: drawdownStressPoints, max: hasDerivatives ? 4 : 5 },
        ...(hasDerivatives
          ? [
              { label: 'Funding 7D avg', value: fmtRatioPct(current.BTC_FUNDING_7D_AVG), points: fundingStressPoints, max: 3 },
              { label: 'OI drawdown 90D', value: fmtRatioPct(current.BTC_OI_DRAWDOWN_90D), points: oiStressPoints, max: 2 },
            ]
          : []),
      ],
    },
    {
      title: 'Liquidity Turn',
      score: current.BOTTOM_LIQUIDITY_SCORE,
      formula:
        'LIQ_SCORE tier (0/5/9) + positive US_LIQ 13W delta (+4) + G3 liquidity YoY tier (0/2/4) + DXY_SCORE tier (0/2/3), capped at 20.',
      contributions: [
        { label: 'LIQ_SCORE', value: fmtInt(current.LIQ_SCORE), points: liquidityScorePoints, max: 9 },
        { label: 'US_LIQ 13W delta', value: fmtAbbrev(current.US_LIQ_13W_DELTA), points: usLiq13wPoints, max: 4 },
        { label: 'G3 liquidity YoY', value: fmtPct((current as any).G3_YOY), points: g3YoyPoints, max: 4 },
        { label: 'DXY_SCORE', value: fmtInt(current.DXY_SCORE), points: dxyPoints, max: 3 },
      ],
    },
    {
      title: 'Macro Support',
      score: current.BOTTOM_MACRO_SCORE,
      formula:
        'BIZ_CYCLE_SCORE tier (2/7/10) + SAHM below 0.50 (+4) + yield curve tier (0/1/3) + ISM PMI tier (0/1/3), capped at 20.',
      contributions: [
        { label: 'BIZ_CYCLE_SCORE', value: fmtInt(current.BIZ_CYCLE_SCORE), points: bizCyclePoints, max: 10 },
        { label: 'SAHM', value: fmtNum(current.SAHM, 2), points: sahmPoints, max: 4 },
        { label: 'YC 10Y-3M', value: fmtNum(current.YC_M, 2), points: ycPoints, max: 3 },
        { label: 'ISM PMI', value: fmtNum((current as any).ISM_PMI, 1), points: ismPoints, max: 3 },
      ],
    },
    {
      title: 'Price Setup',
      score: current.BOTTOM_PRICE_SETUP_SCORE,
      max: 10,
      formula:
        'Price damage / bottom setup: 365D-high drawdown depth (0/1/2/3) + BTC below 40W MA (0/1/2/3) + BTC below STH realized price (0/1/2/3) + negative 30D and 90D momentum (+1), capped at 10.',
      contributions: [
        { label: '365D-high drawdown depth', value: fmtRatioPct((current as any).BTC_DRAWDOWN_FROM_365D_HIGH), points: setupDrawdownDepthPoints, max: 3 },
        { label: 'BTC below 40W MA', value: `${fmtUsd(current.BTCUSD)} / ${fmtUsd((current as any).BTC_MA40W)}`, points: setupBelowMa40wPoints, max: 3 },
        { label: 'BTC below STH realized price', value: `${fmtUsd(current.BTCUSD)} / ${fmtUsd(current.STH_REALIZED_PRICE)}`, points: setupBelowSthRpPoints, max: 3 },
        { label: 'Negative 30D + 90D momentum', value: `${fmtRatioPct((current as any).BTC_ROC30)} / ${fmtRatioPct((current as any).BTC_ROC90)}`, points: setupNegativeMomentumPoints, max: 1 },
      ],
    },
    {
      title: 'Price Repair',
      score: current.BOTTOM_PRICE_REPAIR_SCORE,
      max: 10,
      formula:
        'Price repair / confirmation: BTC vs 40W MA proximity (0/1/2/3) + BTC vs STH realized price proximity (0/1/2/3) + BTC_ROC30 > 0 (+1) + BTC_ROC90 > 0 (+1) + base stabilization (0/1/2), capped at 10.',
      contributions: [
        { label: 'BTC vs 40W MA proximity', value: `${fmtUsd(current.BTCUSD)} / ${fmtUsd((current as any).BTC_MA40W)}`, points: repairVsMaPoints, max: 3 },
        { label: 'BTC vs STH realized price', value: `${fmtUsd(current.BTCUSD)} / ${fmtUsd(current.STH_REALIZED_PRICE)}`, points: repairVsSthPoints, max: 3 },
        { label: '30D momentum (BTC_ROC30)', value: fmtRatioPct((current as any).BTC_ROC30), points: repairRoc30Points, max: 1 },
        { label: '90D momentum (BTC_ROC90)', value: fmtRatioPct((current as any).BTC_ROC90), points: repairRoc90Points, max: 1 },
        {
          label: 'Base stabilization',
          value: `30d after 60D low and +8%: ${yesNo(heldAboveLocalLow)}; lows stable: ${yesNo(lowsStoppedBreaking)}; ROC30 > 0: ${yesNo(Number.isFinite(roc30) && roc30 > 0)}`,
          points: baseStabilizationPoints,
          max: 2,
        },
      ],
    },
  ];

  return (
    <Card
      sx={{
        borderColor: 'rgba(250,204,21,0.35)',
        background: 'linear-gradient(180deg, rgba(113,63,18,0.18) 0%, rgba(15,23,42,0.7) 100%)',
      }}
    >
      <CardHeader
        title={<Typography sx={{ fontWeight: 900 }}>Bottom Accumulation Score</Typography>}
        subheader="A 0-100 staged-deployment gauge built from five 0-20 components."
        action={<Chip label={`${fmtInt(current.BOTTOM_ACCUM_SCORE)} / 100`} color={bottomScoreColor(current.BOTTOM_ACCUM_SCORE) as any} variant="filled" />}
      />
      <Divider />
      <CardContent>
        <Stack spacing={2}>
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, px: 2, py: 1.25, bgcolor: 'rgba(2,6,23,0.15)' }}>
            <Typography variant="overline" color="text.secondary">
              Formula
            </Typography>
            <Typography
              variant="body2"
              sx={{
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                fontWeight: 800,
                lineHeight: 1.7,
              }}
            >
              BOTTOM_ACCUM_SCORE = ONCHAIN_VALUE_SCORE + CAPITULATION_SCORE + LIQUIDITY_TURN_SCORE + MACRO_RISK_SCORE + PRICE_SETUP_SCORE + PRICE_REPAIR_SCORE
            </Typography>
          </Box>

          <Grid container spacing={1.25}>
            <Grid item xs={12} sm={4}>
              <MetricRow label="Band" value={band} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <MetricRow label="Deployment range" value={deployment} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <MetricRow label="As of" value={current.Date ?? 'n/a'} />
            </Grid>
          </Grid>

          <Grid container spacing={1.5}>
            {components.map((component) => (
              <Grid item xs={12} md={6} key={component.title}>
                <BottomComponentCard {...component} />
              </Grid>
            ))}
          </Grid>
        </Stack>
      </CardContent>
    </Card>
  );
}

function BottomComponentCard(props: {
  title: string;
  score: number | undefined;
  max?: number;
  formula: string;
  contributions: ScoreContribution[];
}) {
  const max = props.max ?? 20;
  return (
    <Box sx={{ height: '100%', border: '1px solid', borderColor: 'divider', borderRadius: 2, px: 2, py: 1.5, bgcolor: 'rgba(2,6,23,0.08)' }}>
      <Stack spacing={1.25}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1.5}>
          <Typography sx={{ fontWeight: 900 }}>{props.title}</Typography>
          <Chip size="small" label={`${fmtInt(props.score)} / ${max}`} color={bottomComponentColor(props.score, max) as any} variant="filled" />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
          {props.formula}
        </Typography>
        <Divider />
        <Grid container spacing={1}>
          {props.contributions.map((contribution) => (
            <Grid item xs={12} sm={6} key={contribution.label}>
              <ContributionRow contribution={contribution} />
            </Grid>
          ))}
        </Grid>
      </Stack>
    </Box>
  );
}

type ScoreContribution = {
  label: string;
  value: string;
  points: number;
  max: number;
};

function ContributionRow({ contribution }: { contribution: ScoreContribution }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, px: 2, py: 1.25, bgcolor: 'rgba(2,6,23,0.06)' }}>
      <Stack spacing={0.75}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1.5}>
          <Typography variant="overline" color="text.secondary">
            {contribution.label}
          </Typography>
          <Chip
            size="small"
            label={`+${contribution.points}`}
            variant="outlined"
            sx={{
              height: 20,
              minWidth: 34,
              borderColor: contribution.points > 0 ? 'rgba(148,163,184,0.45)' : 'rgba(148,163,184,0.25)',
              bgcolor: contribution.points > 0 ? 'rgba(148,163,184,0.10)' : 'transparent',
              color: contribution.points > 0 ? 'text.secondary' : 'text.disabled',
              fontFamily: 'monospace',
              fontSize: 11,
              fontWeight: 800,
              '& .MuiChip-label': { px: 0.75 },
            }}
          />
        </Stack>
        <Typography
          variant="body2"
          sx={{
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontWeight: 800,
          }}
        >
          {contribution.value}
        </Typography>
      </Stack>
    </Box>
  );
}

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

function fmtRatioPct(x: any): string {
  if (typeof x !== 'number' || !isFinite(x)) return 'n/a';
  return `${(x * 100).toFixed(2)}%`;
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

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function bottomScoreBand(score: any): string {
  const v = Number(score);
  if (!Number.isFinite(v)) return 'n/a';
  if (v >= 85) return 'Capitulation Opportunity';
  if (v >= 70) return 'Strong Accumulation';
  if (v >= 50) return 'Accumulate Slowly';
  if (v >= 25) return 'Watch';
  return 'Avoid';
}

function bottomDeploymentRange(score: any): string {
  const v = Number(score);
  if (!Number.isFinite(v)) return 'n/a';
  if (v >= 85) return '75-100%';
  if (v >= 70) return '50-75%';
  if (v >= 50) return '25-40%';
  if (v >= 25) return '0-10%';
  return '0%';
}

function bottomScoreColor(score: any): 'default' | 'error' | 'warning' | 'info' | 'success' {
  const v = Number(score);
  if (!Number.isFinite(v)) return 'default';
  if (v >= 70) return 'success';
  if (v >= 50) return 'info';
  if (v >= 25) return 'warning';
  return 'error';
}

function bottomComponentColor(score: any, max = 20): 'default' | 'error' | 'warning' | 'info' | 'success' {
  const v = Number(score);
  if (!Number.isFinite(v)) return 'default';
  if (v >= max * 0.7) return 'success';
  if (v >= max * 0.5) return 'info';
  if (v >= max * 0.25) return 'warning';
  return 'error';
}

export default ScoreBreakdown;

