import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';

// Utilidades de las rutas JSON públicas (carrito, checkout, seguimiento): mismo origen, JSON, tamaño
// máximo, respuestas sin caché y 404 «como si no existiera» cuando la función está deshabilitada.
// Nunca se loguea el cuerpo de una solicitud (puede tener datos personales o el token de un pedido).

export const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } as const;

export function notFound() {
  return new NextResponse(null, { status: 404, headers: NO_STORE });
}

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function sameHost(origin: string, host: string) {
  try {
    return new URL(origin).host === host;
  } catch {
    return false; // "null" u otro valor que no es una URL
  }
}

/**
 * Lee el cuerpo JSON de un POST del propio sitio. Devuelve el cuerpo ya parseado, o la respuesta de error
 * (403 otro origen, 415 sin JSON, 413 demasiado grande, 400 JSON inválido).
 */
export async function readJsonBody(request: NextRequest, maxBytes: number): Promise<{ body: unknown } | { response: NextResponse }> {
  const origin = request.headers.get('origin');
  if (origin !== null && !sameHost(origin, request.nextUrl.host)) return { response: json({ error: 'forbidden' }, 403) };
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return { response: json({ error: 'invalid_request' }, 415) };
  }
  const text = await request.text();
  if (text.length > maxBytes) return { response: json({ error: 'invalid_request' }, 413) };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { response: json({ error: 'invalid_request' }, 400) };
  }
}

/** Solo el código de un error (nunca el mensaje completo ni datos de la solicitud). */
export function errorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' ? code : error instanceof Error ? error.name : 'unknown';
}

/** GET/PUT/PATCH/DELETE de una ruta solo-POST: 404 (no se informa que la ruta existe). */
export const onlyPost = { GET: notFound, PUT: notFound, PATCH: notFound, DELETE: notFound };
