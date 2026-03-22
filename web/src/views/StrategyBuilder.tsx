import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  Dialog,
  DialogContent,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip as MuiTooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import {
  Bot,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Lightbulb,
  Link2,
  Droplets,
  FolderOpen,
  TrendingUp,
  ArrowLeftRight,
  Gauge,
  Radio,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Wand2,
  Workflow,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  STRATEGY_SERIES_CATALOG,
  getGroupedSeries,
  describeComparator,
  summarizeStrategySpec,
  validateStrategySpec,
  type StrategyAlertMode,
  type StrategyPreviewTrace,
  type StrategyPreviewResult,
  type StrategySnapshotRow,
  type StrategySpec,
} from '../lib/strategyBuilder';
import { SignalBuilderDocsContent } from './DocsSignalBuilder';

type StoredStrategy = {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'paused' | 'invalid';
  prompt: string;
  spec: StrategySpec | null;
  latest_signal_value: number | null;
  latest_signal_date: string | null;
  alert: {
    enabled: boolean;
    mode: StrategyAlertMode;
  };
};

const StrategyBuilder: React.FC = () => {
  const navigate = useNavigate();
  const { session, isAuthenticated, loading, tier } = useAuth();
  const theme = useTheme();
  const isSmDown = useMediaQuery(theme.breakpoints.down('sm'));
  const hasPaidAccess = tier === 'pro' || tier === 'pro_plus' || tier === 'lifetime';
  const [prompt, setPrompt] = useState('');
  const [strategyName, setStrategyName] = useState('Prompt strategy');
  const [strategyDescription, setStrategyDescription] = useState('LLM-assisted custom Pro strategy.');
  const [strategyStatus, setStrategyStatus] = useState<'draft' | 'active' | 'paused' | 'invalid'>('draft');
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [alertMode, setAlertMode] = useState<StrategyAlertMode>('state_change');
  const [draftSpec, setDraftSpec] = useState<StrategySpec | null>(null);
  const [jsonSpec, setJsonSpec] = useState('');
  const [provider, setProvider] = useState<'openai' | 'heuristic' | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [preview, setPreview] = useState<StrategyPreviewResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedPreviewRows, setSelectedPreviewRows] = useState<string[]>([]);
  const [showAdvancedDetails, setShowAdvancedDetails] = useState(false);
  const [strategies, setStrategies] = useState<StoredStrategy[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);
  const [loadingStrategies, setLoadingStrategies] = useState(false);
  const [savedStrategiesOpen, setSavedStrategiesOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<'interpret' | 'preview' | 'save' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [seriesModalOpen, setSeriesModalOpen] = useState(false);
  const [seriesModalKey, setSeriesModalKey] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const groupedSeries = useMemo(() => getGroupedSeries(), []);

  const openSeriesDetail = useCallback((key: string) => {
    setSeriesModalKey(key);
    setSeriesModalOpen(true);
  }, []);

  const authHeaders = useMemo(() => ({
    'Content-Type': 'application/json',
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }), [session?.access_token]);

  const loadStrategies = async () => {
    if (!session?.access_token || !hasPaidAccess) return;
    setLoadingStrategies(true);
    try {
      const response = await fetch('/api/pro/strategies', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to load strategies.');
      setStrategies(data.strategies ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load strategies.');
    } finally {
      setLoadingStrategies(false);
    }
  };

  useEffect(() => {
    void loadStrategies();
  }, [session?.access_token, hasPaidAccess]);

  const parseResult = useMemo(() => {
    if (!jsonSpec.trim()) {
      return { spec: draftSpec, parseError: null as string | null };
    }
    try {
      return {
        spec: JSON.parse(jsonSpec) as StrategySpec,
        parseError: null as string | null,
      };
    } catch (parseError) {
      return {
        spec: null,
        parseError: parseError instanceof Error ? parseError.message : 'Invalid JSON.',
      };
    }
  }, [jsonSpec, draftSpec]);

  const parsedSpec = parseResult.spec;

  const validation = useMemo(
    () => {
      if (parseResult.parseError) {
        return { ok: false, errors: [`Advanced JSON is invalid: ${parseResult.parseError}`] };
      }
      return parsedSpec ? validateStrategySpec(parsedSpec) : { ok: false, errors: ['No strategy drafted yet.'] };
    },
    [parseResult.parseError, parsedSpec],
  );

  const chartData = useMemo(() => (
    preview?.rows.map((row) => ({
      ...row,
      btcScaled: row.BTCUSD ? row.BTCUSD / 100000 : null,
    })) ?? []
  ), [preview]);

  const previewTraceMap = useMemo(
    () => new Map((preview?.traces ?? []).map((trace) => [buildPreviewRowKey(trace.kind, trace.id), trace])),
    [preview],
  );

  const selectedPreviewCharts = useMemo(() => {
    if (!preview) return [];
    const selectedKeys = new Set(selectedPreviewRows);
    return preview.snapshot
      .filter((row) => isSelectableSnapshotRow(row) && selectedKeys.has(buildPreviewRowKey(row.kind, row.id)))
      .flatMap((row) => {
        const trace = previewTraceMap.get(buildPreviewRowKey(row.kind, row.id));
        return trace ? [{ row, trace }] : [];
      });
  }, [preview, previewTraceMap, selectedPreviewRows]);

  useEffect(() => {
    setSelectedPreviewRows([]);
  }, [preview]);

  const selectedStrategy = useMemo(
    () => strategies.find((strategy) => strategy.id === selectedStrategyId) ?? null,
    [strategies, selectedStrategyId],
  );

  const currentDraftFingerprint = useMemo(() => JSON.stringify({
    prompt,
    name: strategyName,
    description: strategyDescription,
    status: strategyStatus,
    alertEnabled,
    alertMode,
    spec: parsedSpec,
  }), [alertEnabled, alertMode, parsedSpec, prompt, strategyDescription, strategyName, strategyStatus]);

  const selectedDraftFingerprint = useMemo(() => {
    if (!selectedStrategy) return null;
    return JSON.stringify({
      prompt: selectedStrategy.prompt,
      name: selectedStrategy.name,
      description: selectedStrategy.description,
      status: selectedStrategy.status,
      alertEnabled: selectedStrategy.alert.enabled,
      alertMode: selectedStrategy.alert.mode,
      spec: selectedStrategy.spec,
    });
  }, [selectedStrategy]);

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedStrategy) return true;
    return currentDraftFingerprint !== selectedDraftFingerprint;
  }, [currentDraftFingerprint, selectedDraftFingerprint, selectedStrategy]);

  const applyStrategy = (strategy: StoredStrategy) => {
    setSelectedStrategyId(strategy.id);
    setPrompt(strategy.prompt);
    setStrategyName(strategy.name);
    setStrategyDescription(strategy.description);
    setStrategyStatus(strategy.status);
    setAlertEnabled(strategy.alert.enabled);
    setAlertMode(strategy.alert.mode);
    setDraftSpec(strategy.spec);
    setJsonSpec(strategy.spec ? JSON.stringify(strategy.spec, null, 2) : '');
    setPreview(null);
    setSuccess(null);
    setError(null);
    setSavedStrategiesOpen(false);
  };

  const detachSelectedStrategy = () => {
    setSelectedStrategyId(null);
    setSuccess('New draft created.');
    setError(null);
  };

  const togglePreviewRow = useCallback((row: StrategySnapshotRow) => {
    if (!isSelectableSnapshotRow(row)) return;
    const key = buildPreviewRowKey(row.kind, row.id);
    setSelectedPreviewRows((current) => (
      current.includes(key)
        ? current.filter((entry) => entry !== key)
        : [...current, key]
    ));
  }, []);

  const interpretPrompt = async () => {
    setBusyAction('interpret');
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/pro/strategies/interpret', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ prompt }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to interpret prompt.');
      setDraftSpec(data.spec);
      setJsonSpec(JSON.stringify(data.spec, null, 2));
      setStrategyName(data.spec.name);
      setStrategyDescription(data.spec.description);
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setProvider(data.provider ?? null);
      setSuccess('Prompt interpreted. Review the strategy blocks and JSON before saving.');
    } catch (interpretError) {
      setError(interpretError instanceof Error ? interpretError.message : 'Unable to interpret prompt.');
    } finally {
      setBusyAction(null);
    }
  };

  const previewStrategy = async () => {
    const currentSpec = parsedSpec;
    if (!currentSpec) {
      setError('Draft a strategy first.');
      return;
    }
    setBusyAction('preview');
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/pro/strategies/preview', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ spec: currentSpec }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to preview strategy.');
      setPreview(data.preview ?? null);
      setPreviewOpen(true);
      setSuccess('Historical preview updated.');
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Unable to preview strategy.');
    } finally {
      setBusyAction(null);
    }
  };

  const saveStrategy = async (mode: 'update' | 'create' = 'update') => {
    const currentSpec = parsedSpec;
    if (!currentSpec) {
      setError('Draft a strategy first.');
      return;
    }
    setBusyAction('save');
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/pro/strategies', {
        method: mode === 'update' && selectedStrategyId ? 'PUT' : 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          strategyId: mode === 'update' ? selectedStrategyId : null,
          name: strategyName,
          description: strategyDescription,
          prompt,
          status: strategyStatus,
          spec: currentSpec,
          alertEnabled,
          alertMode,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to save strategy.');
      const saved = data.strategy as StoredStrategy;
      applyStrategy(saved);
      await loadStrategies();
      setSuccess(mode === 'update' && selectedStrategyId ? 'Strategy updated.' : 'Strategy saved as new.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save strategy.');
    } finally {
      setBusyAction(null);
    }
  };

  const deleteStrategy = async () => {
    if (!selectedStrategyId) return;
    setBusyAction('delete');
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/pro/strategies', {
        method: 'DELETE',
        headers: authHeaders,
        body: JSON.stringify({ strategyId: selectedStrategyId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to delete strategy.');
      setSelectedStrategyId(null);
      setDraftSpec(null);
      setJsonSpec('');
      setPreview(null);
      await loadStrategies();
      setSuccess('Strategy deleted.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete strategy.');
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <CircularProgress size={24} />
      </Paper>
    );
  }

  if (!isAuthenticated) {
    return (
      <Paper sx={{ p: 4 }}>
        <Stack spacing={2}>
          <Typography variant="h5" sx={{ fontWeight: 900 }}>Sign in required</Typography>
          <Typography color="text.secondary">
            Sign in and upgrade to Pro to use the Signal Builder.
          </Typography>
          <Button variant="contained" onClick={() => navigate('/')} sx={{ textTransform: 'none', fontWeight: 700 }}>
            Back to home
          </Button>
        </Stack>
      </Paper>
    );
  }

  if (!hasPaidAccess) {
    return (
      <Paper sx={{ p: 4 }}>
        <Stack spacing={2}>
          <Typography variant="h4" sx={{ fontWeight: 900 }}>Signal Builder</Typography>
          <Alert severity="info">
            The Signal Builder is available to Pro, Pro+, and Lifetime subscribers.
          </Alert>
          <Button variant="contained" onClick={() => navigate('/profile')} sx={{ textTransform: 'none', fontWeight: 700, alignSelf: 'flex-start' }}>
            Upgrade in profile
          </Button>
        </Stack>
      </Paper>
    );
  }

  return (
    <Box sx={{ maxWidth: 1180, mx: 'auto' }}>
      <Stack spacing={3}>
        <Paper sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack spacing={2.5}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Workflow size={28} style={{ color: '#60a5fa' }} />
              <Typography variant="h3" component="h1" sx={{ fontWeight: 900, fontSize: { xs: 28, sm: 36, md: 44 } }}>
                Signal Builder
              </Typography>
            </Stack>
            <Typography sx={{ color: 'text.secondary', maxWidth: 780 }}>
              Describe the strategy you want in plain English. CoinStrat turns that into a constrained,
              reviewable strategy spec that you can preview, save, and alert on without running custom code.
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Typography
                  component="span"
                  sx={{
                    color: 'primary.main',
                    cursor: 'pointer',
                    fontWeight: 600,
                    '&:hover': { textDecoration: 'underline' },
                  }}
                  onClick={() => setHelpOpen(true)}
                >
                <Lightbulb size={13} style={{ verticalAlign: 'text-bottom', marginRight: 3 }} />
                Learn more
              </Typography>
            </Stack>
          </Stack>
        </Paper>

        {error && <Alert severity="error">{error}</Alert>}
        {success && <Alert severity="success">{success}</Alert>}
        {warnings.map((warning) => (
          <Alert severity="warning" key={warning}>{warning}</Alert>
        ))}

        <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 320px' } }}>
          <Stack spacing={3}>
            <Paper sx={{ p: 3 }}>
              <Stack spacing={2}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>Describe your strategy</Typography>
                  <Stack direction="row" spacing={1}>
                    <IconButton
                      onClick={() => setSavedStrategiesOpen(true)}
                      disabled={busyAction !== null}
                      size="small"
                      sx={{ border: '1px solid', borderColor: 'divider' }}
                      aria-label="Load a saved strategy"
                      title="Load a saved strategy"
                    >
                      <FolderOpen size={18} />
                    </IconButton>
                    <IconButton
                      onClick={detachSelectedStrategy}
                      disabled={busyAction !== null}
                      size="small"
                      sx={{ border: '1px solid', borderColor: 'divider' }}
                      aria-label="Start a new draft"
                      title="Start a new draft"
                    >
                      <Plus size={18} />
                    </IconButton>
                  </Stack>
                </Stack>
                <TextField
                  multiline
                  minRows={4}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Example: Alert me when BTC crosses above its 200 day moving average and MVRV is above 1.2"
                />
                {selectedStrategy && (
                  <Alert severity="info">
                    Editing saved strategy: <strong>{selectedStrategy.name}</strong>.
                  </Alert>
                )}
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                  <Button
                    variant="contained"
                    startIcon={<Wand2 size={16} />}
                    onClick={() => void interpretPrompt()}
                    disabled={busyAction !== null}
                    sx={{ textTransform: 'none', fontWeight: 700 }}
                  >
                    {busyAction === 'interpret' ? 'Interpreting…' : 'Interpret prompt'}
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={() => void previewStrategy()}
                    disabled={!parsedSpec || busyAction !== null}
                    sx={{ textTransform: 'none', fontWeight: 700 }}
                  >
                    {busyAction === 'preview' ? 'Previewing…' : 'Preview strategy'}
                  </Button>
                  {hasUnsavedChanges ? (
                    <>
                      {selectedStrategyId && (
                        <Button
                          variant="outlined"
                          startIcon={<Save size={16} />}
                          onClick={() => void saveStrategy('update')}
                          disabled={!validation.ok || busyAction !== null}
                          sx={{ textTransform: 'none', fontWeight: 700 }}
                        >
                          {busyAction === 'save' ? 'Saving…' : 'Update strategy'}
                        </Button>
                      )}
                      {!selectedStrategyId && (
                        <Button
                          variant="outlined"
                          startIcon={<Save size={16} />}
                          onClick={() => void saveStrategy('create')}
                          disabled={!validation.ok || busyAction !== null}
                          sx={{ textTransform: 'none', fontWeight: 700 }}
                        >
                          {busyAction === 'save' ? 'Saving…' : 'Save strategy'}
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      <Button
                        variant="outlined"
                        color="error"
                        startIcon={<Trash2 size={16} />}
                        onClick={() => void deleteStrategy()}
                        disabled={!selectedStrategyId || busyAction !== null}
                        sx={{ textTransform: 'none', fontWeight: 700 }}
                      >
                        {busyAction === 'delete' ? 'Deleting…' : 'Delete strategy'}
                      </Button>
                    </>
                  )}
                </Stack>
                {preview && (
                  <Button
                    variant="text"
                    onClick={() => setPreviewOpen(true)}
                    sx={{ alignSelf: 'flex-start', px: 0, textTransform: 'none', fontWeight: 700 }}
                  >
                    Reopen preview
                  </Button>
                )}
                {provider && (
                  <Typography variant="body2" color="text.secondary">
                    Interpretation provider: <strong>{provider}</strong>
                  </Typography>
                )}
                {preview && (
                  <Typography variant="body2" color="text.secondary">
                    Preview includes the current snapshot of sources, metrics, conditions, and output alongside the historical chart.
                  </Typography>
                )}
              </Stack>
            </Paper>

            <Paper sx={{ p: 3 }}>
              <Stack spacing={2}>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>Review strategy details</Typography>
                <TextField value={strategyName} onChange={(event) => setStrategyName(event.target.value)} label="Strategy name" />
                <TextField value={strategyDescription} onChange={(event) => setStrategyDescription(event.target.value)} label="Description" multiline minRows={2} />
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
                  <Box sx={{ minWidth: 180 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>Status</Typography>
                    <Select fullWidth value={strategyStatus} onChange={(event) => setStrategyStatus(event.target.value as typeof strategyStatus)}>
                      <MenuItem value="draft">Draft</MenuItem>
                      <MenuItem value="active">Active</MenuItem>
                      <MenuItem value="paused">Paused</MenuItem>
                      <MenuItem value="invalid">Invalid</MenuItem>
                    </Select>
                  </Box>
                  <Box sx={{ minWidth: 220 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>Alert mode</Typography>
                    <Select fullWidth value={alertMode} onChange={(event) => setAlertMode(event.target.value as StrategyAlertMode)}>
                      <MenuItem value="state_change">State change</MenuItem>
                      <MenuItem value="turns_on">Turns on</MenuItem>
                      <MenuItem value="turns_off">Turns off</MenuItem>
                      <MenuItem value="disabled">Disabled</MenuItem>
                    </Select>
                  </Box>
                  <Button
                    variant={alertEnabled ? 'contained' : 'outlined'}
                    onClick={() => setAlertEnabled((current) => !current)}
                    sx={{ textTransform: 'none', fontWeight: 700, alignSelf: 'flex-end' }}
                  >
                    {alertEnabled ? 'Alerts enabled' : 'Enable alerts'}
                  </Button>
                </Stack>
                {parsedSpec && (
                  <>
                    <Divider />
                    <Typography variant="body2" color="text.secondary">
                      {summarizeStrategySpec(parsedSpec)}
                    </Typography>
                    <Box>
                      <Button
                        variant="text"
                        onClick={() => setShowAdvancedDetails((current) => !current)}
                        endIcon={showAdvancedDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        sx={{ px: 0, textTransform: 'none', fontWeight: 700 }}
                      >
                        {showAdvancedDetails ? 'Hide advanced strategy details' : 'Show advanced strategy details'}
                      </Button>
                      <Collapse in={showAdvancedDetails}>
                        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                          <Stack spacing={1.5}>
                            <Typography sx={{ fontWeight: 700 }}>Sources</Typography>
                            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                              {parsedSpec.sources.map((source) => (
                                <Chip key={source.id} label={`${source.label} (${source.id})`} size="small" variant="outlined" />
                              ))}
                            </Stack>
                          </Stack>
                          <Stack spacing={1.5}>
                            <Typography sx={{ fontWeight: 700 }}>Metrics</Typography>
                            {parsedSpec.metrics.map((metric) => (
                              <Paper key={metric.id} variant="outlined" sx={{ p: 1.5 }}>
                                <Typography sx={{ fontWeight: 700 }}>{metric.label}</Typography>
                                <Typography variant="body2" color="text.secondary">
                                  {metric.operator} from <code>{metric.input}</code>
                                  {metric.timeframe && metric.timeframe !== 'day' ? ` on ${metric.timeframe} bars` : ''}
                                  {metric.window ? ` over ${metric.window}d` : ''}
                                  {metric.periods ? ` over ${metric.periods} periods` : ''}
                                  {metric.length ? ` with length ${metric.length}` : ''}
                                  {metric.stochWindow ? ` using stoch window ${metric.stochWindow}` : ''}
                                </Typography>
                              </Paper>
                            ))}
                          </Stack>
                          <Stack spacing={1.5}>
                            <Typography sx={{ fontWeight: 700 }}>Conditions</Typography>
                            {parsedSpec.conditions.map((condition) => (
                              <Paper key={condition.id} variant="outlined" sx={{ p: 1.5 }}>
                                <Typography sx={{ fontWeight: 700 }}>{condition.label}</Typography>
                                <Typography variant="body2" color="text.secondary">
                                  <code>{condition.left}</code> {describeComparator(condition.comparator)}{' '}
                                  {condition.rightType === 'constant' ? condition.rightConstant : <code>{condition.rightRef}</code>}
                                  {condition.lookbackDays && condition.minTrueDays
                                    ? ` for at least ${condition.minTrueDays} of ${condition.lookbackDays} days`
                                    : ''}
                                </Typography>
                              </Paper>
                            ))}
                          </Stack>
                          <TextField
                            label="Advanced JSON"
                            multiline
                            minRows={12}
                            value={jsonSpec}
                            onChange={(event) => setJsonSpec(event.target.value)}
                          />
                        </Stack>
                      </Collapse>
                    </Box>
                    {!validation.ok && <Alert severity="warning">{validation.errors.join(' ')}</Alert>}
                  </>
                )}
              </Stack>
            </Paper>

          </Stack>

          <Stack spacing={3}>
            <Paper sx={{ p: 3 }}>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>Available series</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Click any series to inspect its historical chart and latest value.
                  </Typography>
                </Box>
                {groupedSeries.map((g) => (
                  <Box key={g.group}>
                    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.75 }}>
                      {seriesGroupIcon(g.group)}
                      <Typography variant="overline" sx={{ fontWeight: 700, letterSpacing: 1 }}>
                        {g.label}
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                      {g.series.map((entry) => (
                        <MuiTooltip key={entry.key} title={entry.description} arrow enterDelay={400}>
                          <Chip
                            label={entry.label}
                            size="small"
                            variant="outlined"
                            clickable
                            onClick={() => openSeriesDetail(entry.key)}
                            sx={{
                              cursor: 'pointer',
                              '&:hover': { borderColor: 'primary.main', bgcolor: 'rgba(96,165,250,0.08)' },
                            }}
                          />
                        </MuiTooltip>
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </Paper>

            <SeriesDetailModal
              open={seriesModalOpen}
              onClose={() => setSeriesModalOpen(false)}
              seriesKey={seriesModalKey}
              accessToken={session?.access_token ?? null}
              isSmDown={isSmDown}
            />
          </Stack>
        </Box>
      </Stack>

      <Dialog
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        fullScreen={isSmDown}
        fullWidth
        maxWidth="lg"
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            m: isSmDown ? 0 : 2,
            width: isSmDown ? '100%' : undefined,
            maxHeight: isSmDown ? '100%' : 'calc(100% - 32px)',
          },
        }}
      >
        <DialogContent sx={{ p: isSmDown ? 1.5 : 3 }}>
          <Stack spacing={2.5}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <IconButton onClick={() => setHelpOpen(false)} aria-label="Close Signal Builder help">
                <X size={18} />
              </IconButton>
            </Stack>
            <SignalBuilderDocsContent showPager={false} />
          </Stack>
        </DialogContent>
      </Dialog>

      <Dialog
        open={savedStrategiesOpen}
        onClose={() => setSavedStrategiesOpen(false)}
        fullScreen={isSmDown}
        fullWidth
        maxWidth="md"
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            m: isSmDown ? 0 : 2,
            width: isSmDown ? '100%' : undefined,
            maxHeight: isSmDown ? '100%' : 'calc(100% - 32px)',
          },
        }}
      >
        <DialogContent sx={{ p: isSmDown ? 1.5 : 3 }}>
          <Stack spacing={2.5}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant={isSmDown ? 'h6' : 'h5'} sx={{ fontWeight: 900 }}>
                  Saved strategies
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Load one of your saved Signal Builder strategies into the editor.
                </Typography>
              </Box>
              <IconButton onClick={() => setSavedStrategiesOpen(false)} aria-label="Close saved strategies">
                <X size={18} />
              </IconButton>
            </Stack>

            {loadingStrategies ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 2 }}>
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">Loading strategies…</Typography>
              </Box>
            ) : strategies.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No saved strategies yet. Draft one from the prompt box and save it when the preview looks sensible.
              </Typography>
            ) : (
              <Stack spacing={1.25}>
                {strategies.map((strategy) => (
                  <Paper
                    key={strategy.id}
                    variant="outlined"
                    sx={{
                      p: 1.5,
                      cursor: 'pointer',
                      borderColor: selectedStrategyId === strategy.id ? 'primary.main' : 'rgba(148,163,184,0.24)',
                      '&:hover': { borderColor: 'primary.main' },
                    }}
                    onClick={() => applyStrategy(strategy)}
                  >
                    <Typography sx={{ fontWeight: 700 }}>{strategy.name}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {strategy.description}
                    </Typography>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                      <Chip label={strategy.status} size="small" variant="outlined" />
                      <Chip label={strategy.alert.enabled ? `Alerts: ${strategy.alert.mode}` : 'Alerts off'} size="small" variant="outlined" />
                      {strategy.latest_signal_date && (
                        <Chip
                          label={`Latest ${strategy.latest_signal_value ?? 0} on ${strategy.latest_signal_date}`}
                          size="small"
                          variant="outlined"
                        />
                      )}
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            )}
          </Stack>
        </DialogContent>
      </Dialog>

      <Dialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        fullScreen={isSmDown}
        fullWidth
        maxWidth="lg"
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            m: isSmDown ? 0 : 2,
            width: isSmDown ? '100%' : undefined,
            maxHeight: isSmDown ? '100%' : 'calc(100% - 32px)',
          },
        }}
      >
        <DialogContent sx={{ p: isSmDown ? 0 : 2 }}>
          <Stack spacing={isSmDown ? 1.25 : 2} sx={{ p: isSmDown ? 1 : 0 }}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ px: isSmDown ? 0.5 : 0, pt: isSmDown ? 0.5 : 0 }}
            >
              <Box>
                <Typography variant={isSmDown ? 'h6' : 'h5'} sx={{ fontWeight: 900 }}>
                  Preview
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Current strategy snapshot plus historical behavior on the signal dataset.
                </Typography>
              </Box>
              <IconButton onClick={() => setPreviewOpen(false)} aria-label="Close preview">
                <X size={18} />
              </IconButton>
            </Stack>

            {!preview ? (
              <Typography variant="body2" color="text.secondary" sx={{ px: isSmDown ? 0.5 : 0 }}>
                Run a preview to inspect current state, signal flips, and the last year of signal history.
              </Typography>
            ) : (
              <>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ px: isSmDown ? 0.5 : 0 }}>
                  <Chip label={`Current state: ${preview.currentState}`} size="small" variant="outlined" />
                  {preview.latestDate && <Chip label={`Latest date: ${preview.latestDate}`} size="small" variant="outlined" />}
                  <Chip label={`Transitions: ${preview.summary.transitionCount}`} size="small" variant="outlined" />
                  <Chip label={`Active days: ${preview.summary.activeDays}`} size="small" variant="outlined" />
                </Stack>

                <Stack spacing={1} sx={{ px: isSmDown ? 0.5 : 0 }}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    justifyContent="space-between"
                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                  >
                    <Box>
                      <Typography sx={{ fontWeight: 700 }}>Current snapshot</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Tap any source, metric, or condition row to show or hide its chart below.
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Chip label={`${selectedPreviewCharts.length} selected`} size="small" variant="outlined" />
                      <Button
                        variant="text"
                        size="small"
                        onClick={() => setSelectedPreviewRows([])}
                        disabled={selectedPreviewRows.length === 0}
                        sx={{ textTransform: 'none', fontWeight: 700 }}
                      >
                        Clear all
                      </Button>
                    </Stack>
                  </Stack>
                  <TableContainer
                    component={Paper}
                    variant="outlined"
                    sx={{ backgroundColor: 'transparent', overflowX: 'auto' }}
                  >
                    <Table size="small" sx={{ minWidth: 520 }}>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 800 }}>Type</TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>Name</TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>Reference</TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>Current value</TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>Chart</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {preview.snapshot.map((row) => (
                          <TableRow
                            key={`${row.kind}-${row.id}`}
                            hover={isSelectableSnapshotRow(row)}
                            selected={selectedPreviewRows.includes(buildPreviewRowKey(row.kind, row.id))}
                            onClick={isSelectableSnapshotRow(row) ? () => togglePreviewRow(row) : undefined}
                            sx={isSelectableSnapshotRow(row) ? {
                              cursor: 'pointer',
                              '& .MuiTableCell-root': { borderColor: 'rgba(148,163,184,0.18)' },
                            } : undefined}
                          >
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                              <Chip
                                label={row.kind}
                                size="small"
                                variant="outlined"
                                sx={{ textTransform: 'capitalize' }}
                              />
                            </TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>{row.label}</TableCell>
                            <TableCell sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                              {row.reference ?? '—'}
                            </TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                              {row.displayValue}
                            </TableCell>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                              <Chip
                                label={
                                  row.kind === 'output'
                                    ? 'Pinned'
                                    : selectedPreviewRows.includes(buildPreviewRowKey(row.kind, row.id))
                                      ? 'Shown'
                                      : 'Tap to show'
                                }
                                size="small"
                                variant="outlined"
                                color={
                                  row.kind === 'output'
                                    ? 'default'
                                    : selectedPreviewRows.includes(buildPreviewRowKey(row.kind, row.id))
                                      ? 'primary'
                                      : 'default'
                                }
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <Typography variant="caption" color="text.secondary">
                    Snapshot date:{' '}
                    {preview.latestDate
                      ? `${preview.latestDate}. This is usually yesterday's data, but it can be older if the underlying feeds have not refreshed yet.`
                      : 'Unavailable.'}
                  </Typography>
                </Stack>

                <Stack spacing={1} sx={{ px: isSmDown ? 0.5 : 0 }}>
                  <Typography sx={{ fontWeight: 700 }}>Signal output</Typography>
                  <Typography variant="caption" color="text.secondary">
                    The main chart stays pinned so you can compare contributor charts against the final signal.
                  </Typography>
                  <Box sx={{ width: '100%', height: isSmDown ? '48vh' : 340 }}>
                    <ResponsiveContainer>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.16} />
                        <XAxis dataKey="Date" tick={{ fontSize: 12 }} minTickGap={30} />
                        <YAxis yAxisId="signal" domain={[0, 1]} ticks={[0, 1]} />
                        <YAxis yAxisId="btc" orientation="right" />
                        <Tooltip />
                        <Line yAxisId="signal" type="stepAfter" dataKey="signal" stroke="#60a5fa" dot={false} strokeWidth={2.2} name="Signal" />
                        <Line yAxisId="btc" type="monotone" dataKey="btcScaled" name="BTC (scaled)" stroke="#f59e0b" dot={false} strokeWidth={1.4} />
                      </LineChart>
                    </ResponsiveContainer>
                  </Box>
                </Stack>

                {selectedPreviewCharts.length > 0 && (
                  <Stack spacing={1.25} sx={{ px: isSmDown ? 0.5 : 0 }}>
                    <Typography sx={{ fontWeight: 700 }}>Selected contributors</Typography>
                    {selectedPreviewCharts.map(({ row, trace }) => (
                      <PreviewTraceChart
                        key={buildPreviewRowKey(trace.kind, trace.id)}
                        row={row}
                        trace={trace}
                        dates={preview.rows.map((previewRow) => previewRow.Date)}
                        isSmDown={isSmDown}
                      />
                    ))}
                  </Stack>
                )}

                <Stack spacing={1} sx={{ px: isSmDown ? 0.5 : 0, pb: isSmDown ? 1 : 0 }}>
                  <Typography sx={{ fontWeight: 700 }}>Recent transitions</Typography>
                  {preview.transitions.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">No flips in the preview window.</Typography>
                  ) : (
                    preview.transitions.slice(-10).reverse().map((transition) => (
                      <Paper key={`${transition.Date}-${transition.previous}-${transition.next}`} variant="outlined" sx={{ p: 1.25 }}>
                        <Typography variant="body2">
                          {transition.Date}: {transition.previous} to {transition.next}
                        </Typography>
                      </Paper>
                    ))
                  )}
                </Stack>
              </>
            )}
          </Stack>
        </DialogContent>
      </Dialog>    </Box>
  );
};

function seriesGroupIcon(group: string) {
  const sz = 15;
  const cls = 'opacity-60';
  switch (group) {
    case 'market':
      return <DollarSign size={sz} className={cls} />;
    case 'valuation':
      return <Link2 size={sz} className={cls} />;
    case 'liquidity':
      return <Droplets size={sz} className={cls} />;
    case 'macro':
      return <TrendingUp size={sz} className={cls} />;
    case 'fx':
      return <ArrowLeftRight size={sz} className={cls} />;
    case 'scores':
      return <Gauge size={sz} className={cls} />;
    case 'signals':
      return <Radio size={sz} className={cls} />;
    default:
      return null;
  }
}

function buildPreviewRowKey(kind: StrategySnapshotRow['kind'], id: string) {
  return `${kind}-${id}`;
}

function isSelectableSnapshotRow(row: StrategySnapshotRow) {
  switch (row.kind) {
    case 'source':
    case 'metric':
    case 'condition':
      return true;
    case 'output':
      return false;
    default: {
      const exhaustiveCheck: never = row.kind;
      return exhaustiveCheck;
    }
  }
}

function isBinaryPreviewTrace(trace: StrategyPreviewTrace) {
  switch (trace.kind) {
    case 'condition':
    case 'output':
      return true;
    case 'source':
    case 'metric':
      return false;
    default: {
      const exhaustiveCheck: never = trace.kind;
      return exhaustiveCheck;
    }
  }
}

function previewTraceColor(kind: StrategyPreviewTrace['kind']) {
  switch (kind) {
    case 'source':
      return '#34d399';
    case 'metric':
      return '#f59e0b';
    case 'condition':
      return '#a78bfa';
    case 'output':
      return '#60a5fa';
    default: {
      const exhaustiveCheck: never = kind;
      return exhaustiveCheck;
    }
  }
}

function formatGenericPreviewNumber(value: number) {
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  if (Math.abs(value) < 0.01 && value !== 0) {
    return value.toExponential(2);
  }
  return value.toFixed(Math.abs(value) < 10 ? 4 : 2);
}

function formatPreviewTraceValue(value: number | boolean | null, trace: StrategyPreviewTrace) {
  if (value == null) return '—';
  switch (trace.kind) {
    case 'source':
      return typeof value === 'number'
        ? formatSeriesValue(value, trace.reference ?? '')
        : value
          ? 'ON'
          : 'OFF';
    case 'metric':
      return typeof value === 'number' ? formatGenericPreviewNumber(value) : '—';
    case 'condition':
      return value === true ? 'TRUE' : 'FALSE';
    case 'output':
      return Number(value) === 1 ? 'ON' : 'OFF';
    default: {
      const exhaustiveCheck: never = trace.kind;
      return exhaustiveCheck;
    }
  }
}

interface PreviewTraceChartProps {
  row: StrategySnapshotRow;
  trace: StrategyPreviewTrace;
  dates: string[];
  isSmDown: boolean;
}

function PreviewTraceChart({ row, trace, dates, isSmDown }: PreviewTraceChartProps) {
  const binaryTrace = isBinaryPreviewTrace(trace);
  const stroke = previewTraceColor(trace.kind);

  const data = useMemo(() => (
    dates.map((date, index) => {
      const rawValue = trace.values[index] ?? null;
      const value = typeof rawValue === 'boolean'
        ? (rawValue ? 1 : 0)
        : typeof rawValue === 'number' && Number.isFinite(rawValue)
          ? rawValue
          : null;
      return {
        Date: date,
        value,
        rawValue,
      };
    })
  ), [dates, trace.values]);

  const hasValues = data.some((point) => point.value != null);

  const yDomain = useMemo(() => {
    if (binaryTrace) return [0, 1] as [number, number];
    const values = data
      .map((point) => point.value)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (values.length === 0) return [0, 1] as [number, number];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = (max - min) * 0.05 || Math.max(Math.abs(max) * 0.05, 1);
    return [min - pad, max + pad] as [number, number];
  }, [binaryTrace, data]);

  return (
    <Paper variant="outlined" sx={{ p: isSmDown ? 1.25 : 1.5 }}>
      <Stack spacing={1.25}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
        >
          <Box>
            <Typography sx={{ fontWeight: 800 }}>
              {trace.kind === 'condition' && row.reference
                ? `${trace.label} (${row.reference})`
                : trace.label}
            </Typography>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
              <Chip label={trace.kind} size="small" variant="outlined" sx={{ textTransform: 'capitalize' }} />
              {row.reference && (
                <Chip label={row.reference} size="small" variant="outlined" sx={{ maxWidth: '100%' }} />
              )}
            </Stack>
          </Box>
          <Chip label={`Latest: ${row.displayValue}`} size="small" sx={{ fontWeight: 700 }} />
        </Stack>

        {!hasValues ? (
          <Typography variant="body2" color="text.secondary">
            No historical values available for this contributor in the preview window.
          </Typography>
        ) : (
          <Box sx={{ width: '100%', height: isSmDown ? 220 : 240 }}>
            <ResponsiveContainer>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.14} />
                <XAxis dataKey="Date" tick={{ fontSize: 11 }} minTickGap={30} />
                <YAxis
                  domain={yDomain}
                  ticks={binaryTrace ? [0, 1] : undefined}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value: number) => (
                    binaryTrace
                      ? trace.kind === 'output'
                        ? (value === 1 ? 'ON' : 'OFF')
                        : (value === 1 ? 'TRUE' : 'FALSE')
                      : formatGenericPreviewNumber(value)
                  )}
                  width={binaryTrace ? 56 : 72}
                />
                <Tooltip
                  labelFormatter={(label: string) => label}
                  formatter={(_, __, item: { payload?: { rawValue?: number | boolean | null } }) => [
                    formatPreviewTraceValue(item.payload?.rawValue ?? null, trace),
                    trace.label,
                  ]}
                  contentStyle={{
                    backgroundColor: 'rgba(15, 23, 42, 0.92)',
                    border: '1px solid rgba(148,163,184,0.2)',
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                />
                <Line
                  type={binaryTrace ? 'stepAfter' : 'monotone'}
                  dataKey="value"
                  stroke={stroke}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}

function formatSeriesValue(value: number | null, key: string): string {
  if (value == null) return '—';
  if (['BTCUSD', 'STH_REALIZED_PRICE', 'LTH_REALIZED_PRICE'].includes(key)) {
    return value.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: value >= 1000 ? 0 : 2,
    });
  }
  if (['CORE_ON', 'MACRO_ON', 'ACCUM_ON', 'PRICE_REGIME_ON', 'SIP_EXHAUSTED'].includes(key)) {
    return value === 1 ? 'ON' : 'OFF';
  }
  if (['VAL_SCORE', 'LIQ_SCORE', 'DXY_SCORE', 'CYCLE_SCORE'].includes(key)) {
    return String(value);
  }
  if (['SIP', 'US_LIQ_YOY', 'G3_YOY'].includes(key)) {
    return `${value.toFixed(2)}%`;
  }
  if (['WALCL', 'WTREGEN', 'RRPONTSYD', 'US_LIQ', 'US_LIQ_13W_DELTA', 'ECB_RAW', 'BOJ_RAW', 'G3_ASSETS'].includes(key)) {
    const abs = Math.abs(value);
    if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    return value.toLocaleString();
  }
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(value) < 0.01) return value.toExponential(2);
  return value.toFixed(Math.abs(value) < 10 ? 4 : 2);
}

interface SeriesDetailModalProps {
  open: boolean;
  onClose: () => void;
  seriesKey: string | null;
  accessToken: string | null;
  isSmDown: boolean;
}

function SeriesDetailModal({ open, onClose, seriesKey, accessToken, isSmDown }: SeriesDetailModalProps) {
  const [data, setData] = useState<Array<{ d: string; v: number | null }>>([]);
  const [latest, setLatest] = useState<{ d: string; v: number | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = useMemo(
    () => (seriesKey ? STRATEGY_SERIES_CATALOG.find((e) => e.key === seriesKey) ?? null : null),
    [seriesKey],
  );

  useEffect(() => {
    if (!open || !seriesKey || !accessToken) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData([]);
    setLatest(null);

    fetch(`/api/pro/series-detail?key=${encodeURIComponent(seriesKey)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Failed to load series data.');
        return json;
      })
      .then((json) => {
        if (cancelled) return;
        setData(json.data ?? []);
        setLatest(json.latest ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load series.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, seriesKey, accessToken]);

  const chartData = useMemo(() => {
    if (!data.length) return [];
    return data
      .filter((r) => r.v != null)
      .map((r) => ({ date: r.d, ts: new Date(r.d).getTime(), value: r.v! }));
  }, [data]);

  const lastPoint = chartData.length > 0 ? chartData[chartData.length - 1] : null;

  const yDomain = useMemo(() => {
    if (!chartData.length) return [0, 1] as [number, number];
    let min = Infinity;
    let max = -Infinity;
    for (const p of chartData) {
      if (p.value < min) min = p.value;
      if (p.value > max) max = p.value;
    }
    const pad = (max - min) * 0.05 || 1;
    return [min - pad, max + pad] as [number, number];
  }, [chartData]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={isSmDown}
      fullWidth
      maxWidth="md"
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          m: isSmDown ? 0 : 2,
          width: isSmDown ? '100%' : undefined,
          maxHeight: isSmDown ? '100%' : 'calc(100% - 32px)',
        },
      }}
    >
      <DialogContent sx={{ p: isSmDown ? 1.5 : 3 }}>
        <Stack spacing={2}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box>
              <Typography variant={isSmDown ? 'h6' : 'h5'} sx={{ fontWeight: 900 }}>
                {meta?.label ?? seriesKey}
              </Typography>
              {meta && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                  {meta.description}
                </Typography>
              )}
              {meta && (
                <Stack direction="row" spacing={0.75} sx={{ mt: 0.75 }}>
                  <Chip label={meta.kind} size="small" variant="outlined" sx={{ textTransform: 'capitalize' }} />
                  <Chip label={meta.group} size="small" variant="outlined" sx={{ textTransform: 'capitalize' }} />
                </Stack>
              )}
            </Box>
            <IconButton onClick={onClose} aria-label="Close series detail" sx={{ mt: -0.5 }}>
              <X size={18} />
            </IconButton>
          </Stack>

          {latest && (
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                display: 'flex',
                alignItems: 'baseline',
                gap: 1.5,
                borderColor: 'primary.main',
                bgcolor: 'rgba(96,165,250,0.06)',
              }}
            >
              <Typography variant="overline" sx={{ fontWeight: 700 }}>
                Latest ({latest.d})
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 900, fontFamily: 'monospace' }}>
                {formatSeriesValue(latest.v, seriesKey ?? '')}
              </Typography>
            </Paper>
          )}

          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={32} />
            </Box>
          )}

          {error && <Alert severity="error">{error}</Alert>}

          {!loading && !error && chartData.length > 0 && (
            <Box sx={{ width: '100%', height: isSmDown ? '50vh' : 340 }}>
              <ResponsiveContainer>
                <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="seriesGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.12} />
                  <XAxis
                    dataKey="ts"
                    scale="time"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(ts: number) => {
                      const d = new Date(ts);
                      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    }}
                    tick={{ fontSize: 11 }}
                    minTickGap={40}
                  />
                  <YAxis domain={yDomain} tick={{ fontSize: 11 }} width={60} />
                  <Tooltip
                    labelFormatter={(ts: number) => new Date(ts).toISOString().slice(0, 10)}
                    formatter={(v: number) => [formatSeriesValue(v, seriesKey ?? ''), meta?.label ?? seriesKey]}
                    contentStyle={{
                      backgroundColor: 'rgba(15, 23, 42, 0.92)',
                      border: '1px solid rgba(148,163,184,0.2)',
                      borderRadius: 8,
                      fontSize: 13,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#60a5fa"
                    strokeWidth={1.8}
                    fill="url(#seriesGrad)"
                    dot={false}
                    activeDot={{ r: 4, stroke: '#60a5fa', strokeWidth: 2, fill: '#0f172a' }}
                  />
                  {lastPoint && (
                    <ReferenceDot
                      x={lastPoint.ts}
                      y={lastPoint.value}
                      r={6}
                      fill="#60a5fa"
                      stroke="#fff"
                      strokeWidth={2}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          )}

          {!loading && !error && chartData.length === 0 && data.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
              No historical data available for this series.
            </Typography>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

export default StrategyBuilder;
