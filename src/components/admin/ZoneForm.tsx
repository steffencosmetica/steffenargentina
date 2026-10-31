'use client';

import { useActionState, useRef, useState } from 'react';
import { saveZoneAction } from '@/app/(admin)/admin/(panel)/envios/actions';
import { IDLE } from '@/lib/admin/action-state';
import { formatPesosInput } from '@/lib/money';
import { REGIONS } from '@/lib/shipping/regions';
import { validateZoneInput, zoneFromForm, type ZoneErrors } from '@/lib/shipping/validation';
import type { AdminProvince, AdminZone } from '@/lib/shipping/admin';
import { ActionNotice, Field, SubmitButton } from './ui';

type Props = {
  zone?: AdminZone;
  provinces: AdminProvince[];
  /** id → nombre de las demás zonas, para avisar cuando una provincia está en otra */
  zoneNames: Record<string, string>;
};

export default function ZoneForm({ zone, provinces, zoneNames }: Props) {
  const [state, formAction] = useActionState(saveZoneAction, IDLE);
  const [clientErrors, setClientErrors] = useState<ZoneErrors>({});
  const [freeEnabled, setFreeEnabled] = useState(zone?.freeFromCentavos != null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(zone?.provinces.map((p) => p.code) ?? []));
  const [pending, setPending] = useState<{ removed: string[]; moved: { name: string; from: string }[] } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const moveRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const byCode = new Map(provinces.map((p) => [p.code, p]));
  const errors: ZoneErrors = { ...(state.status === 'error' ? state.fieldErrors ?? {} : {}), ...clientErrors };

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    // ya confirmado en el diálogo: se envía tal cual
    if (moveRef.current?.value === '1') return;
    const { input, errors: parseErrors } = zoneFromForm(new FormData(event.currentTarget));
    const found = { ...validateZoneInput(input), ...parseErrors };
    setClientErrors(found);
    if (Object.keys(found).length) {
      event.preventDefault();
      return;
    }
    // cambios que hay que confirmar: provincias que pierden cobertura o que se mueven de otra zona
    const removed = (zone?.provinces ?? []).filter((p) => !selected.has(p.code)).map((p) => p.name);
    const moved = [...selected]
      .map((code) => byCode.get(code)!)
      .filter((p) => p.zoneId && p.zoneId !== zone?.id)
      .map((p) => ({ name: p.name, from: zoneNames[p.zoneId!] ?? 'otra zona' }));
    if (removed.length || moved.length) {
      event.preventDefault();
      setPending({ removed, moved });
      dialogRef.current?.showModal();
    }
  }

  function confirm() {
    dialogRef.current?.close();
    if (moveRef.current) moveRef.current.value = '1';
    formRef.current?.requestSubmit();
    // si el servidor rechaza, la próxima vez se vuelve a confirmar
    setTimeout(() => {
      if (moveRef.current) moveRef.current.value = '0';
    }, 0);
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} className="adm-form" noValidate>
      {zone && <input type="hidden" name="id" value={zone.id} />}
      <input ref={moveRef} type="hidden" name="move" defaultValue="0" />
      {Object.keys(clientErrors).length > 0 ? (
        <ActionNotice state={{ status: 'error', message: 'Revisá los campos marcados.' }} />
      ) : (
        <ActionNotice state={state} />
      )}

      <section className="adm-card">
        <div className="adm-card-body">
          <h2 className="adm-section-title">Tarifa</h2>
          <p className="adm-section-help">Costo fijo de envío para todas las provincias de la zona.</p>
          <div className="adm-grid">
            <Field label="Nombre de la zona" name="name" error={errors.name} className="adm-span-2">
              {(p) => <input {...p} className="adm-input" defaultValue={zone?.name} maxLength={80} required />}
            </Field>
            <Field label="Tarifa de envío" name="price" error={errors.price} hint="Ej.: 5.000 o 5.000,50. Puede ser 0.">
              {(p) => (
                <div className="adm-input-prefix">
                  <span>$</span>
                  <input {...p} className="adm-input adm-num" inputMode="decimal" defaultValue={zone ? formatPesosInput(zone.priceCentavos) : ''} required />
                </div>
              )}
            </Field>
            <div className="adm-stack-sm">
              <label className="adm-switch">
                <input type="checkbox" name="freeEnabled" checked={freeEnabled} onChange={(e) => setFreeEnabled(e.target.checked)} />
                <div>
                  <strong>Envío gratis</strong>
                  <span>Desde un importe de compra.</span>
                </div>
              </label>
              {freeEnabled && (
                <Field label="Gratis desde" name="freeFrom" error={errors.freeFrom} hint="Subtotal de productos, sin el envío.">
                  {(p) => (
                    <div className="adm-input-prefix">
                      <span>$</span>
                      <input
                        {...p}
                        className="adm-input adm-num"
                        inputMode="decimal"
                        defaultValue={zone?.freeFromCentavos != null ? formatPesosInput(zone.freeFromCentavos) : ''}
                      />
                    </div>
                  )}
                </Field>
              )}
            </div>
            <label className="adm-switch adm-span-2">
              <input type="checkbox" name="isActive" defaultChecked={zone?.isActive ?? true} />
              <div>
                <strong>Activa</strong>
                <span>Si la desactivás, sus provincias quedan sin cobertura hasta que la reactives.</span>
              </div>
            </label>
          </div>
        </div>
      </section>

      <section className="adm-card" aria-labelledby="provincias-titulo">
        <div className="adm-card-body">
          <h2 className="adm-section-title" id="provincias-titulo">
            Provincias ({selected.size})
          </h2>
          <p className="adm-section-help">Cada provincia puede estar en una sola zona. Las que están en otra zona se indican al lado.</p>
          {errors.provinces && <p className="adm-error">{errors.provinces}</p>}
          <div className="adm-province-groups">
            {REGIONS.map((region) => (
              <fieldset key={region.name} className="adm-province-group">
                <legend>{region.name}</legend>
                {region.codes.map((code) => {
                  const province = byCode.get(code);
                  if (!province) return null;
                  const other = province.zoneId && province.zoneId !== zone?.id ? zoneNames[province.zoneId] : null;
                  return (
                    <label key={code} className="adm-check" data-other={other ? 'true' : undefined}>
                      <input type="checkbox" name="provinces" value={code} checked={selected.has(code)} onChange={() => toggle(code)} />
                      <span>{province.name}</span>
                      {other && <em>en {other}</em>}
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </div>
        </div>
      </section>

      <div className="adm-form-footer">
        <SubmitButton>{zone ? 'Guardar cambios' : 'Crear zona'}</SubmitButton>
      </div>

      <dialog ref={dialogRef} className="adm-dialog" aria-labelledby="zona-confirmar-titulo">
        <div className="adm-dialog-body">
          <h2 id="zona-confirmar-titulo">¿Confirmás los cambios de cobertura?</h2>
          {pending?.removed.length ? (
            <p>
              <strong>Quedan sin cobertura:</strong> {pending.removed.join(', ')}. No se podrán hacer pedidos a esas provincias hasta
              asignarlas a otra zona activa.
            </p>
          ) : null}
          {pending?.moved.length ? (
            <p>
              <strong>Se mueven a esta zona:</strong> {pending.moved.map((m) => `${m.name} (desde ${m.from})`).join(', ')}.
            </p>
          ) : null}
        </div>
        <div className="adm-dialog-footer">
          <button type="button" className="adm-btn" onClick={() => dialogRef.current?.close()}>
            Revisar
          </button>
          <button type="button" className="adm-btn adm-btn-primary" onClick={confirm}>
            Confirmar y guardar
          </button>
        </div>
      </dialog>
    </form>
  );
}
