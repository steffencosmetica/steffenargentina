// Plantillas de los emails transaccionales del arrepentimiento. Sin marketing, seguimiento ni imágenes remotas.
// La constancia por email es un RESPALDO de la que se muestra en la web: no la reemplaza ni confirma un reembolso.

import { renderOrderMessage } from './order-templates.ts';
export type ClaimedMessage = {
  id: string;
  leaseId: string;
  kind: 'constancia' | 'recuperacion' | 'alerta' | 'pedido_recibido' | 'pago_confirmado' | 'pedido_despachado' | 'recuperacion_pedido';
  recipient: string;
  attempt: number;
  payload: Record<string, unknown>;
};

export type RenderedMail = { subject: string; text: string; html: string };

export type TemplateContext = { linkBaseUrl: string; contactEmail: string; whatsapp: string };

export class TemplateError extends Error {}

const ZONE = 'America/Argentina/Buenos_Aires';

export function formatArgentina(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new TemplateError('fecha');
  return `${date.toLocaleString('es-AR', { timeZone: ZONE, dateStyle: 'short', timeStyle: 'short' })} (hora de Argentina)`;
}

function str(value: unknown, pattern: RegExp, name: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new TemplateError(name);
  return value;
}

const CODE = /^ARR-[A-F0-9]{32}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function build(subject: string, paragraphs: string[], link?: { href: string; label: string }): RenderedMail {
  const text = paragraphs.join('\n\n') + '\n';
  const html = `<!doctype html><html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.5;max-width:560px">${paragraphs
    .map((p) => {
      if (link && p.includes(link.href)) {
        return `<p><a href="${escapeHtml(link.href)}" style="color:#0b5d4f;font-weight:bold">${escapeHtml(link.label)}</a></p>`;
      }
      return `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`;
    })
    .join('')}</body></html>`;
  return { subject, text, html };
}

function footer(ctx: TemplateContext): string {
  return `Steffen Cosmética Capilar\nAtención: lunes a viernes de 8:00 a 16:00, por email (${ctx.contactEmail}) y WhatsApp (${ctx.whatsapp}).\nEste es un email transaccional sobre tu solicitud; no recibirás publicidad por este medio.`;
}

export function renderMessage(message: ClaimedMessage, ctx: TemplateContext): RenderedMail {
  const p = message.payload;
  if (['pedido_recibido','pago_confirmado','pedido_despachado','recuperacion_pedido'].includes(message.kind)) return renderOrderMessage(message,ctx);
  if (message.kind === 'constancia') {
    const code = str(p.code, CODE, 'codigo');
    const received = formatArgentina(str(p.received_at, /^\d{4}-\d{2}-\d{2}T/, 'fecha'));
    return build(`Constancia de tu solicitud de arrepentimiento ${code}`, [
      'Recibimos tu solicitud de arrepentimiento (revocación de compra) enviada desde steffenargentina.com.ar.',
      `Código de identificación: ${code}\nFecha de recepción: ${received}\nEstado: recibida`,
      'Este email es una copia de respaldo de la constancia que se mostró en la web al enviar la solicitud. Conservá el código. Esta constancia no confirma un reembolso ni el resultado de la gestión: vamos a contactarte por este medio para coordinar los pasos siguientes.',
      `Si no enviaste esta solicitud, respondé este email o escribinos a ${ctx.contactEmail}.`,
      footer(ctx),
    ]);
  }
  if (message.kind === 'recuperacion') {
    const token = str(p.token, TOKEN, 'token');
    const minutes = typeof p.expires_minutes === 'number' && p.expires_minutes > 0 ? p.expires_minutes : 30;
    const href = `${ctx.linkBaseUrl.replace(/\/$/, '')}/arrepentimiento/recuperar#t=${token}`;
    return build('Acceso a tus constancias de arrepentimiento', [
      'Recibimos un pedido para consultar las constancias de arrepentimiento asociadas a este email.',
      `Abrí este enlace privado para verlas. Vence en ${minutes} minutos y sirve una sola vez:\n${href}`,
      'No lo compartas. Si no hiciste este pedido, ignorá este mensaje: sin este enlace nadie puede ver tus constancias.',
      footer(ctx),
    ], { href, label: 'Ver mis constancias' });
  }
  const code = typeof p.code === 'string' && (CODE.test(p.code) || /^STF-\d{4}-[2-9A-HJ-NP-Z]{4}$/.test(p.code)) ? p.code : 'sin código';
  const failedKind = typeof p.failed_kind === 'string' ? p.failed_kind.replace(/[^a-z_]/g, '') : 'comunicación';
  const status = typeof p.failed_status === 'string' ? p.failed_status.replace(/[^a-z_]/g, '') : 'fallido';
  const errorCode = typeof p.error_code === 'string' ? p.error_code.replace(/[^a-z0-9_]/g, '') : 'sin código';
  const attempts = typeof p.attempts === 'number' ? p.attempts : 0;
  return build(`[Alerta Steffen] No se pudo enviar la ${failedKind} ${code}`, [
    `La ${failedKind} por email de la solicitud ${code} quedó en estado «${status}» después de ${attempts} intento(s). Último error: ${errorCode}.`,
    'La constancia inmediata se mostró en la web al solicitante; el respaldo por email requiere revisión humana en /admin/arrepentimientos (reintentar, registrar rebote o resolver por otro canal).',
    'Este aviso no incluye datos personales. Si el servicio de correo está caído, este aviso puede no llegar: revisá también el monitor de comunicaciones.',
  ]);
}
