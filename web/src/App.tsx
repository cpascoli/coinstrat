import React, { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  LayoutDashboard,
  BarChart3,
  Binary,
  Info,
  Activity,
  FlaskConical,
  Github,
  User,
  LogOut,
  LogIn,
  Shield,
  BookOpen,
  Database,
  Key,
  Workflow,
  Menu as MenuIcon,
} from 'lucide-react';
import Dashboard from './views/Dashboard';
import ScoreBreakdown from './views/ScoreBreakdown';
import LogicFlow from './views/LogicFlow';
import ChartsView from './views/ChartsView';
import Home from './views/Home';
import Backtest from './views/Backtest';
import Profile from './views/Profile';
import Admin from './views/Admin';
import Developer from './views/Developer';
import DocsArchitecture from './views/DocsArchitecture';
import DocsHome from './views/DocsHome';
import DocsData from './views/DocsData';
import DocsSignals from './views/DocsSignals';
import DocsScores from './views/DocsScores';
import DocsSignalBuilder from './views/DocsSignalBuilder';
import NewsletterConfirm from './views/NewsletterConfirm';
import Terms from './views/Terms';
import Privacy from './views/Privacy';
import Unsubscribe from './views/Unsubscribe';
import AlertUnsubscribe from './views/AlertUnsubscribe';
import StrategyBuilder from './views/StrategyBuilder';
import StrategyAlertUnsubscribe from './views/StrategyAlertUnsubscribe';
import { computeAllSignals } from './services/engine';
import { useAuth } from './contexts/AuthContext';
import AuthModal from './components/AuthModal';
import {
  AppBar,
  Box,
  BottomNavigation,
  BottomNavigationAction,
  Button,
  CircularProgress,
  Container,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Paper,
  Toolbar,
  Typography,
  Alert,
  Avatar,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { SITE_CONTENT_MAX_WIDTH_PX } from './layoutConstants';

// Types for the signal data
export interface SignalData {
  Date: string;
  BTCUSD: number;
  ACCUM_ON: number;
  CORE_ON: number;
  MACRO_ON: number;
  PRICE_REGIME_ON: number;
  VAL_SCORE: number;
  DXY_SCORE: number;
  LIQ_SCORE: number;
  CYCLE_SCORE: number;
  US_LIQ: number;
  US_LIQ_YOY: number;
  US_LIQ_13W_DELTA: number;
  SAHM?: number;
  YC_M?: number;
  NO_YOY?: number;
  MVRV?: number;
  STH_REALIZED_PRICE?: number;
  LTH_REALIZED_PRICE?: number;
  // Euphoria Exhaustion diagnostics
  SIP?: number;                // Supply in Profit (%)
  SIP_EUPHORIA_FLAG?: number;  // 1 if euphoria detected this cycle
  SIP_EXHAUSTED?: number;      // 1 if failed to reclaim 95% within 45d window
  SIP_OBS_DAYS?: number;       // Days into observation window (0 if not active)
  [key: string]: any;
}

type TabKey = 'dashboard' | 'scores' | 'logic' | 'charts' | 'backtest';

const App: React.FC = () => {
  const [data, setData] = useState<SignalData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authRedirectOverride, setAuthRedirectOverride] = useState<string | null>(null);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [mobilePublicNavEl, setMobilePublicNavEl] = useState<null | HTMLElement>(null);

  const {
    user,
    profile,
    isAdmin,
    signOut,
    loading: authLoading,
    isAuthenticated,
    isVerified,
    hasFreeAccess,
  } = useAuth();
  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));
  const location = useLocation();
  const navigate = useNavigate();
  const hasPaidBuilderAccess = profile?.tier === 'pro' || profile?.tier === 'pro_plus' || profile?.tier === 'lifetime';

  const tabs = useMemo(
    () => [
      { key: 'dashboard' as const, path: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
      { key: 'logic' as const, path: '/signals', label: 'Signals', icon: <Binary className="h-5 w-5" /> },
      { key: 'scores' as const, path: '/scores', label: 'Scores', icon: <BarChart3 className="h-5 w-5" /> },
      // Default to the System subpage under Charts
      { key: 'charts' as const, path: '/charts/system', label: 'Charts', icon: <Activity className="h-5 w-5" /> },
      { key: 'backtest' as const, path: '/backtest', label: 'Backtest', icon: <FlaskConical className="h-5 w-5" /> },
    ],
    []
  );

  const activeTab: TabKey | false = useMemo(() => {
    const p = location.pathname;
    const found = tabs.find((t) => p === t.path);
    if (found) return found.key;
    // Treat any /charts/* route as the Charts tab
    if (p.startsWith('/charts')) return 'charts';
    // Home/docs/reference pages shouldn't highlight a bottom-nav item
    if (p === '/' || p.startsWith('/docs') || p === '/api-docs' || p === '/strategy-builder') return false;
    return 'dashboard';
  }, [location.pathname, tabs]);

  const goToTab = (key: TabKey) => {
    const t = tabs.find((x) => x.key === key);
    navigate(t?.path ?? '/dashboard');
  };

  const requiresMemberAccess = useMemo(() => {
    const p = location.pathname;
    return p === '/dashboard'
      || p === '/scores'
      || p === '/signals';
  }, [location.pathname]);

  const isPublicDataRoute = useMemo(() => {
    const p = location.pathname;
    return p === '/backtest' || p.startsWith('/charts');
  }, [location.pathname]);

  const authRedirectTo = requiresMemberAccess
    ? `${location.pathname}${location.search}${location.hash}`
    : '/dashboard';
  const modalRedirectTo = authRedirectOverride ?? authRedirectTo;

  const openAuth = (redirectTo = authRedirectTo) => {
    setAuthRedirectOverride(redirectTo);
    setAuthOpen(true);
  };

  const closeAuth = () => {
    setAuthOpen(false);
    setAuthRedirectOverride(null);
  };

  const shouldLoadData =
    isPublicDataRoute || (requiresMemberAccess && hasFreeAccess) || location.pathname === '/';
  const showAppNavigation = hasFreeAccess && location.pathname !== '/';
  const showDesktopDashboard = hasFreeAccess;

  const desktopPrimaryLinks = useMemo(() => {
    const docsActive = location.pathname.startsWith('/docs')
      || location.pathname === '/developer'
      || location.pathname === '/api-docs';

    return [
      ...(showDesktopDashboard
        ? [{ key: 'dashboard', path: '/dashboard', label: 'Dashboard', active: location.pathname === '/dashboard' }]
        : []),
      ...(isAuthenticated
        ? [
            {
              key: 'signal-builder',
              path: '/strategy-builder',
              label: 'Signal Builder',
              active: location.pathname === '/strategy-builder',
            },
          ]
        : []),
      { key: 'docs', path: '/docs', label: 'Docs', active: docsActive },
      { key: 'charts', path: '/charts/system', label: 'Charts', active: location.pathname.startsWith('/charts') },
      { key: 'backtest', path: '/backtest', label: 'Backtest', active: location.pathname === '/backtest' },
    ];
  }, [isAuthenticated, location.pathname, showDesktopDashboard]);

  useEffect(() => {
    if (!shouldLoadData) {
      setData([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    setLoading(true);
    setError(null);

    computeAllSignals()
      .then(signals => {
        if (cancelled) return;
        if (signals.length === 0) throw new Error('No data retrieved from APIs. Check CORS or API keys.');
        setData(signals);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        console.error(err);
        setError(err.message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shouldLoadData]);

  const lastData = data.length ? data[data.length - 1] : null;

  const DataLoading = (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <CircularProgress size={22} />
        <Typography sx={{ fontWeight: 800 }}>Loading data…</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Fetching BTC + macro series and recomputing signals in-browser.
      </Typography>
    </Paper>
  );

  const DataError = (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
        <Info className="h-6 w-6 text-red-600" />
        <Typography sx={{ fontWeight: 900 }}>Data Error</Typography>
      </Box>
      <Alert severity="error" sx={{ mb: 2 }}>
        {error ?? 'Unknown error'}
      </Alert>
      <Typography variant="body2" color="text.secondary">
        You can still browse the Home page while data loads. Check the browser console / Network tab for details.
      </Typography>
    </Paper>
  );

  const renderDataRoute = (node: React.ReactElement) => {
    if (error) return DataError;
    if (loading || !lastData) return DataLoading;
    return node;
  };

  const gateMemberRoute = (node: React.ReactElement) => {
    if (authLoading) {
      return (
        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <CircularProgress size={22} />
            <Typography sx={{ fontWeight: 800 }}>Checking access…</Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Restoring your session and checking whether Free access is unlocked.
          </Typography>
        </Paper>
      );
    }

    if (!isAuthenticated) {
      return (
        <Paper sx={{ p: 3 }}>
          <Typography sx={{ fontWeight: 900, mb: 1.5 }}>Sign in to unlock CoinStrat Free</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Dashboard, signal analysis and scoring are available to signed-in Free members. Use a magic link for the fastest access.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
            <Button variant="contained" onClick={() => openAuth(authRedirectTo)} sx={{ fontWeight: 700 }}>
              Sign in or create account
            </Button>
            <Button variant="outlined" onClick={() => navigate('/docs')} sx={{ fontWeight: 700 }}>
              Learn more first
            </Button>
          </Box>
        </Paper>
      );
    }

    if (!hasFreeAccess || !isVerified) {
      return (
        <Paper sx={{ p: 3 }}>
          <Typography sx={{ fontWeight: 900, mb: 1.5 }}>Verify your email to unlock CoinStrat Free</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Password signups need email confirmation before dashboard access is enabled. Magic-link and OAuth users are unlocked automatically once the sign-in completes.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
            <Button variant="outlined" onClick={() => navigate('/')} sx={{ fontWeight: 700 }}>
              Back to home
            </Button>
            <Button
              variant="text"
              color="inherit"
              onClick={async () => { await signOut(); navigate('/'); }}
              sx={{ fontWeight: 700 }}
            >
              Sign out
            </Button>
          </Box>
        </Paper>
      );
    }

    return renderDataRoute(node);
  };

  const isHome = location.pathname === '/';
  const isDocsRoute = location.pathname.startsWith('/docs');

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: isHome || isDocsRoute ? '#0c1322' : 'background.default',
        pb: { xs: 8, md: 0 },
      }}
    >
      {!isHome && (
      <AppBar
        position="sticky"
        color="transparent"
        elevation={0}
        sx={{
          bgcolor: 'rgba(12, 19, 34, 0.8)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderBottom: '1px solid',
          borderColor: 'rgba(67, 70, 85, 0.15)',
          boxShadow: '0 25px 50px -12px rgba(7, 14, 29, 0.4)',
        }}
      >
        <Toolbar
          disableGutters
          sx={{
            minHeight: { xs: 64, sm: 72 },
            justifyContent: 'center',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              maxWidth: `${SITE_CONTENT_MAX_WIDTH_PX}px`,
              mx: 'auto',
              px: { xs: 2, sm: 3 },
              py: { xs: 1.5, sm: 2 },
            }}
          >
            <Link
              to="/"
              className="shrink-0 font-headline text-2xl font-black tracking-tighter text-[#b4c5ff] no-underline"
              aria-label="CoinStrat home"
            >
              CoinStrat
            </Link>

            <Box className="flex min-w-0 flex-1 items-center justify-end gap-6 md:gap-8">
              {/* Desktop primary navigation — matches homepage link treatment */}
              {isMdUp && (
                <Box className="flex items-center space-x-8">
                  {desktopPrimaryLinks.map((item) => (
                    <Link
                      key={item.key}
                      to={item.path}
                      className={clsx(
                        'border-b-2 pb-1 font-headline font-bold tracking-tight transition-colors no-underline',
                        item.active
                          ? 'border-[#2563eb] text-[#b4c5ff]'
                          : 'border-transparent text-slate-400 hover:text-white',
                      )}
                    >
                      {item.label}
                    </Link>
                  ))}
                </Box>
              )}

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
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                    transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                    PaperProps={{
                      sx: { minWidth: 200, bgcolor: '#191f2f', border: '1px solid rgba(67, 70, 85, 0.35)' },
                    }}
                  >
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
                        openAuth();
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

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {isMdUp && !user && (
                  <button
                    type="button"
                    onClick={() => openAuth()}
                    className="rounded-xl bg-[#b4c5ff] px-6 py-2.5 font-headline font-medium text-[#002a78] transition-all hover:shadow-[0_0_20px_-5px_rgba(180,197,255,0.4)] active:scale-95"
                  >
                    Get Started
                  </button>
                )}
                {user ? (
                  <>
                    <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small">
                      <Avatar sx={{ width: 32, height: 32, bgcolor: '#2563eb', fontSize: 14, fontWeight: 700 }}>
                        {(profile?.email?.[0] ?? user?.email?.[0] ?? 'U').toUpperCase()}
                      </Avatar>
                    </IconButton>
                    <Menu
                      anchorEl={anchorEl}
                      open={Boolean(anchorEl)}
                      onClose={() => setAnchorEl(null)}
                      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                      PaperProps={{
                        sx: { minWidth: 200, bgcolor: '#191f2f', border: '1px solid rgba(67, 70, 85, 0.35)' },
                      }}
                    >
                      <MenuItem onClick={() => { setAnchorEl(null); navigate('/signals'); }}>
                        <ListItemIcon><Binary size={16} /></ListItemIcon>
                        <ListItemText>Signals</ListItemText>
                      </MenuItem>
                      <MenuItem onClick={() => { setAnchorEl(null); navigate('/scores'); }}>
                        <ListItemIcon><BarChart3 size={16} /></ListItemIcon>
                        <ListItemText>Scores</ListItemText>
                      </MenuItem>
                      <MenuItem onClick={() => { setAnchorEl(null); navigate('/developer'); }}>
                        <ListItemIcon><Key size={16} /></ListItemIcon>
                        <ListItemText>Developer</ListItemText>
                      </MenuItem>
                      {hasPaidBuilderAccess && !isMdUp && (
                        <MenuItem onClick={() => { setAnchorEl(null); navigate('/strategy-builder'); }}>
                          <ListItemIcon><Workflow size={16} /></ListItemIcon>
                          <ListItemText>Signal Builder</ListItemText>
                        </MenuItem>
                      )}
                      <MenuItem onClick={() => { setAnchorEl(null); navigate('/profile'); }}>
                        <ListItemIcon><User size={16} /></ListItemIcon>
                        <ListItemText>Profile</ListItemText>
                      </MenuItem>
                      {isAdmin && (
                        <MenuItem onClick={() => { setAnchorEl(null); navigate('/admin'); }}>
                          <ListItemIcon><Shield size={16} /></ListItemIcon>
                          <ListItemText>Admin</ListItemText>
                        </MenuItem>
                      )}
                      <MenuItem onClick={async () => { setAnchorEl(null); await signOut(); navigate('/'); }}>
                        <ListItemIcon><LogOut size={16} /></ListItemIcon>
                        <ListItemText>Sign out</ListItemText>
                      </MenuItem>
                    </Menu>
                  </>
                ) : null}
              </Box>
            </Box>
          </Box>
        </Toolbar>
      </AppBar>
      )}

      <Container
        maxWidth={false}
        disableGutters
        sx={{
          maxWidth: isHome ? undefined : `${SITE_CONTENT_MAX_WIDTH_PX}px`,
          mx: isHome ? undefined : 'auto',
          px: isHome ? 0 : { xs: 2, sm: 3 },
          py: isHome || isDocsRoute ? 0 : { xs: 2.5, md: 4 },
          width: '100%',
        }}
      >
        <Routes>
          <Route
            path="/"
            element={
              <Home
                hasFreeAccess={hasFreeAccess}
                isAuthenticated={isAuthenticated}
                onOpenAuth={openAuth}
                currentSignal={lastData}
                signalLoading={loading}
                signalError={error}
              />
            }
          />
          <Route path="/docs" element={<DocsHome />} />
          <Route path="/docs/api" element={<Navigate to="/developer" replace />} />
          <Route path="/developer" element={<Developer />} />
          <Route path="/strategy-builder" element={<StrategyBuilder />} />
          <Route path="/docs/data" element={<DocsData />} />
          <Route path="/docs/architecture" element={<DocsArchitecture />} />
          <Route path="/docs/scores" element={<DocsScores />} />
          <Route path="/docs/signals" element={<DocsSignals />} />
          <Route path="/docs/signal-builder" element={<DocsSignalBuilder />} />
          <Route path="/dashboard" element={gateMemberRoute(<Dashboard current={lastData as SignalData} history={data} />)} />
          <Route path="/scores" element={gateMemberRoute(<ScoreBreakdown current={lastData as SignalData} />)} />
          <Route path="/signals" element={gateMemberRoute(<LogicFlow current={lastData as SignalData} />)} />
          <Route path="/charts/*" element={renderDataRoute(<ChartsView data={data} />)} />
          <Route path="/backtest" element={renderDataRoute(<Backtest data={data} />)} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/api-docs" element={<Navigate to="/developer" replace />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/newsletter/confirm" element={<NewsletterConfirm />} />
          <Route path="/unsubscribe" element={<Unsubscribe />} />
          <Route path="/alerts/unsubscribe" element={<AlertUnsubscribe />} />
          <Route path="/alerts/strategies/unsubscribe" element={<StrategyAlertUnsubscribe />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        <AuthModal open={authOpen} onClose={closeAuth} redirectTo={modalRedirectTo} />

        <Box
          component="footer"
          sx={{
            mt: { xs: 4, md: 6 },
            pt: 3,
            my: 3,
            borderTop: '1px solid',
            borderColor: 'divider',
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1.5,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            © {new Date().getFullYear()} Coin Strat. All rights reserved.
          </Typography>
          <Typography
            variant="caption"
            component="a"
            href="/terms"
            onClick={(e: React.MouseEvent) => { e.preventDefault(); navigate('/terms'); }}
            sx={{ color: 'text.secondary', textDecoration: 'none', '&:hover': { color: 'text.primary' }, cursor: 'pointer' }}
          >
            Terms
          </Typography>
          <Typography
            variant="caption"
            component="a"
            href="/privacy"
            onClick={(e: React.MouseEvent) => { e.preventDefault(); navigate('/privacy'); }}
            sx={{ color: 'text.secondary', textDecoration: 'none', '&:hover': { color: 'text.primary' }, cursor: 'pointer' }}
          >
            Privacy
          </Typography>
          <Box
            component="a"
            href="https://github.com/cpascoli/coinstrat"
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              color: 'text.secondary',
              display: 'inline-flex',
              '&:hover': { color: 'text.primary' },
              transition: 'color 0.2s',
            }}
            aria-label="GitHub repository"
          >
            <Github size={16} />
          </Box>
        </Box>
      </Container>

      {/* Mobile bottom navigation */}
      {!isMdUp && showAppNavigation && (
        <Paper sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, borderTop: '1px solid', borderColor: 'divider' }} elevation={0}>
          <BottomNavigation
            showLabels
            value={activeTab}
            onChange={(_, next) => goToTab(next)}
          >
            {tabs.map((t) => (
              <BottomNavigationAction key={t.key} value={t.key} label={t.label} icon={t.icon} />
            ))}
          </BottomNavigation>
        </Paper>
      )}
    </Box>
  );
};

export default App;

