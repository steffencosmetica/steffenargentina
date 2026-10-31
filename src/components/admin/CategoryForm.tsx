'use client';

import { useActionState, useState } from 'react';
import { saveCategoryAction } from '@/app/(admin)/admin/(panel)/categorias/actions';
import { IDLE } from '@/lib/admin/action-state';
import { categoryFromForm } from '@/lib/catalog/form';
import { slugify, validateCategoryInput, type ValidationErrors } from '@/lib/catalog/validation';
import type { AdminCategory } from '@/lib/catalog/admin-queries';
import { ActionNotice, Field, SubmitButton } from './ui';

export default function CategoryForm({ category }: { category?: AdminCategory }) {
  const [state, formAction] = useActionState(saveCategoryAction, IDLE);
  const [clientErrors, setClientErrors] = useState<ValidationErrors>({});
  const [slug, setSlug] = useState(category?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(Boolean(category));

  const errors: ValidationErrors = { ...(state.status === 'error' ? state.fieldErrors ?? {} : {}), ...clientErrors };

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    const found = validateCategoryInput(categoryFromForm(new FormData(event.currentTarget)).input);
    setClientErrors(found);
    if (Object.keys(found).length) event.preventDefault();
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="adm-form" noValidate>
      {category && <input type="hidden" name="id" value={category.id} />}
      {Object.keys(clientErrors).length > 0 ? (
        <ActionNotice state={{ status: 'error', message: 'Revisá los campos marcados.' }} />
      ) : (
        <ActionNotice state={state} />
      )}
      <section className="adm-card">
        <div className="adm-card-body adm-stack">
          <div className="adm-grid">
            <Field label="Nombre" name="name" error={errors.name}>
              {(p) => (
                <input
                  {...p}
                  className="adm-input"
                  defaultValue={category?.name}
                  maxLength={120}
                  required
                  onChange={(e) => {
                    if (!slugTouched) setSlug(slugify(e.target.value));
                  }}
                />
              )}
            </Field>
            <Field label="Slug (URL)" name="slug" error={errors.slug} hint="Minúsculas, números y guiones.">
              {(p) => (
                <input
                  {...p}
                  className="adm-input"
                  value={slug}
                  maxLength={120}
                  required
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                />
              )}
            </Field>
          </div>
          <Field label="Descripción" name="description" optional>
            {(p) => <textarea {...p} className="adm-textarea" rows={3} defaultValue={category?.description ?? ''} />}
          </Field>
          <label className="adm-switch">
            <input type="checkbox" name="isActive" defaultChecked={category?.isActive ?? true} />
            <div>
              <strong>Activa</strong>
              <span>Si la desactivás, sus productos dejan de mostrarse en la tienda.</span>
            </div>
          </label>
        </div>
      </section>
      <div className="adm-form-footer">
        <SubmitButton>{category ? 'Guardar cambios' : 'Crear categoría'}</SubmitButton>
      </div>
    </form>
  );
}
