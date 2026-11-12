import { centavosToDecimal, MAX_CENTAVOS } from '../money.ts';

export type RefundTransaction = { id: string; paid: number; refunded: number };
export type Dispute = { id: string; order_id: string; code: string; cents: number; deadline: string | null; documentation: string };
export type AfterSales = {
  paid: number; refunded: number; balance: number; blocked: boolean; transactions: RefundTransaction[];
  requests: { id: string; kind: 'full' | 'partial'; cents: number; reason: string; state: string; error: string | null; created_at: string }[];
  external: { id: string; cents: number; confirmed_at: string }[];
  returns: { id: string; item_id: string; quantity: number; reason: string; state: string; received_at: string | null;
    inspected_at: string | null; condition: string | null; suitable: number | null; unsuitable: number | null; notes: string | null }[];
  cases: (Dispute & { status: string; impact_cents: number; opened_at: string; resolved_at: string | null })[];
  events: { id: number; subject: string; kind: string; actor: string | null; created_at: string;
    details: { note?: string; reference?: string } }[];
};

export function refundBody(kind: 'full' | 'partial', payment: string | null, cents: number, transactions: RefundTransaction[]) {
  if (!['full','partial'].includes(kind) || !Number.isSafeInteger(cents) || cents < 1 || cents > MAX_CENTAVOS || !transactions.length) throw new Error('refund_input');
  if (new Set(transactions.map(transaction => transaction.id)).size !== transactions.length || transactions.some(transaction =>
    !/^[A-Za-z0-9_-]{1,64}$/.test(transaction.id) || !Number.isSafeInteger(transaction.paid) || !Number.isSafeInteger(transaction.refunded)
    || transaction.paid < 0 || transaction.paid > MAX_CENTAVOS || transaction.refunded < 0 || transaction.refunded > transaction.paid)) throw new Error('refund_input');
  if (kind === 'full') {
    if (payment !== null || transactions.reduce((sum, transaction) => sum + transaction.paid - transaction.refunded, 0) !== cents) {
      throw new Error('refund_input');
    }
    return null; // El adaptador HTTP futuro omite el body por completo.
  }
  const selected = transactions.find(transaction => transaction.id === payment);
  if (!selected || cents > selected.paid - selected.refunded) throw new Error('refund_input');
  return { transactions: [{ id: selected.id, amount: centavosToDecimal(cents) }] };
}

export const refundLabels: Record<string, string> = {
  requested: 'Pendiente de procesamiento', processing: 'En procesamiento', confirmed: 'Confirmado por Mercado Pago simulado',
  rejected: 'Fallido', unknown: 'Requiere conciliación',
};
export const refundErrorLabels: Record<string,string> = {
  provider_insufficient_funds: 'El vendedor no tiene saldo suficiente para este reintegro.',
  provider_balance_changed: 'El saldo disponible cambió. Revisá los movimientos anteriores.',
  provider_order_blocked: 'La operación está bloqueada por su estado o una disputa.',
  lease_expired: 'La ejecución se interrumpió. Consultá el resultado antes de retomarla.',
  timeout: 'El proveedor no respondió a tiempo. Falta conciliar el resultado.',
  network: 'Se perdió la conexión. Falta conciliar el resultado.',
  conflict: 'El proveedor informó un conflicto. Falta verificar la operación existente.',
  unknown_result: 'Todavía no hay un resultado confirmado.',
  invalid_payload: 'Los datos del reintegro requieren revisión antes de continuar.',
};
export const returnLabels: Record<string, string> = {
  requested: 'Solicitada', coordinated: 'Coordinada', received: 'Recibida', inspected: 'Inspeccionada', resolved: 'Resuelta',
};
export const disputeLabels: Record<string, string> = { open: 'Abierto', won: 'Ganado', lost: 'Perdido' };
export const documentationLabels: Record<string, string> = {
  pending: 'Falta documentación', review_pending: 'En revisión', valid: 'Válida', invalid: 'Inválida',
  not_supplied: 'No presentada', not_applicable: 'No requerida según el proveedor',
};
