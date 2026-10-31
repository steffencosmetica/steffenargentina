'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { deleteCategoryAction, moveCategoryAction, toggleCategoryActiveAction } from '@/app/(admin)/admin/(panel)/categorias/actions';
import { IDLE } from '@/lib/admin/action-state';
import type { AdminCategory } from '@/lib/catalog/admin-queries';
import { IconDown, IconTrash, IconUp } from './icons';
import { ConfirmButton, Notice } from './ui';

export default function CategoryRow({ category, index, total }: { category: AdminCategory; index: number; total: number }) {
  const [moveState, moveAction, movePending] = useActionState(moveCategoryAction, IDLE);
  const [activeState, activeAction, activePending] = useActionState(toggleCategoryActiveAction, IDLE);
  const [deleteState, deleteAction] = useActionState(deleteCategoryAction, IDLE);
  const error = [moveState, activeState, deleteState].find((s) => s.status === 'error');
  const hasProducts = category.productCount > 0;

  return (
    <li data-testid="category-row">
      <div className="adm-order">
        <form action={moveAction}>
          <input type="hidden" name="id" value={category.id} />
          <input type="hidden" name="direction" value="up" />
          <button type="submit" className="adm-icon-btn" disabled={index === 0 || movePending} aria-label={`Subir ${category.name}`}>
            <IconUp />
          </button>
        </form>
        <form action={moveAction}>
          <input type="hidden" name="id" value={category.id} />
          <input type="hidden" name="direction" value="down" />
          <button type="submit" className="adm-icon-btn" disabled={index === total - 1 || movePending} aria-label={`Bajar ${category.name}`}>
            <IconDown />
          </button>
        </form>
      </div>

      <div className="adm-list-main">
        <Link href={`/admin/categorias/${category.id}`}>{category.name}</Link>
        <span className="adm-list-meta">
          /{category.slug} · {category.productCount} producto{category.productCount === 1 ? '' : 's'}
        </span>
        {error && error.status === 'error' && <Notice kind="error">{error.message}</Notice>}
      </div>

      <div className="adm-actions">
        <form action={activeAction}>
          <input type="hidden" name="id" value={category.id} />
          <input type="hidden" name="value" value={String(!category.isActive)} />
          <button
            type="submit"
            className={`adm-badge adm-badge-btn ${category.isActive ? 'adm-badge-on' : 'adm-badge-off'}`}
            disabled={activePending}
            aria-label={`${category.isActive ? 'Desactivar' : 'Activar'} ${category.name}`}
          >
            {category.isActive ? 'Activa' : 'Inactiva'}
          </button>
        </form>
        <Link href={`/admin/categorias/${category.id}`} className="adm-btn adm-btn-sm">
          Editar
        </Link>
        <form action={deleteAction}>
          <input type="hidden" name="id" value={category.id} />
          <ConfirmButton
            className="adm-icon-btn"
            aria-label={hasProducts ? `No se puede eliminar ${category.name}: tiene productos` : `Eliminar ${category.name}`}
            disabled={hasProducts}
            title={`¿Eliminar «${category.name}»?`}
            description="La categoría no tiene productos. Esta acción no se puede deshacer."
          >
            <IconTrash />
          </ConfirmButton>
        </form>
      </div>
    </li>
  );
}
