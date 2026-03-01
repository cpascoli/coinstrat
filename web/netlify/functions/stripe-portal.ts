import type { Handler } from '@netlify/functions';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-12-18.acacia' });

const SITE_URL = process.env.URL || 'https://coinstrat.netlify.app';

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { customerId } = JSON.parse(event.body || '{}');

    if (!customerId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing customerId' }) };
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${SITE_URL}/profile`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err: any) {
    console.error('[stripe-portal]', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
