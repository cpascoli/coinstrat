import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const defaultFromEmail = process.env.RESEND_FROM_EMAIL || 'alerts@coinstrat.xyz';

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
  try {
    await resend.emails.send({
      from: input.from ?? defaultFromEmail,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });

    return {
      ok: true,
      errorSummary: null,
    };
  } catch (error) {
    return {
      ok: false,
      errorSummary: error instanceof Error ? error.message : String(error),
    };
  }
}
