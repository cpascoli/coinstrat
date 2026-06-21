import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const defaultFromEmail = process.env.RESEND_FROM_EMAIL || 'alerts@coinstrat.xyz';

/**
 * Resend's default send limit is 5 requests/second across the account. Alert
 * and strategy-alert workflows fan out to many recipients, so we (a) globally
 * pace every transactional send through a shared rate gate to stay under that
 * ceiling, and (b) retry messages that still come back rate-limited (429).
 *
 * The Resend SDK resolves (does NOT throw) on API-level errors, returning
 * `{ data: null, error }`, so we must inspect `error` explicitly — otherwise a
 * 429 would be mistaken for a successful send.
 */
const MIN_SEND_INTERVAL_MS = 250; // ~4 requests/second, safely under Resend's 5/s
const MAX_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 1100;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Shared scheduling cursor: each send reserves the next slot >= MIN_SEND_INTERVAL_MS
// after the previous one. Updated synchronously so concurrent callers serialize.
let nextSlotAt = 0;

async function acquireSendSlot(): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, nextSlotAt);
  nextSlotAt = start + MIN_SEND_INTERVAL_MS;
  const delay = start - now;
  if (delay > 0) await sleep(delay);
}

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { statusCode?: number; name?: string; message?: string };
  return (
    e.statusCode === 429 ||
    e.name === 'rate_limit_exceeded' ||
    /rate limit|too many requests/i.test(e.message ?? '')
  );
}

export interface TransactionalEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
}

export function getDefaultAlertFromEmail(): string {
  return defaultFromEmail;
}

export async function sendTransactionalEmail(input: TransactionalEmail): Promise<{
  ok: boolean;
  errorSummary: string | null;
}> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await acquireSendSlot();
      const { error } = await resend.emails.send({
        from: input.from ?? defaultFromEmail,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });

      if (!error) {
        return { ok: true, errorSummary: null };
      }

      // Back off and retry on rate-limit (429); fail for anything else.
      if (isRateLimitError(error) && attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
        continue;
      }

      return {
        ok: false,
        errorSummary: error.message || JSON.stringify(error),
      };
    } catch (error) {
      // Network-level rejection: retry rate-limit-ish failures, else surface.
      if (isRateLimitError(error) && attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
        continue;
      }
      return {
        ok: false,
        errorSummary: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
