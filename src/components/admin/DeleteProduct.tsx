'use client';

import { useActionState } from 'react';
import { deleteProductAction } from '@/app/(admin)/admin/(panel)/productos/actions';
import { IDLE } from '@/lib/admin/action-state';
import { IconTrash } from './icons';
import { ActionNotice, ConfirmButton } from './ui';

export default function DeleteProduct({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState(deleteProductAction, IDLE);
  return (
    <form action={action} className="adm-stack">
      <input type="hidden" name="id" value={id} />
      <ActionNotice state={state} />
      <div>
        <ConfirmButton
          title={`¿Eliminar «${name}»?`}
          description="Se borran el producto y todas sus imágenes. No se puede deshacer. Si solo querés ocultarlo de la tienda, desactivalo."
          confirmLabel="Eliminar producto"
        >
          <IconTrash /> Eliminar producto
        </ConfirmButton>
      </div>
    </form>
  );
}
