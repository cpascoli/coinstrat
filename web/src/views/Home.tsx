import React from 'react';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Box, Button, Card, CardContent, CardHeader, Divider, IconButton, Link, Stack, Tooltip, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { HeroIllustration } from '../components/HeroIllustration';

const Home: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-4xl space-y-12">

    <Typography
      sx={{
        textAlign: 'center',
        fontWeight: 1000,
        letterSpacing: -1.2,
        lineHeight: 1.0,
        mb: 1.25,
        maxWidth: '90%',
        fontSize: { xs: 44, sm: 56, md: 62 },
      }}
    >
      <Box
        component="span"
        sx={{
          background: 'linear-gradient(90deg, rgba(96,165,250,1) 0%, rgba(167,139,250,1) 45%, rgba(34,197,94,1) 100%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}
      >
        Multi‑Factor Bitcoin Macro Engine
      </Box>
    </Typography>

      <Box
        sx={{
          borderRadius: 3,
          py: { xs: 2.5, sm: 3, md: 4 },
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ display: 'grid', gap: { xs: 3, md: 4 }, gridTemplateColumns: { xs: '1fr', md: '1.0fr 1.0fr' }, alignItems: 'flex-start' }}>
          <Box>
            <Box component="ul" sx={{ mb: 1, pl: 2.5, color: 'text.secondary' }}>
    
              <Box component="li" sx={{ mb: 1 }}>
                <Typography color="text.secondary" sx={{ lineHeight: 1.75, fontSize: { xs: 14, sm: 16, md: 18 } }}>
                  Coin Strat turns <strong>global liquidity</strong>, <strong>macro conditions</strong>, and <strong>BTC valuation</strong> into simple signals 
                  that help you decide when to <strong>deploy</strong>, <strong>accelerate</strong>, and <strong>pause</strong> bitcoin accumulation.
                </Typography>
              </Box>

              <Box component="li" sx={{ mb: 1}}>
                <Typography color="text.secondary" sx={{ lineHeight: 1.75, fontSize: { xs: 14, sm: 16, md: 18 } }}>
                  Use Coin Strat to optimize how you fund {' '}
                  <Link
                    href="https://powerwallet.finance"
                    target="_blank"
                    rel="noreferrer"
                    underline="hover"
                    sx={{ color: 'primary.light', fontWeight: 900, whiteSpace: 'nowrap' }}
                  >
                    Power Wallet
                  </Link>
                  ’s bitcoin accumulation strategies.
                </Typography>
              </Box>
            </Box>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ mt: 5, alignItems: { sm: 'center' } }}>
              <Button variant="contained" size="medium" onClick={() => navigate('/dashboard')} sx={{ fontWeight: 900 }}>
                Open Dashboard
              </Button>
              <Button variant="outlined" size="medium" onClick={() => navigate('/charts/system')} sx={{ fontWeight: 900 }}>
                View Charts
              </Button>
            </Stack>
          </Box>

          <Box sx={{ width: '100%', mx: { xs: 'auto', md: 0 } }}>
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
            title="Scoring" 
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
         
          <h2 className="text-2xl font-bold text-slate-100">Key Signals</h2>
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
                CORE Accumulation
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
                 MACRO Acceleration
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
          The app derives metrics and computes scores from the following 3rd party data feeds
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
            title="Long-Term Holder SOPR"
            id="LTH SOPR (BGeometrics)"
            href="https://charts.bgeometrics.com/lth_sopr.html"
            meaning="Spent Output Profit Ratio for coins held > 155 days. LTH SOPR < 1 means long-term holders are selling at a loss (capitulation)."
            usage={[
              "Valuation amplifier: when MVRV is in fair-value range (1.0–1.8) and LTH SOPR < 1.0, VAL_SCORE is upgraded from 1 to 2 (deep value).",
            ]}
          />

          <ReferenceCard
            title="Market Value to Realized Value"
            id="MVRV"
            href="https://www.blockchain.com/explorer/charts/mvrv"
            meaning="Market Value to Realized Value ratio (valuation proxy)."
            usage={[
              "Valuation scoring (VAL_SCORE): MVRV < 1.0 → 2; 1.0–1.8 → 1 (or 2 if LTH SOPR < 1); ≥ 1.8 → 0.",
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

export default Home;

