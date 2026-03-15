import React, { useEffect, useMemo, useState } from 'react';
import { LayoutDashboard, BarChart3, Binary, Info, Activity, FlaskConical, Github, User, LogOut, Shield, BookOpen, Database, Key, Workflow } from 'lucide-react';
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
  Paper,
  Toolbar,
  Typography,
  Alert,
  Avatar,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

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
  const [docsAnchorEl, setDocsAnchorEl] = useState<null | HTMLElement>(null);

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

  const requiresAppAccess = useMemo(() => {
    const p = location.pathname;
    return p === '/dashboard'
      || p === '/scores'
      || p === '/signals'
      || p === '/backtest'
      || p.startsWith('/charts');
  }, [location.pathname]);

  const authRedirectTo = requiresAppAccess
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

  const shouldLoadData = requiresAppAccess && hasFreeAccess;
  const showAppNavigation = hasFreeAccess;

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

  const gate = (node: React.ReactElement) => {
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
            Dashboard, signals, charts, and backtests are available to signed-in Free members. Use a magic link for the fastest access.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
            <Button variant="contained" onClick={() => openAuth(authRedirectTo)} sx={{ fontWeight: 700 }}>
              Sign in or create account
            </Button>
            <Button variant="outlined" onClick={() => navigate('/docs')} sx={{ fontWeight: 700 }}>
              Read docs first
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

    if (error) return DataError;
    if (loading || !lastData) return DataLoading;
    return node;
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: { xs: 8, md: 0 } }}>
      <AppBar
        position="sticky"
        color="transparent"
        sx={{
          bgcolor: 'rgba(10, 15, 28, 0.78)', // dark glass
          backdropFilter: 'blur(10px)',
          borderBottom: '1px solid',
          borderColor: 'rgba(148,163,184,0.18)',
        }}
      >
        <Toolbar sx={{ minHeight: 64 }}>
          <Box
            component="button"
            onClick={() => navigate('/')}
            aria-label="Go to homepage"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              flexGrow: 1,
              cursor: 'pointer',
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              p: 0,
              textAlign: 'left',
            }}
          >
            <Box
              sx={{
                height: 34,
                width: 34,
                borderRadius: 1.5,
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 900,
              }}
            >
              CS
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 900, letterSpacing: -0.4 }}>
              Coin <Box component="span" sx={{ color: 'primary.main' }}>Strat</Box>
            </Typography>
          </Box>

          {/* Desktop tab buttons */}
          {isMdUp && showAppNavigation && (
            <Box sx={{ display: 'flex', gap: 1 }}>
              {tabs.map((t) => (
                <Paper
                  key={t.key}
                  component="button"
                  onClick={() => goToTab(t.key)}
                  sx={{
                    cursor: 'pointer',
                    px: 1.5,
                    py: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    bgcolor: activeTab === t.key ? 'primary.main' : 'background.paper',
                    color: activeTab === t.key ? 'primary.contrastText' : 'text.primary',
                    borderColor: activeTab === t.key ? 'primary.main' : 'divider',
                    '&:hover': { borderColor: 'primary.main' },
                  }}
                >
                  {t.icon}
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {t.label}
                  </Typography>
                </Paper>
              ))}
              {!user && (
                <Paper
                  component="button"
                  onClick={() => navigate('/docs')}
                  sx={{
                    cursor: 'pointer',
                    px: 1.5,
                    py: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    bgcolor: location.pathname.startsWith('/docs') ? 'primary.main' : 'background.paper',
                    color: location.pathname.startsWith('/docs') ? 'primary.contrastText' : 'text.primary',
                    borderColor: location.pathname.startsWith('/docs') ? 'primary.main' : 'divider',
                    '&:hover': { borderColor: 'primary.main' },
                  }}
                >
                  <BookOpen className="h-5 w-5" />
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    Docs
                  </Typography>
                </Paper>
              )}
            </Box>
          )}

          {!isMdUp && !user && (
            <>
              <IconButton onClick={(e) => setDocsAnchorEl(e.currentTarget)} size="small" sx={{ mr: 0.5 }}>
                <BookOpen size={18} />
              </IconButton>
              <Menu
                anchorEl={docsAnchorEl}
                open={Boolean(docsAnchorEl)}
                onClose={() => setDocsAnchorEl(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                PaperProps={{ sx: { minWidth: 200 } }}
              >
                <MenuItem onClick={() => { setDocsAnchorEl(null); navigate('/docs'); }}>
                  <ListItemIcon><BookOpen size={16} /></ListItemIcon>
                  <ListItemText>Docs Home</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setDocsAnchorEl(null); navigate('/developer'); }}>
                  <ListItemIcon><Key size={16} /></ListItemIcon>
                  <ListItemText>Developer</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setDocsAnchorEl(null); navigate('/docs/data'); }}>
                  <ListItemIcon><Database size={16} /></ListItemIcon>
                  <ListItemText>Data Feeds</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setDocsAnchorEl(null); navigate('/docs/architecture'); }}>
                  <ListItemIcon><Activity size={16} /></ListItemIcon>
                  <ListItemText>Architecture</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setDocsAnchorEl(null); navigate('/docs/scores'); }}>
                  <ListItemIcon><BarChart3 size={16} /></ListItemIcon>
                  <ListItemText>Scores</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => { setDocsAnchorEl(null); navigate('/docs/signals'); }}>
                  <ListItemIcon><Binary size={16} /></ListItemIcon>
                  <ListItemText>Signals</ListItemText>
                </MenuItem>
              </Menu>
            </>
          )}

          {/* Auth / User menu */}
          <Box sx={{ ml: { xs: 0, md: 1.5 } }}>
            {user ? (
              <>
                <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small">
                  <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14, fontWeight: 700 }}>
                    {(profile?.email?.[0] ?? user?.email?.[0] ?? 'U').toUpperCase()}
                  </Avatar>
                </IconButton>
                <Menu
                  anchorEl={anchorEl}
                  open={Boolean(anchorEl)}
                  onClose={() => setAnchorEl(null)}
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                  transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                  PaperProps={{ sx: { minWidth: 180 } }}
                >
                  <MenuItem onClick={() => { setAnchorEl(null); navigate('/docs'); }}>
                    <ListItemIcon><BookOpen size={16} /></ListItemIcon>
                    <ListItemText>Docs</ListItemText>
                  </MenuItem>
                  <MenuItem onClick={() => { setAnchorEl(null); navigate('/developer'); }}>
                    <ListItemIcon><Key size={16} /></ListItemIcon>
                    <ListItemText>Developer</ListItemText>
                  </MenuItem>
                {hasPaidBuilderAccess && (
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
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: { xs: 2.5, md: 4 } }}>
        <Routes>
          <Route
            path="/"
            element={<Home hasFreeAccess={hasFreeAccess} isAuthenticated={isAuthenticated} onOpenAuth={openAuth} />}
          />
          <Route path="/docs" element={<DocsHome />} />
          <Route path="/docs/api" element={<Navigate to="/developer" replace />} />
          <Route path="/developer" element={<Developer />} />
          <Route path="/strategy-builder" element={<StrategyBuilder />} />
          <Route path="/docs/data" element={<DocsData />} />
          <Route path="/docs/architecture" element={<DocsArchitecture />} />
          <Route path="/docs/scores" element={<DocsScores />} />
          <Route path="/docs/signals" element={<DocsSignals />} />
          <Route path="/dashboard" element={gate(<Dashboard current={lastData as SignalData} history={data} />)} />
          <Route path="/scores" element={gate(<ScoreBreakdown current={lastData as SignalData} />)} />
          <Route path="/signals" element={gate(<LogicFlow current={lastData as SignalData} />)} />
          <Route path="/charts/*" element={gate(<ChartsView data={data} />)} />
          <Route path="/backtest" element={gate(<Backtest data={data} />)} />
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
            pt: 2,
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

