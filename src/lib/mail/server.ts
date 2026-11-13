import 'server-only';
import { after } from 'next/server';
import { createServiceClient, hasServiceKey } from '@/lib/supabase/admin';
import { EMAIL, WHATSAPP_NUMERO } from '@/lib/site';
import { mailConfigFromEnv } from './config.ts';
import { createTransport, type MailTransport } from './transports.ts';
import { drainOnce, supabaseQueue } from './worker.ts';
import { orderMailEnabled } from './order-config.ts';

// Envío inmediato «después de responder»: la respuesta al navegador (con la constancia web) nunca espera al
// correo. Si este intento falla o el proceso se reinicia, la comunicación sigue pendiente en la base y la
// procesa el ejecutor autónomo (scripts/mail-worker.ts). No se reciben ni se registran datos personales.

let cached: { key: string; transport: MailTransport | null; linkBaseUrl: string } | undefined;

function current() {
  const key = [process.env.MAIL_TRANSPORT, process.env.MAIL_SMTP_HOST, process.env.MAIL_CAPTURE_DIR, process.env.MAIL_FROM].join('|');
  if (cached?.key === key) return cached;
  const result = mailConfigFromEnv(process.env);
  if (!result.ok) {
    console.error(JSON.stringify({ evento: 'mail_config_invalida' }));
    cached = { key, transport: null, linkBaseUrl: '' };
  } else {
    cached = { key, transport: createTransport(result.config), linkBaseUrl: result.config.transport === 'desactivado' ? '' : result.config.linkBaseUrl };
  }
  return cached;
}

export function scheduleMailDrain(): void {
  const { transport, linkBaseUrl } = current();
  if (!transport || !hasServiceKey()) return;
  after(async () => {
    try {
      await drainOnce({
        queue: supabaseQueue(createServiceClient(),120,orderMailEnabled(process.env)),
        transport,
        context: { linkBaseUrl, contactEmail: EMAIL, whatsapp: WHATSAPP_NUMERO },
        worker: `web-${process.pid}`,
        limit: 5,
      });
    } catch {
      console.error(JSON.stringify({ evento: 'mail_envio_inmediato_fallo' }));
    }
  });
}
