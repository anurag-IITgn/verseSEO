import DodoPayments from 'dodopayments';
import { env } from '../config/env.js';

export const dodo = new DodoPayments({
    bearerToken: env.DODO_PAYMENTS_API_KEY!,
    environment: env.DODO_PAYMENTS_ENVIRONMENT,
});

export async function createDodoCheckout(customerEmail: string, userId?: string) {
    const session = await dodo.checkoutSessions.create({
        product_cart: [
            {
                product_id: env.DODO_PAYMENTS_PRODUCT_ID!,
                quantity: 1,
            },
        ],
        customer: {
            email: customerEmail,
        },
        metadata: userId ? { userId } : undefined,
    });

    return session.checkout_url;
}