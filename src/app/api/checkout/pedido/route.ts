import type { NextRequest } from 'next/server';
import { clientIp, createOrder, humanCheck, isCheckoutAvailable } from '@/lib/checkout/server';
import { formFieldsFromDb, parseCreateOrderRequest, validateForm } from '@/lib/checkout/request';
import { errorCode, json, notFound, onlyPost, readJsonBody } from '@/lib/http/json-api';
import { PROVINCE_CODES } from '@/lib/shipping/regions';
import { scheduleMailDrain } from '@/lib/mail/server';

// POST /api/checkout/pedido — crea el pedido y reserva el stock con public.crear_pedido().
//
// - 404 si el checkout no está disponible en este despliegue (Preview / Production).
// - La base es la autoridad: vuelve a validar los datos, verifica checkout_enabled, precios, stock, límites,
//   cobertura y que el total coincida con el que aceptó el comprador, y aplica idempotencia y antiabuso.
// - Mismo cuerpo y misma clave (doble clic, reintento de red) → el mismo pedido ("replayed").
// - El token del pedido solo viaja en esta respuesta (POST, sin caché). Nada de la solicitud se loguea.

const MAX_BODY = 16_384;
const PROVINCES = new Set(PROVINCE_CODES);

export async function POST(request: NextRequest) {
  if (!isCheckoutAvailable()) return notFound();

  const read = await readJsonBody(request, MAX_BODY);
  if ('response' in read) return read.response;
  const order = parseCreateOrderRequest(read.body);
  if (!order) return json({ error: 'invalid_request' }, 400);

  // mismas reglas que la base, para responder con el detalle por campo sin gastar un intento
  const fields = validateForm(order.form, PROVINCES, order.acceptTerms);
  if (fields.length) return json({ status: 'rejected', error: 'invalid_input', fields, productIds: [], currentTotalCentavos: null }, 422);

  if (!humanCheck()) return json({ status: 'rejected', error: 'human_check_failed', fields: [], productIds: [], currentTotalCentavos: null }, 403);

  const ip = await clientIp();
  if (!ip) {
    console.error('Checkout sin IP de cliente confiable');
    return json({ error: 'order_unavailable' }, 500);
  }

  try {
    const result = await createOrder(order, ip);
    if (result.status === 'rejected') {
      return json({ ...result, fields: formFieldsFromDb(result.fields) }, 409);
    }
    scheduleMailDrain();
    return json({
      status: result.status,
      code: result.code,
      token: result.token,
      totalCentavos: result.totalCentavos,
      reservationExpiresAt: result.reservationExpiresAt,
    });
  } catch (error) {
    // el navegador puede reintentar con la MISMA clave: si el pedido llegó a crearse, recibe el mismo
    console.error('No se pudo crear el pedido', errorCode(error));
    return json({ error: 'order_unavailable' }, 502);
  }
}

export const { GET, PUT, PATCH, DELETE } = onlyPost;
