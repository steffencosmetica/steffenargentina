import 'server-only';
import { NextRequest, type NextResponse } from 'next/server';
import { json, readJsonBody } from '@/lib/http/json-api';
import { clientIpFor } from '@/lib/orders/client-ip';

// Utilidades compartidas por las rutas públicas del arrepentimiento (recepción, recuperación y canje).

/** Lee un JSON del mismo origen con límite de bytes REAL (también para cuerpos sin content-length). */
export async function readBoundedJson(request: NextRequest, maxBytes: number): Promise<{ body: unknown } | { response: NextResponse }> {
  if (Number(request.headers.get('content-length')) > maxBytes) return { response: json({ error: 'invalid_request' }, 413) };
  const reader = request.body?.getReader();
  if (!reader) return { response: json({ error: 'invalid_request' }, 400) };
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return { response: json({ error: 'invalid_request' }, 413) };
    }
    chunks.push(part.value);
  }
  const copy = new NextRequest(request.url, { method: 'POST', headers: request.headers, body: Buffer.concat(chunks) });
  // Reutiliza los controles de mismo origen y JSON después de la lectura acotada.
  return readJsonBody(copy, maxBytes);
}

/** IP confiable para los límites antiabuso (la base solo guarda su HMAC). null: no se puede atender. */
export function revocationClientIp(request: NextRequest): string | null {
  return clientIpFor(request.headers, process.env);
}
