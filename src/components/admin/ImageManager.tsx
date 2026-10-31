'use client';

import { useActionState, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  deleteImageAction,
  moveImageAction,
  prepareImageUploadAction,
  registerImageAction,
  setPrimaryImageAction,
} from '@/app/(admin)/admin/(panel)/productos/actions';
import { IDLE } from '@/lib/admin/action-state';
import type { AdminProductImage } from '@/lib/catalog/admin-queries';
import { createBrowserSupabase } from '@/lib/supabase/browser';
import { CATALOGO_BUCKET } from '@/lib/supabase/env';
import { IconLeft, IconRight, IconStar, IconTrash, IconUpload } from './icons';
import { ActionNotice, ConfirmButton, Notice } from './ui';

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MAX_BYTES = 5 * 1024 * 1024;

type Upload = { name: string; status: 'subiendo' | 'listo' | 'error'; message?: string };

export default function ImageManager({ productId, productName, images }: { productId: string; productName: string; images: AdminProductImage[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  // el borrado vive en el padre: la miniatura desaparece al borrar y su aviso se perdería
  const [deleteState, deleteAction] = useActionState(deleteImageAction, IDLE);

  function setUpload(index: number, patch: Partial<Upload>) {
    setUploads((list) => list.map((u, i) => (i === index ? { ...u, ...patch } : u)));
  }

  async function uploadFiles(files: File[]) {
    if (!files.length || busy) return;
    setBusy(true);
    setUploads(files.map((f) => ({ name: f.name, status: 'subiendo' })));
    // el navegador sube directo a Storage con un token de un solo uso; no hace falta la sesión
    const supabase = createBrowserSupabase();

    for (const [i, file] of files.entries()) {
      if (!ACCEPT.includes(file.type)) {
        setUpload(i, { status: 'error', message: 'Formato no admitido (JPG, PNG, WebP o AVIF).' });
        continue;
      }
      if (file.size > MAX_BYTES) {
        setUpload(i, { status: 'error', message: 'Supera los 5 MB.' });
        continue;
      }
      try {
        const ticket = await prepareImageUploadAction(productId, file.type, file.size);
        if (!ticket.ok) {
          setUpload(i, { status: 'error', message: ticket.message });
          continue;
        }
        const { error } = await supabase.storage
          .from(CATALOGO_BUCKET)
          .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
        if (error) {
          setUpload(i, { status: 'error', message: 'No se pudo subir el archivo. Revisá la conexión e intentá de nuevo.' });
          continue;
        }
        const result = await registerImageAction(productId, ticket.path, productName);
        setUpload(i, result.status === 'error' ? { status: 'error', message: result.message } : { status: 'listo' });
      } catch {
        setUpload(i, { status: 'error', message: 'Se perdió la conexión durante la subida.' });
      }
    }

    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
    router.refresh();
  }

  return (
    <div className="adm-stack">
      <ActionNotice state={deleteState} />
      {images.length === 0 ? (
        <Notice kind="info">Este producto todavía no tiene imágenes. La primera que subas será la principal.</Notice>
      ) : (
        <ul className="adm-images" aria-label="Imágenes del producto">
          {images.map((img, i) => (
            <ImageTile key={img.id} image={img} index={i} total={images.length} deleteAction={deleteAction} />
          ))}
        </ul>
      )}

      <label
        className="adm-dropzone"
        data-active={dragging}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          uploadFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <IconUpload />
        <strong>{busy ? 'Subiendo imágenes…' : 'Agregar imágenes'}</strong>
        <span>Arrastralas acá o hacé clic para elegirlas. JPG, PNG, WebP o AVIF, hasta 5 MB cada una.</span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT.join(',')}
          multiple
          disabled={busy}
          className="adm-visually-hidden"
          aria-label="Elegir imágenes para subir"
          onChange={(e) => uploadFiles(Array.from(e.target.files ?? []))}
        />
      </label>

      {uploads.length > 0 && (
        <ul className="adm-uploads" aria-live="polite">
          {uploads.map((u, i) => (
            <li key={`${u.name}-${i}`}>
              <span>{u.name}</span>
              <span className={u.status === 'error' ? 'adm-quick-msg is-error' : u.status === 'listo' ? 'adm-quick-msg is-ok' : 'adm-muted'}>
                {u.status === 'subiendo' ? 'Subiendo…' : u.status === 'listo' ? 'Lista' : u.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ImageTile({
  image,
  index,
  total,
  deleteAction,
}: {
  image: AdminProductImage;
  index: number;
  total: number;
  deleteAction: (formData: FormData) => void;
}) {
  const [primaryState, primaryAction, primaryPending] = useActionState(setPrimaryImageAction, IDLE);
  const [moveState, moveAction, movePending] = useActionState(moveImageAction, IDLE);
  const error = [primaryState, moveState].find((s) => s.status === 'error');
  const label = `imagen ${index + 1}`;

  return (
    <li className="adm-image" data-primary={image.isPrimary} data-testid="product-image">
      <img src={image.url} alt={image.altText ?? ''} loading="lazy" />
      {image.isPrimary && <span className="adm-badge adm-badge-gold">Principal</span>}
      <div className="adm-image-tools">
        <div>
          <form action={moveAction}>
            <input type="hidden" name="id" value={image.id} />
            <input type="hidden" name="direction" value="up" />
            <button type="submit" className="adm-icon-btn" disabled={index === 0 || movePending} aria-label={`Mover ${label} antes`}>
              <IconLeft />
            </button>
          </form>
          <form action={moveAction}>
            <input type="hidden" name="id" value={image.id} />
            <input type="hidden" name="direction" value="down" />
            <button type="submit" className="adm-icon-btn" disabled={index === total - 1 || movePending} aria-label={`Mover ${label} después`}>
              <IconRight />
            </button>
          </form>
        </div>
        <div>
          <form action={primaryAction}>
            <input type="hidden" name="id" value={image.id} />
            <button
              type="submit"
              className="adm-icon-btn"
              aria-pressed={image.isPrimary}
              disabled={image.isPrimary || primaryPending}
              aria-label={image.isPrimary ? `La ${label} es la principal` : `Usar ${label} como principal`}
            >
              <IconStar filled={image.isPrimary} />
            </button>
          </form>
          <form action={deleteAction}>
            <input type="hidden" name="id" value={image.id} />
            <ConfirmButton
              className="adm-icon-btn"
              aria-label={`Eliminar ${label}`}
              title="¿Eliminar esta imagen?"
              description="Se borra del producto y del almacenamiento. No se puede deshacer."
            >
              <IconTrash />
            </ConfirmButton>
          </form>
        </div>
      </div>
      {error && error.status === 'error' && (
        <div className="adm-image-error">
          <Notice kind="error">{error.message}</Notice>
        </div>
      )}
    </li>
  );
}
