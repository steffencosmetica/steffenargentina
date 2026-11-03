import { NextResponse, type NextRequest } from 'next/server';
import { isCartEnabled, quoteCart } from '@/lib/cart/server';
import { parseQuoteRequest } from '@/lib/cart/quote';

// POST /api/carrito/cotizar — cotización del carrito con datos actuales.
// Con el carrito deshabilitado responde 404 (como si no existiera). Solo lectura: no crea pedidos ni
// reserva stock. No devuelve stock exacto (ver public.cotizar_carrito).

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_BODY = 8_192;

function sameHost(origin: string, host: string) {
  try {
    return new URL(origin).host === host;
  } catch {
    return false; // "null" u otro valor que no es una URL
  }
}

function notFound() {
  return new NextResponse(null, { status: 404, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  if (!isCartEnabled()) return notFound();

  // solo desde el propio sitio
  const origin = request.headers.get('origin');
  if (origin !== null && !sameHost(origin, request.nextUrl.host)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 415, headers: NO_STORE });
  }
  const text = await request.text();
  if (text.length > MAX_BODY) return NextResponse.json({ error: 'invalid_request' }, { status: 413, headers: NO_STORE });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE });
  }
  const items = parseQuoteRequest(body);
  if (!items) return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE });

  try {
    return NextResponse.json(await quoteCart(items), { headers: NO_STORE });
  } catch (error) {
    console.error('No se pudo cotizar el carrito', (error as { code?: string })?.code ?? (error instanceof Error ? error.message : error));
    return NextResponse.json({ error: 'quote_unavailable' }, { status: 502, headers: NO_STORE });
  }
}

// cualquier otro método: 404 (no se informa que la ruta existe)
export const GET = () => notFound();
export const PUT = () => notFound();
export const PATCH = () => notFound();
export const DELETE = () => notFound();
