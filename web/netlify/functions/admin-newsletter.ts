import type { Handler } from '@netlify/functions';
import { requireAdmin } from './lib/auth';
import {
  composeNewsletterIssue,
  getIssueById,
  getIssueByWeek,
  getNewsletterDashboardData,
  getNewsletterSettings,
  sendNewsletterIssue,
  updateNewsletterSettings,
} from './lib/newsletter';

type AdminNewsletterAction = 'compose' | 'send' | 'send_test';

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, body: '' };
  }

  const admin = await requireAdmin(event);
  if (!admin) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required.' }) };
  }

  try {
    if (event.httpMethod === 'GET') {
      const weekOf = event.queryStringParameters?.weekOf;
      const data = await getNewsletterDashboardData(weekOf);
      return {
        statusCode: 200,
        body: JSON.stringify(data),
      };
    }

    if (event.httpMethod === 'PUT') {
      const body = JSON.parse(event.body || '{}');
      const settings = await updateNewsletterSettings({
        enabled: body.enabled,
        send_weekday: body.send_weekday,
        send_hour_utc: body.send_hour_utc,
        audience_mode: body.audience_mode,
        from_name: body.from_name,
        reply_to: body.reply_to,
      });
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, settings }),
      };
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const action = body.action as AdminNewsletterAction | undefined;

    switch (action) {
      case 'compose': {
        const issue = await composeNewsletterIssue({
          actorId: admin.id,
          weekOf: body.weekOf,
          editorNote: body.editor_note ?? null,
          ctaLabel: body.cta_label ?? null,
          ctaHref: body.cta_href ?? null,
          curatedLinks: Array.isArray(body.curated_links) ? body.curated_links : [],
        });

        return {
          statusCode: 200,
          body: JSON.stringify({ ok: true, issue }),
        };
      }
      case 'send':
      case 'send_test': {
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
          testRecipient: action === 'send_test' ? admin.email : null,
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
        return { statusCode: 400, body: JSON.stringify({ error: 'Unsupported newsletter action.' }) };
    }
  } catch (err: any) {
    console.error('[admin-newsletter]', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
