import React, { useMemo } from 'react';
import { Link as RouterLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Tab,
  Tabs,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { BarChart3, Binary, LayoutDashboard } from 'lucide-react';
import { SignalData } from '../App';
import Dashboard from './Dashboard';
import LogicFlow from './LogicFlow';
import ScoreBreakdown from './ScoreBreakdown';

const SECTIONS = [
  { segment: '' as const, label: 'Overview', path: '/dashboard', Icon: LayoutDashboard },
  { segment: 'signals' as const, label: 'Signals', path: '/dashboard/signals', Icon: Binary },
  { segment: 'scores' as const, label: 'Scores', path: '/dashboard/scores', Icon: BarChart3 },
] as const;

export interface MemberDashboardProps {
  current: SignalData;
  history: SignalData[];
}

const MemberDashboard: React.FC<MemberDashboardProps> = ({ current, history }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));

  const sectionIndex = useMemo(() => {
    const p = location.pathname.replace(/\/$/, '') || '/dashboard';
    if (p === '/dashboard/signals') return 1;
    if (p === '/dashboard/scores') return 2;
    return 0;
  }, [location.pathname]);

  const handleTabChange = (_: React.SyntheticEvent, idx: number) => {
    navigate(SECTIONS[idx].path);
  };

  return (
    <Box>
      {!isMdUp && (
        <Tabs
          value={sectionIndex}
          onChange={handleTabChange}
          variant="fullWidth"
          sx={{
            mb: 2,
            borderBottom: 1,
            borderColor: 'divider',
            '& .MuiTab-root': { fontWeight: 700, textTransform: 'none', minHeight: 48 },
          }}
        >
          {SECTIONS.map(({ label }) => (
            <Tab key={label} label={label} />
          ))}
        </Tabs>
      )}

      <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
        {isMdUp && (
          <Paper
            variant="outlined"
            sx={{
              width: 220,
              flexShrink: 0,
              p: 0.5,
              borderRadius: 2,
              borderColor: 'rgba(148,163,184,0.24)',
              bgcolor: 'background.paper',
            }}
          >
            <List component="nav" dense disablePadding>
              {SECTIONS.map((s, idx) => {
                const selected = sectionIndex === idx;
                return (
                  <ListItemButton
                    key={s.label}
                    component={RouterLink}
                    to={s.path}
                    selected={selected}
                    sx={{
                      borderRadius: 1,
                      '&.Mui-selected': { bgcolor: 'action.selected' },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>
                      <s.Icon size={20} strokeWidth={2} />
                    </ListItemIcon>
                    <ListItemText
                      primary={s.label}
                      primaryTypographyProps={{ fontWeight: 700 }}
                    />
                  </ListItemButton>
                );
              })}
            </List>
          </Paper>
        )}

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Routes>
            <Route index element={<Dashboard current={current} history={history} />} />
            <Route path="signals" element={<LogicFlow current={current} />} />
            <Route path="scores" element={<ScoreBreakdown current={current} />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Box>
      </Box>
    </Box>
  );
};

export default MemberDashboard;
