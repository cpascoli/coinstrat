import React, { useState } from 'react';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Box, Button, Card, CardContent, CardHeader, Chip, Divider, IconButton, Link, Stack, TextField, Tooltip, Typography, Alert } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { HeroIllustration } from '../components/HeroIllustration';
import { Zap, Crown, Check } from 'lucide-react';

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

      {/* Email signup — high visibility, right below the hero */}
      <EmailSignup />

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

      {/* Pricing */}
      <PricingSection />

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
              "Valuation amplifier: when MVRV is in entry range (< 1.8) and LTH SOPR < 1.0, VAL_SCORE is upgraded to 2 (strong). Both < 1.0 gives score 3 (extreme).",
            ]}
          />

          <ReferenceCard
            title="Market Value to Realized Value"
            id="MVRV"
            href="https://www.blockchain.com/explorer/charts/mvrv"
            meaning="Market Value to Realized Value ratio (valuation proxy)."
            usage={[
              "Valuation scoring (VAL_SCORE): MVRV < 1.0 → 3/2; 1.0–1.8 → 2/1; 1.8–3.5 → 1; ≥ 3.5 → 0 (euphoria).",
            ]}
          />

          <ReferenceCard
            title="Supply in Profit"
            id="SIP (BGeometrics)"
            href="https://charts.bgeometrics.com/supply_in_profit.html"
            meaning="Percentage of total BTC supply currently in profit (current price above the price at which coins last moved on-chain)."
            usage={[
              "Euphoria Exhaustion exit logic: SIP > 95% for 14+ consecutive days arms the exit (euphoria detected).",
              "If SIP then drops below 90% and fails to reclaim 95% within 45 days, SIP_EXHAUSTED is confirmed — CORE exit Condition B fires.",
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

/* ── Pricing Section ── */

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    color: '#94a3b8',
    icon: null,
    badge: null,
    features: [
      'Live dashboard & signals',
      'Score breakdown',
      'Charts (30-day history)',
      'Backtest (1-year window)',
      'Weekly email digest',
    ],
    cta: 'Get started',
    href: '/dashboard',
    variant: 'outlined' as const,
    tier: 'free' as const,
  },
  {
    name: 'Pro',
    price: '$9.99',
    period: '/month',
    color: '#60a5fa',
    icon: <Zap size={18} />,
    badge: null,
    features: [
      'Everything in Free',
      'Full chart history',
      'Full backtest range',
      'Signal API (1K calls/day)',
      'Real-time signal alerts by email',
      'OpenClaw skill access',
    ],
    cta: 'Upgrade to Pro',
    href: '/profile',
    variant: 'contained' as const,
    tier: 'pro' as const,
  },
  {
    name: 'Lifetime',
    price: '$99',
    period: ' one-time',
    color: '#f59e0b',
    icon: <Crown size={18} />,
    badge: 'First 100 Supporters',
    features: [
      'Everything in Pro — forever',
      'No recurring payments',
      'Lock in lifetime access',
      'Signal API (1K calls/day)',
      'All future Pro features included',
      'Priority support',
    ],
    cta: 'Get Lifetime Access',
    href: '/profile',
    variant: 'contained' as const,
    tier: 'lifetime' as const,
  },
];

const PricingSection: React.FC = () => {
  const navigate = useNavigate();
  return (
    <section className="space-y-6">
      <div className="flex items-center gap-3 border-b pb-2">
        <h2 className="text-2xl font-bold text-slate-100">Pricing</h2>
      </div>
      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' } }}>
        {PLANS.map((plan) => (
          <Card
            key={plan.name}
            sx={{
              position: 'relative',
              overflow: 'hidden',
              borderColor: plan.name === 'Lifetime' ? plan.color : plan.name === 'Pro' ? plan.color : 'rgba(148,163,184,0.35)',
              borderWidth: (plan.name === 'Pro' || plan.name === 'Lifetime') ? 2 : 1,
              background: plan.name === 'Lifetime'
                ? 'linear-gradient(180deg, rgba(245,158,11,0.08) 0%, rgba(15,23,42,0.65) 100%)'
                : 'linear-gradient(180deg, rgba(2,6,23,0.35) 0%, rgba(15,23,42,0.65) 100%)',
              boxShadow: 'none',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                {plan.icon}
                <Typography sx={{ fontWeight: 800, fontSize: 18 }}>{plan.name}</Typography>
                {plan.badge && (
                  <Chip label={plan.badge} size="small" sx={{ bgcolor: `${plan.color}22`, color: plan.color, fontWeight: 700, fontSize: 11 }} />
                )}
              </Stack>

              <Box sx={{ mb: 2 }}>
                <Typography component="span" sx={{ fontWeight: 900, fontSize: 32 }}>{plan.price}</Typography>
                <Typography component="span" color="text.secondary" sx={{ fontSize: 14 }}>{plan.period}</Typography>
              </Box>

              <Stack spacing={1} sx={{ mb: 3, flex: 1 }}>
                {plan.features.map((f) => (
                  <Stack key={f} direction="row" spacing={1} alignItems="flex-start">
                    <Check size={16} style={{ color: plan.color, marginTop: 3, flexShrink: 0 }} />
                    <Typography variant="body2" color="text.secondary">{f}</Typography>
                  </Stack>
                ))}
              </Stack>

              <Button
                variant={plan.variant}
                fullWidth
                onClick={() => navigate(plan.href)}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  py: 1.2,
                  ...(plan.variant === 'contained' && { bgcolor: plan.color, '&:hover': { bgcolor: plan.color, filter: 'brightness(1.15)' } }),
                }}
              >
                {plan.cta}
              </Button>
            </CardContent>
          </Card>
        ))}
      </Box>
    </section>
  );
};

/* ── Email Signup ── */

const EmailSignup: React.FC = () => {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setStatus('loading');
    try {
      const res = await fetch('/api/email/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'homepage' }),
      });
      setStatus(res.ok ? 'success' : 'error');
      if (res.ok) setEmail('');
    } catch {
      setStatus('error');
    }
  };

  return (
    <Card
      sx={{
        background: 'linear-gradient(135deg, rgba(96,165,250,0.08) 0%, rgba(167,139,250,0.08) 100%)',
        borderColor: 'rgba(96,165,250,0.25)',
        boxShadow: 'none',
      }}
    >
      <CardContent sx={{ textAlign: 'center', py: 4 }}>
        <Typography variant="h5" sx={{ fontWeight: 900, mb: 1 }}>Free Weekly Signal Report</Typography>
        <Typography color="text.secondary" sx={{ mb: 3, maxWidth: 540, mx: 'auto' }}>
          Every Monday, get the latest accumulation signal, macro scores, and a
          brief market read — straight to your inbox. No spam, unsubscribe anytime.
        </Typography>

        {status === 'success' ? (
          <Alert severity="success" sx={{ maxWidth: 400, mx: 'auto' }}>
            You're in! Your first report arrives next Monday.
          </Alert>
        ) : (
          <Box
            component="form"
            onSubmit={handleSubmit}
            sx={{ display: 'flex', gap: 1, maxWidth: 420, mx: 'auto' }}
          >
            <TextField
              placeholder="your@email.com"
              type="email"
              size="small"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              fullWidth
              sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'background.paper' } }}
            />
            <Button
              type="submit"
              variant="contained"
              disabled={status === 'loading'}
              sx={{ textTransform: 'none', fontWeight: 700, whiteSpace: 'nowrap', px: 3 }}
            >
              {status === 'loading' ? 'Joining…' : 'Get the report'}
            </Button>
          </Box>
        )}
        {status === 'error' && (
          <Alert severity="error" sx={{ mt: 2, maxWidth: 400, mx: 'auto' }}>
            Something went wrong. Please try again.
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};

export default Home;

