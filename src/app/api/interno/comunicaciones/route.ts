import { timingSafeEqual, createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { json, notFound } from '@/lib/http/json-api';
import { createServiceClient, hasServiceKey } from '@/lib/supabase/admin';
import { evaluateHealth, parseStats } from '@/lib/mail/health';

// Monitor de comunicaciones para un servicio EXTERNO de supervisión (no depende del correo).
// GET con `Authorization: Bearer <MAIL_HEALTH_TOKEN>`: 200 si está sano, 503 si hay problemas.
// Sin MAIL_HEALTH_TOKEN configurado la ruta responde 404 (no existe). No devuelve datos personales.
export async function GET(request: NextRequest) {
  const expected = process.env.MAIL_HEALTH_TOKEN ?? '';
  if (expected.length < 32) return notFound();
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  if (!timingSafeEqual(a, b)) return notFound();
  if (!hasServiceKey()) return json({ ok: false, problemas: ['sin_configuracion'] }, 503);
  try {
    const { data, error } = await createServiceClient().rpc('estado_comunicaciones');
    const stats = error ? null : parseStats(data);
    if (!stats) return json({ ok: false, problemas: ['base_no_disponible'] }, 503);
    const health = evaluateHealth(stats, Number(process.env.MAIL_WORKER_MAX_SILENCE_MINUTES ?? 10));
    return json(health, health.ok ? 200 : 503);
  } catch {
    return json({ ok: false, problemas: ['base_no_disponible'] }, 503);
  }
}
export { notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE, notFound as HEAD };
