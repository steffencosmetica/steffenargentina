import type { NextRequest } from 'next/server';
import { buildSummary, isCheckoutAvailable } from '@/lib/checkout/server';
import { parseSummaryRequest } from '@/lib/checkout/request';
import { errorCode, json, notFound, onlyPost, readJsonBody } from '@/lib/http/json-api';
import { ShippingQuoteError } from '@/lib/shipping/quote';

// POST /api/checkout/resumen — carrito cotizado + envío a la provincia elegida + total, con datos actuales.
// Solo lectura (no reserva ni crea nada). 404 si el checkout no está disponible en este despliegue.

const MAX_BODY = 8_192;

export async function POST(request: NextRequest) {
  if (!isCheckoutAvailable()) return notFound();

  const read = await readJsonBody(request, MAX_BODY);
  if ('response' in read) return read.response;
  const parsed = parseSummaryRequest(read.body);
  if (!parsed) return json({ error: 'invalid_request' }, 400);

  try {
    return json(await buildSummary(parsed.items, parsed.provinceCode));
  } catch (error) {
    if (error instanceof ShippingQuoteError) return json({ error: 'invalid_request' }, 400);
    console.error('No se pudo armar el resumen del checkout', errorCode(error));
    return json({ error: 'summary_unavailable' }, 502);
  }
}

export const { GET, PUT, PATCH, DELETE } = onlyPost;
