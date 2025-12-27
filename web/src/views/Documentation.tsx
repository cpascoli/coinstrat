import React from 'react';
import { BookOpen, ShieldCheck, Zap, Layers, RefreshCw } from 'lucide-react';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Box, Card, CardContent, CardHeader, Divider, IconButton, Stack, Tooltip, Typography } from '@mui/material';

const Documentation: React.FC = () => {
  return (
    <div className="mx-auto max-w-4xl space-y-12">
      <div className="text-center space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg">
          <BookOpen className="h-8 w-8" />
        </div>
        <h1 className="text-4xl font-black text-slate-100 tracking-tight">Model Methodology</h1>
        <p className="text-lg text-slate-400">The Coin Strat Pre-Accumulation Framework (2026 Edition)</p>
      </div>

      <section className="space-y-6">
        <div className="flex items-center gap-3 border-b pb-2">
          <Layers className="h-6 w-6 text-blue-400" />
          <h2 className="text-2xl font-bold text-slate-100">System Architecture</h2>
        </div>
        <p className="text-slate-300 leading-relaxed">
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
          <RefreshCw className="h-6 w-6 text-blue-400" />
          <h2 className="text-2xl font-bold text-slate-100">The Accumulation Hierarchy</h2>
        </div>
        
        <div className="rounded-2xl bg-slate-900 border border-slate-700/60 p-8 space-y-8">
          <div className="flex gap-6">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-950/40 border border-slate-700/60 shadow-sm">
              <ShieldCheck className="h-6 w-6 text-blue-300" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100 mb-2">Tier 1: Core Accumulation (CORE_ON)</h3>
              <p className="text-sm text-slate-300 leading-relaxed italic">
                The "Engine." Focuses on multi-month accumulation during deep-value phases. It uses MVRV to identify 
                capitulation bottoms and the 40-week Moving Average to confirm the trend.
              </p>
            </div>
          </div>

          <div className="flex gap-6">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-950/40 border border-slate-700/60 shadow-sm">
              <Zap className="h-6 w-6 text-amber-300" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100 mb-2">Tier 2: Macro Acceleration (MACRO_ON)</h3>
              <p className="text-sm text-slate-300 leading-relaxed italic">
                The "Turbo." Activates when the external environment is highly favorable. If US Net Liquidity is expanding 
                and the Business Cycle is out of the danger zone, the model permits triple-sizing the accumulation rate.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-8">
        <h2 className="text-xl font-bold text-blue-200 mb-4">Philosophy of Capital Protection</h2>
        <p className="text-slate-200 text-sm leading-relaxed">
          The primary goal of the model is not to pick the exact bottom, but to <strong>stay out of the market during liquidity contractions. </strong> 
          By forcing a "PAUSE" when USD strength is rising sharply or the Sahm Rule triggers a recession alert, the system aims to 
          preserve dry powder for the high-probability periods when liquidity is abundant.
        </p>
      </section>

      <section className="space-y-6">
        <div className="flex items-center gap-3 border-b pb-2">
          <BookOpen className="h-6 w-6 text-blue-400" />
          <h2 className="text-2xl font-bold text-slate-100">References (Data Feeds)</h2>
        </div>

        <p className="text-slate-300 leading-relaxed">
          The app computes scores from the following 3rd party data feeds.
        </p>

        {/* Use MUI breakpoints for layout so cards reliably become multi-column on desktop */}
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', lg: '1fr 1fr 1fr' } }}>
          <ReferenceCard
            title="Fed Total Assets"
            id="WALCL"
            href="https://fred.stlouisfed.org/series/WALCL"
            meaning="The Federal Reserve’s total assets (balance sheet size)."
            usage={[
              "Liquidity inputs: used in US net liquidity proxy.",
              "Derived: US_LIQ = WALCL − WTREGEN − RRPONTSYD (RRP normalized to match units).",
            ]}
          />

          <ReferenceCard
            title="Treasury General Account"
            id="WTREGEN"
            href="https://fred.stlouisfed.org/series/WTREGEN"
            meaning="U.S. Treasury deposits at the Fed (TGA)."
            usage={[
              "Liquidity inputs: used in US net liquidity proxy.",
              "Derived: US_LIQ = WALCL − WTREGEN − RRPONTSYD.",
            ]}
          />

          <ReferenceCard
            title="Overnight Reverse Repo (RRP)"
            id="RRPONTSYD"
            href="https://fred.stlouisfed.org/series/RRPONTSYD"
            meaning="Daily ON RRP usage reported by the New York Fed (units: billions USD on FRED)."
            usage={[
              "Liquidity inputs: used in US net liquidity proxy.",
              "Derived: US_LIQ = WALCL − WTREGEN − RRPONTSYD.",
              "Scoring: contributes to LIQ_SCORE via US_LIQ YoY and 13-week delta.",
            ]}
          />

          <ReferenceCard
            title="USD Index"
            id="DTWEXBGS"
            href="https://fred.stlouisfed.org/series/DTWEXBGS"
            meaning="Broad trade‑weighted U.S. dollar index (USD strength proxy; not ICE DXY)."
            usage={[
              "USD regime scoring (DXY_SCORE): compute MA50, MA200, and ROC20.",
              "Rules: ROC20 > +0.5% → score 0; ROC20 < -0.5% and MA50 < MA200 → score 2; else score 1.",
            ]}
          />

          <ReferenceCard
            title="Sahm Rule"
            id="SAHMREALTIME"
            href="https://fred.stlouisfed.org/series/SAHMREALTIME"
            meaning="Monthly Sahm Rule indicator (labor market deterioration proxy)."
            usage={[
              "Business cycle scoring (BIZ_CYCLE_SCORE): recession-risk if SAHM ≥ 0.50; expansion if SAHM < 0.35 (with other conditions).",
            ]}
          />

          <ReferenceCard
            title="Yield Curve (10Y − 3M)"
            id="T10Y3M"
            href="https://fred.stlouisfed.org/series/T10Y3M"
            meaning="Daily 10-year minus 3-month Treasury spread (curve slope / recession risk proxy)."
            usage={[
              "Business cycle scoring: recession-risk if YC < 0; expansion if YC ≥ 0.75 (with other conditions).",
            ]}
          />

          <ReferenceCard
            title="Manufacturers’ New Orders"
            id="AMTMNO"
            href="https://fred.stlouisfed.org/series/AMTMNO"
            meaning="Monthly manufacturing new orders proxy (demand/industrial momentum)."
            usage={[
              "Business cycle scoring: compute NO_YOY (YoY %) and NO_MOM3 (3‑month momentum approximation).",
              "Recession-risk if NO_YOY < 0 and NO_MOM3 ≤ 0; expansion requires NO_YOY ≥ 0 (with other conditions).",
            ]}
          />

          <ReferenceCard
            title="BTC Daily Price"
            id="Binance, BTCUSDT"
            href="https://api.binance.com/api/v3/klines"
            meaning="Exchange candlestick endpoint used to fetch recent BTC daily candles."
            usage={[
              "BTC price tail: merged with local bundled history to keep data current.",
            ]}
          />

          <ReferenceCard
            title="Market Value to Realized Value"
            id="MVRV"
            href="https://api.blockchain.info/charts/mvrv?timespan=all&sampled=true&metadata=false&daysAverageString=1d&cors=true&format=json"
            meaning="Market Value to Realized Value ratio (valuation proxy)."
            usage={[
              "Valuation scoring (VAL_SCORE): MVRV < 1.0 → 2; 1.0–1.8 → 1; ≥ 1.8 → 0.",
            ]}
          />
        </Box>
      </section>
    </div>
  );
};

const DocCard = ({ title, text }: any) => (
  <div className="rounded-xl border border-slate-700/60 bg-slate-900 p-5 shadow-sm">
    <h4 className="font-bold text-slate-100 mb-2">{title}</h4>
    <p className="text-xs text-slate-300 leading-relaxed">{text}</p>
  </div>
);

const ReferenceCard = ({
  title,
  id,
  href,
  meaning,
  usage,
}: {
  title: string;
  id: string;
  href: string;
  meaning: string;
  usage: string[];
}) => (
  <Card>
    <CardHeader
      title={
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1.5 }}>
          <Typography sx={{ fontWeight: 900, lineHeight: 1.15 }}>
            {title} -{' '}
            <Box
              component="span"
              sx={{
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                fontWeight: 800,
              }}
            >
              {id}
            </Box>
          </Typography>
          <Tooltip title="Open source">
            <IconButton
              component="a"
              href={href}
              target="_blank"
              rel="noreferrer"
              size="small"
              sx={{
                color: '#fff',
                border: '1px solid',
                borderColor: 'rgba(148,163,184,0.35)',
                bgcolor: 'rgba(2,6,23,0.18)',
                '&:hover': { borderColor: 'rgba(148,163,184,0.6)', bgcolor: 'rgba(2,6,23,0.28)' },
              }}
              aria-label={`Open ${id} source`}
            >
              <OpenInNewIcon sx={{ fontSize: 16, color: '#fff' }} />
            </IconButton>
          </Tooltip>
        </Box>
      }
      subheader={
        <Typography variant="body2" color="text.secondary">
          {meaning}
        </Typography>
      }
    />
    <Divider />
    <CardContent>
      <Stack spacing={1.25}>
        <Box
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            px: 2,
            py: 1.25,
            bgcolor: 'rgba(2,6,23,0.10)',
          }}
        >
          <Typography variant="overline" color="text.secondary">
            How it’s used
          </Typography>
          <Stack component="ul" spacing={0.75} sx={{ mt: 0.5, pl: 2 }}>
            {usage.map((u) => (
              <Typography component="li" variant="body2" key={u} sx={{ color: 'text.primary' }}>
                {u}
              </Typography>
            ))}
          </Stack>
        </Box>
      </Stack>
    </CardContent>
  </Card>
);

export default Documentation;

