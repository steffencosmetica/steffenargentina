// Procesa la cola de comunicaciones: reclama (con arrendamiento), envía y registra el resultado.
// Lo usan el ejecutor autónomo (scripts/mail-worker.ts) y el servidor de Next después de responder.
// Los registros solo incluyen ids, tipos y códigos de error: nunca direcciones, tokens ni cuerpos.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types.ts';
import { MailSendError, classifySmtpError, redact } from './errors.ts';
import { renderMessage, TemplateError, type ClaimedMessage, type TemplateContext } from './templates.ts';
import type { MailTransport } from './transports.ts';

export type Outcome = 'aceptado' | 'error_temporal' | 'error_permanente';

export type MailQueue = {
  claim(worker: string, limit: number): Promise<ClaimedMessage[]>;
  report(id: string, leaseId: string, outcome: Outcome, error?: { code: string; detail: string }, providerId?: string): Promise<string>;
  validate?(message: ClaimedMessage): Promise<boolean>;
};

export type DrainSummary = { claimed: number; accepted: number; retry: number; failed: number; unchanged: number; reportErrors: number };

export type Logger = (event: string, data?: Record<string, string | number>) => void;

export const silentLogger: Logger = () => {};

export async function drainOnce(opts: {
  queue: MailQueue;
  transport: MailTransport;
  context: TemplateContext;
  worker: string;
  limit?: number;
  log?: Logger;
}): Promise<DrainSummary> {
  const log = opts.log ?? silentLogger;
  const summary: DrainSummary = { claimed: 0, accepted: 0, retry: 0, failed: 0, unchanged: 0, reportErrors: 0 };
  const messages = await opts.queue.claim(opts.worker, opts.limit ?? 10);
  summary.claimed = messages.length;
  for (const message of messages) {
    let outcome: Outcome = 'aceptado';
    let error: { code: string; detail: string } | undefined;
    let providerId: string | undefined;
    try {
      const orderMessage=message.kind.startsWith('pedido_')||message.kind==='pago_confirmado'||message.kind==='recuperacion_pedido'||message.payload._order_message===true;
      if(orderMessage && (!opts.queue.validate || !await opts.queue.validate(message))) { summary.unchanged++; continue; }
      const rendered = renderMessage(message, opts.context);
      ({ providerId } = await opts.transport.send({ ...rendered, id: message.id, to: message.recipient,
        ...(orderMessage?{idempotent:true,expiresAt:String(message.payload._lease_until??'')}: {}) }));
    } catch (e) {
      const failure = e instanceof TemplateError ? new MailSendError('permanente', 'plantilla', e.message) : classifySmtpError(e);
      outcome = failure.kind === 'permanente' ? 'error_permanente' : 'error_temporal';
      error = { code: failure.code, detail: failure.detail };
    }
    try {
      const result = await opts.queue.report(message.id, message.leaseId, outcome, error, providerId);
      if (result === 'aceptado') summary.accepted++;
      else if (result === 'reintento') summary.retry++;
      else if (result === 'fallido') summary.failed++;
      else summary.unchanged++;
      log('mail_resultado', { id: message.id, tipo: message.kind, intento: message.attempt, resultado: result, ...(error ? { error: error.code } : {}) });
    } catch (e) {
      // La base no respondió: el arrendamiento vence y otro ciclo lo recupera (puede repetirse ESTE email).
      summary.reportErrors++;
      log('mail_resultado_sin_registrar', { id: message.id, tipo: message.kind, error: redact((e as Error)?.name ?? 'error', 60) });
    }
  }
  return summary;
}

type Rpc = SupabaseClient<Database>;

export function supabaseQueue(client: Rpc, leaseSeconds = 120, includeOrders = false): MailQueue {
  return {
    async claim(worker, limit) {
      const { data, error } = await client.rpc(includeOrders?'comunicaciones_reclamar_tienda':'comunicaciones_reclamar', { p_worker: worker, p_limit: limit, p_lease_seconds: leaseSeconds });
      if (error) throw new Error(`reclamar:${error.code ?? 'error'}`);
      return (data ?? []).map((row) => ({
        id: row.id,
        leaseId: row.lease_id,
        kind: row.kind as ClaimedMessage['kind'],
        recipient: row.recipient,
        attempt: row.attempt,
        payload: (row.payload ?? {}) as Record<string, unknown>,
      }));
    },
    async validate(message) {
      const {data,error}=await client.rpc('comunicaciones_validar_envio',{p_id:message.id,p_lease:message.leaseId});
      if(error)throw new Error('validacion_envio');return data===true;
    },
    async report(id, leaseId, outcome, error, providerId) {
      const { data, error: rpcError } = await client.rpc('comunicaciones_resultado', {
        p_id: id,
        p_lease: leaseId,
        p_outcome: outcome,
        p_error_code: error?.code,
        p_error_detail: error?.detail,
        p_provider_id: providerId,
      });
      if (rpcError) throw new Error(`resultado:${rpcError.code ?? 'error'}`);
      return String(data);
    },
  };
}
