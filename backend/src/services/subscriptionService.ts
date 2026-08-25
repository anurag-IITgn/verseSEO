import type { UnwrapWebhookEvent } from 'dodopayments/resources/webhooks/webhooks.js';
import { findUserByEmail, findUserById } from '../repositories/userRepo.js';
import {
  findSubscriptionsByUserId,
  updateUserPlan,
  upsertSubscription,
} from '../repositories/subscriptionRepo.js';

export interface LoggerLike {
  info: (objOrMsg: unknown, msg?: string) => void;
  warn: (objOrMsg: unknown, msg?: string) => void;
}

export async function processDodoWebhookEvent(
  event: UnwrapWebhookEvent,
  logger?: LoggerLike,
): Promise<{ processed: boolean; reason?: string }> {
  const eventType = event.type;

  // We are specifically interested in subscription.* lifecycle events
  if (!eventType.startsWith('subscription.')) {
    logger?.info(`Skipping non-subscription webhook event type: ${eventType}`);
    return { processed: false, reason: `Ignored event type ${eventType}` };
  }

  // All subscription.* events carry SubscriptionsAPI.Subscription in `event.data`
  const subscriptionData = (event as any).data;
  if (!subscriptionData || !subscriptionData.subscription_id) {
    logger?.warn({ eventType }, 'Webhook event missing subscription data');
    return { processed: false, reason: 'Missing subscription data' };
  }

  const providerSubscriptionId = subscriptionData.subscription_id;
  const metadata = subscriptionData.metadata || {};
  const customerEmail = subscriptionData.customer?.email;

  // 1. Identify application user
  const metadataUserId = typeof metadata.userId === 'string'
    ? metadata.userId
    : typeof metadata.user_id === 'string'
      ? metadata.user_id
      : undefined;

  let targetUser = metadataUserId ? await findUserById(metadataUserId) : null;

  if (!targetUser && customerEmail) {
    targetUser = await findUserByEmail(customerEmail);
  }

  if (!targetUser) {
    logger?.warn(
      { eventType, providerSubscriptionId },
      'Could not match Dodo subscription event to an existing user',
    );
    return { processed: false, reason: 'User not found' };
  }

  const userId = targetUser.id;
  const status: string = subscriptionData.status || 'unknown';
  const currentPeriodStart = subscriptionData.previous_billing_date
    ? new Date(subscriptionData.previous_billing_date)
    : null;
  const currentPeriodEnd = subscriptionData.next_billing_date
    ? new Date(subscriptionData.next_billing_date)
    : null;

  // 2. Idempotent upsert of subscription record
  await upsertSubscription({
    userId,
    providerSubscriptionId,
    plan: 'pro',
    status,
    currentPeriodStart,
    currentPeriodEnd,
  });

  // 3. Synchronize users.plan
  // "renewed" means the subscription successfully renewed and is still active.
  // Treat it identically to "active" so the user is not downgraded.
  if (status === 'active' || status === 'renewed') {
    await updateUserPlan(userId, 'pro');
    logger?.info({ userId, providerSubscriptionId, status }, 'User upgraded to Pro subscription');
  } else {
    // If status is cancelled, expired, failed, on_hold, paused, etc.
    const userSubs = await findSubscriptionsByUserId(userId);
    const hasActiveSub = userSubs.some(
      (sub) => sub.status === 'active' && sub.providerSubscriptionId !== providerSubscriptionId,
    );

    if (!hasActiveSub) {
      await updateUserPlan(userId, 'free');
      logger?.info(
        { userId, providerSubscriptionId, status },
        'User reverted to Free plan due to subscription status change',
      );
    }
  }

  return { processed: true };
}
