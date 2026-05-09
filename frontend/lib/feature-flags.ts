/**
 * Product feature toggles (build-time / env). Use NEXT_PUBLIC_* only for safe, non-secret switches.
 */

/**
 * When true, marketing may route users to paid-tier signup/checkout flows.
 * Keep false until payment capture (e.g. Stripe) is integrated — avoids implying purchasable Pro plans.
 */
export function isPaidCheckoutEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_ENABLE_PAID_CHECKOUT;
  return typeof v === "string" && v.trim().toLowerCase() === "true";
}
