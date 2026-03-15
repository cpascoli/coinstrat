import {
  listPendingSignalAlertDeliveries,
} from './signalAlerts';
import {
  listPendingStrategyAlertDeliveries,
} from './strategyAlerts';
import { processPendingAlertDeliveries, type AlertDeliveryRunSummary } from './alertDeliveryQueue';
import { runSignalRefresh, type SignalRefreshResult } from './signalRefreshRunner';

export interface ScheduledAlertsStatus {
  limit: number;
  backlogTotal: number;
  readyTotal: number;
  nextRunAttemptEstimate: number;
  signalBacklog: number;
  strategyBacklog: number;
}

export interface ScheduledAlertsWorkflowResult {
  ok: true;
  refresh: SignalRefreshResult;
  deliveries: AlertDeliveryRunSummary;
}

export async function getScheduledAlertsStatus(limit = 50): Promise<ScheduledAlertsStatus> {
  const [signalPending, strategyPending] = await Promise.all([
    listPendingSignalAlertDeliveries(),
    listPendingStrategyAlertDeliveries(),
  ]);

  const backlogTotal = signalPending.length + strategyPending.length;
  const readyTotal = [...signalPending, ...strategyPending].filter((delivery) => delivery.isReady).length;

  return {
    limit,
    backlogTotal,
    readyTotal,
    nextRunAttemptEstimate: Math.min(limit, readyTotal),
    signalBacklog: signalPending.length,
    strategyBacklog: strategyPending.length,
  };
}

export async function runScheduledAlertsWorkflow(limit = 50): Promise<ScheduledAlertsWorkflowResult> {
  const refresh = await runSignalRefresh('incremental');
  const deliveries = await processPendingAlertDeliveries(limit);

  return {
    ok: true,
    refresh,
    deliveries,
  };
}
