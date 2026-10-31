'use client';

import { useActionState } from 'react';
import {
  toggleProductActiveAction,
  toggleProductFeaturedAction,
  updatePriceAction,
  updateStockAction,
} from '@/app/(admin)/admin/(panel)/productos/actions';
import { IDLE } from '@/lib/admin/action-state';
import { formatPesosInput } from '@/lib/money';
import { IconStar } from './icons';
import { useFlash } from './ui';

// Controles de edición rápida de una fila del listado de productos.

function QuickMessage({ state }: { state: ReturnType<typeof useFlash> }) {
  if (!state || state.status === 'idle') return null;
  return (
    <span className={`adm-quick-msg ${state.status === 'error' ? 'is-error' : 'is-ok'}`} role={state.status === 'error' ? 'alert' : 'status'}>
      {state.status === 'error' ? state.message : '✓'}
    </span>
  );
}

export function QuickPrice({ id, priceCentavos, name }: { id: string; priceCentavos: number; name: string }) {
  const [state, action, pending] = useActionState(updatePriceAction, IDLE);
  const flash = useFlash(state);
  return (
    <form action={action} className="adm-quick">
      <input type="hidden" name="id" value={id} />
      <div className="adm-input-prefix">
        <span>$</span>
        <input
          className="adm-input"
          name="price"
          inputMode="decimal"
          defaultValue={formatPesosInput(priceCentavos)}
          aria-label={`Precio de ${name}`}
          aria-invalid={state.status === 'error' || undefined}
          readOnly={pending}
        />
      </div>
      <button type="submit" className="adm-btn adm-btn-sm" disabled={pending} aria-label={`Guardar precio de ${name}`}>
        {pending ? '…' : 'OK'}
      </button>
      <QuickMessage state={flash} />
    </form>
  );
}

export function QuickStock({ id, stock, name }: { id: string; stock: number; name: string }) {
  const [state, action, pending] = useActionState(updateStockAction, IDLE);
  const flash = useFlash(state);
  return (
    <form action={action} className="adm-quick">
      <input type="hidden" name="id" value={id} />
      <input
        className="adm-input adm-input-stock"
        name="stock"
        inputMode="numeric"
        defaultValue={stock}
        aria-label={`Stock de ${name}`}
        aria-invalid={state.status === 'error' || undefined}
        readOnly={pending}
      />
      <button type="submit" className="adm-btn adm-btn-sm" disabled={pending} aria-label={`Guardar stock de ${name}`}>
        {pending ? '…' : 'OK'}
      </button>
      <QuickMessage state={flash} />
    </form>
  );
}

export function ActiveToggle({ id, isActive, name }: { id: string; isActive: boolean; name: string }) {
  const [state, action, pending] = useActionState(toggleProductActiveAction, IDLE);
  return (
    <form action={action} className="adm-quick">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="value" value={String(!isActive)} />
      <button
        type="submit"
        className={`adm-badge adm-badge-btn ${isActive ? 'adm-badge-on' : 'adm-badge-off'}`}
        disabled={pending}
        aria-label={`${isActive ? 'Desactivar' : 'Activar'} ${name}`}
        title={isActive ? 'Clic para desactivar' : 'Clic para activar'}
      >
        {isActive ? 'Activo' : 'Inactivo'}
      </button>
      {state.status === 'error' && <span className="adm-quick-msg is-error" role="alert">{state.message}</span>}
    </form>
  );
}

export function FeaturedToggle({ id, isFeatured, name }: { id: string; isFeatured: boolean; name: string }) {
  const [state, action, pending] = useActionState(toggleProductFeaturedAction, IDLE);
  return (
    <form action={action} className="adm-quick">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="value" value={String(!isFeatured)} />
      <button
        type="submit"
        className="adm-icon-btn"
        aria-pressed={isFeatured}
        disabled={pending}
        aria-label={`${isFeatured ? 'Quitar de destacados' : 'Marcar como destacado'}: ${name}`}
        title={isFeatured ? 'Destacado (clic para quitar)' : 'Marcar como destacado'}
      >
        <IconStar filled={isFeatured} />
      </button>
      {state.status === 'error' && <span className="adm-quick-msg is-error" role="alert">{state.message}</span>}
    </form>
  );
}
