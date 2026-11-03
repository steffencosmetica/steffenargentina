import type { NextRequest } from 'next/server';
import { isCheckoutAvailable, lookupOrder } from '@/lib/checkout/server';
import { isOrderCode, isOrderToken } from '@/lib/checkout/order-view';
import { errorCode, json, notFound, onlyPost, readJsonBody } from '@/lib/http/json-api';

// POST /api/pedido/consultar — estado de un pedido con su código y su token privado.
// El token llega en el CUERPO (nunca en la URL: no queda en logs del servidor, del proxy ni en el Referer).
// Código inexistente, token incorrecto o mal formado: la misma respuesta 404, sin revelar si el pedido existe.

const MAX_BODY = 1_024;
const NOT_FOUND = { error: 'not_found' };

export async function POST(request: NextRequest) {
  if (!isCheckoutAvailable()) return notFound();

  const read = await readJsonBody(request, MAX_BODY);
  if ('response' in read) return read.response;
  const body = read.body as { code?: unknown; token?: unknown } | null;
  if (!body || typeof body !== 'object' || Object.keys(body).length !== 2 || !isOrderCode(body.code) || !isOrderToken(body.token)) {
    return json(NOT_FOUND, 404);
  }

  try {
    const order = await lookupOrder(body.code, body.token);
    return order ? json(order) : json(NOT_FOUND, 404);
  } catch (error) {
    console.error('No se pudo consultar el pedido', errorCode(error));
    return json({ error: 'lookup_unavailable' }, 502);
  }
}

export const { GET, PUT, PATCH, DELETE } = onlyPost;
