import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Bot, ChevronDown, ChevronUp, Save, Sparkles, Trash2, Wand2, Workflow } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  STRATEGY_SERIES_CATALOG,
  describeComparator,
  summarizeStrategySpec,
  validateStrategySpec,
  type StrategyAlertMode,
  type StrategyPreviewResult,
  type StrategySpec,
} from '../lib/strategyBuilder';

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
  const hasPaidAccess = tier === 'pro' || tier === 'pro_plus' || tier === 'lifetime';
  const [prompt, setPrompt] = useState('Alert me when BTC is above its 200 day moving average and MVRV is below 2.');
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
  const [showAdvancedDetails, setShowAdvancedDetails] = useState(false);
  const [strategies, setStrategies] = useState<StoredStrategy[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);
  const [loadingStrategies, setLoadingStrategies] = useState(false);
  const [busyAction, setBusyAction] = useState<'interpret' | 'preview' | 'save' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
  };

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
      setSuccess('Historical preview updated.');
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Unable to preview strategy.');
    } finally {
      setBusyAction(null);
    }
  };

  const saveStrategy = async () => {
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
        method: selectedStrategyId ? 'PUT' : 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          strategyId: selectedStrategyId,
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
      setSuccess(selectedStrategyId ? 'Strategy updated.' : 'Strategy saved.');
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
              <Chip label="Pro feature" size="small" variant="outlined" />
              <Chip label="LLM with guardrails" size="small" variant="outlined" icon={<Bot size={12} />} />
              <Chip label="Preview before save" size="small" variant="outlined" icon={<Sparkles size={12} />} />
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
                <Typography variant="h6" sx={{ fontWeight: 800 }}>1. Describe your strategy</Typography>
                <TextField
                  multiline
                  minRows={4}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Example: Alert me when BTC crosses above its 200 day moving average and MVRV is below 2."
                />
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
                    <Button
                      variant="outlined"
                      startIcon={<Save size={16} />}
                      onClick={() => void saveStrategy()}
                      disabled={!validation.ok || busyAction !== null}
                      sx={{ textTransform: 'none', fontWeight: 700 }}
                    >
                      {busyAction === 'save' ? 'Saving…' : selectedStrategyId ? 'Update strategy' : 'Save strategy'}
                    </Button>
                  ) : (
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
                  )}
                </Stack>
                {provider && (
                  <Typography variant="body2" color="text.secondary">
                    Interpretation provider: <strong>{provider}</strong>
                  </Typography>
                )}
              </Stack>
            </Paper>

            <Paper sx={{ p: 3 }}>
              <Stack spacing={2}>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>2. Historical preview</Typography>
                {!preview ? (
                  <Typography variant="body2" color="text.secondary">
                    Run a preview to inspect current state, signal flips, and the last year of signal history.
                  </Typography>
                ) : (
                  <>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Chip label={`Current state: ${preview.currentState}`} size="small" variant="outlined" />
                      {preview.latestDate && <Chip label={`Latest date: ${preview.latestDate}`} size="small" variant="outlined" />}
                      <Chip label={`Transitions: ${preview.summary.transitionCount}`} size="small" variant="outlined" />
                      <Chip label={`Active days: ${preview.summary.activeDays}`} size="small" variant="outlined" />
                    </Stack>

                    <Box sx={{ width: '100%', height: 280 }}>
                      <ResponsiveContainer>
                        <LineChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.16} />
                          <XAxis dataKey="Date" tick={{ fontSize: 12 }} minTickGap={30} />
                          <YAxis yAxisId="signal" domain={[0, 1]} ticks={[0, 1]} />
                          <YAxis yAxisId="btc" orientation="right" />
                          <Tooltip />
                          <Line yAxisId="signal" type="stepAfter" dataKey="signal" stroke="#60a5fa" dot={false} strokeWidth={2.2} />
                          <Line yAxisId="btc" type="monotone" dataKey="btcScaled" name="BTC (scaled)" stroke="#f59e0b" dot={false} strokeWidth={1.4} />
                        </LineChart>
                      </ResponsiveContainer>
                    </Box>

                    <Stack spacing={1}>
                      <Typography sx={{ fontWeight: 700 }}>Latest metric values</Typography>
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                        {preview.metrics.map((metric) => (
                          <Chip
                            key={metric.id}
                            label={`${metric.label}: ${metric.latestValue ?? 'n/a'}`}
                            size="small"
                            variant="outlined"
                          />
                        ))}
                      </Stack>
                    </Stack>

                    <Stack spacing={1}>
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
            </Paper>

            <Paper sx={{ p: 3 }}>
              <Stack spacing={2}>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>3. Review strategy details</Typography>
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
                                  {metric.window ? ` over ${metric.window}d` : ''}
                                  {metric.periods ? ` over ${metric.periods} periods` : ''}
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
                <Typography variant="h6" sx={{ fontWeight: 800 }}>Saved strategies</Typography>
                {loadingStrategies ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
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
            </Paper>

            <Paper sx={{ p: 3 }}>
              <Stack spacing={1.5}>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>Available series</Typography>
                <Typography variant="body2" color="text.secondary">
                  The builder only uses approved series and derived CoinStrat fields from the cached dataset.
                </Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  {STRATEGY_SERIES_CATALOG.map((entry) => (
                    <Chip key={entry.key} label={entry.label} size="small" variant="outlined" />
                  ))}
                </Stack>
              </Stack>
            </Paper>
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
};

export default StrategyBuilder;
