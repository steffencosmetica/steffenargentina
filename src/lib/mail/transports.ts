// Transportes de correo. Solo el SMTP sale a la red; el de archivo es para desarrollo y pruebas.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import { MailSendError, classifySmtpError } from './errors.ts';
import { fromDomain, type MailConfig } from './config.ts';
import type { RenderedMail } from './templates.ts';

export type OutgoingMail = RenderedMail & { id: string; to: string };
export type MailTransport = { name: string; send(mail: OutgoingMail): Promise<{ providerId?: string }> };

function headers(config: Exclude<MailConfig, { transport: 'desactivado' }>, mail: OutgoingMail) {
  return {
    // Mismo Message-ID en todos los reintentos de la misma comunicación (ayuda a que el cliente agrupe duplicados).
    messageId: `<arr-${mail.id}@${fromDomain(config.from)}>`,
    headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
  };
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Escribe cada mensaje en `captureDir/<fecha>-<id>.json`. Simulaciones para pruebas:
 *   - archivo CAIDA en el directorio: el «servidor» no responde (error temporal);
 *   - archivo RECHAZO: el «servidor» rechaza al destinatario (error permanente).
 */
export function fileTransport(config: Extract<MailConfig, { transport: 'archivo' }>): MailTransport {
  return {
    name: 'archivo',
    async send(mail) {
      if (await exists(join(config.captureDir, 'CAIDA'))) throw new MailSendError('temporal', 'simulado_caida', 'servicio de correo simulado caído');
      if (await exists(join(config.captureDir, 'RECHAZO'))) throw new MailSendError('permanente', 'simulado_rechazo', '550 destinatario rechazado (simulado)');
      await mkdir(config.captureDir, { recursive: true });
      const h = headers(config, mail);
      const file = join(config.captureDir, `${Date.now()}-${mail.id}-${Math.random().toString(36).slice(2, 8)}.json`);
      await writeFile(file, JSON.stringify({ from: config.from, replyTo: config.replyTo, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html, ...h }, null, 2));
      return { providerId: h.messageId };
    },
  };
}

export function smtpTransport(config: Extract<MailConfig, { transport: 'smtp' }>): MailTransport {
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    requireTLS: !config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.password },
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    logger: false,
    debug: false,
  });
  return {
    name: 'smtp',
    async send(mail) {
      try {
        const info = await transporter.sendMail({
          from: config.from,
          replyTo: config.replyTo,
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
          ...headers(config, mail),
        });
        const rejected = Array.isArray(info.rejected) ? info.rejected.length : 0;
        if (rejected > 0) throw new MailSendError('permanente', 'smtp_destinatario', 'destinatario rechazado por el servidor');
        // Solo se registra «aceptado» si el servidor aceptó explícitamente al destinatario.
        const accepted = Array.isArray(info.accepted) ? info.accepted.length : 0;
        if (accepted !== 1) throw new MailSendError('temporal', 'smtp_sin_aceptacion', 'el servidor no confirmó la aceptación');
        return { providerId: typeof info.messageId === 'string' ? info.messageId : undefined };
      } catch (error) {
        throw classifySmtpError(error);
      }
    },
  };
}

export function createTransport(config: MailConfig): MailTransport | null {
  if (config.transport === 'archivo') return fileTransport(config);
  if (config.transport === 'smtp') return smtpTransport(config);
  return null;
}
