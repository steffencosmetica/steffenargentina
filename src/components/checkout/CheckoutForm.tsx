'use client';

import '@/styles/checkout.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatArs, type Centavos } from '@/lib/money';
import type { CartItem } from '@/lib/cart/types';
import type { ProvinceCoverage } from '@/lib/shipping/quote';
import { describeRejection, type RejectionCode } from '@/lib/orders/errors';
import {
  checkoutFingerprint,
  EMPTY_FORM,
  FIELD_MESSAGES,
  validateForm,
  type CheckoutFormData,
  type FormField,
} from '@/lib/checkout/request';
import { blockedReason, canConfirm, type CheckoutSummary } from '@/lib/checkout/summary';
import { forgetIdempotencyKey, idempotencyKeyFor, rememberOrderToken } from '@/lib/checkout/browser';
import { useCartOptional } from '@/components/cart/CartProvider';
import OrderSummary from './OrderSummary';

// Formulario del checkout (Fase 4B.5). Sin registro. La base decide todo lo comercial:
//   - el resumen (precios, disponibilidad, envío y total) se pide al servidor en cada cambio;
//   - al confirmar se vuelve a cotizar: si el total cambió, se muestra y hay que confirmar de nuevo;
//   - crear_pedido() recalcula todo y rechaza si el total aceptado ya no es el vigente.
// El carrito NUNCA se vacía acá (ni por errores, ni por crear un pedido pendiente de pago): la limpieza se
// coordina con la confirmación del pago en la Fase 5.

type Props = { provinces: ProvinceCoverage[] };

type CreateResponse =
  | { status: 'created' | 'replayed'; code: string; token: string; totalCentavos: Centavos; reservationExpiresAt: string }
  | {
      status: 'rejected';
      error: RejectionCode | 'unknown' | 'human_check_failed';
      fields: FormField[];
      productIds: string[];
      currentTotalCentavos: Centavos | null;
    };

type Banner = { tone: 'warn' | 'error' | 'info'; text: string } | null;

const SUMMARY_URL = '/api/checkout/resumen';
const ORDER_URL = '/api/checkout/pedido';
// reintentos automáticos ante fallas de red, siempre con la MISMA clave de idempotencia
const RETRY_DELAYS = [600, 1500];

async function fetchSummary(items: CartItem[], provinceCode: string | null, signal?: AbortSignal): Promise<CheckoutSummary> {
  const response = await fetch(SUMMARY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, provinceCode }),
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`resumen ${response.status}`);
  return (await response.json()) as CheckoutSummary;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST del pedido; reintenta solo si no hubo respuesta (red) o el servidor no pudo hablar con la base. */
async function postOrder(body: string): Promise<{ ok: true; data: CreateResponse } | { ok: false }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(ORDER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, cache: 'no-store' });
      if (response.status === 502 || response.status === 503 || response.status === 504) throw new Error('reintentable');
      const data = (await response.json()) as CreateResponse | { error: string };
      if (!('status' in data)) return { ok: false };
      return { ok: true, data };
    } catch {
      if (attempt >= RETRY_DELAYS.length) return { ok: false };
      await wait(RETRY_DELAYS[attempt]);
    }
  }
}

export default function CheckoutForm({ provinces }: Props) {
  const cart = useCartOptional();
  const router = useRouter();
  const provinceCodes = useMemo(() => new Set(provinces.map((p) => p.code)), [provinces]);

  const [form, setForm] = useState<CheckoutFormData>(EMPTY_FORM);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [errors, setErrors] = useState<FormField[]>([]);
  const [showSummary, setShowSummary] = useState(false);
  const [summary, setSummary] = useState<CheckoutSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [totalChange, setTotalChange] = useState<{ from: Centavos; to: Centavos } | null>(null);

  const submittingRef = useRef(false);
  const summaryRef = useRef<CheckoutSummary | null>(null);
  summaryRef.current = summary;
  const errorBox = useRef<HTMLDivElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);

  const items = cart?.items ?? [];
  const itemsKey = items.map((i) => `${i.productId}:${i.quantity}`).join(',');
  const province = form.provinceCode || null;

  // --- resumen con datos del servidor ---------------------------------------------------------
  const refresh = useCallback(async (): Promise<CheckoutSummary | null> => {
    const current = cart?.items ?? [];
    if (!current.length) return null;
    const id = ++sequence.current;
    setLoading(true);
    try {
      const fresh = await fetchSummary(current, province);
      if (id === sequence.current) {
        setSummary(fresh);
        setSummaryError(false);
      }
      return fresh;
    } catch {
      if (id === sequence.current) setSummaryError(true);
      return null;
    } finally {
      if (id === sequence.current) setLoading(false);
    }
    // itemsKey resume cart.items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, province]);

  useEffect(() => {
    if (!cart?.hydrated || !itemsKey) return;
    const timer = setTimeout(() => void refresh(), 150);
    return () => clearTimeout(timer);
  }, [cart?.hydrated, itemsKey, refresh]);

  // otra provincia u otras cantidades: el aviso de «total cambiado» ya no corresponde
  useEffect(() => setTotalChange(null), [itemsKey, province]);

  // --- campos ---------------------------------------------------------------------------------
  const update = (field: keyof CheckoutFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
    if (errors.includes(field)) setErrors((list) => list.filter((x) => x !== field));
  };

  const fieldProps = (field: FormField) => {
    const invalid = showSummary && errors.includes(field);
    return {
      id: `ck-${field}`,
      name: field,
      'aria-invalid': invalid || undefined,
      'aria-describedby': invalid ? `ck-${field}-error` : undefined,
    };
  };

  const fieldError = (field: FormField) =>
    showSummary && errors.includes(field) ? (
      <p id={`ck-${field}-error`} className="ck-error" data-testid={`ck-error-${field}`}>
        {FIELD_MESSAGES[field]}
      </p>
    ) : null;

  const showBanner = (next: Banner) => {
    setBanner(next);
    requestAnimationFrame(() => bannerRef.current?.focus());
  };

  // --- confirmación ---------------------------------------------------------------------------
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current || !cart) return; // doble clic / Enter repetido
    submittingRef.current = true;
    setSubmitting(true);
    setBanner(null);
    try {
      await confirm();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function confirm() {
    // 1-2. datos del comprador y dirección
    const invalid = validateForm(form, provinceCodes, acceptTerms);
    setErrors(invalid);
    setShowSummary(true);
    if (invalid.length) {
      requestAnimationFrame(() => errorBox.current?.focus());
      return;
    }

    // 3-6. precios, disponibilidad, límites, cobertura y total vigentes
    const shown = summaryRef.current?.totalCentavos ?? null;
    const fresh = await refresh();
    if (!fresh) {
      showBanner({ tone: 'error', text: 'No pudimos actualizar los precios. Revisá tu conexión e intentá de nuevo.' });
      return;
    }
    const reason = blockedReason(fresh);
    if (!canConfirm(fresh) || fresh.totalCentavos === null) {
      if (fresh.quote.lines.some((l) => l.status !== 'ok')) void cart?.refreshQuote(); // avisos y ajustes del carrito
      showBanner({ tone: 'warn', text: reason ?? 'Revisá tu compra antes de confirmar.' });
      return;
    }
    if (shown === null || fresh.totalCentavos !== shown) {
      // el total cambió desde que lo vio: no se crea nada hasta que confirme el nuevo
      setTotalChange(shown === null ? null : { from: shown, to: fresh.totalCentavos });
      showBanner({
        tone: 'warn',
        text:
          shown === null
            ? `El total de tu compra es ${formatArs(fresh.totalCentavos)}. Revisalo y confirmá.`
            : `El total cambió de ${formatArs(shown)} a ${formatArs(fresh.totalCentavos)} (precio o envío actualizado). Revisá el resumen y confirmá de nuevo.`,
      });
      return;
    }

    // 7. términos aceptados (validado arriba). 8-9. antiabuso y creación transaccional: en el servidor y la base
    const expected = fresh.totalCentavos;
    const orderItems = cart?.items ?? [];
    const key = await idempotencyKeyFor(checkoutFingerprint(form, orderItems, expected));
    const result = await postOrder(JSON.stringify({ idempotencyKey: key, form, items: orderItems, expectedTotalCentavos: expected, acceptTerms: true }));

    if (!result.ok) {
      showBanner({ tone: 'error', text: 'No pudimos confirmar el pedido por un problema de conexión. Tu carrito sigue guardado: intentá de nuevo.' });
      return;
    }
    const data = result.data;
    if (data.status === 'rejected') {
      await handleRejection(data);
      return;
    }
    setTotalChange(null);
    rememberOrderToken(data.code, data.token);
    // el carrito se conserva hasta que el pago se confirme (Fase 5)
    router.push(`/pedido/${data.code}`);
  }

  async function handleRejection(data: Extract<CreateResponse, { status: 'rejected' }>) {
    switch (data.error) {
      case 'invalid_input':
        setErrors(data.fields);
        setShowSummary(true);
        if (data.fields.length) {
          requestAnimationFrame(() => errorBox.current?.focus());
          return;
        }
        break;
      case 'total_mismatch': {
        const before = summaryRef.current?.totalCentavos ?? null;
        const now = await refresh();
        const to = now?.totalCentavos ?? data.currentTotalCentavos;
        if (before !== null && to !== null) setTotalChange({ from: before, to });
        showBanner({
          tone: 'warn',
          text: to !== null && before !== null
            ? `El total cambió de ${formatArs(before)} a ${formatArs(to)} (precio o envío actualizado). Revisá el resumen y confirmá de nuevo.`
            : describeRejection('total_mismatch'),
        });
        return;
      }
      case 'product_unavailable':
      case 'insufficient_stock':
      case 'quantity_limit':
      case 'no_shipping_coverage':
        // el carrito se actualiza con los avisos de cada producto; nada se quita solo
        void cart?.refreshQuote();
        await refresh();
        break;
      case 'idempotency_conflict':
        forgetIdempotencyKey();
        break;
    }
    const text = data.error === 'human_check_failed' ? 'No pudimos verificar la solicitud. Recargá la página e intentá de nuevo.' : describeRejection(data.error);
    showBanner({ tone: data.error === 'checkout_disabled' ? 'info' : 'warn', text });
  }

  // --- render ---------------------------------------------------------------------------------
  if (!cart) return null; // la página solo existe con el carrito habilitado

  if (!cart.hydrated) {
    return (
      <p className="ck-loading" role="status">
        Cargando tu carrito…
      </p>
    );
  }

  if (!items.length) {
    return (
      <div className="ck-empty" data-testid="ck-empty">
        <p>Tu carrito está vacío.</p>
        <Link href="/tienda" className="store-btn" prefetch={false}>
          Ir a la tienda
        </Link>
      </div>
    );
  }

  const reason = blockedReason(summary);
  const disabledByStore = summary !== null && !summary.quote.checkoutEnabled;
  const selected = provinces.find((p) => p.code === form.provinceCode);
  const total = summary?.totalCentavos ?? null;

  return (
    <div className="ck-layout">
      <OrderSummary items={items} summary={summary} loading={loading} onEditCart={() => cart.open()} />

      <form className="ck-form" noValidate onSubmit={onSubmit} aria-describedby="ck-form-note" data-testid="ck-form">
        {disabledByStore && (
          <p className="ck-banner is-info" data-testid="ck-disabled">
            Las compras online todavía no están habilitadas. Podés revisar tu compra; tu carrito queda guardado.
          </p>
        )}

        {showSummary && errors.length > 0 && (
          <div ref={errorBox} className="ck-banner is-error ck-error-summary" role="alert" tabIndex={-1} data-testid="ck-error-summary">
            <p>
              <strong>Revisá {errors.length === 1 ? 'este dato' : `estos ${errors.length} datos`}:</strong>
            </p>
            <ul>
              {errors.map((f) => (
                <li key={f}>
                  <a href={`#ck-${f}`}>{FIELD_MESSAGES[f]}</a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <fieldset className="ck-fieldset">
          <legend>Contacto</legend>
          <p className="ck-hint">No hace falta registrarse. Te escribimos a este email y teléfono por tu pedido.</p>
          <div className="ck-grid">
            <div className="ck-field">
              <label htmlFor="ck-firstName">Nombre</label>
              <input {...fieldProps('firstName')} type="text" autoComplete="given-name" required maxLength={60} value={form.firstName} onChange={update('firstName')} />
              {fieldError('firstName')}
            </div>
            <div className="ck-field">
              <label htmlFor="ck-lastName">Apellido</label>
              <input {...fieldProps('lastName')} type="text" autoComplete="family-name" required maxLength={60} value={form.lastName} onChange={update('lastName')} />
              {fieldError('lastName')}
            </div>
            <div className="ck-field">
              <label htmlFor="ck-email">Email</label>
              <input {...fieldProps('email')} type="email" inputMode="email" autoComplete="email" required maxLength={254} spellCheck={false} value={form.email} onChange={update('email')} />
              {fieldError('email')}
            </div>
            <div className="ck-field">
              <label htmlFor="ck-phone">Teléfono</label>
              <input {...fieldProps('phone')} type="tel" inputMode="tel" autoComplete="tel" required maxLength={30} placeholder="Ej.: 223 555-1234" value={form.phone} onChange={update('phone')} />
              {fieldError('phone')}
            </div>
          </div>
        </fieldset>

        <fieldset className="ck-fieldset">
          <legend>Entrega</legend>
          <div className="ck-grid">
            <div className="ck-field ck-span-2">
              <label htmlFor="ck-provinceCode">Provincia</label>
              <select {...fieldProps('provinceCode')} autoComplete="address-level1" required value={form.provinceCode} onChange={update('provinceCode')}>
                <option value="">Elegí una provincia</option>
                {provinces.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.hasCoverage ? p.name : `${p.name} (sin envíos por ahora)`}
                  </option>
                ))}
              </select>
              {fieldError('provinceCode')}
              {selected && summary?.shipping.status === 'no_coverage' && (
                <p className="ck-warn" role="status" data-testid="ck-no-coverage">
                  Todavía no hacemos envíos a {selected.name}. Podés consultarnos por WhatsApp.
                </p>
              )}
              {summary?.shipping.status === 'ok' && (
                <p className="ck-ok" role="status" data-testid="ck-shipping-note">
                  {summary.shipping.isFree ? 'Envío gratis' : `Envío: ${formatArs(summary.shipping.costCentavos)}`} ({summary.shipping.zoneName})
                </p>
              )}
            </div>
            <div className="ck-field">
              <label htmlFor="ck-city">Localidad</label>
              <input {...fieldProps('city')} type="text" autoComplete="address-level2" required maxLength={80} value={form.city} onChange={update('city')} />
              {fieldError('city')}
            </div>
            <div className="ck-field">
              <label htmlFor="ck-postalCode">Código postal</label>
              <input {...fieldProps('postalCode')} type="text" autoComplete="postal-code" autoCapitalize="characters" required maxLength={10} value={form.postalCode} onChange={update('postalCode')} />
              {fieldError('postalCode')}
            </div>
            <div className="ck-field ck-span-2 ck-street">
              <label htmlFor="ck-street">Calle</label>
              <input {...fieldProps('street')} type="text" autoComplete="address-line1" required maxLength={120} value={form.street} onChange={update('street')} />
              {fieldError('street')}
            </div>
            <div className="ck-field">
              <label htmlFor="ck-number">Número</label>
              <input {...fieldProps('number')} type="text" inputMode="text" autoCapitalize="characters" required maxLength={10} value={form.number} onChange={update('number')} />
              {fieldError('number')}
            </div>
            <div className="ck-field">
              <label htmlFor="ck-unit">
                Piso / depto. <span className="ck-optional">(opcional)</span>
              </label>
              <input {...fieldProps('unit')} type="text" autoComplete="address-line2" maxLength={30} value={form.unit} onChange={update('unit')} />
              {fieldError('unit')}
            </div>
            <div className="ck-field ck-span-2">
              <label htmlFor="ck-notes">
                Indicaciones para la entrega <span className="ck-optional">(opcional)</span>
              </label>
              <textarea {...fieldProps('notes')} rows={3} maxLength={500} value={form.notes} onChange={update('notes')} />
              {fieldError('notes')}
            </div>
          </div>
        </fieldset>

        {/* Facturación: BILLING_FIELDS_ENABLED (src/lib/checkout/request.ts), oculto hasta definirlo con el contador */}

        <div className="ck-field ck-terms">
          <label className="ck-check">
            <input
              {...fieldProps('terms')}
              type="checkbox"
              checked={acceptTerms}
              onChange={(e) => {
                setAcceptTerms(e.target.checked);
                if (e.target.checked) setErrors((list) => list.filter((x) => x !== 'terms'));
              }}
            />
            <span>Acepto los términos y condiciones de compra y la política de privacidad de Steffen.</span>
          </label>
          {fieldError('terms')}
        </div>

        <p id="ck-form-note" className="ck-hint">
          Al confirmar, reservamos los productos por un tiempo limitado. El pago online todavía no está disponible: después de
          confirmar vas a ver el estado de tu pedido.
        </p>

        <div ref={bannerRef} tabIndex={-1} className="ck-banner-slot" aria-live="polite">
          {banner && (
            <p className={`ck-banner is-${banner.tone}`} data-testid="ck-banner" role={banner.tone === 'error' ? 'alert' : undefined}>
              {banner.text}
            </p>
          )}
          {summaryError && !banner && <p className="ck-banner is-error">No pudimos actualizar los precios. Revisá tu conexión.</p>}
        </div>

        {/* barra de confirmación: fija abajo en celulares (con el total), al final del formulario en escritorio */}
        <div className="ck-bar" data-testid="ck-bar">
          <div className="ck-bar-total">
            <span>Total</span>
            <strong data-testid="ck-bar-total">{total !== null ? formatArs(total) : '—'}</strong>
            {totalChange && (
              <span className="ck-bar-change" data-testid="ck-total-change">
                antes {formatArs(totalChange.from)}
              </span>
            )}
          </div>
          <button
            type="submit"
            className="store-btn ck-submit"
            disabled={submitting || disabledByStore}
            aria-describedby={reason ? 'ck-bar-reason' : undefined}
            data-testid="ck-submit"
          >
            {submitting ? 'Confirmando…' : totalChange ? 'Confirmar nuevo total' : 'Confirmar pedido'}
          </button>
          {reason && !disabledByStore && (
            <p id="ck-bar-reason" className="ck-bar-reason" data-testid="ck-reason">
              {reason}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
