const ALERT_RETRY_DELAY_MS = 4 * 60 * 60 * 1000;

export function buildNextAlertRetryAt(now = new Date()): string {
  return new Date(now.getTime() + ALERT_RETRY_DELAY_MS).toISOString();
}

export function isAlertRetryReady(nextRetryAt: string | null | undefined, now = new Date()): boolean {
  if (!nextRetryAt) return true;

  const retryAtMs = new Date(nextRetryAt).getTime();
  if (Number.isNaN(retryAtMs)) return true;

  return retryAtMs <= now.getTime();
}
