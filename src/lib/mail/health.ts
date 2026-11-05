// Evalúa los indicadores de public.estado_comunicaciones(). Sirve aunque el correo esté caído:
// un monitor externo consulta esta evaluación (HTTP o CLI) y avisa por su propio canal.

export type CommunicationStats = {
  now: string;
  pendientes: number;
  vencidas: number;
  fallidas: number;
  alertas_pendientes: number;
  mas_antigua_pendiente: string | null;
  ultimo_ejecutor: string | null;
};

export type HealthProblem = 'sin_ejecutor' | 'ejecutor_detenido' | 'comunicaciones_demoradas' | 'comunicaciones_fallidas';

export type Health = { ok: boolean; problemas: HealthProblem[]; pendientes: number; vencidas: number; fallidas: number; minutosSinEjecutor: number | null };

export const HEALTH_MESSAGES: Record<HealthProblem, string> = {
  sin_ejecutor: 'Ningún ejecutor de correo se registró todavía: las comunicaciones no se procesan solas.',
  ejecutor_detenido: 'El ejecutor de correo no da señales de vida: las comunicaciones pendientes no avanzan.',
  comunicaciones_demoradas: 'Hay comunicaciones demoradas: el servicio de correo o el ejecutor pueden estar fallando.',
  comunicaciones_fallidas: 'Hay comunicaciones fallidas o rebotadas que requieren intervención humana.',
};

export function parseStats(value: unknown): CommunicationStats | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const n = (k: string) => (typeof v[k] === 'number' ? (v[k] as number) : Number.NaN);
  const stats = {
    now: typeof v.now === 'string' ? v.now : '',
    pendientes: n('pendientes'),
    vencidas: n('vencidas'),
    fallidas: n('fallidas'),
    alertas_pendientes: n('alertas_pendientes'),
    mas_antigua_pendiente: typeof v.mas_antigua_pendiente === 'string' ? v.mas_antigua_pendiente : null,
    ultimo_ejecutor: typeof v.ultimo_ejecutor === 'string' ? v.ultimo_ejecutor : null,
  };
  if (!stats.now || [stats.pendientes, stats.vencidas, stats.fallidas, stats.alertas_pendientes].some(Number.isNaN)) return null;
  return stats;
}

export function evaluateHealth(stats: CommunicationStats, maxWorkerSilenceMinutes = 10): Health {
  const problemas: HealthProblem[] = [];
  const now = Date.parse(stats.now);
  const minutosSinEjecutor = stats.ultimo_ejecutor ? Math.floor((now - Date.parse(stats.ultimo_ejecutor)) / 60_000) : null;
  if (minutosSinEjecutor === null) problemas.push('sin_ejecutor');
  else if (minutosSinEjecutor > maxWorkerSilenceMinutes) problemas.push('ejecutor_detenido');
  if (stats.vencidas > 0) problemas.push('comunicaciones_demoradas');
  if (stats.fallidas > 0) problemas.push('comunicaciones_fallidas');
  return { ok: problemas.length === 0, problemas, pendientes: stats.pendientes, vencidas: stats.vencidas, fallidas: stats.fallidas, minutosSinEjecutor };
}
