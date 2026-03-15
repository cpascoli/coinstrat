import { buildNextAlertRetryAt, isAlertRetryReady } from './alertDeliveryRetry';
import { isPaidTier, serviceSupabase, type AppTier } from './auth';
import { getDefaultAlertFromEmail, sendTransactionalEmail } from './emailDelivery';

export const ALERT_KEYS = [
  'CORE_ON',
  'MACRO_ON',
  'PRICE_REGIME_ON',
  'VAL_SCORE',
  'LIQ_SCORE',
  'CYCLE_SCORE',
  'DXY_SCORE',
] as const;

export type AlertKey = typeof ALERT_KEYS[number];

export interface SignalAlertSubscription {
  user_id: string;
  email: string;
  enabled: boolean;
  alert_keys: AlertKey[];
  unsubscribe_token: string;
}

export interface AlertChange {
  alertKey: AlertKey;
  signalDate: string;
  previousValue: string;
  newValue: string;
  row: Record<string, unknown>;
}

export interface PendingSignalAlertDelivery {
  kind: 'signal';
  eventId: string;
  userId: string;
  email: string;
  unsubscribeToken: string;
  change: AlertChange;
  attemptCount: number;
  nextRetryAt: string | null;
  sortAt: string;
  isReady: boolean;
}

interface AlertKeyConfig {
  label: string;
  shortLabel: string;
  explanation: string;
  kind: 'binary' | 'score';
}

const fromEmail = getDefaultAlertFromEmail();
const appUrl = process.env.VITE_APP_URL || 'https://coinstrat.xyz';

const ALERT_CONFIG: Record<AlertKey, AlertKeyConfig> = {
  CORE_ON: {
    label: 'Core Accumulation',
    shortLabel: 'Core Accumulation',
    explanation: 'The long-term accumulation engine that combines valuation and trend confirmation.',
    kind: 'binary',
  },
  MACRO_ON: {
    label: 'Macro Accelerator',
    shortLabel: 'Macro Accelerator',
    explanation: 'The macro overlay that increases conviction when liquidity and cycle conditions are supportive.',
    kind: 'binary',
  },
  PRICE_REGIME_ON: {
    label: 'Price Regime',
    shortLabel: 'Price Regime',
    explanation: 'The trend regime that checks whether BTC is trading above its long-term trend filter.',
    kind: 'binary',
  },
  VAL_SCORE: {
    label: 'Valuation Score',
    shortLabel: 'Valuation',
    explanation: 'The valuation score that reflects whether BTC looks cheap, neutral, or expensive versus history.',
    kind: 'score',
  },
  LIQ_SCORE: {
    label: 'Liquidity Score',
    shortLabel: 'Liquidity',
    explanation: 'The liquidity score that tracks whether macro liquidity is a headwind or tailwind.',
    kind: 'score',
  },
  CYCLE_SCORE: {
    label: 'Business Cycle Score',
    shortLabel: 'Cycle',
    explanation: 'The business-cycle score that tracks recession and growth stress conditions.',
    kind: 'score',
  },
  DXY_SCORE: {
    label: 'Dollar Regime Score',
    shortLabel: 'Dollar',
    explanation: 'The dollar regime score that reflects whether the dollar backdrop is hostile or supportive for BTC.',
    kind: 'score',
  },
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeAlertKeys(keys: unknown): AlertKey[] {
  if (!Array.isArray(keys)) return [];

  const allowed = new Set<AlertKey>(ALERT_KEYS);
  const next = new Set<AlertKey>();
  for (const key of keys) {
    if (typeof key === 'string' && allowed.has(key as AlertKey)) {
      next.add(key as AlertKey);
    }
  }

  return ALERT_KEYS.filter((key) => next.has(key));
}

function asStringValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  return String(value);
}

function formatAlertValue(key: AlertKey, value: string): string {
  const config = ALERT_CONFIG[key];
  if (config.kind === 'binary') {
    return value === '1' ? 'ON' : 'OFF';
  }
  return value;
}

function buildEventKey(change: AlertChange): string {
  return `${change.signalDate}:${change.alertKey}:${change.previousValue}:${change.newValue}`;
}

function buildAlertSubject(change: AlertChange): string {
  const config = ALERT_CONFIG[change.alertKey];
  return `${config.label} changed on ${change.signalDate}`;
}

function buildAlertHeading(change: AlertChange): string {
  const config = ALERT_CONFIG[change.alertKey];
  if (config.kind === 'binary') {
    return `${config.label} switched ${formatAlertValue(change.alertKey, change.newValue)}`;
  }
  return `${config.label} moved from ${change.previousValue} to ${change.newValue}`;
}

function buildAlertExplanation(change: AlertChange): string {
  const config = ALERT_CONFIG[change.alertKey];
  if (config.kind === 'binary') {
    return `${config.explanation} It just moved from ${formatAlertValue(change.alertKey, change.previousValue)} to ${formatAlertValue(change.alertKey, change.newValue)}.`;
  }
  return `${config.explanation} It just moved from ${change.previousValue} to ${change.newValue}.`;
}

function buildManageAlertsUrl(): string {
  return `${appUrl}/profile`;
}

function buildAlertUnsubscribeUrl(token: string): string {
  return `${appUrl}/alerts/unsubscribe?token=${encodeURIComponent(token)}`;
}

function renderAlertEmailHtml(change: AlertChange, unsubscribeToken: string): string {
  const heading = buildAlertHeading(change);
  const explanation = buildAlertExplanation(change);
  const previousLabel = formatAlertValue(change.alertKey, change.previousValue);
  const nextLabel = formatAlertValue(change.alertKey, change.newValue);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(buildAlertSubject(change))}</title>
  </head>
  <body style="margin:0;background:#020617;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e2e8f0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#020617;padding:16px 10px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#0f172a;border:1px solid rgba(148,163,184,0.18);border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:24px 24px 18px 24px;border-bottom:1px solid rgba(148,163,184,0.12);">
                <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#93c5fd;font-weight:700;">CoinStrat Pro Alert</div>
                <div style="font-size:28px;line-height:1.2;font-weight:800;color:#f8fafc;margin-top:10px;">${escapeHtml(heading)}</div>
                <div style="font-size:15px;line-height:1.7;color:#cbd5e1;margin-top:10px;">${escapeHtml(explanation)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 10px;">
                  <tr>
                    <td style="width:34%;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;">Signal</td>
                    <td style="font-size:15px;color:#f8fafc;font-weight:700;">${escapeHtml(ALERT_CONFIG[change.alertKey].label)}</td>
                  </tr>
                  <tr>
                    <td style="font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;">Changed on</td>
                    <td style="font-size:15px;color:#f8fafc;font-weight:700;">${escapeHtml(change.signalDate)}</td>
                  </tr>
                  <tr>
                    <td style="font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;">Previous</td>
                    <td style="font-size:15px;color:#f8fafc;font-weight:700;">${escapeHtml(previousLabel)}</td>
                  </tr>
                  <tr>
                    <td style="font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;">New</td>
                    <td style="font-size:15px;color:#86efac;font-weight:800;">${escapeHtml(nextLabel)}</td>
                  </tr>
                </table>

                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:20px;">
                  <tr>
                    <td style="border-radius:999px;background:#2563eb;">
                      <a href="${buildManageAlertsUrl()}" style="display:inline-block;padding:12px 18px;color:#ffffff;text-decoration:none;font-weight:700;">Open dashboard</a>
                    </td>
                  </tr>
                </table>

                <div style="font-size:13px;line-height:1.7;color:#94a3b8;margin-top:22px;">
                  Manage which signals you track in your profile.
                  <a href="${buildManageAlertsUrl()}" style="color:#93c5fd;text-decoration:none;">Manage alerts</a>
                  or
                  <a href="${buildAlertUnsubscribeUrl(unsubscribeToken)}" style="color:#93c5fd;text-decoration:none;">unsubscribe from alert emails</a>.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderAlertEmailText(change: AlertChange, unsubscribeToken: string): string {
  const previousLabel = formatAlertValue(change.alertKey, change.previousValue);
  const nextLabel = formatAlertValue(change.alertKey, change.newValue);

  return [
    `CoinStrat Pro Alert`,
    '',
    buildAlertHeading(change),
    buildAlertExplanation(change),
    '',
    `Signal: ${ALERT_CONFIG[change.alertKey].label}`,
    `Changed on: ${change.signalDate}`,
    `Previous: ${previousLabel}`,
    `New: ${nextLabel}`,
    '',
    `Open dashboard: ${buildManageAlertsUrl()}`,
    `Manage alerts: ${buildManageAlertsUrl()}`,
    `Unsubscribe from alerts: ${buildAlertUnsubscribeUrl(unsubscribeToken)}`,
  ].join('\n');
}

export function detectAlertChanges(rows: Array<Record<string, unknown> | null | undefined>): AlertChange[] {
  if (rows.length < 2) return [];

  const changes: AlertChange[] = [];

  for (let idx = 1; idx < rows.length; idx += 1) {
    const previousRow = rows[idx - 1];
    const currentRow = rows[idx];
    if (!previousRow || !currentRow) continue;

    const signalDate = typeof currentRow.Date === 'string' ? currentRow.Date : '';
    if (!signalDate) continue;

    for (const alertKey of ALERT_KEYS) {
      const previousValue = asStringValue(previousRow[alertKey]);
      const newValue = asStringValue(currentRow[alertKey]);

      if (!previousValue && !newValue) continue;
      if (previousValue === newValue) continue;

      changes.push({
        alertKey,
        signalDate,
        previousValue,
        newValue,
        row: currentRow,
      });
    }
  }

  return changes;
}

export async function getSignalAlertPreferences(userId: string): Promise<SignalAlertSubscription | null> {
  const profile = await serviceSupabase
    .from('profiles')
    .select('id, email, tier')
    .eq('id', userId)
    .maybeSingle();

  if (profile.error || !profile.data?.email) return null;

  const subscription = await serviceSupabase
    .from('signal_alert_subscriptions')
    .select('user_id, email, enabled, alert_keys, unsubscribe_token')
    .eq('user_id', userId)
    .maybeSingle();

  if (subscription.error) {
    throw new Error(subscription.error.message);
  }

  if (!subscription.data) {
    return {
      user_id: userId,
      email: normalizeEmail(profile.data.email),
      enabled: false,
      alert_keys: [],
      unsubscribe_token: '',
    };
  }

  return {
    user_id: subscription.data.user_id,
    email: normalizeEmail(subscription.data.email),
    enabled: Boolean(subscription.data.enabled),
    alert_keys: normalizeAlertKeys(subscription.data.alert_keys),
    unsubscribe_token: subscription.data.unsubscribe_token,
  };
}

export async function saveSignalAlertPreferences(
  userId: string,
  input: { enabled: boolean; alertKeys: unknown },
): Promise<SignalAlertSubscription> {
  const { data: profile, error: profileError } = await serviceSupabase
    .from('profiles')
    .select('id, email, tier')
    .eq('id', userId)
    .maybeSingle();

  if (profileError || !profile?.email) {
    throw new Error(profileError?.message ?? 'Profile not found.');
  }

  if (!isPaidTier(profile.tier as AppTier)) {
    throw new Error('Signal alerts require a Pro or Lifetime subscription.');
  }

  const alertKeys = normalizeAlertKeys(input.alertKeys);
  const enabled = Boolean(input.enabled) && alertKeys.length > 0;

  const { data, error } = await serviceSupabase
    .from('signal_alert_subscriptions')
    .upsert({
      user_id: userId,
      email: normalizeEmail(profile.email),
      enabled,
      alert_keys: alertKeys,
      updated_at: new Date().toISOString(),
    })
    .select('user_id, email, enabled, alert_keys, unsubscribe_token')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Unable to save alert preferences.');
  }

  return {
    user_id: data.user_id,
    email: normalizeEmail(data.email),
    enabled: Boolean(data.enabled),
    alert_keys: normalizeAlertKeys(data.alert_keys),
    unsubscribe_token: data.unsubscribe_token,
  };
}

export async function unsubscribeSignalAlerts(token: string): Promise<string> {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    throw new Error('Missing unsubscribe token.');
  }

  const { data, error } = await serviceSupabase
    .from('signal_alert_subscriptions')
    .update({
      enabled: false,
      updated_at: new Date().toISOString(),
    })
    .eq('unsubscribe_token', normalizedToken)
    .select('email')
    .single();

  if (error || !data?.email) {
    throw new Error(error?.message ?? 'Alert subscription not found.');
  }

  return normalizeEmail(data.email);
}

function mapEventRowToChange(row: any): AlertChange {
  return {
    alertKey: row.alert_key as AlertKey,
    signalDate: row.signal_date as string,
    previousValue: row.previous_value ?? '',
    newValue: row.new_value ?? '',
    row: row.row_json ?? {},
  };
}

async function upsertSignalAlertDelivery(params: {
  eventId: string;
  userId: string;
  email: string;
  status: 'sent' | 'failed';
  attemptCount: number;
  lastAttemptAt: string;
  nextRetryAt: string | null;
  errorSummary: string | null;
}): Promise<void> {
  const { error } = await serviceSupabase
    .from('signal_alert_deliveries')
    .upsert({
      event_id: params.eventId,
      user_id: params.userId,
      email: params.email,
      provider: 'resend',
      status: params.status,
      sent_at: params.status === 'sent' ? params.lastAttemptAt : null,
      attempt_count: params.attemptCount,
      last_attempt_at: params.lastAttemptAt,
      next_retry_at: params.nextRetryAt,
      error_summary: params.errorSummary,
    }, { onConflict: 'event_id,user_id' });

  if (error) {
    throw new Error(error.message);
  }
}

export async function persistSignalAlertChanges(changes: AlertChange[]): Promise<{ events: number; deliveries: number }> {
  let eventsCreated = 0;

  for (const change of changes) {
    const eventPayload = {
      event_key: buildEventKey(change),
      alert_key: change.alertKey,
      signal_date: change.signalDate,
      previous_value: change.previousValue || null,
      new_value: change.newValue || null,
      row_json: change.row,
    };

    const { data: eventRow, error: eventError } = await serviceSupabase
      .from('signal_alert_events')
      .upsert(eventPayload, { onConflict: 'event_key' })
      .select('id, event_key')
      .single();

    if (eventError || !eventRow) {
      throw new Error(eventError?.message ?? 'Failed to create signal alert event.');
    }

    eventsCreated += 1;
  }

  return { events: eventsCreated, deliveries: 0 };
}

export async function listPendingSignalAlertDeliveries(): Promise<PendingSignalAlertDelivery[]> {
  const { data: eventRows, error: eventsError } = await serviceSupabase
    .from('signal_alert_events')
    .select('id, alert_key, signal_date, previous_value, new_value, row_json, detected_at')
    .order('signal_date', { ascending: true })
    .order('detected_at', { ascending: true });

  if (eventsError) {
    throw new Error(eventsError.message);
  }
  if (!eventRows?.length) {
    return [];
  }

  const { data: subscriptions, error: subscriptionError } = await serviceSupabase
    .from('signal_alert_subscriptions')
    .select('user_id, email, enabled, alert_keys, unsubscribe_token')
    .eq('enabled', true);

  if (subscriptionError) {
    throw new Error(subscriptionError.message);
  }
  if (!subscriptions?.length) {
    return [];
  }

  const userIds = subscriptions.map((subscription) => subscription.user_id);
  const eventIds = eventRows.map((row) => row.id);

  const { data: profiles, error: profilesError } = await serviceSupabase
    .from('profiles')
    .select('id, tier')
    .in('id', userIds);

  if (profilesError) {
    throw new Error(profilesError.message);
  }

  const { data: deliveryRows, error: deliveriesError } = await serviceSupabase
    .from('signal_alert_deliveries')
    .select('event_id, user_id, status, attempt_count, next_retry_at')
    .in('event_id', eventIds);

  if (deliveriesError) {
    throw new Error(deliveriesError.message);
  }

  const eligibleUsers = new Set(
    (profiles ?? [])
      .filter((profile) => isPaidTier(profile.tier as AppTier))
      .map((profile) => profile.id),
  );

  const deliveriesByKey = new Map(
    (deliveryRows ?? []).map((row: any) => [
      `${row.event_id}:${row.user_id}`,
      {
        status: row.status as 'sent' | 'failed',
        attemptCount: Number(row.attempt_count ?? 0),
        nextRetryAt: (row.next_retry_at as string | null | undefined) ?? null,
      },
    ]),
  );

  return eventRows.flatMap((row: any) => {
    const alertKey = row.alert_key as AlertKey;
    const change = mapEventRowToChange(row);

    return subscriptions.flatMap((subscription) => {
      if (!eligibleUsers.has(subscription.user_id)) return [];
      if (!normalizeAlertKeys(subscription.alert_keys).includes(alertKey)) return [];

      const delivery = deliveriesByKey.get(`${row.id}:${subscription.user_id}`);
      if (delivery?.status === 'sent') return [];

      return [{
        kind: 'signal' as const,
        eventId: row.id as string,
        userId: subscription.user_id as string,
        email: normalizeEmail(subscription.email as string),
        unsubscribeToken: subscription.unsubscribe_token as string,
        change,
        attemptCount: delivery?.attemptCount ?? 0,
        nextRetryAt: delivery?.nextRetryAt ?? null,
        sortAt: (row.detected_at as string | undefined) ?? (row.signal_date as string),
        isReady: isAlertRetryReady(delivery?.nextRetryAt ?? null),
      }];
    });
  });
}

export async function sendPendingSignalAlertDelivery(delivery: PendingSignalAlertDelivery): Promise<{
  status: 'sent' | 'failed';
  errorSummary: string | null;
}> {
  const attemptedAt = new Date().toISOString();
  const attemptCount = delivery.attemptCount + 1;
  const result = await sendTransactionalEmail({
    from: fromEmail,
    to: delivery.email,
    subject: buildAlertSubject(delivery.change),
    html: renderAlertEmailHtml(delivery.change, delivery.unsubscribeToken),
    text: renderAlertEmailText(delivery.change, delivery.unsubscribeToken),
  });

  await upsertSignalAlertDelivery({
    eventId: delivery.eventId,
    userId: delivery.userId,
    email: delivery.email,
    status: result.ok ? 'sent' : 'failed',
    attemptCount,
    lastAttemptAt: attemptedAt,
    nextRetryAt: result.ok ? null : buildNextAlertRetryAt(new Date(attemptedAt)),
    errorSummary: result.errorSummary,
  });

  return {
    status: result.ok ? 'sent' : 'failed',
    errorSummary: result.errorSummary,
  };
}
