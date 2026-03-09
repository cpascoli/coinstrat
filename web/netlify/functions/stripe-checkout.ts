import type { Handler } from '@netlify/functions';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-12-18.acacia' });

const SITE_URL = process.env.URL || 'https://coinstrat.netlify.app';

const PRICE_IDS: Record<string, string | undefined> = {
  pro: process.env.STRIPE_PRO_PRICE_ID,
  pro_plus: process.env.STRIPE_PRO_PLUS_PRICE_ID,
  lifetime: process.env.STRIPE_LIFETIME_PRICE_ID,
};

const ONE_TIME_TIERS = new Set(['lifetime']);

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { tier, userId, email } = JSON.parse(event.body || '{}');

    const priceId = PRICE_IDS[tier];
    if (!priceId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid tier' }) };
    }

    const isOneTime = ONE_TIME_TIERS.has(tier);

    const session = await stripe.checkout.sessions.create({
      mode: isOneTime ? 'payment' : 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${SITE_URL}/profile?checkout=success`,
      cancel_url: `${SITE_URL}/profile?checkout=cancelled`,
      customer_email: email,
      client_reference_id: userId,
      metadata: { userId, tier },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err: any) {
    console.error('[stripe-checkout]', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
