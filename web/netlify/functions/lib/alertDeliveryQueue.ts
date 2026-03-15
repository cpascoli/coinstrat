import {
  listPendingSignalAlertDeliveries,
  sendPendingSignalAlertDelivery,
  type PendingSignalAlertDelivery,
} from './signalAlerts';
import {
  listPendingStrategyAlertDeliveries,
  sendPendingStrategyAlertDelivery,
  type PendingStrategyAlertDelivery,
} from './strategyAlerts';

type PendingAlertDelivery = PendingSignalAlertDelivery | PendingStrategyAlertDelivery;

export interface AlertDeliveryRunSummary {
  limit: number;
  backlogBefore: number;
  readyBefore: number;
  attempted: number;
  sent: number;
  failed: number;
  remainingBacklog: number;
  signalBacklog: number;
  strategyBacklog: number;
}

function sortQueue(left: PendingAlertDelivery, right: PendingAlertDelivery): number {
  if (left.sortAt === right.sortAt) {
    return left.kind.localeCompare(right.kind);
  }

  return left.sortAt.localeCompare(right.sortAt);
}

export async function processPendingAlertDeliveries(limit = 50): Promise<AlertDeliveryRunSummary> {
  const [signalPending, strategyPending] = await Promise.all([
    listPendingSignalAlertDeliveries(),
    listPendingStrategyAlertDeliveries(),
  ]);

  const backlogBefore = signalPending.length + strategyPending.length;
  const readyQueue = [...signalPending, ...strategyPending]
    .filter((delivery) => delivery.isReady)
    .sort(sortQueue);
  const selectedQueue = readyQueue.slice(0, limit);

  let attempted = 0;
  let sent = 0;
  let failed = 0;

  for (const delivery of selectedQueue) {
    attempted += 1;

    const result = delivery.kind === 'signal'
      ? await sendPendingSignalAlertDelivery(delivery)
      : await sendPendingStrategyAlertDelivery(delivery);

    if (result.status === 'sent') {
      sent += 1;
    } else {
      failed += 1;
    }
  }

  return {
    limit,
    backlogBefore,
    readyBefore: readyQueue.length,
    attempted,
    sent,
    failed,
    remainingBacklog: Math.max(backlogBefore - sent, 0),
    signalBacklog: signalPending.length,
    strategyBacklog: strategyPending.length,
  };
}
