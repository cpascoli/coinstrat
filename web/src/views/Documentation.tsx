import React from 'react';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Box, Button, Card, CardContent, CardHeader, Divider, IconButton, Link, Stack, Tooltip, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';

const HeroIllustration: React.FC = () => (
  <Box
    component="svg"
    viewBox="0 0 760 520"
    width="100%"
    height="auto"
    role="img"
    aria-label="Coin Strat hero illustration: price chart with macro regimes and signals"
    sx={{ display: 'block' }}
  >
    <defs>
      <linearGradient id="cs-bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#0b1220" stopOpacity="1" />
        <stop offset="55%" stopColor="#0f1a2f" stopOpacity="1" />
        <stop offset="100%" stopColor="#111c33" stopOpacity="1" />
      </linearGradient>
      <linearGradient id="cs-accent" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.95" />
        <stop offset="50%" stopColor="#a78bfa" stopOpacity="0.85" />
        <stop offset="100%" stopColor="#22c55e" stopOpacity="0.85" />
      </linearGradient>
      <linearGradient id="cs-line" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#e5e7eb" />
        <stop offset="100%" stopColor="#93c5fd" />
      </linearGradient>
      <filter id="cs-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="6" result="blur" />
        <feColorMatrix
          in="blur"
          type="matrix"
          values="
            1 0 0 0 0
            0 1 0 0 0
            0 0 1 0 0
            0 0 0 .55 0"
          result="glow"
        />
        <feMerge>
          <feMergeNode in="glow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>

    {/* Card background */}
    <rect x="16" y="16" width="728" height="488" rx="26" fill="url(#cs-bg)" stroke="rgba(148,163,184,0.22)" />
    <rect x="16" y="16" width="728" height="5" rx="3" fill="url(#cs-accent)" />

    {/* Grid */}
    {Array.from({ length: 9 }).map((_, i) => (
      <line
        key={`h-${i}`}
        x1="60"
        x2="700"
        y1={110 + i * 36}
        y2={110 + i * 36}
        stroke="rgba(148,163,184,0.10)"
        strokeWidth="1"
      />
    ))}
    {Array.from({ length: 10 }).map((_, i) => (
      <line
        key={`v-${i}`}
        y1="92"
        y2="448"
        x1={80 + i * 62}
        x2={80 + i * 62}
        stroke="rgba(148,163,184,0.06)"
        strokeWidth="1"
      />
    ))}

    {/* Regime shading blocks */}
    <rect x="86" y="92" width="126" height="356" fill="rgba(34,197,94,0.10)" />
    <rect x="212" y="92" width="148" height="356" fill="rgba(148,163,184,0.10)" />
    <rect x="360" y="92" width="126" height="356" fill="rgba(239,68,68,0.10)" />
    <rect x="486" y="92" width="214" height="356" fill="rgba(34,197,94,0.08)" />

    {/* Price line */}
    <path
      d="M86 394 C 132 380, 154 330, 206 344 C 248 356, 258 298, 306 286 C 354 274, 366 238, 404 246 C 448 256, 462 210, 494 200 C 540 186, 562 150, 600 158 C 640 166, 664 132, 700 116"
      fill="none"
      stroke="url(#cs-line)"
      strokeWidth="3.2"
      filter="url(#cs-glow)"
    />

    {/* "Liquidity" area line */}
    <path
      d="M86 424 C 150 420, 206 430, 274 412 C 330 398, 382 402, 440 392 C 510 380, 612 382, 700 360"
      fill="none"
      stroke="rgba(96,165,250,0.55)"
      strokeWidth="2"
      strokeDasharray="6 6"
    />

    {/* Mini badges */}
    <g transform="translate(66 44)">
      <rect x="0" y="0" width="156" height="36" rx="12" fill="rgba(2,6,23,0.60)" stroke="rgba(148,163,184,0.22)" />
      <text x="16" y="24" fill="#e5e7eb" fontFamily="ui-sans-serif, system-ui" fontSize="14" fontWeight="800">
        Coin Strat 2026
      </text>
    </g>

    <g transform="translate(560 44)">
      <rect x="0" y="0" width="146" height="36" rx="12" fill="rgba(2,6,23,0.60)" stroke="rgba(148,163,184,0.22)" />
      <circle cx="18" cy="18" r="8" fill="#22c55e" fillOpacity="0.9" />
      <text x="34" y="24" fill="#cbd5e1" fontFamily="ui-sans-serif, system-ui" fontSize="13" fontWeight="700">
        Signals: ON
      </text>
    </g>

    {/* Bottom factor chips */}
    <g transform="translate(68 460)">
      {[
        { x: 0, label: 'Liquidity', c: '#60a5fa' },
        { x: 170, label: 'Business Cycle', c: '#34d399' },
        { x: 356, label: 'USD Regime', c: '#fbbf24' },
        { x: 520, label: 'Valuation', c: '#e5e7eb' },
      ].map((t) => (
        <g key={t.label} transform={`translate(${t.x} 0)`}>
          <rect x="0" y="0" width="152" height="34" rx="12" fill="rgba(2,6,23,0.60)" stroke="rgba(148,163,184,0.22)" />
          <circle cx="18" cy="17" r="7" fill={t.c} fillOpacity="0.95" />
          <text x="34" y="22" fill="#cbd5e1" fontFamily="ui-sans-serif, system-ui" fontSize="12.8" fontWeight="700">
            {t.label}
          </text>
        </g>
      ))}
    </g>
  </Box>
);

const Documentation: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-4xl space-y-12">
      <Box
        sx={{
          borderRadius: 3,
          p: { xs: 2.5, sm: 3, md: 4 },
          border: '1px solid',
          borderColor: 'rgba(148,163,184,0.25)',
          background:
            'linear-gradient(180deg, rgba(2,6,23,0.35) 0%, rgba(15,23,42,0.70) 100%)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ display: 'grid', gap: { xs: 3, md: 4 }, gridTemplateColumns: { xs: '1fr', md: '1.1fr 0.9fr' }, alignItems: 'center' }}>
          <Box>
            <Typography variant="h3" sx={{ fontWeight: 950, letterSpacing: -0.8, color: 'text.primary', mb: 1 }}>
              Coin
              <Box component="span" sx={{ color: 'primary.main' }}> Strat</Box>
            </Typography>
            <Box component="ul" sx={{ m: 0, mb: 2.25, pl: 2.5, color: 'text.secondary' }}>
              <Box component="li" sx={{ mb: 1 }}>
                <Typography color="text.secondary" sx={{ lineHeight: 1.75 }}>
                  Coin Strat is a multi-factor signal engine designed to help you time capital allocation to {' '}
                  <Link
                    href="https://powerwallet.finance"
                    target="_blank"
                    rel="noreferrer"
                    underline="hover"
                    sx={{ color: 'primary.light', fontWeight: 900, whiteSpace: 'nowrap' }}
                  >
                    Power Wallet
                  </Link>'s bitcoin accumulation strategies.
                </Typography>
              </Box>
              <Box component="li" sx={{ mb: 1 }}>
                <Typography color="text.secondary" sx={{ lineHeight: 1.75 }}>
                  It tells you when to <strong>deploy fresh capital</strong>, when to <strong>accelerate accumulation</strong>, and when to{' '}
                  <strong>pause</strong> to protect capital.
                </Typography>
              </Box>
              <Box component="li">
                <Typography color="text.secondary" sx={{ lineHeight: 1.75 }}>
                  Signals blend <strong>global liquidity</strong>, <strong>macro conditions</strong>, and <strong>BTC valuation</strong> into one clear system state.
                </Typography>
              </Box>
            </Box>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ alignItems: { sm: 'center' } }}>
              <Button variant="contained" size="medium" onClick={() => navigate('/dashboard')} sx={{ fontWeight: 900 }}>
                Open Dashboard
              </Button>
              <Button variant="outlined" size="medium" onClick={() => navigate('/charts/system')} sx={{ fontWeight: 900 }}>
                View Charts
              </Button>
            </Stack>
          </Box>

          <Box sx={{ width: '100%', maxWidth: 520, mx: { xs: 'auto', md: 0 } }}>
            <HeroIllustration />
          </Box>
        </Box>
      </Box>

      <section className="space-y-6">
        <div className="flex items-center gap-3 border-b pb-2">
         
          <h2 className="text-2xl font-bold text-slate-100">System Architecture</h2>
        </div>
        <p className="text-slate-300 leading-relaxed">
          The system is composed of three main components
        </p>
        {/* Use MUI breakpoints for layout so cards reliably render in a row on desktop */}
        <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' } }}>
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
        </Box>
      </section>

      <section className="space-y-6">
        <div className="flex items-center gap-3 border-b pb-2">
         
          <h2 className="text-2xl font-bold text-slate-100">The Accumulation Hierarchy</h2>
        </div>
        
        <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          <Card
            sx={{
              position: 'relative',
              overflow: 'hidden',
              borderColor: 'rgba(148,163,184,0.35)',
              background:
                'linear-gradient(180deg, rgba(2,6,23,0.35) 0%, rgba(15,23,42,0.65) 100%)',
              boxShadow: 'none',
              '&::before': {
                content: '""',
                position: 'absolute',
                inset: 0,
                height: 3,
                background: 'linear-gradient(90deg, rgba(96,165,250,0.95), rgba(59,130,246,0.65))',
                opacity: 0.95,
              },
            }}
          >
            <CardContent sx={{ pt: 2.25 }}>
              <Typography sx={{ fontWeight: 900, color: 'text.primary', mb: 1 }}>
                Tier 1: CORE Accumulation
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.65, fontStyle: 'regular' }}>
                The Core "Engine" focuses on multi-month accumulation during deep-value phases. It uses MVRV to identify
                capitulation bottoms and the 40-week Moving Average to confirm the trend.
              </Typography>
            </CardContent>
          </Card>

          <Card
            sx={{
              position: 'relative',
              overflow: 'hidden',
              borderColor: 'rgba(148,163,184,0.35)',
              background:
                'linear-gradient(180deg, rgba(2,6,23,0.35) 0%, rgba(15,23,42,0.65) 100%)',
              boxShadow: 'none',
              '&::before': {
                content: '""',
                position: 'absolute',
                inset: 0,
                height: 3,
                background: 'linear-gradient(90deg, rgba(251,191,36,0.95), rgba(245,158,11,0.65))',
                opacity: 0.95,
              },
            }}
          >
            <CardContent sx={{ pt: 2.25 }}>
              <Typography sx={{ fontWeight: 900, color: 'text.primary', mb: 1 }}>
                Tier 2: MACRO Acceleration
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.65, fontStyle: 'regular' }}>
                The "Turbo" activates when the external environment is highly favorable. If US Net Liquidity is expanding
                and the Business Cycle is out of the danger zone, the model permits triple-sizing the accumulation rate.
              </Typography>
            </CardContent>
          </Card>
        </Box>
      </section>

  

      <section className="space-y-6">
        <div className="flex items-center gap-3 border-b pb-2">
          <h2 className="text-2xl font-bold text-slate-100">Data Feeds</h2>
        </div>

        <p className="text-slate-300 leading-relaxed">
          The app computes scores from the following 3rd party data feeds
        </p>

        {/* Use MUI breakpoints for layout so cards reliably become multi-column on desktop */}
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', lg: '1fr 1fr 1fr' } }}>
          <ReferenceCard
            title="Fed Total Assets"
            id="WALCL"
            href="https://fred.stlouisfed.org/series/WALCL"
            meaning="The Federal Reserve’s total assets (balance sheet)."
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
            title="Overnight Reverse Repo"
            id="RRPONTSYD"
            href="https://fred.stlouisfed.org/series/RRPONTSYD"
            meaning="Daily ON RRP usage reported by the New York Fed"
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
            title="BTC Daily Close"
            id="BTCUSDT (Binance)"
            href="https://www.binance.com/en-GB/trade/BTC_USDT?type=spot"
            meaning="Exchange candlestick endpoint used to fetch recent BTC daily candles."
            usage={[
              "BTC price tail: merged with local bundled history to keep data current.",
            ]}
          />

          <ReferenceCard
            title="Market Value to Realized Value"
            id="MVRV"
            href="https://www.blockchain.com/explorer/charts/mvrv"
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
  <Card
    sx={{
      position: 'relative',
      overflow: 'hidden',
      borderColor: 'rgba(148,163,184,0.35)',
      background:
        'linear-gradient(180deg, rgba(2,6,23,0.35) 0%, rgba(15,23,42,0.65) 100%)',
      boxShadow: 'none',
      transition: 'transform 140ms ease, border-color 140ms ease, background 140ms ease',
      '&:hover': {
        transform: 'translateY(-2px)',
        borderColor: 'rgba(96,165,250,0.55)',
        background:
          'linear-gradient(180deg, rgba(2,6,23,0.35) 0%, rgba(15,23,42,0.80) 100%)',
      },
      '&::before': {
        content: '""',
        position: 'absolute',
        inset: 0,
        height: 3,
        background: 'linear-gradient(90deg, rgba(96,165,250,0.9), rgba(167,139,250,0.7), rgba(34,197,94,0.7))',
        opacity: 0.9,
      },
    }}
  >
    <CardContent sx={{ pt: 2.25 }}>
      <Typography sx={{ fontWeight: 900, color: 'text.primary', mb: 1 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
        {text}
      </Typography>
    </CardContent>
  </Card>
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

