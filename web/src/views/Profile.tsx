import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  FormControlLabel,
  Link,
  Paper,
  Button,
  Chip,
  IconButton,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { Bell, Copy, Crown, ExternalLink, Eye, EyeOff, KeyRound, LogOut, Sparkles, User, Zap } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ProfileSectionNav from '../components/ProfileSectionNav';
import { useAuth } from '../contexts/AuthContext';
import { buildOpenClawInstallSnippet, OPENCLAW_SKILL_URL, PRO_ALERT_OPTIONS, type ProAlertKey } from '../lib/proFeatures';

const TIER_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  free:     { label: 'Free',     color: '#94a3b8', icon: null },
  pro:      { label: 'Pro',      color: '#60a5fa', icon: <Zap size={14} /> },
  pro_plus: { label: 'Pro+',     color: '#a78bfa', icon: <Crown size={14} /> },
  lifetime: { label: 'Lifetime', color: '#f59e0b', icon: <Crown size={14} /> },
};

type AlertPreferences = {
  enabled: boolean;
  alertKeys: ProAlertKey[];
};

type ProfileSectionId = 'account' | 'api' | 'signals' | 'openclaw';

const PROFILE_SECTION_ITEMS: Array<{ id: ProfileSectionId; label: string; icon: React.ReactElement }> = [
  { id: 'account', label: 'Account', icon: <User size={16} /> },
  { id: 'api', label: 'API', icon: <KeyRound size={16} /> },
  { id: 'signals', label: 'Signals', icon: <Bell size={16} /> },
  { id: 'openclaw', label: 'OpenClaw', icon: <Sparkles size={16} /> },
];

const Profile: React.FC = () => {
  const { session, user, profile, tier, loading, signOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));
  const [searchParams] = useSearchParams();
  const [activeSection, setActiveSection] = useState<ProfileSectionId>('account');
  const [showKey, setShowKey] = useState(false);
  const [copiedState, setCopiedState] = useState<'idle' | 'api' | 'skill'>('idle');
  const [billingError, setBillingError] = useState<string | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsSaving, setAlertsSaving] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [alertsMessage, setAlertsMessage] = useState<string | null>(null);
  const [alertPreferences, setAlertPreferences] = useState<AlertPreferences>({
    enabled: false,
    alertKeys: [],
  });
  const accountRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<HTMLDivElement | null>(null);
  const signalsRef = useRef<HTMLDivElement | null>(null);
  const openClawRef = useRef<HTMLDivElement | null>(null);

  const checkoutState = searchParams.get('checkout');
  const hasPaidAccess = tier === 'pro' || tier === 'pro_plus' || tier === 'lifetime';
  const allAlertsSelected = useMemo(
    () => PRO_ALERT_OPTIONS.every((option) => alertPreferences.alertKeys.includes(option.key)),
    [alertPreferences.alertKeys],
  );
  const installSnippet = buildOpenClawInstallSnippet(profile?.api_key ?? 'YOUR_API_KEY_HERE');
  const authHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    }),
    [session?.access_token],
  );

  const tierInfo = TIER_LABELS[tier] ?? TIER_LABELS.free;
  const sectionRefs = {
    account: accountRef,
    api: apiRef,
    signals: signalsRef,
    openclaw: openClawRef,
  };

  const handleSectionSelect = (sectionId: ProfileSectionId) => {
    setActiveSection(sectionId);

    if (isMdUp) {
      sectionRefs[sectionId].current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleCopy = async () => {
    if (profile?.api_key) {
      await navigator.clipboard.writeText(profile.api_key);
      setCopiedState('api');
      setTimeout(() => setCopiedState('idle'), 2000);
    }
  };

  const handleCopySkill = async () => {
    await navigator.clipboard.writeText(installSnippet);
    setCopiedState('skill');
    setTimeout(() => setCopiedState('idle'), 2000);
  };

  const handleUpgrade = async (targetTier: 'pro' | 'lifetime') => {
    setBillingError(null);
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ tier: targetTier }),
    });
    const data = await res.json();
    if (!res.ok) {
      setBillingError(data.error ?? 'Unable to start checkout.');
      return;
    }
    const { url } = data;
    if (url) window.location.href = url;
  };

  const handleManage = async () => {
    setBillingError(null);
    const res = await fetch('/api/stripe/portal', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) {
      setBillingError(data.error ?? 'Unable to open the billing portal.');
      return;
    }
    const { url } = data;
    if (url) window.location.href = url;
  };

  useEffect(() => {
    if (!session?.access_token || !hasPaidAccess) return;

    let cancelled = false;
    setAlertsLoading(true);
    setAlertsError(null);

    fetch('/api/pro/alerts/preferences', {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    })
      .then(async (response) => {
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setAlertsError(data.error ?? 'Unable to load alert preferences.');
          return;
        }
        setAlertPreferences({
          enabled: Boolean(data.preferences?.enabled),
          alertKeys: (data.preferences?.alertKeys ?? []) as ProAlertKey[],
        });
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setAlertsError(error.message || 'Unable to load alert preferences.');
      })
      .finally(() => {
        if (!cancelled) setAlertsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hasPaidAccess, session?.access_token]);

  const toggleAlert = (alertKey: ProAlertKey) => {
    setAlertsMessage(null);
    setAlertsError(null);
    setAlertPreferences((current) => {
      const exists = current.alertKeys.includes(alertKey);
      const alertKeys = exists
        ? current.alertKeys.filter((key) => key !== alertKey)
        : [...current.alertKeys, alertKey];

      return {
        enabled: alertKeys.length > 0 ? current.enabled : false,
        alertKeys,
      };
    });
  };

  const toggleAllAlerts = () => {
    setAlertsMessage(null);
    setAlertsError(null);
    setAlertPreferences((current) => ({
      enabled: !allAlertsSelected,
      alertKeys: allAlertsSelected ? [] : PRO_ALERT_OPTIONS.map((option) => option.key),
    }));
  };

  const saveAlertPreferences = async () => {
    if (!session?.access_token) return;

    setAlertsSaving(true);
    setAlertsMessage(null);
    setAlertsError(null);

    try {
      const response = await fetch('/api/pro/alerts/preferences', {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(alertPreferences),
      });
      const data = await response.json();
      if (!response.ok) {
        setAlertsError(data.error ?? 'Unable to save alert preferences.');
        return;
      }
      setAlertPreferences({
        enabled: Boolean(data.preferences?.enabled),
        alertKeys: (data.preferences?.alertKeys ?? []) as ProAlertKey[],
      });
      setAlertsMessage(
        data.preferences?.enabled
          ? 'Signal alert preferences updated.'
          : 'Signal alerts are currently turned off.',
      );
    } catch (error) {
      setAlertsError(error instanceof Error ? error.message : 'Unable to save alert preferences.');
    } finally {
      setAlertsSaving(false);
    }
  };

  const shouldShowSection = (sectionId: ProfileSectionId) => isMdUp || activeSection === sectionId;

  if (loading) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <CircularProgress size={24} />
      </Paper>
    );
  }

  if (!user) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Not signed in</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          Sign in to view your profile and subscription.
        </Typography>
      </Paper>
    );
  }

  if (!profile) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Finalizing your account</Typography>
        <Typography color="text.secondary" sx={{ mt: 1, mb: 2 }}>
          You are signed in and Free access is active, but your account profile is still syncing. This usually resolves within a few seconds.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="center">
          <Button variant="contained" onClick={() => void refreshProfile()} sx={{ textTransform: 'none', fontWeight: 700 }}>
            Retry account sync
          </Button>
          <Button variant="outlined" onClick={() => navigate('/dashboard')} sx={{ textTransform: 'none', fontWeight: 700 }}>
            Open dashboard
          </Button>
        </Stack>
      </Paper>
    );
  }

  return (
    <Box sx={{ maxWidth: 1180, mx: 'auto' }}>
      <Box
        sx={{
          display: { xs: 'block', md: 'grid' },
          gridTemplateColumns: { md: '220px minmax(0, 1fr)' },
          gap: { md: 3, lg: 4 },
          alignItems: 'start',
        }}
      >
        <Box sx={{ display: { xs: 'none', md: 'block' } }}>
          <Box sx={{ position: 'sticky', top: 88 }}>
            <ProfileSectionNav
              items={PROFILE_SECTION_ITEMS}
              activeId={activeSection}
              onSelect={(sectionId) => handleSectionSelect(sectionId as ProfileSectionId)}
              variant="desktop"
            />
          </Box>
        </Box>

        <Box sx={{ maxWidth: 920, width: '100%' }}>
          <Stack spacing={3}>
            <Box>
              <Typography
                variant="h3"
                component="h1"
                sx={{ fontWeight: 900, fontSize: { xs: 30, sm: 38, md: 46 }, mb: 1 }}
              >
                Profile
              </Typography>
              <Typography sx={{ color: 'text.secondary', maxWidth: 720 }}>
                Manage your account, subscription, API access, signal alerts, and OpenClaw setup from one place.
              </Typography>
            </Box>

            <Box sx={{ display: { xs: 'block', md: 'none' } }}>
              <ProfileSectionNav
                items={PROFILE_SECTION_ITEMS}
                activeId={activeSection}
                onSelect={(sectionId) => handleSectionSelect(sectionId as ProfileSectionId)}
                variant="mobile"
              />
            </Box>

            {shouldShowSection('account') && (
              <Box ref={accountRef}>
                <Stack spacing={2}>
                  <Typography variant="h5" sx={{ fontWeight: 850 }}>
                    Account & Subscription
                  </Typography>

                  <Paper sx={{ p: 3 }}>
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

                  <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>Subscription</Typography>

                    {checkoutState === 'success' && (
                      <Alert severity="success" sx={{ mb: 2 }}>
                        Checkout completed. Your subscription will refresh here as soon as Stripe confirms the update.
                      </Alert>
                    )}
                    {checkoutState === 'cancelled' && (
                      <Alert severity="info" sx={{ mb: 2 }}>
                        Checkout was cancelled. Your existing subscription is unchanged.
                      </Alert>
                    )}
                    {billingError && (
                      <Alert severity="error" sx={{ mb: 2 }}>
                        {billingError}
                      </Alert>
                    )}

                    {tier === 'free' && (
                      <>
                        <Alert severity="info" sx={{ mb: 2 }}>
                          Upgrade to Pro to access the Signal API, real-time alerts, and the OpenClaw skill.
                        </Alert>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Button
                            variant="contained"
                            onClick={() => handleUpgrade('pro')}
                            startIcon={<Zap size={16} />}
                            sx={{ textTransform: 'none', fontWeight: 700 }}
                          >
                            Upgrade to Pro — $9.99/mo
                          </Button>
                          <Button
                            variant="contained"
                            onClick={() => handleUpgrade('lifetime')}
                            startIcon={<Crown size={16} />}
                            sx={{ textTransform: 'none', fontWeight: 700, bgcolor: '#f59e0b', '&:hover': { bgcolor: '#f59e0b', filter: 'brightness(1.15)' } }}
                          >
                            Lifetime Deal — $99
                          </Button>
                        </Stack>
                      </>
                    )}

                    {tier === 'pro' && (
                      <>
                        <Typography color="text.secondary" sx={{ mb: 2 }}>
                          You're on the <strong>Pro</strong> plan. You have 1,000 API calls per day, separate signal alerts, and OpenClaw skill access.
                        </Typography>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Button
                            variant="contained"
                            onClick={() => handleUpgrade('lifetime')}
                            startIcon={<Crown size={16} />}
                            sx={{ textTransform: 'none', fontWeight: 700, bgcolor: '#f59e0b', '&:hover': { bgcolor: '#f59e0b', filter: 'brightness(1.15)' } }}
                          >
                            Switch to Lifetime — $99
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

                    {tier === 'lifetime' && (
                      <Stack spacing={1.5}>
                        <Alert severity="success" icon={<Crown size={18} />}>
                          You have <strong>Lifetime</strong> access. All Pro features are unlocked permanently with the same API and alert privileges as Pro.
                        </Alert>
                        <Typography color="text.secondary">
                          Lifetime includes the Signal API, alert preferences, and OpenClaw access without recurring billing.
                        </Typography>
                      </Stack>
                    )}

                    {tier === 'pro_plus' && (
                      <>
                        <Typography color="text.secondary" sx={{ mb: 2 }}>
                          You're on the <strong>Pro+</strong> plan. You have 10,000 API calls per day alongside the same Pro alerting and OpenClaw access.
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

                  <Paper sx={{ p: 3 }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', sm: 'center' }}>
                      <Button
                        variant="outlined"
                        color="error"
                        onClick={async () => { await signOut(); navigate('/'); }}
                        startIcon={<LogOut size={16} />}
                        sx={{ textTransform: 'none', fontWeight: 600, alignSelf: 'flex-start' }}
                      >
                        Sign out
                      </Button>
                      <Typography variant="body2" color="text.secondary">
                        Paid features are enforced server-side. Lifetime is treated as Pro-equivalent anywhere API and alerts are available.
                      </Typography>
                    </Stack>
                  </Paper>
                </Stack>
              </Box>
            )}

            {shouldShowSection('api') && (
              <Box ref={apiRef}>
                <Stack spacing={2}>
                  <Typography variant="h5" sx={{ fontWeight: 850 }}>
                    API Management
                  </Typography>

                  <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>API Key</Typography>

                    {!hasPaidAccess ? (
                      <Typography color="text.secondary">
                        Upgrade to Pro or get a Lifetime Deal to unlock API access.
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
                          <Tooltip title={copiedState === 'api' ? 'Copied!' : 'Copy'}>
                            <IconButton onClick={handleCopy} size="small">
                              <Copy size={16} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                          Include this key in the <code>X-API-Key</code> header for paid API requests. Pro and Lifetime include 1,000 calls/day. Pro+ includes 10,000 calls/day.
                        </Typography>
                      </>
                    )}
                  </Paper>

                  <Paper sx={{ p: 3 }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', sm: 'center' }}>
                      <Link
                        component="button"
                        type="button"
                        onClick={() => navigate('/docs/api')}
                        underline="hover"
                        sx={{ color: 'primary.light', textAlign: 'left' }}
                      >
                        Review the API docs
                      </Link>
                      <Typography variant="body2" color="text.secondary">
                        The API reference documents public versus paid endpoints, rate limits, and the current roadmap for future Pro API upgrades.
                      </Typography>
                    </Stack>
                  </Paper>
                </Stack>
              </Box>
            )}

            {shouldShowSection('signals') && (
              <Box ref={signalsRef}>
                <Stack spacing={2}>
                  <Typography variant="h5" sx={{ fontWeight: 850 }}>
                    Signals
                  </Typography>

                  <Paper sx={{ p: 3 }}>
                    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1.5 }}>
                      <Bell size={18} />
                      <Typography variant="h6" sx={{ fontWeight: 800 }}>
                        Signal Alerts
                      </Typography>
                    </Stack>

                    {!hasPaidAccess ? (
                      <Alert severity="info">
                        Signal alerts are a Pro feature. Upgrade to receive near real-time emails after the refresh pipeline detects a signal or score change.
                      </Alert>
                    ) : (
                      <Stack spacing={2}>
                        <Typography color="text.secondary">
                          These alerts are separate from the weekly newsletter. They fire after the signal refresh pipeline detects a state change, so repeated refreshes do not resend the same alert.
                        </Typography>

                        {alertsLoading ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                            <CircularProgress size={18} />
                            <Typography variant="body2" color="text.secondary">
                              Loading your alert preferences…
                            </Typography>
                          </Box>
                        ) : (
                          <>
                            {alertsError && <Alert severity="error">{alertsError}</Alert>}
                            {alertsMessage && <Alert severity="success">{alertsMessage}</Alert>}

                            <Stack
                              direction={{ xs: 'column', sm: 'row' }}
                              spacing={1.5}
                              justifyContent="space-between"
                              alignItems={{ xs: 'flex-start', sm: 'center' }}
                            >
                              <FormControlLabel
                                control={(
                                  <Switch
                                    checked={allAlertsSelected}
                                    onChange={toggleAllAlerts}
                                  />
                                )}
                                label="Track all supported alerts"
                              />
                              <FormControlLabel
                                control={(
                                  <Switch
                                    checked={alertPreferences.enabled}
                                    onChange={(_, checked) => setAlertPreferences((current) => ({ ...current, enabled: checked }))}
                                    disabled={alertPreferences.alertKeys.length === 0}
                                  />
                                )}
                                label="Alert emails enabled"
                              />
                            </Stack>

                            <Stack spacing={1.5}>
                              {PRO_ALERT_OPTIONS.map((option) => (
                                <Paper
                                  key={option.key}
                                  variant="outlined"
                                  sx={{
                                    p: 1.5,
                                    borderColor: 'rgba(148,163,184,0.22)',
                                    background: 'rgba(2,6,23,0.28)',
                                  }}
                                >
                                  <FormControlLabel
                                    sx={{ alignItems: 'flex-start', m: 0 }}
                                    control={(
                                      <Switch
                                        checked={alertPreferences.alertKeys.includes(option.key)}
                                        onChange={() => toggleAlert(option.key)}
                                      />
                                    )}
                                    label={(
                                      <Box sx={{ pt: 0.25 }}>
                                        <Typography sx={{ fontWeight: 700 }}>{option.label}</Typography>
                                        <Typography variant="body2" color="text.secondary">
                                          {option.description}
                                        </Typography>
                                      </Box>
                                    )}
                                  />
                                </Paper>
                              ))}
                            </Stack>

                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                              <Button
                                variant="contained"
                                onClick={() => void saveAlertPreferences()}
                                disabled={alertsSaving}
                                sx={{ textTransform: 'none', fontWeight: 700 }}
                              >
                                {alertsSaving ? 'Saving…' : 'Save alert preferences'}
                              </Button>
                            </Stack>

                            <Typography variant="body2" color="text.secondary">
                              Each alert email also includes a category-specific unsubscribe link if you want to stop alert emails without changing your weekly newsletter subscription.
                            </Typography>
                          </>
                        )}
                      </Stack>
                    )}
                  </Paper>
                </Stack>
              </Box>
            )}

            {shouldShowSection('openclaw') && (
              <Box ref={openClawRef}>
                <Stack spacing={2}>
                  <Typography variant="h5" sx={{ fontWeight: 850 }}>
                    OpenClaw Skill
                  </Typography>

                  <Paper sx={{ p: 3 }}>
                    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1.5 }}>
                      <Sparkles size={18} />
                      <Typography variant="h6" sx={{ fontWeight: 800 }}>
                        OpenClaw Skill Access
                      </Typography>
                    </Stack>

                    {!hasPaidAccess ? (
                      <Alert severity="info">
                        OpenClaw skill access is included with Pro and Lifetime.
                      </Alert>
                    ) : (
                      <Stack spacing={2}>
                        <Typography color="text.secondary">
                          Download the ready-to-copy CoinStrat skill, then give your OpenClaw agent your API key and the skill instructions. The skill covers current signal lookup, history lookup, weekly comparisons, and model-state summaries.
                        </Typography>

                        <TextField
                          value={installSnippet}
                          multiline
                          minRows={7}
                          fullWidth
                          InputProps={{
                            readOnly: true,
                            sx: {
                              fontFamily: 'monospace',
                              fontSize: 13,
                              alignItems: 'flex-start',
                            },
                          }}
                        />

                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                          <Button
                            variant="contained"
                            startIcon={<Copy size={16} />}
                            onClick={() => void handleCopySkill()}
                            sx={{ textTransform: 'none', fontWeight: 700 }}
                          >
                            {copiedState === 'skill' ? 'Copied setup snippet' : 'Copy setup snippet'}
                          </Button>
                          <Button
                            variant="outlined"
                            component="a"
                            href={OPENCLAW_SKILL_URL}
                            target="_blank"
                            rel="noreferrer"
                            startIcon={<ExternalLink size={16} />}
                            sx={{ textTransform: 'none', fontWeight: 700 }}
                          >
                            Open skill file
                          </Button>
                        </Stack>

                        <Typography variant="body2" color="text.secondary">
                          Keep your API key private. If you rotate it later, update the snippet you gave to OpenClaw.
                        </Typography>
                      </Stack>
                    )}
                  </Paper>
                </Stack>
              </Box>
            )}
          </Stack>
        </Box>
      </Box>
    </Box>
  );
};

export default Profile;
