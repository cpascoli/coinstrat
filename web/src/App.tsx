import React, { useEffect, useMemo, useState } from 'react';
import { LayoutDashboard, BarChart3, Binary, Info, Activity } from 'lucide-react';
import Dashboard from './views/Dashboard';
import ScoreBreakdown from './views/ScoreBreakdown';
import LogicFlow from './views/LogicFlow';
import ChartsView from './views/ChartsView';
import Home from './views/Home';
import { computeAllSignals } from './services/engine';
import {
  AppBar,
  Box,
  BottomNavigation,
  BottomNavigationAction,
  CircularProgress,
  Container,
  Paper,
  Toolbar,
  Typography,
  Alert,
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
  [key: string]: any;
}

type TabKey = 'dashboard' | 'scores' | 'logic' | 'charts';

const App: React.FC = () => {
  const [data, setData] = useState<SignalData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));
  const location = useLocation();
  const navigate = useNavigate();

  const tabs = useMemo(
    () => [
      { key: 'dashboard' as const, path: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
      { key: 'logic' as const, path: '/signals', label: 'Signals', icon: <Binary className="h-5 w-5" /> },
      { key: 'scores' as const, path: '/scores', label: 'Scores', icon: <BarChart3 className="h-5 w-5" /> },
      // Default to the System subpage under Charts
      { key: 'charts' as const, path: '/charts/system', label: 'Charts', icon: <Activity className="h-5 w-5" /> },
    ],
    []
  );

  const activeTab: TabKey | false = useMemo(() => {
    const p = location.pathname;
    const found = tabs.find((t) => p === t.path);
    if (found) return found.key;
    // Treat any /charts/* route as the Charts tab
    if (p.startsWith('/charts')) return 'charts';
    // Home/About landing page shouldn't highlight a nav item
    if (p === '/') return false;
    return 'dashboard';
  }, [location.pathname, tabs]);

  const goToTab = (key: TabKey) => {
    const t = tabs.find((x) => x.key === key);
    navigate(t?.path ?? '/dashboard');
  };

  useEffect(() => {
    // Replicating Python logic in real-time within the browser
    computeAllSignals()
      .then(signals => {
        if (signals.length === 0) throw new Error('No data retrieved from APIs. Check CORS or API keys.');
        setData(signals);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError(err.message);
        setLoading(false);
      });
  }, []);

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
          {isMdUp && (
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
            </Box>
          )}
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: { xs: 2.5, md: 4 } }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/dashboard" element={gate(<Dashboard current={lastData as SignalData} history={data} />)} />
          <Route path="/scores" element={gate(<ScoreBreakdown current={lastData as SignalData} />)} />
          <Route path="/signals" element={gate(<LogicFlow current={lastData as SignalData} />)} />
          <Route path="/charts/*" element={gate(<ChartsView data={data} />)} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>

        <Box
          component="footer"
          sx={{
            mt: { xs: 4, md: 6 },
            pt: 2,
            borderTop: '1px solid',
            borderColor: 'divider',
            textAlign: 'center',
          }}
        >
          <Typography variant="caption" color="text.secondary">
            © {new Date().getFullYear()} Coin Strat. All rights reserved.
          </Typography>
        </Box>
      </Container>

      {/* Mobile bottom navigation */}
      {!isMdUp && (
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

