import React, { useEffect, useMemo, useState } from 'react';
import { LayoutDashboard, BarChart3, Binary, BookOpen, Info, Activity } from 'lucide-react';
import Dashboard from './views/Dashboard';
import ScoreBreakdown from './views/ScoreBreakdown';
import LogicFlow from './views/LogicFlow';
import ChartsView from './views/ChartsView';
import Documentation from './views/Documentation';
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
  CYCLE_SCORE_V2: number;
  US_LIQ: number;
  US_LIQ_YOY: number;
  US_LIQ_13W_DELTA: number;
  SAHM?: number;
  YC_M?: number;
  NO_YOY?: number;
  MVRV?: number;
  [key: string]: any;
}

type TabKey = 'dashboard' | 'scores' | 'logic' | 'charts' | 'docs';

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
      { key: 'scores' as const, path: '/scores', label: 'Scores', icon: <BarChart3 className="h-5 w-5" /> },
      { key: 'logic' as const, path: '/logic', label: 'Logic', icon: <Binary className="h-5 w-5" /> },
      { key: 'charts' as const, path: '/charts', label: 'Charts', icon: <Activity className="h-5 w-5" /> },
      { key: 'docs' as const, path: '/docs', label: 'Methodology', icon: <BookOpen className="h-5 w-5" /> },
    ],
    []
  );

  const activeTab: TabKey = useMemo(() => {
    const p = location.pathname;
    const found = tabs.find((t) => p === t.path);
    return found?.key ?? 'dashboard';
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

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
          px: 2,
        }}
      >
        <Paper sx={{ p: 4, textAlign: 'center', width: '100%', maxWidth: 420 }}>
          <CircularProgress />
          <Typography variant="h6" sx={{ mt: 2, fontWeight: 700 }}>
            Loading Coin Strat…
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Fetching BTC + macro series and recomputing signals in-browser.
          </Typography>
        </Paper>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', bgcolor: 'background.default', px: 2 }}>
        <Container maxWidth="sm">
          <Paper sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <Info className="h-6 w-6 text-red-600" />
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Data Error
              </Typography>
            </Box>
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
            <Typography variant="body2" color="text.secondary">
              This usually happens due to missing API keys (FRED on Netlify) or local CORS restrictions. Check the browser
              console and Network tab for details.
            </Typography>
          </Paper>
        </Container>
      </Box>
    );
  }

  const lastData = data[data.length - 1];

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: { xs: 8, md: 0 } }}>
      <AppBar position="sticky" color="transparent">
        <Toolbar sx={{ minHeight: 64 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexGrow: 1 }}>
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
              Coin Strat <Box component="span" sx={{ color: 'primary.main' }}>2026</Box>
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
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard current={lastData} history={data} />} />
          <Route path="/scores" element={<ScoreBreakdown current={lastData} />} />
          <Route path="/logic" element={<LogicFlow current={lastData} />} />
          <Route path="/charts" element={<ChartsView data={data} />} />
          <Route path="/docs" element={<Documentation />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
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

