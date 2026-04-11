import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Avatar,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Activity,
  BookOpen,
  LayoutDashboard,
  Crown,
  FlaskConical,
  Key,
  LogIn,
  LogOut,
  Menu as MenuIcon,
  Newspaper,
  Shield,
  User,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { SignalData } from '../App';
import { getRecommendation, type RecommendationAction } from '../lib/recommendation';

interface HomeProps {
  hasFreeAccess?: boolean;
  isAuthenticated?: boolean;
  onOpenAuth?: (redirectTo?: string) => void;
  currentSignal?: SignalData | null;
  signalLoading?: boolean;
  signalError?: string | null;
}

function stanceBadgeClasses(action: RecommendationAction | 'neutral') {
  switch (action) {
    case 'PAUSE':
      return {
        dot: 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.75)]',
        text: 'text-red-300',
      };
    case 'ACCEL':
      return {
        dot: 'bg-secondary shadow-[0_0_8px_rgba(77,224,130,0.8)]',
        text: 'text-secondary',
      };
    case 'BASE':
      return {
        dot: 'bg-[#60a5fa] shadow-[0_0_8px_rgba(96,165,250,0.65)]',
        text: 'text-[#93c5fd]',
      };
    default:
      return {
        dot: 'bg-outline/60',
        text: 'text-outline',
      };
  }
}

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    accent: 'slate' as const,
    badge: null as string | null,
    features: [
      'Live dashboard & signals',
      'Signal Backtest',
      'Score breakdown',
      'Charts',
      'Weekly email digest',
    ],
    cta: 'Unlock Free Access',
    href: '/dashboard',
    tier: 'free' as const,
  },
  {
    name: 'Pro',
    price: '$9.99',
    period: '/ month',
    accent: 'primary' as const,
    badge: 'Most Popular',
    features: [
      'Everything in Free',
      'Build custom strategies and signals',
      'API and OpenClaw access',
      'Real-time signal alerts by email',
      'Priority feature access',
    ],
    cta: 'Upgrade to Pro',
    href: '/profile',
    tier: 'pro' as const,
  },
  {
    name: 'Lifetime',
    price: '$99',
    period: 'one-time',
    accent: 'amber' as const,
    badge: 'First 100 Supporters',
    features: [
      'Everything in Pro — forever',
      'No recurring payments',
      'Lock in lifetime access',
      'Signal API (1K calls/day)',
      'All future Pro features included',
    ],
    cta: 'Get Lifetime Access',
    href: '/profile',
    tier: 'lifetime' as const,
  },
];

const Home: React.FC<HomeProps> = ({
  hasFreeAccess = false,
  isAuthenticated = false,
  onOpenAuth,
  currentSignal = null,
  signalLoading = false,
  signalError = null,
}) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, profile, isAdmin, signOut } = useAuth();
  const hasPaidBuilderAccess = useMemo(
    () => profile?.tier === 'pro' || profile?.tier === 'pro_plus' || profile?.tier === 'lifetime',
    [profile?.tier],
  );
  const [navMenuEl, setNavMenuEl] = useState<null | HTMLElement>(null);
  const [mobilePublicNavEl, setMobilePublicNavEl] = useState<null | HTMLElement>(null);

  const recommendation = useMemo(
    () => (currentSignal ? getRecommendation(currentSignal) : null),
    [currentSignal],
  );

  const stanceUi = useMemo(() => {
    if (recommendation) {
      return {
        label: recommendation.action,
        actionKey: recommendation.action,
        title: recommendation.reason,
      };
    }
    if (signalLoading) {
      return { label: '…', actionKey: 'neutral' as const, title: 'Loading latest signal…' };
    }
    if (signalError) {
      return { label: '—', actionKey: 'neutral' as const, title: signalError };
    }
    return { label: '—', actionKey: 'neutral' as const, title: undefined as string | undefined };
  }, [recommendation, signalError, signalLoading]);

  const stanceStyle = stanceBadgeClasses(stanceUi.actionKey);

  const primaryCta = () => {
    if (hasFreeAccess) navigate('/dashboard');
    else if (isAuthenticated) navigate('/profile');
    else onOpenAuth?.('/dashboard');
  };

  const navActive = (key: string) => {
    switch (key) {
      case 'dashboard':
        return pathname === '/' || pathname === '/dashboard' || pathname.startsWith('/dashboard/');
      case 'builder':
        return pathname === '/strategy-builder';
      case 'docs':
        return pathname.startsWith('/docs') || pathname === '/developer';
      case 'news':
        return pathname.startsWith('/news');
      case 'charts':
        return pathname.startsWith('/charts');
      case 'backtest':
        return pathname === '/backtest';
      default:
        return false;
    }
  };

  const NavLink = ({ to, navKey, children }: { to: string; navKey: string; children: React.ReactNode }) => {
    const active = navActive(navKey);
    return (
      <Link
        to={to}
        className={clsx(
          'border-b-2 pb-1 font-headline font-bold tracking-tight transition-colors',
          active ? 'border-[#2563eb] text-[#b4c5ff]' : 'border-transparent text-slate-400 hover:text-white',
        )}
      >
        {children}
      </Link>
    );
  };

  return (
    <div className="dark min-h-screen overflow-x-clip bg-surface font-body text-on-surface selection:bg-primary/30">
      <nav className="fixed top-0 z-50 w-full border-b border-[#434655]/15 bg-[#0c1322]/80 shadow-2xl shadow-[#070e1d]/40 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center px-6 py-4">
          <Link
            to="/"
            className="shrink-0 font-headline text-2xl font-black tracking-tighter text-[#b4c5ff]"
            aria-label="CoinStrat home"
          >
            CoinStrat
          </Link>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-6 md:gap-8">
            <div className="hidden items-center space-x-8 md:flex">
              {user ? (
                <>
                  <NavLink to="/dashboard" navKey="dashboard">
                    Dashboard
                  </NavLink>
                  <NavLink to="/strategy-builder" navKey="builder">
                    Signal Builder
                  </NavLink>
                </>
              ) : null}
              <NavLink to="/news" navKey="news">
                News
              </NavLink>
              <NavLink to="/docs" navKey="docs">
                Docs
              </NavLink>
              <NavLink to="/charts/system" navKey="charts">
                Charts
              </NavLink>
              <NavLink to="/backtest" navKey="backtest">
                Backtest
              </NavLink>
            </div>

            <div className="flex items-center gap-2">
            {!user && (
              <div className="md:hidden">
                <IconButton
                  size="small"
                  onClick={(e) => setMobilePublicNavEl(e.currentTarget)}
                  aria-label="Open navigation menu"
                  sx={{ color: '#94a3b8' }}
                >
                  <MenuIcon size={22} />
                </IconButton>
                <Menu
                  anchorEl={mobilePublicNavEl}
                  open={Boolean(mobilePublicNavEl)}
                  onClose={() => setMobilePublicNavEl(null)}
                  disableScrollLock
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                  transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                  PaperProps={{ sx: { minWidth: 200, bgcolor: '#191f2f', border: '1px solid rgba(67, 70, 85, 0.35)' } }}
                >
                  <MenuItem
                    component={Link}
                    to="/news"
                    onClick={() => setMobilePublicNavEl(null)}
                    sx={{ color: '#dce2f7', py: 1.25 }}
                  >
                    <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>
                      <Newspaper size={18} />
                    </ListItemIcon>
                    <ListItemText primaryTypographyProps={{ fontWeight: 700 }}>News</ListItemText>
                  </MenuItem>
                  
                  <MenuItem
                    component={Link}
                    to="/docs"
                    onClick={() => setMobilePublicNavEl(null)}
                    sx={{ color: '#dce2f7', py: 1.25 }}
                  >
                    <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>
                      <BookOpen size={18} />
                    </ListItemIcon>
                    <ListItemText primaryTypographyProps={{ fontWeight: 700 }}>Docs</ListItemText>
                  </MenuItem>

                  <MenuItem
                    component={Link}
                    to="/charts/system"
                    onClick={() => setMobilePublicNavEl(null)}
                    sx={{ color: '#dce2f7', py: 1.25 }}
                  >
                    <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>
                      <Activity size={18} />
                    </ListItemIcon>
                    <ListItemText primaryTypographyProps={{ fontWeight: 700 }}>Charts</ListItemText>
                  </MenuItem>
                  <MenuItem
                    component={Link}
                    to="/backtest"
                    onClick={() => setMobilePublicNavEl(null)}
                    sx={{ color: '#dce2f7', py: 1.25 }}
                  >
                    <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>
                      <FlaskConical size={18} />
                    </ListItemIcon>
                    <ListItemText primaryTypographyProps={{ fontWeight: 700 }}>Backtest</ListItemText>
                  </MenuItem>
                  <Divider sx={{ borderColor: 'rgba(148,163,184,0.15)', my: 0.5 }} />
                  <MenuItem
                    onClick={() => {
                      setMobilePublicNavEl(null);
                      onOpenAuth?.('/dashboard');
                    }}
                    sx={{ color: '#dce2f7', py: 1.25 }}
                  >
                    <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>
                      <LogIn size={18} />
                    </ListItemIcon>
                    <ListItemText primaryTypographyProps={{ fontWeight: 700 }}>Sign In</ListItemText>
                  </MenuItem>
                </Menu>
              </div>
            )}

            {user ? (
              <>
                <IconButton size="small" onClick={(e) => setNavMenuEl(e.currentTarget)} aria-label="Account menu">
                  <Avatar sx={{ width: 32, height: 32, bgcolor: '#2563eb', fontSize: 14, fontWeight: 700 }}>
                    {(profile?.email?.[0] ?? user?.email?.[0] ?? 'U').toUpperCase()}
                  </Avatar>
                </IconButton>
                <Menu
                  anchorEl={navMenuEl}
                  open={Boolean(navMenuEl)}
                  onClose={() => setNavMenuEl(null)}
                  disableScrollLock
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                  transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                  PaperProps={{ sx: { minWidth: 200, bgcolor: '#191f2f', border: '1px solid rgba(67, 70, 85, 0.35)' } }}
                >

                  <MenuItem
                    component={Link}
                    to="/news"
                    onClick={() => setNavMenuEl(null)}
                    sx={{ display: { xs: 'flex', md: 'none' }, color: '#dce2f7', py: 1.25 }}
                  >
                    <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>
                      <Newspaper size={18} />
                    </ListItemIcon>
                    <ListItemText primaryTypographyProps={{ fontWeight: 700 }}>News</ListItemText>
                  </MenuItem>

                  <MenuItem
                    component={Link}
                    to="/docs"
                    onClick={() => setNavMenuEl(null)}
                    sx={{ display: { xs: 'flex', md: 'none' }, color: '#dce2f7', py: 1.25 }}
                  >
                    <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>
                      <BookOpen size={18} />
                    </ListItemIcon>
                    <ListItemText primaryTypographyProps={{ fontWeight: 700 }}>Docs</ListItemText>
                  </MenuItem>

                  <MenuItem
                    component={Link}
                    to="/charts/system"
                    onClick={() => setNavMenuEl(null)}
                    sx={{ display: { xs: 'flex', md: 'none' }, color: '#dce2f7', py: 1.25 }}
                  >
                    <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>
                      <Activity size={18} />
                    </ListItemIcon>
                    <ListItemText primaryTypographyProps={{ fontWeight: 700 }}>Charts</ListItemText>
                  </MenuItem>
                  <MenuItem
                    component={Link}
                    to="/backtest"
                    onClick={() => setNavMenuEl(null)}
                    sx={{ display: { xs: 'flex', md: 'none' }, color: '#dce2f7', py: 1.25 }}
                  >
                    <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>
                      <FlaskConical size={18} />
                    </ListItemIcon>
                    <ListItemText primaryTypographyProps={{ fontWeight: 700 }}>Backtest</ListItemText>
                  </MenuItem>
                  <Divider sx={{ display: { xs: 'block', md: 'none' }, borderColor: 'rgba(148,163,184,0.15)', my: 0.5 }} />
                  <MenuItem
                    component={Link}
                    to="/dashboard"
                    onClick={() => setNavMenuEl(null)}
                  >
                    <ListItemIcon><LayoutDashboard size={16} /></ListItemIcon>
                    <ListItemText>Dashboard</ListItemText>
                  </MenuItem>
                  <MenuItem onClick={() => { setNavMenuEl(null); navigate('/developer'); }}>
                    <ListItemIcon><Key size={16} /></ListItemIcon>
                    <ListItemText>Developer</ListItemText>
                  </MenuItem>
                  {hasPaidBuilderAccess && (
                    <MenuItem onClick={() => { setNavMenuEl(null); navigate('/strategy-builder'); }}>
                      <ListItemText>Signal Builder</ListItemText>
                    </MenuItem>
                  )}
                  <MenuItem onClick={() => { setNavMenuEl(null); navigate('/profile'); }}>
                    <ListItemIcon><User size={16} /></ListItemIcon>
                    <ListItemText>Profile</ListItemText>
                  </MenuItem>
                  {isAdmin && (
                    <MenuItem onClick={() => { setNavMenuEl(null); navigate('/admin'); }}>
                      <ListItemIcon><Shield size={16} /></ListItemIcon>
                      <ListItemText>Admin</ListItemText>
                    </MenuItem>
                  )}
                  <MenuItem onClick={async () => { setNavMenuEl(null); await signOut(); navigate('/'); }}>
                    <ListItemIcon><LogOut size={16} /></ListItemIcon>
                    <ListItemText>Sign out</ListItemText>
                  </MenuItem>
                </Menu>
              </>
            ) : null}
            {!(user && hasFreeAccess) && (
              <button
                type="button"
                onClick={primaryCta}
                className="hidden rounded-xl bg-[#b4c5ff] px-6 py-2.5 font-headline font-medium text-[#002a78] transition-all hover:shadow-[0_0_20px_-5px_rgba(180,197,255,0.4)] active:scale-95 md:inline-flex"
              >
                {hasFreeAccess ? 'Dashboard' : isAuthenticated ? 'Profile' : 'Get Started'}
              </button>
            )}
            </div>
          </div>
        </div>
      </nav>

      <main className="pt-24">
        <section className="mx-auto mb-40 max-w-7xl px-6">
          <div className="grid items-center gap-16 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <div className="mb-0 inline-flex flex-wrap items-center gap-4">
                <div className="inline-flex items-center gap-3 rounded-full border border-secondary/20 bg-secondary-container/10 px-4 py-2">
                  <div className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-secondary opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-secondary" />
                  </div>
                  <span className="text-[7px] font-black uppercase tracking-[0.2em] text-secondary">Live Signal</span>
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-outline-variant/20 bg-surface-container-high/40 px-4 py-2">
                  <div className="flex items-center gap-2" title={stanceUi.title}>
                    <div className={clsx('h-1.5 w-1.5 rounded-full', stanceStyle.dot)} />
                    <span className={clsx('text-xs font-black tracking-tight', stanceStyle.text)}>{stanceUi.label}</span>
                  </div>
                </div>
              </div>

              <h1 className="font-headline mb-8 text-5xl font-black leading-[1.1] tracking-tighter text-shadow-sm md:text-7xl">
                <span className="bg-gradient-to-r from-[#F5F5F5] via-[#FAB81F] to-[#FAB81F] bg-clip-text pr-2 italic text-transparent">
                  Your Bitcoin
                </span>
                <br />
                <span className="bg-gradient-to-r from-[#F0FFEC] via-[#C5F4F6] to-[#5EFFAF] bg-clip-text pr-2 italic text-transparent">
                  Accumulation
                </span>
                <br />
                <span className="relative inline-block">
                  Signal
                  <span className="absolute -bottom-2 left-0 h-1.5 w-1/3 rounded-full bg-primary/40" />
                </span>
              </h1>

              <p className="mb-12 max-w-xl text-xl font-medium leading-relaxed text-on-surface-variant">
                CoinStrat synthesizes on-chain activity, macro conditions, and business cycle into high-precision execution signals
                that helps you optimize your Bitcoin accumulation.
              </p>

              <div className="flex flex-col gap-5 sm:flex-row">
                <button
                  type="button"
                  onClick={primaryCta}
                  className="group relative overflow-hidden rounded-xl bg-primary px-10 py-5 text-lg font-black text-on-primary transition-all hover:shadow-[0_0_30px_-5px_rgba(180,197,255,0.4)]"
                >
                  <span className="relative z-10 flex items-center gap-2">
                    {hasFreeAccess ? 'Open Dashboard' : isAuthenticated ? 'Open Profile' : 'View Live Signal'}
                    <span className="material-symbols-outlined text-xl transition-transform group-hover:translate-x-1">arrow_forward</span>
                  </span>
                  <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-white/0 via-white/10 to-white/0 transition-transform duration-700 group-hover:translate-x-full" />
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/docs')}
                  className="group flex items-center justify-center gap-2 rounded-xl border border-outline-variant/30 bg-surface-container px-10 py-5 text-lg font-bold transition-all hover:border-primary/50"
                >
                  <span className="material-symbols-outlined text-xl text-outline">menu_book</span>
                  Explore Methodology
                </button>
              </div>
            </div>

            <div className="relative min-w-0 lg:col-span-5">
              <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden">
                <div className="absolute inset-0 rounded-full bg-primary/20 opacity-40 mix-blend-screen blur-[120px]" />
                <div className="blend-mask relative h-full w-full scale-125">
                  <img
                    alt="Abstract digital wave flows"
                    src="/stitch/img-01-hero-wave.png"
                    className="h-full w-full object-contain opacity-80 mix-blend-lighten"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        <HomeEmailSignup />

        <HomeWhatIs />

        <section className="mx-auto mb-32 max-w-7xl px-4">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.3em] text-primary">The Quant Advantage</h2>
            <h3 className="font-headline text-4xl font-black tracking-tight md:text-5xl">Why CoinStrat?</h3>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            <FeatureCard
              icon="filter_alt"
              title="Cut Through Noise"
              body="Stop reacting to headlines, price swings, and social-media narratives. Focus on on-chain and macro signals that actually matter."
              hover="primary"
            />
            <FeatureCard
              icon="repeat"
              title="Stay Consistent"
              body="Use a repeatable process instead of gut feel, so your Bitcoin strategy stays grounded when the market gets emotional."
              hover="secondary"
            />
            <FeatureCard
              icon="trending_up"
              title="Optimize BTC Accumulation"
              body="Use CoinStrat to optimize your Dollar-Cost Averaging strategies, getting more SATs for your dollar."
              hover="tertiary"
            />
          </div>
        </section>

        <section className="mx-auto mb-32 max-w-7xl rounded-[3rem] border border-outline-variant/5 bg-surface-container-lowest px-6 py-24">
          <div className="grid items-start gap-20 lg:grid-cols-2">
            <div className="space-y-12">
              <div>
                <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.3em] text-secondary">The Methodology</h2>
                <h3 className="font-headline mb-6 text-4xl font-black tracking-tight md:text-5xl">How CoinStrat Works</h3>
              </div>
              <div className="space-y-8">
                <StepRow
                  n="01"
                  title="Track On-Chain Activity"
                  body="Track on-chain activity, liquidity and macro conditions in one place instead of piecing the puzzle together."
                />
                <StepRow
                  n="02"
                  title="Score the Setup"
                  body="Turn raw data into a simple read on whether conditions are supportive, neutral, or risky for Bitcoin accumulation."
                />
                <StepRow
                  n="03"
                  title="Act with Discipline"
                  body="Translate signals into a practical strategy so you know when to pause, buy, or accelerate your bitcoin accumulation."
                />
              </div>
            </div>
            <div className="relative">
              <img alt="Data Visualization" src="/stitch/img-02-data-viz.png" className="w-full rounded-2xl object-cover shadow-3xl transition-all duration-700" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-surface-container-lowest via-transparent to-transparent" />
            </div>
          </div>
        </section>

        <section className="mx-auto mb-32 max-w-7xl px-6">
          <div className="mb-16 text-center">
            <h3 className="font-headline mb-4 text-4xl font-black tracking-tight md:text-5xl">The Two Core Layers</h3>
            <p className="mx-auto max-w-xl text-on-surface-variant">
              Different market conditions require different levels of conviction. <br /> We split our strategy into two distinct signal layers.
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-2">
            <div className="group relative overflow-hidden rounded-3xl border border-outline-variant/10 bg-surface-container p-10">
              <div className="absolute right-0 top-0 p-8 opacity-10 transition-opacity group-hover:opacity-20">
                <span className="material-symbols-outlined text-7xl">timer</span>
              </div>
              <h4 className="font-headline mb-4 text-3xl font-black text-primary">CORE Accumulation</h4>
              <p className="mb-8 text-lg leading-relaxed text-on-surface-variant">
                This is the base signal. It focuses on on-chain valuation and the trend condition and determines whether accumulation is allowed.
              </p>
              <ul className="mb-8 space-y-4">
                <li className="flex items-center gap-3 text-sm font-bold uppercase tracking-widest text-on-surface/70">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Market valuation in deep value zone
                </li>
                <li className="flex items-center gap-3 text-sm font-bold uppercase tracking-widest text-on-surface/70">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Long-term holders capitulating
                </li>
                <li className="flex items-center gap-3 text-sm font-bold uppercase tracking-widest text-on-surface/70">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Supportive trend condition
                </li>
              </ul>
            </div>
            <div className="group relative overflow-hidden rounded-3xl border border-outline-variant/10 bg-surface-container p-10">
              <div className="absolute right-0 top-0 p-8 opacity-10 transition-opacity group-hover:opacity-20">
                <span className="material-symbols-outlined text-7xl">rocket_launch</span>
              </div>
              <h4 className="font-headline mb-4 text-3xl font-black text-secondary">MACRO Acceleration</h4>
              <p className="mb-8 text-lg leading-relaxed text-on-surface-variant">
                It triggers when liquidity and busines cycle align for rapid expansion to signal accelerated accumulation.
              </p>
              <ul className="mb-8 space-y-4">
                <li className="flex items-center gap-3 text-sm font-bold uppercase tracking-widest text-on-surface/70">
                  <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
                  Fed Balance Sheet expansion
                </li>
                <li className="flex items-center gap-3 text-sm font-bold uppercase tracking-widest text-on-surface/70">
                  <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
                  Business cycle recovery
                </li>
                <li className="flex items-center gap-3 text-sm font-bold uppercase tracking-widest text-on-surface/70">
                  <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
                  Weak dollar regime
                </li>
              </ul>
            </div>
          </div>
        </section>

        <HomePricing hasFreeAccess={hasFreeAccess} isAuthenticated={isAuthenticated} onOpenAuth={onOpenAuth} />
        <HomeFaq />
      </main>
    </div>
  );
};

function FeatureCard({
  icon,
  title,
  body,
  hover,
}: {
  icon: string;
  title: string;
  body: string;
  hover: 'primary' | 'secondary' | 'tertiary';
}) {
  const iconBox =
    hover === 'primary'
      ? 'bg-primary/10 text-primary group-hover:bg-primary group-hover:text-on-primary'
      : hover === 'secondary'
        ? 'bg-secondary/10 text-secondary group-hover:bg-secondary group-hover:text-on-secondary'
        : 'bg-tertiary/10 text-tertiary group-hover:bg-tertiary group-hover:text-on-tertiary';

  return (
    <div className="glass-panel group rounded-2xl p-8 transition-all duration-500">
      <div className={clsx('mb-6 flex h-12 w-12 items-center justify-center rounded-lg transition-all', iconBox)}>
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <h4 className="font-headline mb-4 text-xl font-bold">{title}</h4>
      <p className="leading-relaxed text-on-surface-variant">{body}</p>
    </div>
  );
}

function StepRow({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-6 gap-y-2">
      <div className="col-start-1 row-start-1 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded border border-outline-variant bg-surface-container-high font-headline text-sm font-bold tabular-nums tracking-tight text-primary">
        {n}
      </div>
      <h4 className="col-start-2 row-start-1 m-0 self-start font-headline text-xl font-bold leading-tight">{title}</h4>
      <p className="col-start-2 row-start-2 m-0 text-on-surface-variant">{body}</p>
    </div>
  );
}

const HomeEmailSignup: React.FC = () => {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [successMessage, setSuccessMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setStatus('loading');
    setSuccessMessage('');
    try {
      const res = await fetch('/api/email/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'homepage' }),
      });
      const data = await res.json();
      setStatus(res.ok ? 'success' : 'error');
      if (res.ok) {
        setSuccessMessage(
          data.status === 'already_subscribed'
            ? 'This email is already subscribed to the Weekly Signal Report.'
            : 'Check your inbox and confirm your email to activate the Weekly Signal Report.',
        );
        setEmail('');
      }
    } catch {
      setStatus('error');
    }
  };

  return (
    <section className="mx-auto mb-32 max-w-7xl px-6">
      <div className="glass-panel relative overflow-hidden rounded-3xl p-8 md:p-12">
        <div className="pointer-events-none absolute right-0 top-0 h-full w-1/3 bg-gradient-to-l from-primary/5 to-transparent" />
        <div className="relative z-10 grid items-center gap-12 md:grid-cols-2">
          <div>
            <h2 className="font-headline mb-4 text-3xl font-black tracking-tight text-primary md:text-4xl">Free Weekly Signal Report</h2>
            <p className="mb-8 text-lg text-on-surface-variant">
              Start Sunday morning with the latest CoinStrat signal, and a concise Bitcoin market brief built to help you frame the week ahead.
            </p>
            {status === 'success' ? (
              <p className="rounded-lg border border-secondary/30 bg-surface-container-lowest/80 px-4 py-3 text-sm text-on-surface">{successMessage}</p>
            ) : (
              <form className="flex flex-col gap-3 sm:flex-row" onSubmit={handleSubmit}>
                <input
                  className="flex-grow rounded-lg border border-outline-variant/20 bg-surface-container-lowest/50 px-6 py-4 text-on-surface outline-none transition-all placeholder:text-on-surface-variant/70 focus:ring-2 focus:ring-primary"
                  placeholder="Enter your email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="rounded-lg bg-secondary px-8 py-4 font-bold text-on-secondary shadow-lg shadow-secondary/10 transition-all hover:brightness-110 disabled:opacity-60"
                >
                  {status === 'loading' ? 'Joining…' : 'Subscribe Free'}
                </button>
              </form>
            )}
            {status === 'error' && <p className="mt-3 text-sm text-[#ffb4ab]">Something went wrong. Please try again.</p>}
          </div>
          <div className="hidden md:block">
            <div className="flex flex-col gap-4">
              <GlassBullet tone="secondary" text="On-chain liquidity and valuation analysis" />
              <GlassBullet tone="primary" text="Macro-economic indicators" />
              <GlassBullet tone="tertiary" text="Weekly accumulation signal updates" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const WHAT_IS_PILLARS = [
  {
    icon: 'monitoring',
    color: 'text-primary',
    bg: 'bg-primary/10 group-hover:bg-primary/20',
    title: 'A Signal Engine',
    body: 'CoinStrat reads on-chain metrics, macro-economic indicators, and business-cycle data — and distills them into one clear signal: accumulate, accelerate, or pause.',
  },
  {
    icon: 'straighten',
    color: 'text-secondary',
    bg: 'bg-secondary/10 group-hover:bg-secondary/20',
    title: 'A Decision Framework',
    body: "It gives you a repeatable, rules-based process for Bitcoin accumulation — so you don't rely on gut feel, hype, or market noise to time your buys.",
  },
  {
    icon: 'visibility',
    color: 'text-tertiary',
    bg: 'bg-tertiary/10 group-hover:bg-tertiary/20',
    title: 'Transparent & Auditable',
    body: 'Every data source, score, and rule is documented and visible. No black boxes — you can see exactly why the signal says what it says.',
  },
] as const;

const HomeWhatIs: React.FC = () => (
  <section className="mx-auto mb-32 max-w-7xl px-6">
    <div className="mb-14 text-center">
      <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.3em] text-secondary">
        The Short Version
      </h2>
      <h3 className="font-headline text-4xl font-black tracking-tight md:text-5xl">
        What is CoinStrat?
      </h3>
      <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-on-surface-variant">
        CoinStrat watches the data that matters — on-chain, macro, market cycle —
        and tells you <strong className="text-on-surface">when to buy Bitcoin, when to buy more, and when to wait</strong>.
      </p>
    </div>

    <div className="relative grid gap-6 md:grid-cols-3">
      <div className="pointer-events-none absolute left-0 right-0 top-1/2 hidden h-px bg-gradient-to-r from-transparent via-outline-variant/25 to-transparent md:block" />

      {WHAT_IS_PILLARS.map((p) => (
        <div
          key={p.title}
          className="group relative flex flex-col items-center rounded-3xl border border-outline-variant/10 bg-surface-container/50 px-8 pb-10 pt-12 text-center backdrop-blur-sm transition-all duration-500 hover:border-outline-variant/25 hover:bg-surface-container"
        >
          <div
            className={clsx(
              'mb-6 flex h-16 w-16 items-center justify-center rounded-2xl transition-all duration-300',
              p.bg,
            )}
          >
            <span className={clsx('material-symbols-outlined text-3xl', p.color)}>{p.icon}</span>
          </div>
          <h4 className="font-headline mb-3 text-xl font-bold">{p.title}</h4>
          <p className="text-sm leading-relaxed text-on-surface-variant">{p.body}</p>
        </div>
      ))}
    </div>

    <p className="mx-auto mt-10 max-w-xl text-center text-sm text-on-surface-variant/70">
      Think of it as an autopilot for <em>when</em> and <em>how hard</em> to stack sats
    </p>
  </section>
);

function GlassBullet({ tone, text }: { tone: 'primary' | 'secondary' | 'tertiary'; text: string }) {
  const color = tone === 'primary' ? 'text-primary' : tone === 'secondary' ? 'text-secondary' : 'text-tertiary';
  return (
    <div className="flex items-center gap-4 rounded-xl border border-outline-variant/10 bg-surface-container-high/30 p-4 backdrop-blur-md">
      <span className={clsx('material-symbols-outlined', color)} style={{ fontVariationSettings: "'FILL' 1" }}>
        check_circle
      </span>
      <span className="font-medium">{text}</span>
    </div>
  );
}

const HOME_FAQ_ITEMS: { q: string; a: React.ReactNode }[] = [
  {
    q: 'Who is it for?',
    a: (
      <>
        <strong className="text-on-surface">Self-directed Bitcoin holders</strong> who are in for the long run and want a clear
        framework. CoinStrat is built for people stacking over years, who care whether valuation,
        liquidity, and macro line up before they add size. If your edge is discipline and consistency, this is for you. If you need
        intraday calls or guaranteed returns, it isn’t.
      </>
    ),
  },
  {
    q: 'Why Bitcoin accumulation?',
    a: (
      <>
        Bitcoin’s supply schedule and adoption story reward <strong className="text-on-surface">steady accumulation</strong> when
        conditions support it, not panic buying at highs or freezing at lows. Rules beat emotion: you decide your size and cadence;
        CoinStrat tells you when the model says conditions are favorable, neutral, or worth pausing.
        <br />
        We’re not claiming to nail
        every wiggle, but we give you a <strong className="text-on-surface">repeatable read</strong> on the setup so your DCA stays
        intentional.
      </>
    ),
  },
  {
    q: "What's behind the CoinStrat signal?",
    a: (
      <>
        A <strong className="text-on-surface">transparent engine</strong>, not a black box.{' '}
        <strong className="text-on-surface">CORE</strong> is a state machine driven by on-chain valuation and price regime: 
        entry, hold, and exit rules are explicit. 
        {' '}
        <strong className="text-on-surface">MACRO</strong> layers liquidity, business cycle, and
        dollar strength to modulate intensity when CORE is already on. 
        Factor scores (liquidity, cycle, dollar, valuation) are broken down in the app. 
        <br />
        Open {' '} <strong className="text-on-surface">Dashboard → Signals and Scores</strong> to see the live logic, and read the{' '}
        <Link to="/docs" className="font-semibold text-primary underline-offset-2 hover:underline">
          Docs
        </Link>{' '}
        for architecture and data.
      </>
    ),
  },
  {
    q: 'Why go Pro?',
    a: (
      <>
        <strong className="text-on-surface">Free is the full CORE model</strong>: dashboard, charts, backtest context, and the
        weekly email. <strong className="text-on-surface">Pro is the power layer</strong> for who wants to define their own rules:
        {` `}
        <strong className="text-on-surface">Signal Builder</strong> (AI-powered strategy builder), email alerts, API access, and OpenClaw so
        you can wire signals into your own workflows. Upgrade when you’re ready to design and automate.
      </>
    ),
  },
  {
    q: 'How can you build your own custom signals?',
    a: (
      <>
        With Pro, open{' '}
        <Link to="/strategy-builder" className="font-semibold text-primary underline-offset-2 hover:underline">
          Signal Builder
        </Link>
        , describe what you want in natural language, and inspect the generated spec before you trust it. Preview on historical data,
        iterate, then save strategies and turn on alerts when you’re satisfied. Start from curated built-in templates or from
        scratch—your call. The{' '}
        <Link to="/docs/signal-builder" className="font-semibold text-primary underline-offset-2 hover:underline">
          Signal Builder docs
        </Link>{' '}
        list available series, metric operators, and example prompts so you know exactly what the engine can express.
      </>
    ),
  },
];

const HomeFaq: React.FC = () => (
  <section className="mx-auto mb-32 max-w-3xl px-6 md:max-w-4xl">
    <div className="mb-10 text-center">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-primary">Questions</h2>
      <h3 className="font-headline text-3xl font-black tracking-tight md:text-4xl">Quick answers</h3>
      <p className="mx-auto mt-4 max-w-xl text-on-surface-variant">
        A few things people ask before signing in or upgrading. 
        <br/>
        This isn’t personalized advice — always do your own research.
      </p>
    </div>
    <div className="flex flex-col gap-2">
      {HOME_FAQ_ITEMS.map((item) => (
        <Accordion
          key={item.q}
          defaultExpanded
          disableGutters
          elevation={0}
          sx={{
            borderRadius: '16px !important',
            border: '1px solid rgba(148, 163, 184, 0.15)',
            bgcolor: 'rgba(15, 23, 42, 0.45)',
            '&:before': { display: 'none' },
            overflow: 'hidden',
          }}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon sx={{ color: 'rgba(148, 163, 184, 0.9)' }} />}
            sx={{
              px: 2.5,
              py: 0.5,
              '& .MuiAccordionSummary-content': { my: 1.25 },
            }}
          >
            <Typography component="p" sx={{ fontWeight: 800, fontSize: '1rem' }}>
              {item.q}
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 2.5, pb: 2.5, pt: 0 }}>
            <Typography component="div" variant="body2" sx={{ color: 'rgba(226, 232, 240, 0.82)', lineHeight: 1.65 }}>
              {item.a}
            </Typography>
          </AccordionDetails>
        </Accordion>
      ))}
    </div>
  </section>
);

const HomePricing: React.FC<{
  hasFreeAccess?: boolean;
  isAuthenticated?: boolean;
  onOpenAuth?: (redirectTo?: string) => void;
}> = ({ hasFreeAccess = false, isAuthenticated = false, onOpenAuth }) => {
  const navigate = useNavigate();

  const onPlanCta = (tier: (typeof PLANS)[number]['tier'], href: string) => {
    if (tier === 'free' && !hasFreeAccess) {
      if (isAuthenticated) navigate('/profile');
      else onOpenAuth?.('/dashboard');
      return;
    }
    if (tier !== 'free' && !hasFreeAccess) {
      if (isAuthenticated) navigate('/profile');
      else onOpenAuth?.('/profile');
      return;
    }
    navigate(href);
  };

  return (
    <section className="mx-auto mb-32 max-w-7xl px-6">
      <div className="mb-16 text-center">
        <h3 className="font-headline text-4xl font-black tracking-tight md:text-5xl">Choose Your Edge</h3>
      </div>
      <div className="grid gap-8 md:grid-cols-3">
        {PLANS.map((plan) => {
          if (plan.accent === 'slate') {
            return (
              <div key={plan.name} className="flex h-full flex-col rounded-3xl border border-outline-variant/20 bg-surface-container-low/50 p-8 transition-all duration-300 hover:bg-surface-container-low hover:shadow-xl hover:shadow-black/20">
                <h4 className="font-headline mb-2 text-xl font-bold">{plan.name}</h4>
                <div className="mb-6 flex items-baseline gap-1">
                  <span className="font-headline text-4xl font-black text-on-surface">{plan.price}</span>
                  <span className="text-sm text-outline">{plan.period}</span>
                </div>
                <p className="mb-8 flex-grow text-sm text-on-surface-variant">Full free tier access to the model, charts, and weekly email.</p>
                <ul className="mb-10 flex-grow space-y-4">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-3 text-sm">
                      <span className="material-symbols-outlined text-lg text-outline">check</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => onPlanCta(plan.tier, plan.href)}
                  className="w-full rounded-xl border border-outline-variant bg-white py-3 font-bold text-gray-800 transition-all hover:bg-surface-container-high hover:text-gray-900"
                >
                  {plan.cta}
                </button>
              </div>
            );
          }
          if (plan.accent === 'primary') {
            return (
              <div key={plan.name} className="relative z-10 flex h-full flex-col rounded-3xl border-2 border-primary bg-surface-container p-8 shadow-[0_0_40px_-10px_rgba(37,99,235,0.3)] transition-all duration-300 hover:shadow-[0_0_50px_-5px_rgba(37,99,235,0.4)] md:scale-105">
                {plan.badge && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-primary to-primary-container px-6 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-on-primary shadow-lg shadow-primary/20">
                    {plan.badge}
                  </div>
                )}
                <h4 className="font-headline mb-2 mt-2 text-xl font-bold text-primary">{plan.name}</h4>
                <div className="mb-6 flex items-baseline gap-1">
                  <span className="font-headline text-4xl font-black text-on-surface">{plan.price}</span>
                  <span className="text-sm text-outline">{plan.period}</span>
                </div>
                <p className="mb-8 flex-grow text-sm text-on-surface-variant">The full signal suite for active accumulators.</p>
                <ul className="mb-10 flex-grow space-y-4">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-3 text-sm">
                      <span className="material-symbols-outlined text-lg text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
                        check
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => onPlanCta(plan.tier, plan.href)}
                  className="w-full rounded-xl bg-primary py-4 font-bold text-on-primary shadow-lg shadow-primary/25 transition-all hover:brightness-110 active:scale-95"
                >
                  Go Pro Now
                </button>
              </div>
            );
          }
          return (
            <div key={plan.name} className="flex h-full flex-col rounded-3xl border-2 border-[#f59e0b] bg-gradient-to-b from-surface-container-low to-surface-container-lowest p-8 shadow-[0_0_30px_-10px_rgba(245,158,11,0.2)] transition-all duration-300 hover:shadow-[0_0_40px_-5px_rgba(245,158,11,0.3)]">
              <h4 className="font-headline mb-2 flex items-center justify-between text-xl font-bold">
                <span className="flex items-center gap-2">
                  <Crown size={18} className="text-[#f59e0b]" />
                  {plan.name}
                </span>
              </h4>
              {plan.badge && (
                <div className="mb-2 ml-auto inline-block rounded bg-[#f59e0b]/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-[#f59e0b]">
                  {plan.badge}
                </div>
              )}
              <div className="mb-6 flex items-baseline gap-1">
                <span className="font-headline text-4xl font-black text-on-surface">{plan.price}</span>
                <span className="text-sm text-outline">{plan.period}</span>
              </div>
              <p className="mb-8 flex-grow text-sm text-on-surface-variant">One payment. Forever access to the signal.</p>
              <ul className="mb-10 flex-grow space-y-4">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-3 text-sm">
                    <span className="material-symbols-outlined text-lg text-[#f59e0b]" style={{ fontVariationSettings: "'FILL' 1" }}>
                      verified
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => onPlanCta(plan.tier, plan.href)}
                className="w-full rounded-xl bg-[#f59e0b] py-4 font-black text-[#0c1322] shadow-lg shadow-[#f59e0b]/20 transition-all hover:brightness-110 active:scale-95"
              >
                {plan.cta}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default Home;