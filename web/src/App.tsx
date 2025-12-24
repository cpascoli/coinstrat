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
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');

  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));

  const tabs = useMemo(
    () => [
      { key: 'dashboard' as const, label: 'Dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
      { key: 'scores' as const, label: 'Scores', icon: <BarChart3 className="h-5 w-5" /> },
      { key: 'logic' as const, label: 'Logic', icon: <Binary className="h-5 w-5" /> },
      { key: 'charts' as const, label: 'Charts', icon: <Activity className="h-5 w-5" /> },
      { key: 'docs' as const, label: 'Methodology', icon: <BookOpen className="h-5 w-5" /> },
    ],
    []
  );

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
            Loading Power Wallet Intelligence…
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
              PW
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 900, letterSpacing: -0.4 }}>
              Power Wallet <Box component="span" sx={{ color: 'primary.main' }}>2026</Box>
            </Typography>
          </Box>

          {/* Desktop tab buttons */}
          {isMdUp && (
            <Box sx={{ display: 'flex', gap: 1 }}>
              {tabs.map((t) => (
                <Paper
                  key={t.key}
                  component="button"
                  onClick={() => setActiveTab(t.key)}
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
        {activeTab === 'dashboard' && <Dashboard current={lastData} history={data} />}
        {activeTab === 'scores' && <ScoreBreakdown current={lastData} />}
        {activeTab === 'logic' && <LogicFlow current={lastData} />}
        {activeTab === 'charts' && <ChartsView data={data} />}
        {activeTab === 'docs' && <Documentation />}
      </Container>

      {/* Mobile bottom navigation */}
      {!isMdUp && (
        <Paper sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, borderTop: '1px solid', borderColor: 'divider' }} elevation={0}>
          <BottomNavigation
            showLabels
            value={activeTab}
            onChange={(_, next) => setActiveTab(next)}
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

