import { paymentReconciliationEnabled } from './payment-webhook.ts';

export function afterSalesEnabled(env: Record<string, string | undefined>) {
  return paymentReconciliationEnabled(env) && env.STEFFEN_MP_AFTER_SALES === '1';
}
