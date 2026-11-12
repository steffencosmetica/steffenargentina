import 'server-only';
import { assertUuid, requireAdmin } from '@/lib/catalog/admin';
import { hasServiceKey } from '@/lib/supabase/admin';
import { MAX_CENTAVOS, parsePesosInput } from '@/lib/money';
import { afterSalesEnabled } from './after-sales-config';
import { refundBody, type AfterSales, type Dispute } from './after-sales-model';
import { executeMockRefund, type RefundClaim } from './refund-provider';

function enabled() {
  return afterSalesEnabled(process.env) && hasServiceKey();
}
const value = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const integer = (input: string) => /^\d{1,12}$/.test(input) && Number(input) <= MAX_CENTAVOS ? Number(input) : null;

export async function readAfterSales(order: string) {
  const { supabase } = await requireAdmin();
  if (!enabled()) return null;
  assertUuid(order);
  const { data, error } = await supabase.rpc('admin_ver_posventa', { p_order: order });
  if (error) throw new Error('No se pudo consultar la posventa.');
  return data as unknown as AfterSales;
}

export async function readOpenDisputes() {
  const { supabase } = await requireAdmin();
  if (!enabled()) return [];
  const { data, error } = await supabase.rpc('admin_disputas_abiertas');
  if (error) throw new Error('No se pudieron consultar los contracargos.');
  return data as unknown as Dispute[];
}

export async function changeAfterSales(form: FormData) {
  const { supabase } = await requireAdmin();
  if (!enabled()) throw new Error('La posventa simulada está deshabilitada.');
  const order = value(form, 'order');
  const id = value(form, 'id');
  const operation = value(form, 'operation');
  assertUuid(order);
  assertUuid(id);

  if (operation === 'chargeback_note') {
    const result = await supabase.rpc('admin_nota_contracargo', {
      p_order: order, p_case: id, p_note: value(form, 'notes'), p_reference: value(form, 'reference') || null,
    });
    if (result.error) throw new Error('Revisá la observación y la referencia del contracargo.');
    return { order, message: 'Observación registrada.' };
  }
  if (operation.startsWith('return_')) {
    const item = value(form, 'item') || null;
    if (item) assertUuid(item);
    const quantity = integer(value(form, 'quantity'));
    const suitable = integer(value(form, 'suitable'));
    if ((quantity ?? 0) > 2_147_483_647 || (suitable ?? 0) > 2_147_483_647) throw new Error('Cantidad inválida.');
    const result = await supabase.rpc('admin_devolucion_fisica', {
      p_order: order, p_id: id, p_item: item, p_action: operation.slice(7), p_quantity: quantity,
      p_reason: value(form, 'reason') || null, p_suitable: suitable, p_condition: value(form, 'condition') || null,
      p_notes: value(form, 'notes') || null,
    });
    if (result.error) throw new Error('La devolución cambió o los datos ingresados no son válidos.');
    return { order, message: 'Devolución física registrada.' };
  }
  if (!['refund_request','refund_resume'].includes(operation) || value(form,'confirm') !== 'yes') {
    throw new Error('Confirmá el reintegro antes de enviarlo.');
  }
  let refundId = id;
  if (operation === 'refund_request') {
    const kind = value(form, 'kind');
    const cents = kind === 'partial' ? parsePesosInput(value(form,'amount')) : null;
    const expected = integer(value(form,'expected'));
    if (!['full','partial'].includes(kind) || expected === null || (kind === 'partial' && !cents)) throw new Error('Revisá el importe.');
    const result = await supabase.rpc('admin_solicitar_reembolso', {
      p_order: order, p_key: id, p_kind: kind, p_payment: kind === 'partial' ? value(form,'payment') : null,
      p_cents: cents, p_expected: expected, p_reason: value(form,'reason'), p_confirm: true, p_contact: value(form,'contact') === 'yes',
    });
    if (result.error || !result.data) {
      const message = result.error?.message === 'refund_contact_required' ? 'Registrá primero el contacto con el comprador.'
        : 'El reintegro no está disponible. Revisá el saldo, la incidencia y el motivo.';
      throw new Error(message);
    }
    refundId = result.data;
  }

  const acquired = await supabase.rpc('admin_tomar_reembolso', { p_order: order, p_id: refundId, p_confirm: true });
  if (acquired.error) throw new Error('No se pudo reclamar el reintegro. Revisá su estado antes de reintentar.');
  const claim = acquired.data as RefundClaim;
  if (!claim?.lease || !claim.id || !claim.key || !claim.kind || !claim.provider || !claim.cents || !claim.transactions) {
    return { order, message: 'El reintegro ya se registró. Consultá su estado en el historial.' };
  }
  // El RPC simulado vuelve a consultar el ledger y valida la transacción, el importe y el saldo antes de escribir.
  const payment = claim.payment ?? null;
  const body = refundBody(claim.kind, payment, claim.cents, claim.transactions);
  const state = await executeMockRefund({ ...claim, id: claim.id, key: claim.key, lease: claim.lease,
    kind: claim.kind, provider: claim.provider, payment, cents: claim.cents, transactions: claim.transactions }, body);
  return { order, message: state === 'confirmed' ? 'Reintegro confirmado por el proveedor simulado.'
    : state === 'rejected' ? 'Reintegro rechazado. Consultá el motivo en el historial.'
    : 'Resultado pendiente de conciliación. Revisá el historial antes de repetir la operación.' };
}
