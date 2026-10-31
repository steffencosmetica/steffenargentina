'use client';

import { useActionState } from 'react';
import { simulateQuoteAction } from '@/app/(admin)/admin/(panel)/envios/actions';
import { IDLE } from '@/lib/admin/action-state';
import { ActionNotice, SubmitButton } from './ui';

/** Prueba la cotización con la misma función que usará el checkout. */
export default function QuoteSimulator({ provinces }: { provinces: { code: string; name: string }[] }) {
  const [state, action] = useActionState(simulateQuoteAction, IDLE);
  return (
    <form action={action} className="adm-stack" data-testid="quote-simulator">
      <div className="adm-grid">
        <div className="adm-field">
          <label htmlFor="sim-province">Provincia</label>
          <select id="sim-province" name="province" className="adm-select" defaultValue="AR-C">
            {provinces.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="adm-field">
          <label htmlFor="sim-subtotal">Subtotal de productos</label>
          <div className="adm-input-prefix">
            <span>$</span>
            <input id="sim-subtotal" name="subtotal" className="adm-input adm-num" inputMode="decimal" defaultValue="25.000" />
          </div>
        </div>
      </div>
      <div>
        <SubmitButton className="adm-btn" pendingText="Cotizando…">
          Cotizar
        </SubmitButton>
      </div>
      <ActionNotice state={state} />
    </form>
  );
}
