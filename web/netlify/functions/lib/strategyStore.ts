import type { StrategyAlertMode, StrategySpec, StrategyStatus } from '../../../src/lib/strategyBuilder';
import { serviceSupabase } from './auth';

export interface StoredStrategy {
  id: string;
  user_id: string;
  name: string;
  description: string;
  status: StrategyStatus;
  prompt: string;
  active_version_id: string | null;
  last_previewed_at: string | null;
  last_evaluated_at: string | null;
  latest_signal_value: number | null;
  latest_signal_date: string | null;
  created_at: string;
  updated_at: string;
  spec: StrategySpec | null;
  alert: {
    id: string | null;
    enabled: boolean;
    mode: StrategyAlertMode;
    unsubscribe_token: string | null;
  };
}

export interface StrategyAlertEventRecord {
  id: string;
  strategy_id: string;
  strategy_version_id: string;
  signal_date: string;
  previous_value: number;
  new_value: number;
  event_key: string;
}

function mapStoredStrategy(row: any): StoredStrategy {
  const versionRow = Array.isArray(row.user_strategy_versions)
    ? row.user_strategy_versions[0]
    : row.user_strategy_versions;
  const alertRow = Array.isArray(row.user_strategy_alerts)
    ? row.user_strategy_alerts[0]
    : row.user_strategy_alerts;

  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    description: row.description,
    status: row.status,
    prompt: row.prompt,
    active_version_id: row.active_version_id,
    last_previewed_at: row.last_previewed_at,
    last_evaluated_at: row.last_evaluated_at,
    latest_signal_value: row.latest_signal_value,
    latest_signal_date: row.latest_signal_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
    spec: versionRow?.spec_json ?? null,
    alert: {
      id: alertRow?.id ?? null,
      enabled: Boolean(alertRow?.enabled),
      mode: alertRow?.mode ?? 'disabled',
      unsubscribe_token: alertRow?.unsubscribe_token ?? null,
    },
  };
}

export async function listUserStrategies(userId: string): Promise<StoredStrategy[]> {
  const { data, error } = await serviceSupabase
    .from('user_strategies')
    .select(`
      *,
      user_strategy_versions!user_strategies_active_version_id_fkey(spec_json),
      user_strategy_alerts(*)
    `)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapStoredStrategy);
}

export async function getStrategyById(strategyId: string): Promise<StoredStrategy | null> {
  const { data, error } = await serviceSupabase
    .from('user_strategies')
    .select(`
      *,
      user_strategy_versions!user_strategies_active_version_id_fkey(spec_json),
      user_strategy_alerts(*)
    `)
    .eq('id', strategyId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? mapStoredStrategy(data) : null;
}

export async function countUserStrategies(userId: string): Promise<number> {
  const { count, error } = await serviceSupabase
    .from('user_strategies')
    .select('id', { head: true, count: 'exact' })
    .eq('user_id', userId);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function saveUserStrategy(params: {
  strategyId?: string;
  userId: string;
  name: string;
  description: string;
  prompt: string;
  status: StrategyStatus;
  spec: StrategySpec;
  alertEnabled: boolean;
  alertMode: StrategyAlertMode;
}): Promise<StoredStrategy> {
  const { data: profileRow, error: profileError } = await serviceSupabase
    .from('profiles')
    .select('email')
    .eq('id', params.userId)
    .single();
  if (profileError || !profileRow?.email) {
    throw new Error(profileError?.message ?? 'Unable to resolve strategy owner email.');
  }

  const strategyPayload = {
    user_id: params.userId,
    name: params.name,
    description: params.description,
    prompt: params.prompt,
    status: params.status,
    last_previewed_at: new Date().toISOString(),
  };

  let strategyId = params.strategyId ?? null;
  if (strategyId) {
    const { error } = await serviceSupabase
      .from('user_strategies')
      .update(strategyPayload)
      .eq('id', strategyId)
      .eq('user_id', params.userId);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await serviceSupabase
      .from('user_strategies')
      .insert(strategyPayload)
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Unable to create strategy.');
    strategyId = data.id;
  }

  const { data: versionRow, error: versionError } = await serviceSupabase
    .from('user_strategy_versions')
    .insert({
      strategy_id: strategyId,
      prompt: params.prompt,
      spec_json: params.spec,
      notes: params.description,
    })
    .select('id')
    .single();

  if (versionError || !versionRow) {
    throw new Error(versionError?.message ?? 'Unable to save strategy version.');
  }

  const { error: strategyUpdateError } = await serviceSupabase
    .from('user_strategies')
    .update({ active_version_id: versionRow.id })
    .eq('id', strategyId);
  if (strategyUpdateError) throw new Error(strategyUpdateError.message);

  const { error: alertError } = await serviceSupabase
    .from('user_strategy_alerts')
    .upsert({
      strategy_id: strategyId,
      user_id: params.userId,
      email: profileRow.email,
      enabled: params.alertEnabled,
      mode: params.alertMode,
    }, { onConflict: 'strategy_id' });
  if (alertError) throw new Error(alertError.message);

  const strategy = await getStrategyById(strategyId);
  if (!strategy) throw new Error('Saved strategy could not be reloaded.');
  return strategy;
}

export async function deleteUserStrategy(strategyId: string, userId: string): Promise<void> {
  const { error } = await serviceSupabase
    .from('user_strategies')
    .delete()
    .eq('id', strategyId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

export async function saveStrategyEvaluation(params: {
  strategyId: string;
  strategyVersionId: string;
  currentSignal: number;
  latestDate: string | null;
  transitionCount: number;
  activeDays: number;
  previewJson: Record<string, unknown>;
}): Promise<void> {
  const evaluatedAt = new Date().toISOString();
  const { error: evalError } = await serviceSupabase
    .from('user_strategy_evaluations')
    .insert({
      strategy_id: params.strategyId,
      strategy_version_id: params.strategyVersionId,
      evaluated_at: evaluatedAt,
      latest_signal_value: params.currentSignal,
      latest_signal_date: params.latestDate,
      transition_count: params.transitionCount,
      active_days: params.activeDays,
      preview_json: params.previewJson,
    });
  if (evalError) throw new Error(evalError.message);

  const { error: strategyError } = await serviceSupabase
    .from('user_strategies')
    .update({
      last_evaluated_at: evaluatedAt,
      latest_signal_value: params.currentSignal,
      latest_signal_date: params.latestDate,
    })
    .eq('id', params.strategyId);
  if (strategyError) throw new Error(strategyError.message);
}

export async function listActiveStrategiesForEvaluation(): Promise<Array<StoredStrategy & {
  email: string | null;
}>> {
  const { data, error } = await serviceSupabase
    .from('user_strategies')
    .select(`
      *,
      profiles!user_strategies_user_id_fkey(email),
      user_strategy_versions!user_strategies_active_version_id_fkey(spec_json),
      user_strategy_alerts(*)
    `)
    .eq('status', 'active');

  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => {
    const profileRow = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      ...mapStoredStrategy(row),
      email: profileRow?.email ?? null,
    };
  });
}

export async function createStrategyAlertEvent(params: {
  strategyId: string;
  strategyVersionId: string;
  signalDate: string;
  previousValue: number;
  newValue: number;
}): Promise<StrategyAlertEventRecord | null> {
  const eventKey = `${params.strategyId}:${params.strategyVersionId}:${params.signalDate}:${params.previousValue}:${params.newValue}`;
  const { data: existing, error: existingError } = await serviceSupabase
    .from('user_strategy_alert_events')
    .select('*')
    .eq('event_key', eventKey)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return null;

  const { data, error } = await serviceSupabase
    .from('user_strategy_alert_events')
    .insert({
      strategy_id: params.strategyId,
      strategy_version_id: params.strategyVersionId,
      signal_date: params.signalDate,
      previous_value: params.previousValue,
      new_value: params.newValue,
      event_key: eventKey,
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return data as StrategyAlertEventRecord;
}

export async function createStrategyAlertDelivery(params: {
  eventId: string;
  strategyId: string;
  email: string;
  status: 'sent' | 'failed';
  errorSummary?: string | null;
}): Promise<void> {
  const { error } = await serviceSupabase
    .from('user_strategy_alert_deliveries')
    .upsert({
      event_id: params.eventId,
      strategy_id: params.strategyId,
      email: params.email,
      status: params.status,
      sent_at: params.status === 'sent' ? new Date().toISOString() : null,
      error_summary: params.errorSummary ?? null,
    }, { onConflict: 'event_id,strategy_id' });
  if (error) throw new Error(error.message);
}

export async function unsubscribeStrategyAlert(token: string): Promise<string> {
  const { data, error } = await serviceSupabase
    .from('user_strategy_alerts')
    .update({ enabled: false, mode: 'disabled' })
    .eq('unsubscribe_token', token)
    .select('email')
    .maybeSingle();

  if (error || !data?.email) throw new Error('Invalid or expired unsubscribe token.');
  return data.email;
}
