import type { NextRequest } from 'next/server';
import { isCartEnabled, quoteCart } from '@/lib/cart/server';
import { parseQuoteRequest } from '@/lib/cart/quote';
import { errorCode, json, notFound, onlyPost, readJsonBody } from '@/lib/http/json-api';

// POST /api/carrito/cotizar — cotización del carrito con datos actuales.
// Con el carrito deshabilitado responde 404 (como si no existiera). Solo lectura: no crea pedidos ni
// reserva stock. No devuelve stock exacto (ver public.cotizar_carrito).

const MAX_BODY = 8_192;

export async function POST(request: NextRequest) {
  if (!isCartEnabled()) return notFound();

  const read = await readJsonBody(request, MAX_BODY);
  if ('response' in read) return read.response;
  const items = parseQuoteRequest(read.body);
  if (!items) return json({ error: 'invalid_request' }, 400);

  try {
    return json(await quoteCart(items));
  } catch (error) {
    console.error('No se pudo cotizar el carrito', errorCode(error));
    return json({ error: 'quote_unavailable' }, 502);
  }
}

// cualquier otro método: 404 (no se informa que la ruta existe)
export const { GET, PUT, PATCH, DELETE } = onlyPost;
