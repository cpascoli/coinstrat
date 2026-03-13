import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import {
  Crown,
  Database,
  Eye,
  ExternalLink,
  Mail,
  Newspaper,
  RefreshCw,
  Send,
  Shield,
  Trash2,
  Users,
  Zap,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, type Profile, type Tier } from '../lib/supabase';

interface EmailSubscriber {
  id: string;
  email: string;
  subscribed_at: string;
  unsubscribed_at: string | null;
  source: string;
}

type NewsletterAudienceMode = 'all' | 'newsletter_only' | 'paid_only';

interface NewsletterSettings {
  enabled: boolean;
  send_weekday: number;
  send_hour_utc: number;
  audience_mode: NewsletterAudienceMode;
  from_name: string;
  reply_to: string | null;
}

interface CuratedLink {
  id?: string;
  title: string;
  url: string;
  source: string;
  note?: string | null;
  sort_order?: number;
}

interface NewsletterSendLog {
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  delivery_mode: 'broadcast' | 'test';
  sent_at: string;
}

interface NewsletterIssue {
  id: string;
  week_of: string;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';
  subject: string | null;
  preview_text: string | null;
  html: string | null;
  text: string | null;
  editor_note: string | null;
  cta_label: string | null;
  cta_href: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  sent_at: string | null;
  scheduled_for: string | null;
  updated_at: string;
  curated_links: CuratedLink[];
  latest_send_log: NewsletterSendLog | null;
}

const TIER_COLORS: Record<string, string> = {
  free: '#94a3b8',
  pro: '#60a5fa',
  pro_plus: '#a78bfa',
  lifetime: '#f59e0b',
};

const WEEKDAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

function currentMonday(): string {
  const now = new Date();
  const utcDay = now.getUTCDay();
  const delta = utcDay === 0 ? -6 : 1 - utcDay;
  now.setUTCDate(now.getUTCDate() + delta);
  return now.toISOString().slice(0, 10);
}

function emptyCuratedLink(index: number): CuratedLink {
  return {
    title: '',
    url: '',
    source: '',
    note: '',
    sort_order: index,
  };
}

const Admin: React.FC = () => {
  const { isAdmin, session } = useAuth();
  const [tabIdx, setTabIdx] = useState(0);
  const [users, setUsers] = useState<Profile[]>([]);
  const [subscribers, setSubscribers] = useState<EmailSubscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [cacheInfo, setCacheInfo] = useState<{
    latestDate: string | null;
    cachedAt: string | null;
    stale: boolean | null;
  }>({ latestDate: null, cachedAt: null, stale: null });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<string | null>(null);
  const [removingSubscriberEmail, setRemovingSubscriberEmail] = useState<string | null>(null);

  const [selectedWeek, setSelectedWeek] = useState(currentMonday());
  const [newsletterLoading, setNewsletterLoading] = useState(true);
  const [newsletterBusy, setNewsletterBusy] = useState(false);
  const [newsletterSettings, setNewsletterSettings] = useState<NewsletterSettings>({
    enabled: false,
    send_weekday: 1,
    send_hour_utc: 14,
    audience_mode: 'all',
    from_name: 'CoinStrat',
    reply_to: '',
  });
  const [newsletterIssue, setNewsletterIssue] = useState<NewsletterIssue | null>(null);
  const [newsletterHistory, setNewsletterHistory] = useState<NewsletterIssue[]>([]);
  const [recipientCount, setRecipientCount] = useState(0);
  const [editorNote, setEditorNote] = useState('');
  const [ctaLabel, setCtaLabel] = useState('Open Dashboard');
  const [ctaHref, setCtaHref] = useState('https://coinstrat.xyz/dashboard');
  const [curatedLinks, setCuratedLinks] = useState<CuratedLink[]>([emptyCuratedLink(0)]);
  const [newsletterMessage, setNewsletterMessage] = useState<{
    severity: 'success' | 'error';
    text: string;
  } | null>(null);

  const authHeaders = useCallback((): Record<string, string> => {
    const token = (session as Session | null)?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [session]);

  const applyIssueToForm = useCallback((issue: NewsletterIssue | null) => {
    setNewsletterIssue(issue);
    setEditorNote(issue?.editor_note ?? '');
    setCtaLabel(issue?.cta_label ?? 'Open Dashboard');
    setCtaHref(issue?.cta_href ?? 'https://coinstrat.xyz/dashboard');
    setCuratedLinks(
      issue?.curated_links && issue.curated_links.length > 0
        ? issue.curated_links
        : [emptyCuratedLink(0)],
    );
  }, []);

  const fetchCacheInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/signals/current');
      if (!res.ok) {
        setCacheInfo({ latestDate: null, cachedAt: null, stale: null });
        return;
      }
      const data = await res.json();
      setCacheInfo({
        latestDate: data.signal?.Date ?? null,
        cachedAt: data.cached_at ?? null,
        stale: typeof data.stale === 'boolean' ? data.stale : null,
      });
    } catch {
      setCacheInfo({ latestDate: null, cachedAt: null, stale: null });
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const res = await fetch('/api/admin/users', { headers: authHeaders() });
    if (!res.ok) {
      setError('Failed to load users');
      setLoading(false);
      return;
    }
    const data = await res.json();
    setUsers(data.users ?? []);
    setSubscribers(data.subscribers ?? []);
    setLoading(false);
  }, [authHeaders]);

  const fetchNewsletter = useCallback(async (weekOf: string) => {
    setNewsletterLoading(true);
    try {
      const params = new URLSearchParams({ weekOf });
      const res = await fetch(`/api/admin/newsletter?${params.toString()}`, {
        headers: authHeaders(),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to load newsletter workspace.');
      }

      setNewsletterSettings(data.settings);
      setRecipientCount(data.recipientCount ?? 0);
      setNewsletterHistory(data.recentIssues ?? []);
      applyIssueToForm(data.issue ?? null);
    } catch (err: any) {
      setNewsletterMessage({ severity: 'error', text: err.message });
    } finally {
      setNewsletterLoading(false);
    }
  }, [applyIssueToForm, authHeaders]);

  useEffect(() => {
    fetchUsers();
    fetchCacheInfo();
  }, [fetchUsers, fetchCacheInfo]);

  useEffect(() => {
    fetchNewsletter(selectedWeek);
  }, [fetchNewsletter, selectedWeek]);

  if (!isAdmin) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <Shield size={40} style={{ marginBottom: 12, opacity: 0.5 }} />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Access denied</Typography>
        <Typography color="text.secondary">You need admin privileges to view this page.</Typography>
      </Paper>
    );
  }

  const tierCounts = {
    total: users.length,
    free: users.filter((user) => user.tier === 'free').length,
    pro: users.filter((user) => user.tier === 'pro').length,
    pro_plus: users.filter((user) => user.tier === 'pro_plus').length,
    lifetime: users.filter((user) => user.tier === 'lifetime').length,
  };

  const activeSubscribers = useMemo(
    () => subscribers.filter((subscriber) => !subscriber.unsubscribed_at),
    [subscribers],
  );

  const handleTierChange = async (userId: string, newTier: Tier) => {
    setError(null);
    setSuccess(null);

    const res = await fetch('/api/admin/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ userId, tier: newTier }),
    });

    if (res.ok) {
      setSuccess(`User tier updated to ${newTier}`);
      setUsers((prev) => prev.map((user) => (user.id === userId ? { ...user, tier: newTier } : user)));
    } else {
      setError('Failed to update tier');
    }
  };

  const handleRemoveSubscriber = async (email: string) => {
    const confirmed = window.confirm(`Remove ${email} from the newsletter subscriber list?`);
    if (!confirmed) return;

    setError(null);
    setSuccess(null);
    setRemovingSubscriberEmail(email);

    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to remove subscriber');
      }

      setSuccess(`Removed ${email} from newsletter subscribers.`);
      setSubscribers((prev) => prev.map((subscriber) => (
        subscriber.email === email
          ? { ...subscriber, unsubscribed_at: new Date().toISOString() }
          : subscriber
      )));
    } catch (err: any) {
      setError(err.message ?? 'Failed to remove subscriber');
    } finally {
      setRemovingSubscriberEmail(null);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshResult(null);
    setError(null);

    try {
      const res = await fetch('/api/v1/signals/refresh', {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Refresh failed');
      } else if (data.new_rows === 0) {
        setRefreshResult('Cache is already up-to-date.');
      } else {
        setRefreshResult(
          `Appended ${data.new_rows} new rows (${data.total} total). Latest: ${data.latest_date}`,
        );
      }

      await fetchCacheInfo();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSaveNewsletterSettings = async () => {
    setNewsletterBusy(true);
    setNewsletterMessage(null);

    try {
      const res = await fetch('/api/admin/newsletter', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(newsletterSettings),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to save newsletter settings.');
      }

      setNewsletterSettings(data.settings);
      setNewsletterMessage({ severity: 'success', text: 'Newsletter settings saved.' });
      await fetchNewsletter(selectedWeek);
    } catch (err: any) {
      setNewsletterMessage({ severity: 'error', text: err.message });
    } finally {
      setNewsletterBusy(false);
    }
  };

  const handleNewsletterAction = async (action: 'compose' | 'send' | 'send_test') => {
    setNewsletterBusy(true);
    setNewsletterMessage(null);

    try {
      const payload = {
        action,
        issueId: newsletterIssue?.id,
        weekOf: selectedWeek,
        editor_note: editorNote,
        cta_label: ctaLabel,
        cta_href: ctaHref,
      };

      const res = await fetch('/api/admin/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? 'Newsletter action failed.');
      }

      if (data.issue) {
        applyIssueToForm(data.issue);
      }

      switch (action) {
        case 'compose':
          setNewsletterMessage({ severity: 'success', text: 'Newsletter draft composed successfully.' });
          break;
        case 'send':
          setNewsletterMessage({
            severity: 'success',
            text: `Newsletter sent to ${data.result.sent}/${data.result.total} recipients.`,
          });
          break;
        case 'send_test':
          setNewsletterMessage({
            severity: 'success',
            text: `Test email sent to your admin address (${data.result.sent}/${data.result.total}).`,
          });
          break;
        default:
          break;
      }

      await fetchNewsletter(selectedWeek);
    } catch (err: any) {
      setNewsletterMessage({ severity: 'error', text: err.message });
    } finally {
      setNewsletterBusy(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 1160, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 3 }}>
        <Shield size={24} />
        <Typography variant="h5" sx={{ fontWeight: 900 }}>Admin Dashboard</Typography>
      </Stack>

      <Stack direction="row" spacing={2} sx={{ mb: 3 }} useFlexGap flexWrap="wrap">
        <StatCard icon={<Users size={20} />} label="Total users" value={tierCounts.total} color="#e5e7eb" />
        <StatCard icon={null} label="Free" value={tierCounts.free} color={TIER_COLORS.free} />
        <StatCard icon={<Zap size={20} />} label="Pro" value={tierCounts.pro} color={TIER_COLORS.pro} />
        <StatCard icon={<Crown size={20} />} label="Lifetime" value={tierCounts.lifetime} color={TIER_COLORS.lifetime} />
        <StatCard icon={<Mail size={20} />} label="Subscribers" value={activeSubscribers.length} color="#22c55e" />
      </Stack>

      <Paper sx={{ p: 2.5, mb: 3 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <Database size={18} />
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Signal Cache</Typography>
        </Stack>

        <Stack direction="row" spacing={4} alignItems="center" flexWrap="wrap" useFlexGap>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>Latest signal date</Typography>
            <Typography variant="body1" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
              {cacheInfo.latestDate ?? '—'}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>Last refreshed</Typography>
            <Typography variant="body1" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
              {cacheInfo.cachedAt ? new Date(cacheInfo.cachedAt).toLocaleString() : '—'}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>Cache status</Typography>
            <Box sx={{ mt: 0.5 }}>
              <Chip
                size="small"
                label={
                  cacheInfo.stale === null
                    ? 'Unknown'
                    : cacheInfo.stale
                      ? 'Stale snapshot'
                      : 'Fresh snapshot'
                }
                sx={{
                  fontWeight: 700,
                  bgcolor:
                    cacheInfo.stale === null
                      ? 'rgba(148,163,184,0.12)'
                      : cacheInfo.stale
                        ? 'rgba(245,158,11,0.14)'
                        : 'rgba(34,197,94,0.14)',
                  color:
                    cacheInfo.stale === null
                      ? '#94a3b8'
                      : cacheInfo.stale
                        ? '#f59e0b'
                        : '#22c55e',
                }}
              />
            </Box>
          </Box>
          <Box sx={{ ml: 'auto' }}>
            <Button
              variant="contained"
              size="small"
              disabled={refreshing}
              onClick={handleRefresh}
              startIcon={refreshing ? <CircularProgress size={14} color="inherit" /> : <RefreshCw size={14} />}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              {refreshing ? 'Refreshing…' : 'Refresh now'}
            </Button>
          </Box>
        </Stack>

        {refreshResult && (
          <Alert severity="success" sx={{ mt: 1.5 }}>{refreshResult}</Alert>
        )}
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

      <Tabs
        value={tabIdx}
        onChange={(_, value) => setTabIdx(value)}
        sx={{ mb: 2, '& .MuiTab-root': { fontWeight: 700, textTransform: 'none' } }}
      >
        <Tab label={`Registered Users (${users.length})`} />
        <Tab label={`Newsletter Subscribers (${activeSubscribers.length})`} />
        <Tab label="Newsletter" />
      </Tabs>

      {tabIdx === 0 && (
        <Paper>
          {loading ? (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Email</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Tier</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Stripe</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Joined</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 13 }}>
                          {user.email}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={user.tier}
                          size="small"
                          sx={{
                            bgcolor: `${TIER_COLORS[user.tier] ?? '#94a3b8'}22`,
                            color: TIER_COLORS[user.tier] ?? '#94a3b8',
                            fontWeight: 700,
                            fontSize: 11,
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                          {user.stripe_customer_id ? `${user.stripe_customer_id.slice(0, 18)}…` : '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(user.created_at).toLocaleDateString()}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Select
                          size="small"
                          value={user.tier}
                          onChange={(event) => handleTierChange(user.id, event.target.value as Tier)}
                          sx={{ fontSize: 12, minWidth: 100 }}
                        >
                          <MenuItem value="free">free</MenuItem>
                          <MenuItem value="pro">pro</MenuItem>
                          <MenuItem value="lifetime">lifetime</MenuItem>
                          <MenuItem value="pro_plus">pro_plus</MenuItem>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      )}

      {tabIdx === 1 && (
        <Paper>
          {loading ? (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <CircularProgress size={24} />
            </Box>
          ) : activeSubscribers.length === 0 ? (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Mail size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
              <Typography color="text.secondary">No newsletter subscribers yet.</Typography>
            </Box>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Email</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Source</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Subscribed</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {activeSubscribers.map((subscriber) => (
                    <TableRow key={subscriber.id}>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 13 }}>
                          {subscriber.email}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={subscriber.source}
                          size="small"
                          sx={{ fontSize: 11, bgcolor: 'rgba(34,197,94,0.12)', color: '#22c55e' }}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(subscriber.subscribed_at).toLocaleDateString()}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={subscriber.unsubscribed_at ? 'Unsubscribed' : 'Active'}
                          size="small"
                          sx={{
                            fontSize: 11,
                            fontWeight: 700,
                            bgcolor: subscriber.unsubscribed_at ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
                            color: subscriber.unsubscribed_at ? '#ef4444' : '#22c55e',
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          size="small"
                          color="error"
                          variant="outlined"
                          disabled={removingSubscriberEmail === subscriber.email}
                          onClick={() => handleRemoveSubscriber(subscriber.email)}
                          startIcon={removingSubscriberEmail === subscriber.email ? <CircularProgress size={14} color="inherit" /> : <Trash2 size={14} />}
                          sx={{ textTransform: 'none', fontWeight: 700 }}
                        >
                          {removingSubscriberEmail === subscriber.email ? 'Removing…' : 'Remove'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      )}

      {tabIdx === 2 && (
        <Stack spacing={2.5}>
          {newsletterMessage && (
            <Alert severity={newsletterMessage.severity}>{newsletterMessage.text}</Alert>
          )}

          <Paper sx={{ p: 2.5 }}>
            <Stack spacing={1.75}>
              <Stack
                direction={{ xs: 'column', lg: 'row' }}
                spacing={2}
                alignItems={{ lg: 'center' }}
                justifyContent="space-between"
              >
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Newspaper size={18} />
                    <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Newsletter Workspace</Typography>
                  </Stack>

                  <TextField
                    type="date"
                    label="Issue week"
                    value={selectedWeek}
                    onChange={(event) => setSelectedWeek(event.target.value)}
                    size="small"
                    InputLabelProps={{ shrink: true }}
                    sx={{ minWidth: 180 }}
                  />
                </Stack>

                <Box sx={{ width: '100%', maxWidth: { lg: 620 } }}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap flexWrap="wrap" justifyContent={{ lg: 'flex-end' }}>
                    <Button
                      variant="outlined"
                      disabled={newsletterBusy || newsletterLoading}
                      onClick={() => handleNewsletterAction('compose')}
                      startIcon={newsletterBusy ? <CircularProgress size={14} /> : <RefreshCw size={14} />}
                      sx={{ textTransform: 'none', fontWeight: 700 }}
                    >
                      {newsletterIssue ? 'Regenerate draft' : 'Compose draft'}
                    </Button>
                    <Button
                      variant="outlined"
                      disabled={newsletterBusy || newsletterLoading}
                      onClick={() => handleNewsletterAction('compose')}
                      startIcon={<RefreshCw size={14} />}
                      sx={{ textTransform: 'none', fontWeight: 700 }}
                    >
                      Refresh sourced stories
                    </Button>
                    <Button
                      variant="outlined"
                      disabled={newsletterBusy || newsletterLoading || !newsletterIssue?.id}
                      onClick={() => handleNewsletterAction('send_test')}
                      startIcon={<Eye size={14} />}
                      sx={{ textTransform: 'none', fontWeight: 700 }}
                    >
                      Send test to me
                    </Button>
                    <Button
                      variant="contained"
                      disabled={newsletterBusy || newsletterLoading || !newsletterIssue?.id}
                      onClick={() => handleNewsletterAction('send')}
                      startIcon={<Send size={14} />}
                      sx={{ textTransform: 'none', fontWeight: 700 }}
                    >
                      Send now
                    </Button>
                  </Stack>
                </Box>
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap flexWrap="wrap">
                <Chip
                  label={newsletterIssue ? `Status: ${newsletterIssue.status}` : 'Not yet composed'}
                  size="small"
                  color={newsletterIssue?.status === 'sent' ? 'success' : 'default'}
                />

                <Chip
                  label={`Audience: ${recipientCount} recipients`}
                  size="small"
                  variant="outlined"
                />
              </Stack>
            </Stack>
          </Paper>

          <Stack direction={{ xs: 'column', xl: 'row' }} spacing={2.5} alignItems="stretch">
            <Stack spacing={2.5} sx={{ flex: '0 0 420px', maxWidth: { xl: 420 } }}>
              <Paper sx={{ p: 2.5 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2 }}>
                  Schedule
                </Typography>
                <Stack spacing={2}>
                  <FormControlLabel
                    control={(
                      <Switch
                        checked={newsletterSettings.enabled}
                        onChange={(event) => setNewsletterSettings((prev) => ({
                          ...prev,
                          enabled: event.target.checked,
                        }))}
                      />
                    )}
                    label="Enable automatic weekly broadcast"
                  />

                  <Select
                    size="small"
                    value={newsletterSettings.send_weekday}
                    onChange={(event) => setNewsletterSettings((prev) => ({
                      ...prev,
                      send_weekday: Number(event.target.value),
                    }))}
                  >
                    {WEEKDAYS.map((day) => (
                      <MenuItem key={day.value} value={day.value}>{day.label}</MenuItem>
                    ))}
                  </Select>

                  <TextField
                    size="small"
                    type="number"
                    label="Send hour (UTC)"
                    value={newsletterSettings.send_hour_utc}
                    onChange={(event) => setNewsletterSettings((prev) => ({
                      ...prev,
                      send_hour_utc: Number(event.target.value),
                    }))}
                    inputProps={{ min: 0, max: 23 }}
                  />

                  <Select
                    size="small"
                    value={newsletterSettings.audience_mode}
                    onChange={(event) => setNewsletterSettings((prev) => ({
                      ...prev,
                      audience_mode: event.target.value as NewsletterAudienceMode,
                    }))}
                  >
                    <MenuItem value="all">All users + subscribers</MenuItem>
                    <MenuItem value="newsletter_only">Newsletter subscribers only</MenuItem>
                    <MenuItem value="paid_only">Paid users only</MenuItem>
                  </Select>

                  <TextField
                    size="small"
                    label="From name"
                    value={newsletterSettings.from_name}
                    onChange={(event) => setNewsletterSettings((prev) => ({
                      ...prev,
                      from_name: event.target.value,
                    }))}
                  />

                  <TextField
                    size="small"
                    label="Reply-to email"
                    value={newsletterSettings.reply_to ?? ''}
                    onChange={(event) => setNewsletterSettings((prev) => ({
                      ...prev,
                      reply_to: event.target.value,
                    }))}
                  />

                  <Button
                    variant="contained"
                    onClick={handleSaveNewsletterSettings}
                    disabled={newsletterBusy}
                    sx={{ textTransform: 'none', fontWeight: 700, alignSelf: 'flex-start' }}
                  >
                    Save schedule
                  </Button>
                </Stack>
              </Paper>

              <Paper sx={{ p: 2.5 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2 }}>
                  Compose Inputs
                </Typography>
                <Stack spacing={2}>
                  <TextField
                    label="Editor note"
                    multiline
                    minRows={4}
                    value={editorNote}
                    onChange={(event) => setEditorNote(event.target.value)}
                    helperText="Optional note to steer the weekly narrative."
                  />
                  <TextField
                    label="CTA label"
                    value={ctaLabel}
                    onChange={(event) => setCtaLabel(event.target.value)}
                  />
                  <TextField
                    label="CTA URL"
                    value={ctaHref}
                    onChange={(event) => setCtaHref(event.target.value)}
                  />
                </Stack>
              </Paper>

              <Paper sx={{ p: 2.5 }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                    Sourced Stories
                  </Typography>
                  <Chip
                    label={`${curatedLinks.filter((link) => link.title && link.url).length} stories`}
                    size="small"
                    variant="outlined"
                  />
                </Stack>

                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  CoinStrat now sources weekly Bitcoin headlines automatically. Review them here and use
                  `Refresh sourced stories` if you want a different selection.
                </Typography>

                <Stack spacing={2}>
                  {curatedLinks.filter((link) => link.title && link.url).length === 0 ? (
                    <Alert severity="info">Compose the draft to generate sourced stories.</Alert>
                  ) : (
                    curatedLinks
                      .filter((link) => link.title && link.url)
                      .map((link, index) => (
                        <Paper key={`${link.id ?? 'story'}-${index}`} variant="outlined" sx={{ p: 1.5 }}>
                          <Stack spacing={0.75}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                              <Typography sx={{ fontWeight: 700 }}>{link.title}</Typography>
                              <IconButton
                                size="small"
                                component="a"
                                href={link.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <ExternalLink size={14} />
                              </IconButton>
                            </Stack>
                            <Typography variant="caption" color="text.secondary">
                              {link.source}
                            </Typography>
                            {link.note && (
                              <Typography variant="body2" color="text.secondary">
                                {link.note}
                              </Typography>
                            )}
                          </Stack>
                        </Paper>
                      ))
                  )}
                </Stack>
              </Paper>
            </Stack>

            <Stack spacing={2.5} sx={{ flex: 1, minWidth: 0 }}>
              <Paper sx={{ p: 2.5 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5 }}>
                  Draft Preview
                </Typography>

                {newsletterLoading ? (
                  <Box sx={{ py: 6, textAlign: 'center' }}>
                    <CircularProgress size={24} />
                  </Box>
                ) : newsletterIssue ? (
                  <Stack spacing={2}>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                          Subject
                        </Typography>
                        <Typography sx={{ fontWeight: 700 }}>
                          {newsletterIssue.subject ?? '—'}
                        </Typography>
                      </Box>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                          Preview text
                        </Typography>
                        <Typography color="text.secondary">
                          {newsletterIssue.preview_text ?? '—'}
                        </Typography>
                      </Box>
                    </Stack>

                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Chip label={`Provider: ${newsletterIssue.llm_provider ?? 'n/a'}`} size="small" variant="outlined" />
                      <Chip label={`Model: ${newsletterIssue.llm_model ?? 'n/a'}`} size="small" variant="outlined" />
                      <Chip
                        label={`Scheduled: ${newsletterIssue.scheduled_for ? new Date(newsletterIssue.scheduled_for).toLocaleString() : 'not scheduled'}`}
                        size="small"
                        variant="outlined"
                      />
                      <Chip
                        label={`Sent: ${newsletterIssue.sent_at ? new Date(newsletterIssue.sent_at).toLocaleString() : 'not yet'}`}
                        size="small"
                        variant="outlined"
                      />
                    </Stack>

                    {newsletterIssue.latest_send_log && (
                      <Alert severity="info">
                        Last {newsletterIssue.latest_send_log.delivery_mode === 'test' ? 'test' : 'broadcast'}:{' '}
                        {newsletterIssue.latest_send_log.sent_count}/{newsletterIssue.latest_send_log.recipient_count} sent on{' '}
                        {new Date(newsletterIssue.latest_send_log.sent_at).toLocaleString()}.
                      </Alert>
                    )}

                    {newsletterIssue.html ? (
                      <Box
                        component="iframe"
                        title="Newsletter preview"
                        srcDoc={newsletterIssue.html}
                        sx={{
                          width: '100%',
                          minHeight: 820,
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 2,
                          backgroundColor: 'white',
                        }}
                      />
                    ) : (
                      <Alert severity="warning">
                        No draft has been composed for this week yet.
                      </Alert>
                    )}
                  </Stack>
                ) : (
                  <Alert severity="info">
                    Select a week and compose a draft to preview the newsletter.
                  </Alert>
                )}
              </Paper>

              <Paper sx={{ p: 2.5 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2 }}>
                  Recent Issues
                </Typography>

                {newsletterHistory.length === 0 ? (
                  <Typography color="text.secondary">No newsletter issues yet.</Typography>
                ) : (
                  <Stack divider={<Divider flexItem />} spacing={1.5}>
                    {newsletterHistory.map((issue) => (
                      <Stack
                        key={issue.id}
                        direction={{ xs: 'column', md: 'row' }}
                        spacing={1.5}
                        justifyContent="space-between"
                        alignItems={{ md: 'center' }}
                      >
                        <Box>
                          <Typography sx={{ fontWeight: 700 }}>
                            {issue.subject || `Issue week ${issue.week_of}`}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Week of {issue.week_of} · updated {new Date(issue.updated_at).toLocaleString()}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Chip label={issue.status} size="small" />
                          {issue.latest_send_log && (
                            <Chip
                              label={`${issue.latest_send_log.sent_count}/${issue.latest_send_log.recipient_count} sent`}
                              size="small"
                              variant="outlined"
                            />
                          )}
                          <Button
                            variant="text"
                            size="small"
                            onClick={() => setSelectedWeek(issue.week_of)}
                            sx={{ textTransform: 'none', fontWeight: 700 }}
                          >
                            Open
                          </Button>
                        </Stack>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </Paper>
            </Stack>
          </Stack>
        </Stack>
      )}
    </Box>
  );
};

const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: number; color: string }> = ({
  icon,
  label,
  value,
  color,
}) => (
  <Paper sx={{ p: 2, minWidth: 130, flex: '1 1 130px' }}>
    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}>
      {icon}
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{label}</Typography>
    </Stack>
    <Typography variant="h4" sx={{ fontWeight: 900, color }}>{value}</Typography>
  </Paper>
);

export default Admin;
