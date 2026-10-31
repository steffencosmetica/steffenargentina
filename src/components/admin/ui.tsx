'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionState } from '@/lib/admin/action-state';
import { IconAlert, IconCheck } from './icons';

// Piezas de interfaz compartidas por los formularios del panel.

export function Notice({ kind, children }: { kind: 'error' | 'ok' | 'warning' | 'info'; children: React.ReactNode }) {
  const Icon = kind === 'ok' ? IconCheck : IconAlert;
  return (
    <div className={`adm-notice adm-notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon />
      <div>{children}</div>
    </div>
  );
}

/** Mensaje del último Server Action (éxito, advertencia o error general). */
export function ActionNotice({ state }: { state: ActionState }) {
  if (state.status === 'idle') return null;
  if (state.status === 'error') return <Notice kind="error">{state.message}</Notice>;
  return (
    <div className="adm-stack-sm">
      <Notice kind="ok">{state.message}</Notice>
      {state.warning && <Notice kind="warning">{state.warning}</Notice>}
    </div>
  );
}

/** Botón de envío que se deshabilita y cambia el texto mientras el formulario se procesa. */
export function SubmitButton({
  children,
  pendingText = 'Guardando…',
  className = 'adm-btn adm-btn-primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending ? pendingText : children}
    </button>
  );
}

type FieldProps = {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  className?: string;
  children: (props: { id: string; name: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => React.ReactNode;
};

/** Campo con etiqueta, ayuda y error conectados por aria-describedby. */
export function Field({ label, name, error, hint, optional, className, children }: FieldProps) {
  const id = `f-${name}`;
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`adm-field ${className ?? ''}`}>
      <label htmlFor={id}>
        {label} {optional && <span className="adm-optional">(opcional)</span>}
      </label>
      {children({ id, name, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && (
        <p className="adm-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="adm-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Botón que pide confirmación en un <dialog> propio (no usa window.confirm) y recién entonces
 * envía el formulario que lo contiene.
 */
export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel = 'Eliminar',
  className = 'adm-btn adm-btn-danger',
  disabled,
  ...rest
}: {
  children: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { pending } = useFormStatus();

  function confirm() {
    dialogRef.current?.close();
    triggerRef.current?.form?.requestSubmit();
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={className}
        disabled={disabled || pending}
        onClick={() => dialogRef.current?.showModal()}
        {...rest}
      >
        {children}
      </button>
      <dialog ref={dialogRef} className="adm-dialog" aria-labelledby={titleId}>
        <div className="adm-dialog-body">
          <h2 id={titleId}>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="adm-dialog-footer">
          <button type="button" className="adm-btn" onClick={() => dialogRef.current?.close()}>
            Cancelar
          </button>
          <button type="button" className="adm-btn adm-btn-danger-solid" onClick={confirm}>
            {confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}

/** Muestra un mensaje breve después de una acción y lo oculta a los pocos segundos. */
export function useFlash(state: ActionState, ms = 2500) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (state.status === 'idle') return;
    setVisible(true);
    if (state.status === 'error') return;
    const timer = setTimeout(() => setVisible(false), ms);
    return () => clearTimeout(timer);
  }, [state, ms]);
  return visible ? state : null;
}
