import type { Handler } from '@netlify/functions';
import { requireAdmin } from './lib/auth';
import { composeNewsletterIssue, setComposeJob } from './lib/newsletter';

/**
 * Background compose for the weekly newsletter.
 *
 * Composing runs OpenAI text generation (≤30s) + DALL·E image generation (≤35s)
 * + article sourcing, which together blow past Netlify's 26s synchronous cap.
 * The `-background` filename suffix makes Netlify run this asynchronously (it
 * returns 202 immediately and grants a 15-minute budget). The admin UI fires
 * this endpoint and then polls `GET /api/admin/newsletter?composeStatus=<week>`
 * for the job state we persist here.
 */
export const handler: Handler = async (event) => {
  // Background functions always resolve to 202 for the client; the return value
  // is ignored, so we gate the actual work on an admin token inside.
  const admin = await requireAdmin(event);
  if (!admin) {
    console.error('[admin-newsletter-background] Rejected non-admin invocation.');
    return { statusCode: 202, body: '' };
  }

  let body: { weekOf?: string; editor_note?: string | null; cta_label?: string | null; cta_href?: string | null } = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    body = {};
  }

  const weekOf = typeof body.weekOf === 'string' ? body.weekOf : '';
  if (!weekOf) {
    console.error('[admin-newsletter-background] Missing weekOf in request body.');
    return { statusCode: 202, body: '' };
  }

  const startedAt = Date.now();
  await setComposeJob(weekOf, { status: 'running', weekOf, startedAt });

  try {
    const issue = await composeNewsletterIssue({
      actorId: admin.id,
      weekOf,
      editorNote: body.editor_note ?? null,
      ctaLabel: body.cta_label ?? null,
      ctaHref: body.cta_href ?? null,
    });

    await setComposeJob(weekOf, {
      status: 'done',
      weekOf,
      startedAt,
      finishedAt: Date.now(),
      issueId: issue.id,
    });
  } catch (err: any) {
    console.error('[admin-newsletter-background]', err);
    await setComposeJob(weekOf, {
      status: 'error',
      weekOf,
      startedAt,
      finishedAt: Date.now(),
      error: err?.message ?? 'Newsletter compose failed.',
    });
  }

  return { statusCode: 202, body: '' };
};
