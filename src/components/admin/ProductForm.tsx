'use client';

import { useActionState, useState } from 'react';
import { saveProductAction } from '@/app/(admin)/admin/(panel)/productos/actions';
import { IDLE } from '@/lib/admin/action-state';
import { productFromForm } from '@/lib/catalog/form';
import { slugify, validateProductInput, type ValidationErrors } from '@/lib/catalog/validation';
import type { AdminProduct } from '@/lib/catalog/admin-queries';
import { formatPesosInput } from '@/lib/money';
import { ActionNotice, Field, SubmitButton } from './ui';

type CategoryOption = { id: string; name: string; isActive: boolean };

export default function ProductForm({ product, categories }: { product?: AdminProduct; categories: CategoryOption[] }) {
  const [state, formAction] = useActionState(saveProductAction, IDLE);
  const [clientErrors, setClientErrors] = useState<ValidationErrors>({});
  // el slug sigue al nombre hasta que se edita a mano (en un producto existente no cambia solo)
  const [slug, setSlug] = useState(product?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(Boolean(product));

  const serverErrors = state.status === 'error' ? state.fieldErrors ?? {} : {};
  const errors: ValidationErrors = { ...serverErrors, ...clientErrors };

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    // misma validación que el servidor, para avisar sin esperar la respuesta
    const { input, errors: parseErrors } = productFromForm(new FormData(event.currentTarget));
    const found = { ...validateProductInput(input), ...parseErrors };
    setClientErrors(found);
    if (Object.keys(found).length) {
      event.preventDefault();
      const first = event.currentTarget.querySelector<HTMLElement>(`[name="${fieldName(Object.keys(found)[0])}"]`);
      first?.focus();
    }
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="adm-form" noValidate>
      {product && <input type="hidden" name="id" value={product.id} />}
      {Object.keys(clientErrors).length > 0 ? (
        <ActionNotice state={{ status: 'error', message: 'Revisá los campos marcados.' }} />
      ) : (
        <ActionNotice state={state} />
      )}

      <section className="adm-card">
        <div className="adm-card-body">
          <h2 className="adm-section-title">Datos principales</h2>
          <p className="adm-section-help">Nombre, código y categoría con los que se identifica el producto.</p>
          <div className="adm-grid">
            <Field label="Nombre" name="name" error={errors.name} className="adm-span-2">
              {(p) => (
                <input
                  {...p}
                  className="adm-input"
                  defaultValue={product?.name}
                  maxLength={160}
                  required
                  onChange={(e) => {
                    if (!slugTouched) setSlug(slugify(e.target.value));
                  }}
                />
              )}
            </Field>
            <Field label="SKU" name="sku" error={errors.sku} hint="Código interno único. Ej.: STF-SH-500">
              {(p) => <input {...p} className="adm-input" defaultValue={product?.sku} maxLength={60} required autoCapitalize="characters" />}
            </Field>
            <Field label="Slug (URL)" name="slug" error={errors.slug} hint="Minúsculas, números y guiones. Se genera desde el nombre.">
              {(p) => (
                <input
                  {...p}
                  className="adm-input"
                  value={slug}
                  maxLength={160}
                  required
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                />
              )}
            </Field>
            <Field label="Categoría" name="categoryId" error={errors.categoryId} className="adm-span-2">
              {(p) => (
                <select {...p} className="adm-select" defaultValue={product?.categoryId ?? ''} required>
                  <option value="" disabled>
                    Elegí una categoría
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.isActive ? '' : ' (inactiva)'}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        </div>
      </section>

      <section className="adm-card">
        <div className="adm-card-body">
          <h2 className="adm-section-title">Precio y stock</h2>
          <p className="adm-section-help">Precio de venta al público en pesos argentinos.</p>
          <div className="adm-grid">
            <Field label="Precio público" name="price" error={errors.priceCentavos} hint="Ej.: 12.500 o 12.500,50">
              {(p) => (
                <div className="adm-input-prefix">
                  <span>$</span>
                  <input
                    {...p}
                    className="adm-input adm-num"
                    inputMode="decimal"
                    defaultValue={product ? formatPesosInput(product.priceCentavos) : ''}
                    required
                  />
                </div>
              )}
            </Field>
            <Field label="Stock" name="stock" error={errors.stock} hint="Unidades disponibles para la venta.">
              {(p) => <input {...p} className="adm-input adm-num" inputMode="numeric" defaultValue={product?.stock ?? 0} required />}
            </Field>
          </div>
        </div>
      </section>

      <section className="adm-card">
        <div className="adm-card-body">
          <h2 className="adm-section-title">Descripción</h2>
          <p className="adm-section-help">Textos que verá el cliente en la ficha del producto.</p>
          <div className="adm-stack">
            <Field label="Descripción corta" name="shortDescription" optional hint="Una línea para listados y buscadores.">
              {(p) => <input {...p} className="adm-input" defaultValue={product?.shortDescription ?? ''} maxLength={240} />}
            </Field>
            <Field label="Descripción" name="description" optional>
              {(p) => <textarea {...p} className="adm-textarea" rows={5} defaultValue={product?.description ?? ''} />}
            </Field>
            <Field label="Modo de uso" name="usageInstructions" optional>
              {(p) => <textarea {...p} className="adm-textarea" rows={3} defaultValue={product?.usageInstructions ?? ''} />}
            </Field>
          </div>
        </div>
      </section>

      <section className="adm-card">
        <div className="adm-card-body">
          <h2 className="adm-section-title">Envío</h2>
          <p className="adm-section-help">Peso y medidas del paquete listo para despachar. Se usarán para calcular envíos.</p>
          <div className="adm-grid adm-grid-4">
            <Field label="Peso (g)" name="weightGrams" optional error={errors.weightGrams}>
              {(p) => <input {...p} className="adm-input adm-num" inputMode="numeric" defaultValue={product?.weightGrams ?? ''} />}
            </Field>
            <Field label="Largo (mm)" name="packageLengthMm" optional error={errors.packageLengthMm}>
              {(p) => <input {...p} className="adm-input adm-num" inputMode="numeric" defaultValue={product?.packageLengthMm ?? ''} />}
            </Field>
            <Field label="Ancho (mm)" name="packageWidthMm" optional error={errors.packageWidthMm}>
              {(p) => <input {...p} className="adm-input adm-num" inputMode="numeric" defaultValue={product?.packageWidthMm ?? ''} />}
            </Field>
            <Field label="Alto (mm)" name="packageHeightMm" optional error={errors.packageHeightMm}>
              {(p) => <input {...p} className="adm-input adm-num" inputMode="numeric" defaultValue={product?.packageHeightMm ?? ''} />}
            </Field>
          </div>
        </div>
      </section>

      <section className="adm-card">
        <div className="adm-card-body">
          <h2 className="adm-section-title">Visibilidad</h2>
          <div className="adm-grid">
            <label className="adm-switch">
              <input type="checkbox" name="isActive" defaultChecked={product?.isActive ?? true} />
              <div>
                <strong>Activo</strong>
                <span>Visible en la tienda. Desactivalo para ocultarlo sin borrarlo.</span>
              </div>
            </label>
            <label className="adm-switch">
              <input type="checkbox" name="isFeatured" defaultChecked={product?.isFeatured ?? false} />
              <div>
                <strong>Destacado</strong>
                <span>Aparece en las secciones de productos destacados.</span>
              </div>
            </label>
            <Field label="Orden" name="sortOrder" optional error={errors.sortOrder} hint="Los números más bajos se muestran primero.">
              {(p) => <input {...p} className="adm-input adm-num" inputMode="numeric" defaultValue={product?.sortOrder ?? 0} />}
            </Field>
          </div>
        </div>
      </section>

      <div className="adm-form-footer">
        <SubmitButton>{product ? 'Guardar cambios' : 'Crear producto'}</SubmitButton>
      </div>
    </form>
  );
}

// los errores de validación usan los nombres de ProductInput; algunos campos del formulario se llaman distinto
function fieldName(errorKey: string) {
  return errorKey === 'priceCentavos' ? 'price' : errorKey;
}
