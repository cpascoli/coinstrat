import type { Handler } from '@netlify/functions';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-12-18.acacia' });
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET!;

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function tierFromPriceId(priceId: string): string {
  if (priceId === process.env.STRIPE_PRO_PRICE_ID) return 'pro';
  if (priceId === process.env.STRIPE_PRO_PLUS_PRICE_ID) return 'pro_plus';
  return 'free';
}

export const handler: Handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  if (!sig || !event.body) {
    return { statusCode: 400, body: 'Missing signature' };
  }

  let stripeEvent: Stripe.Event;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, endpointSecret);
  } catch (err: any) {
    console.error('[stripe-webhook] Signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;
        const tier = session.metadata?.tier ?? 'pro';

        if (userId) {
          await supabase.from('profiles').update({
            tier,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
          }).eq('id', userId);
          console.log(`[stripe-webhook] User ${userId} upgraded to ${tier}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = stripeEvent.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const priceId = sub.items.data[0]?.price?.id;
        const newTier = priceId ? tierFromPriceId(priceId) : 'free';
        const isActive = ['active', 'trialing'].includes(sub.status);

        await supabase.from('profiles').update({
          tier: isActive ? newTier : 'free',
          stripe_subscription_id: sub.id,
        }).eq('stripe_customer_id', customerId);
        console.log(`[stripe-webhook] Customer ${customerId} subscription updated → ${isActive ? newTier : 'free'}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = stripeEvent.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        await supabase.from('profiles').update({
          tier: 'free',
          stripe_subscription_id: null,
        }).eq('stripe_customer_id', customerId);
        console.log(`[stripe-webhook] Customer ${customerId} subscription cancelled → free`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        console.warn(`[stripe-webhook] Payment failed for customer ${customerId}`);
        break;
      }

      default:
        console.log(`[stripe-webhook] Unhandled event type: ${stripeEvent.type}`);
    }
  } catch (err: any) {
    console.error('[stripe-webhook] Processing error:', err);
    return { statusCode: 500, body: 'Webhook processing error' };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
