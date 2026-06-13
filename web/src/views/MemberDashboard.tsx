import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import { LayoutDashboard } from 'lucide-react';
import { SignalData } from '../App';
import { MODELS, type ModelState } from '../models/registry';

export interface MemberDashboardProps {
  current: SignalData;
  history: SignalData[];
}

function toneColor(tone: ModelState['tone']): { border: string; text: string } {
  switch (tone) {
    case 'pos':
      return { border: '#22c55e', text: '#bbf7d0' };
    case 'neg':
      return { border: '#ef4444', text: '#fecaca' };
    case 'neutral':
      return { border: '#94a3b8', text: '#e2e8f0' };
    default: {
      const exhaustive: never = tone;
      return exhaustive;
    }
  }
}

/**
 * Cross-model "today's state" roll-up: one card per model summarizing its current
 * reading, with deep links into each model's deep dive.
 */
const MemberDashboard: React.FC<MemberDashboardProps> = ({ history }) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
      <LayoutDashboard className="h-8 w-8 text-blue-600" />
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: -0.5 }}>Dashboard</Typography>
        <Typography variant="body2" color="text.secondary">
          Where every CoinStrat model stands today.
        </Typography>
      </Box>
    </Box>

    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', lg: '1fr 1fr 1fr' } }}>
      {MODELS.map((model) => {
        const state = model.currentState(history);
        const c = state ? toneColor(state.tone) : null;
        const Icon = model.Icon;
        return (
          <Paper key={model.id} sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.25, height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
              <Icon size={20} className="text-blue-400" />
              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{model.name}</Typography>
            </Box>
            <Box>
              {state && c
                ? <Chip size="small" label={state.headline} variant="outlined" sx={{ borderColor: c.border, color: c.text, fontWeight: 700 }} />
                : <Chip size="small" label="—" variant="outlined" />}
            </Box>
            {state && (
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                {state.metrics.map((m) => (
                  <Chip key={m.label} size="small" label={`${m.label}: ${m.value}`} sx={{ bgcolor: 'rgba(148,163,184,0.16)', color: '#cbd5e1' }} />
                ))}
              </Stack>
            )}
            <Box sx={{ flex: 1 }} />
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Button component={RouterLink} to={`/models/${model.id}`} variant="contained" size="small" sx={{ fontWeight: 700 }}>Open</Button>
              <Button component={RouterLink} to={`/models/${model.id}/charts`} variant="outlined" size="small" sx={{ fontWeight: 700 }}>Charts</Button>
            </Stack>
          </Paper>
        );
      })}
    </Box>
  </Box>
);

export default MemberDashboard;
