import type { Handler } from '@netlify/functions';
import Stripe from 'stripe';
import { getBearerToken, getProfileFromToken } from './lib/auth';

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
    const token = getBearerToken(event);
    const profile = await getProfileFromToken(token, 'id, stripe_customer_id, tier');

    if (!profile) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required.' }) };
    }

    if (!profile.stripe_customer_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No active Stripe customer found for this account.' }) };
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
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
