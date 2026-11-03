'use client';

import '@/styles/checkout.css';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatArs } from '@/lib/money';
import { FULFILLMENT_LABEL, PAYMENT_LABEL, TOKEN_FRAGMENT, tokenFromHash, type OrderView } from '@/lib/checkout/order-view';
import { orderTokenFor, rememberOrderToken } from '@/lib/checkout/browser';
import { ONLINE_PAYMENTS_ENABLED } from '@/lib/orders/payment';

// Estado de un pedido. El token privado:
//   - llega en el fragmento del enlace (#t=…), que el navegador nunca envía al servidor, o desde esta misma
//     pestaña (sessionStorage) después de confirmar la compra;
//   - se quita de la barra de direcciones apenas se lee (no queda en el historial ni se copia por error);
//   - viaja solo en el CUERPO de un POST a /api/pedido/consultar (nunca en una URL ni en el Referer).
// Sin token válido se muestra lo mismo que para un pedido inexistente.

type State =
  | { kind: 'loading' }
  | { kind: 'missing' } // sin token o código mal formado
  | { kind: 'not_found' }
  | { kind: 'error' }
  | { kind: 'ok'; order: OrderView; token: string };

// horario de Argentina en formato de 24 h («3 de noviembre de 2026, 12:37»; «hasta las 13:07»)
const TZ = 'America/Argentina/Buenos_Aires';
const dateFormat = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ });
const timeFormat = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ });

export default function OrderStatus({ code }: { code: string | null }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fromHash = tokenFromHash(window.location.hash);
    if (window.location.hash) {
      // el token deja de estar en la URL antes de cualquier otra cosa
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    }
    if (!code) {
      setState({ kind: 'missing' });
      return;
    }
    if (fromHash) rememberOrderToken(code, fromHash);
    const token = fromHash ?? orderTokenFor(code);
    if (!token) {
      setState({ kind: 'missing' });
      return;
    }
    const controller = new AbortController();
    fetch('/api/pedido/consultar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, token }),
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) return setState({ kind: 'not_found' });
        if (!response.ok) return setState({ kind: 'error' });
        setState({ kind: 'ok', order: (await response.json()) as OrderView, token });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'error' });
      });
    return () => controller.abort();
  }, [code]);

  if (state.kind === 'loading') {
    return (
      <p className="ck-loading" role="status">
        Buscando tu pedido…
      </p>
    );
  }

  if (state.kind !== 'ok') {
    return (
      <div className="ck-empty" data-testid="order-not-found" role={state.kind === 'error' ? 'alert' : undefined}>
        {state.kind === 'error' ? (
          <p>No pudimos consultar el pedido. Revisá tu conexión e intentá de nuevo.</p>
        ) : (
          <>
            <p>No encontramos un pedido con este enlace.</p>
            <p className="ck-hint">Para ver el estado necesitás el enlace privado que se mostró al confirmar la compra.</p>
          </>
        )}
        <Link href="/tienda" className="store-btn store-btn-ghost" prefetch={false}>
          Volver a la tienda
        </Link>
      </div>
    );
  }

  const { order, token } = state;
  const pending = order.paymentStatus === 'pending';
  const privateLink = `${window.location.origin}/pedido/${order.code}#${TOKEN_FRAGMENT}=${token}`;

  return (
    <div className="ck-order" data-testid="order-status">
      <section className="ck-card ck-order-head" aria-labelledby="ck-order-code">
        <p className="ck-kicker">Pedido</p>
        <h2 id="ck-order-code" className="ck-order-code" data-testid="order-code">
          {order.code}
        </h2>
        <p className="ck-hint">Realizado el {dateFormat.format(new Date(order.createdAt))}</p>
        <dl className="ck-states">
          <div>
            <dt>Pago</dt>
            <dd data-testid="order-payment" data-status={order.paymentStatus}>
              {PAYMENT_LABEL[order.paymentStatus]}
            </dd>
          </div>
          <div>
            <dt>Envío</dt>
            <dd data-testid="order-fulfillment" data-status={order.fulfillmentStatus}>
              {FULFILLMENT_LABEL[order.fulfillmentStatus]}
            </dd>
          </div>
        </dl>
        {order.needsAttention && <p className="ck-banner is-warn">Estamos revisando tu pedido y te vamos a contactar.</p>}
      </section>

      {pending && (
        <section className="ck-card ck-pay" aria-labelledby="ck-pay-title" data-testid="order-payment-panel">
          <h2 id="ck-pay-title">Pago</h2>
          {ONLINE_PAYMENTS_ENABLED ? null : (
            <p>
              El pago online todavía no está disponible.
              {order.reservationExpiresAt && ` Reservamos tus productos hasta las ${timeFormat.format(new Date(order.reservationExpiresAt))} (hora de Argentina).`}
            </p>
          )}
          <p className="ck-hint">Tu carrito sigue guardado en este dispositivo hasta que el pago se confirme.</p>
        </section>
      )}

      <section className="ck-card" aria-labelledby="ck-items-title">
        <h2 id="ck-items-title">Productos</h2>
        <ul className="ck-lines">
          {order.items.map((item) => (
            <li key={item.sku} className="ck-line ck-line-plain" data-testid="order-line">
              <span className="ck-line-info">
                <span className="ck-line-name">{item.name}</span>
                <span className="ck-line-meta">
                  {item.quantity} × {formatArs(item.unitPriceCentavos)}
                </span>
              </span>
              <span className="ck-line-total">{formatArs(item.lineTotalCentavos)}</span>
            </li>
          ))}
        </ul>
        <dl className="ck-totals">
          <div>
            <dt>Subtotal</dt>
            <dd data-testid="order-subtotal">{formatArs(order.subtotalCentavos)}</dd>
          </div>
          <div>
            <dt>Envío{order.province ? ` a ${order.province}` : ''}</dt>
            <dd data-testid="order-shipping">{order.shippingCentavos === 0 ? 'Gratis' : formatArs(order.shippingCentavos)}</dd>
          </div>
          <div className="ck-total-row">
            <dt>Total</dt>
            <dd data-testid="order-total">{formatArs(order.totalCentavos)}</dd>
          </div>
        </dl>
      </section>

      <section className="ck-card ck-private" aria-labelledby="ck-private-title">
        <h2 id="ck-private-title">Enlace privado</h2>
        <p className="ck-hint">
          Guardalo para volver a ver este pedido. Es personal: quien lo tenga puede ver el estado y los productos (no tus datos de
          contacto ni tu dirección).
        </p>
        <button
          type="button"
          className="store-btn store-btn-ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(privateLink);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
          data-testid="order-copy-link"
        >
          {copied ? 'Enlace copiado' : 'Copiar enlace privado'}
        </button>
        <span className="ck-sr-only" role="status">
          {copied ? 'Enlace copiado' : ''}
        </span>
      </section>
    </div>
  );
}
