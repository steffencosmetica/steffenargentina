'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { formatArs } from '@/lib/money';
import { CHECKOUT_PAGE_READY, CHECKOUT_PATH, type QuoteLine } from '@/lib/cart/types';
import { useCartOptional } from './CartProvider';

// Panel lateral del carrito: diálogo modal (foco atrapado, Escape, foco de vuelta a quien lo abrió,
// fondo sin scroll). 420 px desde la derecha en escritorio, ancho completo en celulares.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

const STATUS_TEXT: Record<QuoteLine['status'], string | null> = {
  ok: null,
  unavailable: 'Ya no está disponible',
  out_of_stock: 'Sin stock',
  exceeds_limit: 'Cantidad mayor a la permitida',
  exceeds_stock: 'No hay unidades suficientes',
};

export default function CartDrawer() {
  const cart = useCartOptional();
  const panel = useRef<HTMLDivElement>(null);
  const isOpen = cart?.isOpen ?? false;
  const close = cart?.close;

  useEffect(() => {
    if (!isOpen || !close) return;
    panel.current?.querySelector<HTMLElement>('.cart-close')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !panel.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.documentElement.classList.add('cart-open');
    window.addEventListener('keydown', onKey);
    return () => {
      document.documentElement.classList.remove('cart-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, close]);

  if (!cart || !cart.isOpen) return null;

  const { items, units, quote, limits, notices, feedback, quoting, quoteError } = cart;
  const lineOf = (id: string) => quote?.lines.find((l) => l.productId === id);
  const hasProblems = items.some((i) => {
    const line = lineOf(i.productId);
    return line && line.status !== 'ok';
  });
  const showFeedback = feedback && Date.now() - feedback.at < 15_000;

  return (
    <div className="cart-layer">
      <button type="button" className="cart-backdrop" aria-label="Cerrar carrito" tabIndex={-1} onClick={cart.close} />
      <div
        ref={panel}
        id="cart-drawer"
        className="cart-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-title"
        data-testid="cart-drawer"
      >
        <header className="cart-head">
          <h2 id="cart-title">Mi carrito</h2>
          <span className="cart-head-count" data-testid="cart-drawer-count">
            {units} {units === 1 ? 'unidad' : 'unidades'}
          </span>
          <button type="button" className="cart-close" aria-label="Cerrar carrito" onClick={cart.close}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        {(showFeedback || notices.length > 0) && (
          <div className="cart-notices">
            {showFeedback && (
              <p className={feedback.ok ? 'cart-notice is-ok' : 'cart-notice is-warn'} data-testid="cart-feedback">
                {feedback.text}
              </p>
            )}
            {notices.map((n) => (
              <p key={n} className="cart-notice is-warn" data-testid="cart-notice">
                {n}
              </p>
            ))}
            {notices.length > 0 && (
              <button type="button" className="cart-link" onClick={cart.dismissNotices}>
                Entendido
              </button>
            )}
          </div>
        )}

        {items.length === 0 ? (
          <div className="cart-empty" data-testid="cart-empty">
            <p>Tu carrito está vacío.</p>
            <Link href="/tienda" prefetch={false} className="cart-btn cart-btn-primary" onClick={cart.close}>
              Ir a la tienda
            </Link>
          </div>
        ) : (
          <ul className="cart-lines" aria-label="Productos en el carrito" aria-busy={quoting}>
            {items.map((item) => {
              const line = lineOf(item.productId);
              // sin cotización todavía: «Cargando…»; cotizado sin nombre (producto oculto o inexistente, la base
              // no lo revela): «Producto no disponible»
              const name = line ? (line.name ?? 'Producto no disponible') : 'Cargando…';
              const status = line?.status;
              const blocked = status === 'unavailable' || status === 'out_of_stock';
              const cap = limits ? Math.min(limits.maxUnitsPerProduct, line?.maxQuantity ?? limits.maxUnitsPerProduct) : 0;
              const canIncrease = !!limits && !blocked && item.quantity < cap && units < limits.maxUnitsPerOrder;
              const price = line?.priceCentavos;
              return (
                <li key={item.productId} className="cart-line" data-testid="cart-line" data-status={status ?? 'loading'}>
                  <span className="cart-line-img">
                    {line?.imageUrl ? (
                      <Image src={line.imageUrl} alt="" fill sizes="72px" />
                    ) : (
                      <img src="/img/logo.png" alt="" className="cart-line-noimg" />
                    )}
                  </span>
                  <div className="cart-line-info">
                    {line?.slug && !blocked ? (
                      <Link href={`/tienda/${line.slug}`} prefetch={false} className="cart-line-name" onClick={cart.close}>
                        {name}
                      </Link>
                    ) : (
                      <span className="cart-line-name">{name}</span>
                    )}
                    <span className="cart-line-price">
                      {price != null && status !== 'unavailable' ? `${formatArs(price)} c/u` : ''}
                    </span>
                    {status && STATUS_TEXT[status] && (
                      <span className="cart-line-status" data-testid="cart-line-status">
                        {STATUS_TEXT[status]}
                      </span>
                    )}
                    <div className="cart-line-actions">
                      <div className="cart-qty" role="group" aria-label={`Cantidad de ${name}`}>
                        <button
                          type="button"
                          aria-label={`Restar una unidad de ${name}`}
                          disabled={item.quantity <= 1 || !limits}
                          onClick={() => cart.setQuantity(item.productId, item.quantity - 1)}
                        >
                          −
                        </button>
                        <span aria-live="off" data-testid="cart-line-qty">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label={`Sumar una unidad de ${name}`}
                          disabled={!canIncrease}
                          onClick={() => cart.setQuantity(item.productId, item.quantity + 1)}
                        >
                          +
                        </button>
                      </div>
                      <button type="button" className="cart-link cart-remove" onClick={() => cart.remove(item.productId)} aria-label={`Quitar ${name} del carrito`}>
                        Quitar
                      </button>
                    </div>
                  </div>
                  <span className="cart-line-total" data-testid="cart-line-total">
                    {line?.lineTotalCentavos != null && line.quantity === item.quantity ? formatArs(line.lineTotalCentavos) : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {items.length > 0 && (
          <footer className="cart-foot">
            {quoteError && <p className="cart-notice is-warn">No pudimos actualizar los precios. Revisá tu conexión.</p>}
            <div className="cart-subtotal">
              <span>Subtotal</span>
              <strong data-testid="cart-subtotal">{quote ? formatArs(quote.subtotalCentavos) : '—'}</strong>
            </div>
            <p className="cart-foot-note">
              {hasProblems ? 'Los productos no disponibles no se suman al subtotal. ' : ''}El envío se calcula al finalizar la compra.
            </p>
            {CHECKOUT_PAGE_READY ? (
              <Link href={CHECKOUT_PATH} className="cart-btn cart-btn-primary" prefetch={false}>
                Finalizar compra
              </Link>
            ) : (
              <>
                <button type="button" className="cart-btn cart-btn-primary" disabled aria-describedby="cart-checkout-note" data-testid="cart-checkout">
                  Finalizar compra
                </button>
                <p id="cart-checkout-note" className="cart-foot-note">
                  La compra online estará disponible muy pronto. Tu carrito queda guardado en este dispositivo.
                </p>
              </>
            )}
            <button type="button" className="cart-btn cart-btn-ghost" onClick={cart.close}>
              Seguir comprando
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
