import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Copy, Eye, EyeOff, Key, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { endpointGroups } from './api/endpoints';
import EndpointCard from './api/EndpointCard';

const KEY_STORAGE = 'coinstrat_api_key';

const Developer: React.FC = () => {
  const { session, profile, tier, isAdmin, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const hasApiAccess = tier === 'pro' || tier === 'pro_plus' || tier === 'lifetime';
  const [tabIdx, setTabIdx] = useState(0);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [apiKey, setApiKey] = useState(() => {
    try {
      return localStorage.getItem(KEY_STORAGE) ?? '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    if (profile?.api_key && !apiKey) {
      setApiKey(profile.api_key);
    }
  }, [profile?.api_key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      if (apiKey) localStorage.setItem(KEY_STORAGE, apiKey);
      else localStorage.removeItem(KEY_STORAGE);
    } catch {
      // ignore localStorage failures
    }
  }, [apiKey]);

  const visibleEndpointGroups = useMemo(
    () => endpointGroups.filter((group) => group.role !== 'internal' || isAdmin),
    [isAdmin],
  );

  useEffect(() => {
    if (tabIdx >= visibleEndpointGroups.length) {
      setTabIdx(0);
    }
  }, [tabIdx, visibleEndpointGroups.length]);

  const group = useMemo(
    () => visibleEndpointGroups[tabIdx] ?? visibleEndpointGroups[0],
    [tabIdx, visibleEndpointGroups],
  );

  const copyKey = async () => {
    if (!apiKey) return;
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <Box sx={{ maxWidth: 1180, mx: 'auto' }}>
      <Stack spacing={3}>
        <Paper sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack spacing={2.5}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Key size={28} style={{ color: '#60a5fa' }} />
              <Typography
                variant="h3"
                component="h1"
                sx={{ fontWeight: 900, fontSize: { xs: 28, sm: 36, md: 44 } }}
              >
                API Docs
              </Typography>
            </Stack>

            <Typography sx={{ color: 'text.secondary', maxWidth: 760 }}>
              Explore CoinStrat API endpoints, test requests directly in the browser, and manage your API key.
            </Typography>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip
                label="Base URL: https://coinstrat.xyz"
                size="small"
                variant="outlined"
                sx={{ fontFamily: 'monospace', fontSize: 12 }}
              />
              <Chip label="Public + paid endpoints" size="small" variant="outlined" />
              <Chip
                label="Auto auth in browser"
                size="small"
                variant="outlined"
                icon={<Sparkles size={12} />}
              />
              <Chip label="JSON responses" size="small" variant="outlined" />
            </Stack>
          </Stack>
        </Paper>

        <Paper sx={{ p: { xs: 2.5, sm: 3 } }}>
          <Stack spacing={2}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              alignItems={{ xs: 'flex-start', sm: 'center' }}
              justifyContent="space-between"
            >
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  API Key Management
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Paid requests made from this page automatically use your saved API key.
                </Typography>
              </Box>
              {!isAuthenticated && (
                <Button variant="outlined" onClick={() => navigate('/')} sx={{ textTransform: 'none', fontWeight: 700 }}>
                  Go home to sign in
                </Button>
              )}
            </Stack>

            {hasApiAccess ? (
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TextField
                    size="small"
                    fullWidth
                    value={showKey ? apiKey : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
                    InputProps={{ readOnly: true, sx: { fontFamily: 'monospace', fontSize: 13 } }}
                  />
                  <Tooltip title={showKey ? 'Hide' : 'Reveal'}>
                    <IconButton onClick={() => setShowKey((value) => !value)} size="small">
                      {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={copied ? 'Copied!' : 'Copy'}>
                    <IconButton onClick={() => void copyKey()} size="small">
                      <Copy size={16} />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  This page auto-adds <code>X-API-Key</code> for paid endpoints and your signed-in bearer token for Pro/Admin endpoints.
                </Typography>
              </>
            ) : (
              <Alert severity="info">
                {isAuthenticated
                  ? 'Upgrade to Pro or Lifetime to unlock paid API access and browser testing for paid endpoints.'
                  : 'Sign in and upgrade to Pro or Lifetime to unlock paid API access.'}
              </Alert>
            )}
          </Stack>
        </Paper>

        <Box>
          <Tabs
            value={tabIdx}
            onChange={(_, value: number) => setTabIdx(value)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ '& .MuiTab-root': { fontWeight: 800, textTransform: 'none' }, mb: 2 }}
          >
            {visibleEndpointGroups.map((entry) => (
              <Tab
                key={entry.role}
                label={(
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color }} />
                    <span>{entry.label}</span>
                    <Chip
                      label={entry.endpoints.length}
                      size="small"
                      sx={{ height: 18, fontSize: 11, fontWeight: 700 }}
                    />
                  </Stack>
                )}
              />
            ))}
          </Tabs>

          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {group.description}
          </Typography>

          <Stack spacing={1}>
            {group?.endpoints.map((ep) => (
              <EndpointCard
                key={ep.id}
                ep={ep}
                apiKey={apiKey}
                sessionToken={ep.auth === 'admin_jwt' ? session?.access_token ?? null : null}
              />
            ))}
          </Stack>
        </Box>

        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
            Rate Limits
          </Typography>
          <Stack spacing={1}>
            {[
              { tierLabel: 'Free (public)', limit: '100 calls/day', scope: '/api/v1/signals/current', color: '#94a3b8' },
              { tierLabel: 'Pro', limit: '1,000 calls/day', scope: 'Paid endpoints', color: '#60a5fa' },
              { tierLabel: 'Lifetime', limit: '1,000 calls/day', scope: 'Paid endpoints (permanent)', color: '#f59e0b' },
              { tierLabel: 'Pro+', limit: '10,000 calls/day', scope: 'Paid endpoints', color: '#a78bfa' },
            ].map((row) => (
              <Stack key={row.tierLabel} direction="row" spacing={2} alignItems="center">
                <Chip
                  label={row.tierLabel}
                  size="small"
                  sx={{ minWidth: 110, fontWeight: 700, bgcolor: `${row.color}22`, color: row.color, border: `1px solid ${row.color}44` }}
                />
                <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 120 }}>
                  {row.limit}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {row.scope}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>

        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Browser testing from this page only auto-adds credentials that are safe to use client-side:
          public requests, your own API key, and your signed-in session when supported by the backend.
          Server-only secrets like <code>CRON_SECRET</code> are never exposed here.
        </Typography>
      </Stack>
    </Box>
  );
};

export default Developer;
