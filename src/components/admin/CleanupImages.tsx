'use client';

import { useActionState } from 'react';
import { cleanupImagesAction } from '@/app/(admin)/admin/(panel)/productos/actions';
import { IDLE } from '@/lib/admin/action-state';
import { ActionNotice, SubmitButton } from './ui';

/** Borra del almacenamiento los archivos que ya no usa ningún producto. */
export default function CleanupImages() {
  const [state, action] = useActionState(cleanupImagesAction, IDLE);
  return (
    <form action={action} className="adm-stack-sm">
      <SubmitButton className="adm-btn adm-btn-sm" pendingText="Buscando…">
        Limpiar imágenes sin uso
      </SubmitButton>
      <ActionNotice state={state} />
    </form>
  );
}
