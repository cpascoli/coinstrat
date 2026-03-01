import type { Handler } from '@netlify/functions';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { getStore } from '@netlify/blobs';

const resend = new Resend(process.env.RESEND_API_KEY);
const CRON_SECRET = process.env.CRON_SECRET;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'digest@coinstrat.xyz';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const auth = event.headers['authorization'];
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  try {
    // 1. Get latest signals from cache
    const store = getStore('signals');
    const cached = await store.get('signals_latest', { type: 'json' }).catch(() => null) as any;
    const latest = cached?.data?.[cached.data.length - 1];

    if (!latest) {
      return { statusCode: 503, body: JSON.stringify({ error: 'No cached signals available.' }) };
    }

    // 2. Collect all recipient emails: registered users + newsletter subscribers
    const { data: profiles } = await supabase
      .from('profiles')
      .select('email');
    const { data: subscribers } = await supabase
      .from('email_subscribers')
      .select('email')
      .is('unsubscribed_at', null);

    const allEmails = new Set<string>();
    for (const p of (profiles ?? [])) allEmails.add(p.email);
    for (const s of (subscribers ?? [])) allEmails.add(s.email);

    if (allEmails.size === 0) {
      return { statusCode: 200, body: JSON.stringify({ sent: 0, message: 'No recipients.' }) };
    }

    // 3. Build the email content
    const coreStatus = latest.CORE_ON === 1 ? 'ON' : 'OFF';
    const macroStatus = latest.MACRO_ON === 1 ? 'ON' : 'OFF';
    const btcPrice = Number(latest.BTCUSD).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    const date = latest.Date;

    const subject = `CoinStrat Weekly — CORE ${coreStatus} | BTC ${btcPrice}`;

    const html = `
      <div style="font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto; color: #e5e7eb; background: #0b1220; padding: 32px; border-radius: 12px;">
        <h1 style="font-size: 22px; margin: 0 0 4px;">CoinStrat Weekly Digest</h1>
        <p style="color: #94a3b8; margin: 0 0 24px; font-size: 14px;">${date}</p>

        <div style="background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
          <h2 style="font-size: 16px; margin: 0 0 12px;">Signal Status</h2>
          <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #94a3b8;">CORE</td><td style="padding: 6px 0; font-weight: 700; color: ${latest.CORE_ON ? '#22c55e' : '#ef4444'};">${coreStatus}</td></tr>
            <tr><td style="padding: 6px 0; color: #94a3b8;">MACRO</td><td style="padding: 6px 0; font-weight: 700; color: ${latest.MACRO_ON ? '#22c55e' : '#ef4444'};">${macroStatus}</td></tr>
            <tr><td style="padding: 6px 0; color: #94a3b8;">BTC Price</td><td style="padding: 6px 0; font-weight: 700;">${btcPrice}</td></tr>
          </table>
        </div>

        <div style="background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
          <h2 style="font-size: 16px; margin: 0 0 12px;">Scores</h2>
          <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #94a3b8;">VAL_SCORE</td><td style="padding: 6px 0; font-weight: 700;">${latest.VAL_SCORE}</td></tr>
            <tr><td style="padding: 6px 0; color: #94a3b8;">LIQ_SCORE</td><td style="padding: 6px 0; font-weight: 700;">${latest.LIQ_SCORE}</td></tr>
            <tr><td style="padding: 6px 0; color: #94a3b8;">DXY_SCORE</td><td style="padding: 6px 0; font-weight: 700;">${latest.DXY_SCORE}</td></tr>
            <tr><td style="padding: 6px 0; color: #94a3b8;">CYCLE_SCORE</td><td style="padding: 6px 0; font-weight: 700;">${latest.CYCLE_SCORE}</td></tr>
          </table>
        </div>

        <div style="text-align: center; margin-top: 24px;">
          <a href="https://coinstrat.xyz/dashboard" style="display: inline-block; background: #60a5fa; color: #0b1220; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 14px;">View Full Dashboard</a>
        </div>

        <p style="color: #64748b; font-size: 11px; text-align: center; margin-top: 24px;">
          You're receiving this because you signed up for CoinStrat updates.<br />
          <a href="https://coinstrat.xyz/unsubscribe" style="color: #64748b;">Unsubscribe</a>
        </p>
      </div>
    `;

    // 4. Send via Resend (batch — up to 100 per call)
    const emailList = Array.from(allEmails);
    let sent = 0;

    for (let i = 0; i < emailList.length; i += 50) {
      const batch = emailList.slice(i, i + 50);
      const promises = batch.map(to =>
        resend.emails.send({
          from: FROM_EMAIL,
          to,
          subject,
          html,
        })
      );
      const results = await Promise.allSettled(promises);
      sent += results.filter(r => r.status === 'fulfilled').length;
    }

    console.log(`[weekly-digest] Sent ${sent}/${emailList.length} emails.`);

    return {
      statusCode: 200,
      body: JSON.stringify({ sent, total: emailList.length }),
    };
  } catch (err: any) {
    console.error('[weekly-digest]', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
