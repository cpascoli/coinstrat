import type { Handler } from '@netlify/functions';
import Stripe from 'stripe';
import { getBearerToken, getProfileByUserId, getUserFromToken } from './lib/auth';

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
    const token = getBearerToken(event);
    const authUser = await getUserFromToken(token);
    if (!authUser) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required.' }) };
    }

    const profile = await getProfileByUserId(authUser.id, 'id, email, tier, stripe_customer_id');
    if (!profile) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Profile not found.' }) };
    }

    const { tier } = JSON.parse(event.body || '{}');

    const priceId = PRICE_IDS[tier];
    if (!priceId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid tier' }) };
    }

    if (profile.tier === 'lifetime') {
      return { statusCode: 400, body: JSON.stringify({ error: 'Lifetime is already active on this account.' }) };
    }

    const isOneTime = ONE_TIME_TIERS.has(tier);

    const session = await stripe.checkout.sessions.create({
      mode: isOneTime ? 'payment' : 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${SITE_URL}/profile?checkout=success`,
      cancel_url: `${SITE_URL}/profile?checkout=cancelled`,
      ...(profile.stripe_customer_id ? { customer: profile.stripe_customer_id } : {}),
      customer_email: profile.email ?? authUser.email,
      client_reference_id: authUser.id,
      metadata: { userId: authUser.id, tier },
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
