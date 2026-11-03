'use client';

import { useId, useState } from 'react';
import Image from 'next/image';
import { formatArs } from '@/lib/money';
import type { CartItem, QuoteLine } from '@/lib/cart/types';
import type { CheckoutSummary } from '@/lib/checkout/summary';

// Resumen de la compra. Todos los importes vienen del servidor (CheckoutSummary); el carrito del navegador
// solo aporta qué productos y cuántos. En celulares se pliega (el total queda siempre a la vista en la
// barra inferior); en escritorio está siempre abierto y fijo al costado.

const STATUS_TEXT: Record<QuoteLine['status'], string | null> = {
  ok: null,
  unavailable: 'Ya no está disponible',
  out_of_stock: 'Sin stock',
  exceeds_limit: 'Cantidad mayor a la permitida',
  exceeds_stock: 'No hay unidades suficientes',
};

export default function OrderSummary({
  items,
  summary,
  loading,
  onEditCart,
}: {
  items: CartItem[];
  summary: CheckoutSummary | null;
  loading: boolean;
  onEditCart: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const lineOf = (id: string) => summary?.quote.lines.find((l) => l.productId === id);
  const total = summary?.totalCentavos ?? null;
  const shipping = summary?.shipping;

  return (
    <aside className="ck-summary" aria-labelledby={`${panelId}-title`} data-testid="ck-summary" aria-busy={loading}>
      <h2 id={`${panelId}-title`} className="ck-summary-title">
        <button type="button" className="ck-summary-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
          <span>Resumen de compra</span>
          <span className="ck-summary-toggle-total">{total !== null ? formatArs(total) : summary ? formatArs(summary.quote.subtotalCentavos) : '—'}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <span className="ck-summary-heading">Resumen de compra</span>
      </h2>

      <div id={panelId} className={open ? 'ck-summary-body is-open' : 'ck-summary-body'}>
        <ul className="ck-lines" aria-label="Productos">
          {items.map((item) => {
            const line = lineOf(item.productId);
            const status = line?.status;
            const name = line ? (line.name ?? 'Producto no disponible') : 'Cargando…';
            return (
              <li key={item.productId} className="ck-line" data-testid="ck-line" data-status={status ?? 'loading'}>
                <span className="ck-line-img">
                  {line?.imageUrl ? <Image src={line.imageUrl} alt="" fill sizes="64px" /> : <img src="/img/logo.png" alt="" className="ck-line-noimg" />}
                  <span className="ck-line-qty" aria-hidden="true">
                    {item.quantity}
                  </span>
                </span>
                <span className="ck-line-info">
                  <span className="ck-line-name">{name}</span>
                  <span className="ck-line-meta">
                    {item.quantity} × {line?.priceCentavos != null && status !== 'unavailable' ? formatArs(line.priceCentavos) : '—'}
                  </span>
                  {status && STATUS_TEXT[status] && (
                    <span className="ck-line-status" data-testid="ck-line-status">
                      {STATUS_TEXT[status]}
                    </span>
                  )}
                </span>
                <span className="ck-line-total" data-testid="ck-line-total">
                  {line?.lineTotalCentavos != null ? formatArs(line.lineTotalCentavos) : ''}
                </span>
              </li>
            );
          })}
        </ul>
        <button type="button" className="ck-link" onClick={onEditCart}>
          Editar carrito
        </button>

        <dl className="ck-totals">
          <div>
            <dt>Subtotal</dt>
            <dd data-testid="ck-subtotal">{summary ? formatArs(summary.quote.subtotalCentavos) : '—'}</dd>
          </div>
          <div>
            <dt>Envío{shipping?.status === 'ok' ? ` (${shipping.zoneName})` : ''}</dt>
            <dd data-testid="ck-shipping">
              {!shipping || shipping.status === 'pending'
                ? 'Elegí la provincia'
                : shipping.status === 'no_coverage'
                  ? 'Sin cobertura'
                  : shipping.isFree
                    ? 'Gratis'
                    : formatArs(shipping.costCentavos)}
            </dd>
          </div>
          <div className="ck-total-row">
            <dt>Total</dt>
            <dd data-testid="ck-total">{total !== null ? formatArs(total) : '—'}</dd>
          </div>
        </dl>
        {shipping?.status === 'ok' && !shipping.isFree && shipping.freeFromCentavos !== null && (
          <p className="ck-free-hint">Envío gratis desde {formatArs(shipping.freeFromCentavos)} a esta zona.</p>
        )}
      </div>
    </aside>
  );
}
