import type { SignalRow } from './compute';
import { buildNextAlertRetryAt } from './alertDeliveryRetry';
import { getDefaultAlertFromEmail, sendTransactionalEmail } from './emailDelivery';
import { evaluateStrategy } from './strategyEngine';
import {
  createStrategyAlertDelivery,
  createStrategyAlertEvent,
  listPendingStrategyAlertDeliveries as listPendingStrategyAlertDeliveryRows,
  listActiveStrategiesForEvaluation,
  saveStrategyEvaluation,
} from './strategyStore';
import type { PendingStrategyAlertDelivery } from './strategyStore';
import { assertNever, type StrategyAlertMode } from '../../../src/lib/strategyBuilder';

const fromEmail = getDefaultAlertFromEmail();
const appUrl = process.env.VITE_APP_URL || 'https://coinstrat.xyz';

function shouldSendAlert(mode: StrategyAlertMode, previousValue: number, newValue: number): boolean {
  switch (mode) {
    case 'disabled':
      return false;
    case 'state_change':
      return previousValue !== newValue;
    case 'turns_on':
      return previousValue === 0 && newValue === 1;
    case 'turns_off':
      return previousValue === 1 && newValue === 0;
    default:
      return assertNever(mode);
  }
}

function renderStrategyAlertEmail(params: {
  strategyName: string;
  signalDate: string;
  previousValue: number;
  newValue: number;
  unsubscribeToken: string | null;
}): { subject: string; text: string; html: string } {
  const subject = `${params.strategyName} changed on ${params.signalDate}`;
  const manageUrl = `${appUrl}/strategy-builder`;
  const unsubscribeUrl = params.unsubscribeToken
    ? `${appUrl}/alerts/strategies/unsubscribe?token=${encodeURIComponent(params.unsubscribeToken)}`
    : manageUrl;

  return {
    subject,
    text: [
      'CoinStrat Custom Strategy Alert',
      '',
      `Strategy: ${params.strategyName}`,
      `Date: ${params.signalDate}`,
      `Previous: ${params.previousValue}`,
      `New: ${params.newValue}`,
      '',
      `Manage strategies: ${manageUrl}`,
      `Unsubscribe: ${unsubscribeUrl}`,
    ].join('\n'),
    html: `<!doctype html>
<html>
  <body style="margin:0;background:#020617;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:20px;background:#020617;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#0f172a;border:1px solid rgba(148,163,184,0.18);border-radius:16px;">
            <tr>
              <td style="padding:24px;">
                <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#93c5fd;font-weight:700;">CoinStrat Custom Strategy</div>
                <h1 style="margin:12px 0 8px 0;font-size:28px;line-height:1.2;">${params.strategyName} changed</h1>
                <p style="margin:0 0 16px 0;color:#cbd5e1;">Your saved strategy changed state on ${params.signalDate}.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr><td style="padding:6px 0;color:#94a3b8;">Previous</td><td style="padding:6px 0;font-weight:700;">${params.previousValue}</td></tr>
                  <tr><td style="padding:6px 0;color:#94a3b8;">New</td><td style="padding:6px 0;font-weight:700;color:#86efac;">${params.newValue}</td></tr>
                </table>
                <p style="margin-top:20px;">
                  <a href="${manageUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 18px;text-decoration:none;border-radius:999px;font-weight:700;">Open strategy builder</a>
                </p>
                <p style="margin-top:18px;color:#94a3b8;font-size:13px;">
                  <a href="${unsubscribeUrl}" style="color:#93c5fd;text-decoration:none;">Unsubscribe from this strategy alert</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}

export async function evaluateActiveStrategies(rows: SignalRow[], recentDates: string[]): Promise<{
  strategies: number;
  events: number;
  deliveries: number;
}> {
  const activeStrategies = await listActiveStrategiesForEvaluation();
  const recentDateSet = new Set(recentDates);
  let events = 0;
  let deliveries = 0;

  for (const strategy of activeStrategies) {
    if (!strategy.spec || !strategy.active_version_id) continue;

    const preview = evaluateStrategy(rows, strategy.spec);
    await saveStrategyEvaluation({
      strategyId: strategy.id,
      strategyVersionId: strategy.active_version_id,
      currentSignal: preview.currentState,
      latestDate: preview.latestDate,
      transitionCount: preview.summary.transitionCount,
      activeDays: preview.summary.activeDays,
      previewJson: {
        rows: preview.rows.slice(-90),
        transitions: preview.transitions.slice(-25),
        metrics: preview.metrics,
        conditions: preview.conditions,
        summary: preview.summary,
      },
    });

    if (!strategy.alert.enabled || strategy.alert.mode === 'disabled' || !strategy.email) {
      continue;
    }

    const freshTransitions = preview.transitions.filter((transition) => recentDateSet.has(transition.Date));

    for (const transition of freshTransitions) {
      if (!shouldSendAlert(strategy.alert.mode, transition.previous, transition.next)) {
        continue;
      }

      const eventRecord = await createStrategyAlertEvent({
        strategyId: strategy.id,
        strategyVersionId: strategy.active_version_id,
        signalDate: transition.Date,
        previousValue: transition.previous,
        newValue: transition.next,
      });
      if (!eventRecord) continue;
      events += 1;
    }
  }

  return {
    strategies: activeStrategies.length,
    events,
    deliveries,
  };
}

export async function listPendingStrategyAlertDeliveries(): Promise<PendingStrategyAlertDelivery[]> {
  return listPendingStrategyAlertDeliveryRows();
}

export async function sendPendingStrategyAlertDelivery(delivery: PendingStrategyAlertDelivery): Promise<{
  status: 'sent' | 'failed';
  errorSummary: string | null;
}> {
  const attemptedAt = new Date().toISOString();
  const attemptCount = delivery.attemptCount + 1;
  const emailContent = renderStrategyAlertEmail({
    strategyName: delivery.strategyName,
    signalDate: delivery.signalDate,
    previousValue: delivery.previousValue,
    newValue: delivery.newValue,
    unsubscribeToken: delivery.unsubscribeToken,
  });

  const result = await sendTransactionalEmail({
    from: fromEmail,
    to: delivery.email,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  });

  await createStrategyAlertDelivery({
    eventId: delivery.eventId,
    strategyId: delivery.strategyId,
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

export type { PendingStrategyAlertDelivery } from './strategyStore';
