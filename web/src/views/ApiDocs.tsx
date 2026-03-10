import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Chip,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { Lock, Key } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import DocsPager from '../components/DocsPager';
import DocsSectionNav from '../components/DocsSectionNav';
import { endpointGroups } from './api/endpoints';
import EndpointCard from './api/EndpointCard';

const KEY_STORAGE = 'coinstrat_api_key';

const ApiDocs: React.FC = () => {
  const { profile, tier } = useAuth();
  const hasApiAccess = tier === 'pro' || tier === 'pro_plus';

  const [tabIdx, setTabIdx] = useState(0);
  const [apiKey, setApiKey] = useState(() => {
    try {
      return localStorage.getItem(KEY_STORAGE) ?? '';
    } catch {
      return '';
    }
  });

  // Auto-fill API key from profile if available
  useEffect(() => {
    if (profile?.api_key && !apiKey) {
      setApiKey(profile.api_key);
    }
  }, [profile?.api_key]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Persist key
  useEffect(() => {
    try {
      if (apiKey) localStorage.setItem(KEY_STORAGE, apiKey);
      else localStorage.removeItem(KEY_STORAGE);
    } catch { /* ignore */ }
  }, [apiKey]);

  const group = useMemo(() => endpointGroups[tabIdx], [tabIdx]);

  return (
    <Box sx={{ maxWidth: 880, mx: 'auto' }}>
      <Stack spacing={3}>
        <DocsSectionNav />

        {/* Hero */}
        <Paper sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack spacing={2.5}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Key size={28} style={{ color: '#60a5fa' }} />
              <Typography
                variant="h3"
                component="h1"
                sx={{ fontWeight: 900, fontSize: { xs: 28, sm: 36, md: 44 } }}
              >
                API Reference
              </Typography>
            </Stack>

            <Typography sx={{ color: 'text.secondary', maxWidth: 640 }}>
              Programmatic access to CoinStrat signals. Fetch the latest signal snapshot,
              query full history, and integrate BTC accumulation intelligence into your
              applications, bots, and agents.
            </Typography>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip
                label="Base URL: https://coinstrat.xyz"
                size="small"
                variant="outlined"
                sx={{ fontFamily: 'monospace', fontSize: 12 }}
              />
              <Chip label="JSON responses" size="small" variant="outlined" />
              <Chip
                label="X-API-Key auth"
                size="small"
                variant="outlined"
                icon={<Lock size={12} />}
              />
            </Stack>

            {/* Response fields overview */}
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.75 }}>
                Signal fields
              </Typography>
              <Stack direction="row" spacing={0} alignItems="center" flexWrap="wrap" useFlexGap sx={{ gap: 0.5 }}>
                {[
                  { label: 'CORE_ON', hint: 'Accumulate' },
                  { label: 'MACRO_ON', hint: 'Accelerate' },
                  { label: 'VAL_SCORE', hint: '0–3' },
                  { label: 'LIQ_SCORE', hint: '0–2' },
                  { label: 'DXY_SCORE', hint: '0–2' },
                  { label: 'CYCLE_SCORE', hint: '0–2' },
                ].map((s, i, arr) => (
                  <Stack key={s.label} direction="row" spacing={0.5} alignItems="center">
                    <Chip
                      label={`${s.label} (${s.hint})`}
                      size="small"
                      sx={{ fontFamily: 'monospace', fontSize: 11, bgcolor: 'rgba(255,255,255,0.06)' }}
                    />
                    {i < arr.length - 1 && (
                      <Typography variant="caption" sx={{ color: 'text.secondary', mx: 0.25 }}>·</Typography>
                    )}
                  </Stack>
                ))}
              </Stack>
            </Box>
          </Stack>
        </Paper>

        {/* API Key input */}
        <Paper sx={{ p: { xs: 2, sm: 2.5 }, bgcolor: 'rgba(0,0,0,0.25)' }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            alignItems={{ xs: 'stretch', sm: 'center' }}
          >
            <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap', minWidth: 90 }}>
              API Key
            </Typography>
            <TextField
              size="small"
              fullWidth
              placeholder={hasApiAccess ? 'Your API key (auto-filled from profile)' : 'Upgrade to Pro to get an API key'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type="password"
              sx={{ '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: 13 } }}
            />
            <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
              Saved in browser
            </Typography>
          </Stack>
        </Paper>

        {/* Endpoint group tabs */}
        <Box>
          <Tabs
            value={tabIdx}
            onChange={(_, v: number) => setTabIdx(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ '& .MuiTab-root': { fontWeight: 800, textTransform: 'none' }, mb: 2 }}
          >
            {endpointGroups.map((g) => (
              <Tab
                key={g.role}
                label={
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: g.color }} />
                    <span>{g.label}</span>
                    <Chip
                      label={g.endpoints.length}
                      size="small"
                      sx={{ height: 18, fontSize: 11, fontWeight: 700 }}
                    />
                  </Stack>
                }
              />
            ))}
          </Tabs>

          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {group.description}
          </Typography>

          <Stack spacing={1}>
            {group.endpoints.map((ep) => (
              <EndpointCard key={ep.id} ep={ep} apiKey={apiKey} />
            ))}
          </Stack>
        </Box>

        {/* Rate limits */}
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>Rate Limits</Typography>
          <Stack spacing={1}>
            {[
              { tier: 'Free (no key)', limit: '100 calls/day', scope: '/signals/current only', color: '#94a3b8' },
              { tier: 'Pro', limit: '1,000 calls/day', scope: 'All endpoints', color: '#60a5fa' },
              { tier: 'Lifetime', limit: '1,000 calls/day', scope: 'All endpoints (permanent)', color: '#f59e0b' },
            ].map((r) => (
              <Stack key={r.tier} direction="row" spacing={2} alignItems="center">
                <Chip
                  label={r.tier}
                  size="small"
                  sx={{ minWidth: 100, fontWeight: 700, bgcolor: `${r.color}22`, color: r.color, border: `1px solid ${r.color}44` }}
                />
                <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 120 }}>{r.limit}</Typography>
                <Typography variant="body2" color="text.secondary">{r.scope}</Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>

        {/* Auth footer */}
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Authentication: include{' '}
          <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>
            X-API-Key: &lt;your_key&gt;
          </code>{' '}
          for Pro endpoints. Find your key on the{' '}
          <a href="/profile" style={{ color: '#60a5fa' }}>Profile page</a>.
          Internal endpoints use{' '}
          <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>
            Authorization: Bearer &lt;CRON_SECRET&gt;
          </code>.
        </Typography>

        <DocsPager />
      </Stack>
    </Box>
  );
};

export default ApiDocs;
