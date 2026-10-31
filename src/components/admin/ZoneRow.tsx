'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { deleteZoneAction, moveZoneAction, toggleZoneActiveAction } from '@/app/(admin)/admin/(panel)/envios/actions';
import { IDLE } from '@/lib/admin/action-state';
import { formatArs } from '@/lib/money';
import type { AdminZone } from '@/lib/shipping/admin';
import { IconDown, IconTrash, IconUp } from './icons';
import { ConfirmButton, Notice } from './ui';

export default function ZoneRow({ zone, index, total }: { zone: AdminZone; index: number; total: number }) {
  const [moveState, moveAction, movePending] = useActionState(moveZoneAction, IDLE);
  const [activeState, activeAction, activePending] = useActionState(toggleZoneActiveAction, IDLE);
  const [deleteState, deleteAction] = useActionState(deleteZoneAction, IDLE);
  const error = [moveState, activeState, deleteState].find((s) => s.status === 'error');
  const count = zone.provinces.length;

  return (
    <li data-testid="zone-row">
      <div className="adm-order">
        <form action={moveAction}>
          <input type="hidden" name="id" value={zone.id} />
          <input type="hidden" name="direction" value="up" />
          <button type="submit" className="adm-icon-btn" disabled={index === 0 || movePending} aria-label={`Subir ${zone.name}`}>
            <IconUp />
          </button>
        </form>
        <form action={moveAction}>
          <input type="hidden" name="id" value={zone.id} />
          <input type="hidden" name="direction" value="down" />
          <button type="submit" className="adm-icon-btn" disabled={index === total - 1 || movePending} aria-label={`Bajar ${zone.name}`}>
            <IconDown />
          </button>
        </form>
      </div>

      <div className="adm-list-main">
        <Link href={`/admin/envios/${zone.id}`}>{zone.name}</Link>
        <span className="adm-list-meta adm-num">
          {formatArs(zone.priceCentavos)}
          {zone.freeFromCentavos !== null && ` · gratis desde ${formatArs(zone.freeFromCentavos)}`}
        </span>
        <span className="adm-list-meta">
          {count ? `${count} provincia${count === 1 ? '' : 's'}: ${zone.provinces.map((p) => p.name).join(', ')}` : 'Sin provincias'}
        </span>
        {error && error.status === 'error' && <Notice kind="error">{error.message}</Notice>}
        {activeState.status === 'ok' && !zone.isActive && <Notice kind="warning">{activeState.message}</Notice>}
      </div>

      <div className="adm-actions">
        <form action={activeAction}>
          <input type="hidden" name="id" value={zone.id} />
          <input type="hidden" name="value" value={String(!zone.isActive)} />
          <button
            type="submit"
            className={`adm-badge adm-badge-btn ${zone.isActive ? 'adm-badge-on' : 'adm-badge-off'}`}
            disabled={activePending}
            aria-label={`${zone.isActive ? 'Desactivar' : 'Activar'} ${zone.name}`}
          >
            {zone.isActive ? 'Activa' : 'Inactiva'}
          </button>
        </form>
        <Link href={`/admin/envios/${zone.id}`} className="adm-btn adm-btn-sm">
          Editar
        </Link>
        <form action={deleteAction}>
          <input type="hidden" name="id" value={zone.id} />
          <ConfirmButton
            className="adm-icon-btn"
            aria-label={count ? `No se puede eliminar ${zone.name}: tiene provincias` : `Eliminar ${zone.name}`}
            disabled={count > 0}
            title={`¿Eliminar «${zone.name}»?`}
            description="La zona no tiene provincias asignadas. Esta acción no se puede deshacer."
          >
            <IconTrash />
          </ConfirmButton>
        </form>
      </div>
    </li>
  );
}
