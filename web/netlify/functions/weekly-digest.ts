import type { Handler } from '@netlify/functions';
import { authorizeAdminOrCron } from './lib/auth';
import {
  getAutomaticNewsletterStatus,
  getIssueById,
  getIssueByWeek,
  getNewsletterSettings,
  runAutomaticNewsletterSend,
  sendNewsletterIssue,
} from './lib/newsletter';

// Composing is NOT handled here: it exceeds Netlify's synchronous cap, so it
// only runs inside background functions (`admin-newsletter-background` for the
// admin UI, `newsletter-send-background` for the weekly auto-send).
type DigestAction = 'auto_send' | 'status' | 'preview' | 'send' | 'send_test';

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const auth = await authorizeAdminOrCron(event);
  if (!auth) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const action = (body.action as DigestAction | undefined) ?? 'auto_send';

    switch (action) {
      case 'status': {
        const result = await getAutomaticNewsletterStatus();
        return {
          statusCode: 200,
          body: JSON.stringify(result),
        };
      }
      case 'auto_send': {
        const result = await runAutomaticNewsletterSend();
        return {
          statusCode: 200,
          body: JSON.stringify(result),
        };
      }
      case 'preview': {
        let issue = body.issueId ? await getIssueById(body.issueId) : null;
        if (!issue && body.weekOf) {
          issue = await getIssueByWeek(body.weekOf);
        }

        if (!issue) {
          return { statusCode: 404, body: JSON.stringify({ error: 'Newsletter issue not found.' }) };
        }

        return {
          statusCode: 200,
          body: JSON.stringify({
            ok: true,
            issue: {
              id: issue.id,
              subject: issue.subject,
              preview_text: issue.preview_text,
              html: issue.html,
              text: issue.text,
            },
          }),
        };
      }
      case 'send':
      case 'send_test': {
        if (auth.kind !== 'admin') {
          return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required.' }) };
        }

        let issue = body.issueId ? await getIssueById(body.issueId) : null;
        if (!issue && body.weekOf) {
          issue = await getIssueByWeek(body.weekOf);
        }

        if (!issue) {
          return { statusCode: 404, body: JSON.stringify({ error: 'Newsletter issue not found.' }) };
        }

        const settings = await getNewsletterSettings();
        const result = await sendNewsletterIssue({
          issue,
          settings,
          mode: action === 'send' ? 'broadcast' : 'test',
          testRecipient: action === 'send_test' ? auth.user.email : null,
        });
        const freshIssue = await getIssueById(issue.id);

        return {
          statusCode: 200,
          body: JSON.stringify({
            ok: true,
            issue: freshIssue,
            result,
          }),
        };
      }
      default:
        return { statusCode: 400, body: JSON.stringify({ error: 'Unsupported digest action.' }) };
    }
  } catch (err: any) {
    console.error('[weekly-digest]', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
