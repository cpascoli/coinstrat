import React, { useState } from 'react';
import {
  Box,
  CircularProgress,
  Paper,
  Typography,
  Chip,
  Button,
  TextField,
  IconButton,
  Tooltip,
  Alert,
  Divider,
  Stack,
} from '@mui/material';
import { Copy, Eye, EyeOff, ExternalLink, LogOut, Crown, Zap } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const TIER_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  free:     { label: 'Free',     color: '#94a3b8', icon: null },
  pro:      { label: 'Pro',      color: '#60a5fa', icon: <Zap size={14} /> },
  pro_plus: { label: 'Pro+',     color: '#a78bfa', icon: <Crown size={14} /> },
};

const Profile: React.FC = () => {
  const { user, profile, tier, loading, signOut } = useAuth();
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);

  if (loading) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <CircularProgress size={24} />
      </Paper>
    );
  }

  if (!user || !profile) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Not signed in</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          Sign in to view your profile and subscription.
        </Typography>
      </Paper>
    );
  }

  const tierInfo = TIER_LABELS[tier] ?? TIER_LABELS.free;

  const handleCopy = async () => {
    if (profile.api_key) {
      await navigator.clipboard.writeText(profile.api_key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleUpgrade = async () => {
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tier: tier === 'free' ? 'pro' : 'pro_plus',
        userId: user.id,
        email: user.email,
      }),
    });
    const { url } = await res.json();
    if (url) window.location.href = url;
  };

  const handleManage = async () => {
    const res = await fetch('/api/stripe/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: profile.stripe_customer_id }),
    });
    const { url } = await res.json();
    if (url) window.location.href = url;
  };

  return (
    <Box sx={{ maxWidth: 640, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 900, mb: 3 }}>Account</Typography>

      {/* Profile info */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="body2" color="text.secondary">Email</Typography>
            <Typography sx={{ fontWeight: 600 }}>{profile.email}</Typography>
          </Box>
          <Chip
            label={tierInfo.label}
            icon={tierInfo.icon as React.ReactElement}
            sx={{
              bgcolor: `${tierInfo.color}22`,
              color: tierInfo.color,
              fontWeight: 700,
              borderColor: tierInfo.color,
            }}
            variant="outlined"
          />
        </Stack>

        <Typography variant="body2" color="text.secondary">Member since</Typography>
        <Typography sx={{ fontWeight: 600 }}>
          {new Date(profile.created_at).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
          })}
        </Typography>
      </Paper>

      {/* Subscription */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>Subscription</Typography>

        {tier === 'free' && (
          <>
            <Alert severity="info" sx={{ mb: 2 }}>
              Upgrade to Pro to access the Signal API, real-time alerts, full backtest history, and the OpenClaw skill.
            </Alert>
            <Button
              variant="contained"
              onClick={handleUpgrade}
              startIcon={<Zap size={16} />}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              Upgrade to Pro — $9.99/mo
            </Button>
          </>
        )}

        {tier === 'pro' && (
          <>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              You're on the <strong>Pro</strong> plan. 1,000 API calls/day, real-time alerts, full backtest.
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                onClick={handleUpgrade}
                startIcon={<Crown size={16} />}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                Upgrade to Pro+
              </Button>
              <Button
                variant="outlined"
                onClick={handleManage}
                startIcon={<ExternalLink size={16} />}
                sx={{ textTransform: 'none', fontWeight: 600 }}
              >
                Manage subscription
              </Button>
            </Stack>
          </>
        )}

        {tier === 'pro_plus' && (
          <>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              You're on the <strong>Pro+</strong> plan. 10,000 API calls/day, webhooks, custom strategies.
            </Typography>
            <Button
              variant="outlined"
              onClick={handleManage}
              startIcon={<ExternalLink size={16} />}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Manage subscription
            </Button>
          </>
        )}
      </Paper>

      {/* API Key */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>API Key</Typography>

        {tier === 'free' ? (
          <Typography color="text.secondary">
            Upgrade to Pro to get API access.
          </Typography>
        ) : (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TextField
                value={showKey ? (profile.api_key ?? '') : '••••••••••••••••••••••••'}
                fullWidth
                size="small"
                InputProps={{ readOnly: true, sx: { fontFamily: 'monospace', fontSize: 14 } }}
              />
              <Tooltip title={showKey ? 'Hide' : 'Reveal'}>
                <IconButton onClick={() => setShowKey(!showKey)} size="small">
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </IconButton>
              </Tooltip>
              <Tooltip title={copied ? 'Copied!' : 'Copy'}>
                <IconButton onClick={handleCopy} size="small">
                  <Copy size={16} />
                </IconButton>
              </Tooltip>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Include this key in the <code>X-API-Key</code> header for authenticated API requests.
            </Typography>
          </>
        )}
      </Paper>

      <Divider sx={{ my: 3 }} />

      <Button
        variant="outlined"
        color="error"
        onClick={signOut}
        startIcon={<LogOut size={16} />}
        sx={{ textTransform: 'none', fontWeight: 600 }}
      >
        Sign out
      </Button>
    </Box>
  );
};

export default Profile;
