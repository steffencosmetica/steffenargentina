import 'server-only';
import { isCheckoutAvailable } from '@/lib/checkout/server';
import { orderOfficeEnabled } from '@/lib/mail/order-config';
export function orderRecoveryEnabled(){return isCheckoutAvailable()&&orderOfficeEnabled(process.env);}
export const ORDER_SESSION_COOKIE='steffen-order-access';
