'use client';

import { useActionState } from 'react';
import { loginAction } from '@/app/(admin)/admin/auth-actions';
import { IDLE } from '@/lib/admin/action-state';
import { Field, Notice, SubmitButton } from './ui';

export default function LoginForm({ next, notice }: { next?: string; notice?: { kind: 'info' | 'warning'; text: string } }) {
  const [state, formAction] = useActionState(loginAction, IDLE);
  const errors = state.status === 'error' ? state.fieldErrors ?? {} : {};

  return (
    <form action={formAction} className="adm-form" noValidate>
      {state.status === 'error' ? (
        <Notice kind="error">{state.message}</Notice>
      ) : (
        notice && <Notice kind={notice.kind}>{notice.text}</Notice>
      )}
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="Email" name="email" error={errors.email}>
        {(p) => <input {...p} className="adm-input" type="email" autoComplete="username" required autoFocus />}
      </Field>
      <Field label="Contraseña" name="password" error={errors.password}>
        {(p) => <input {...p} className="adm-input" type="password" autoComplete="current-password" required />}
      </Field>
      <SubmitButton pendingText="Ingresando…">Ingresar</SubmitButton>
      <p className="adm-login-foot">Acceso exclusivo para administradores autorizados.</p>
    </form>
  );
}
