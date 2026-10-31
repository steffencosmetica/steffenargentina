// Traduce los errores de PostgREST / PostgreSQL a mensajes para el administrador.
// Nunca se muestra el mensaje técnico original: puede incluir nombres internos o datos de la consulta.

export type DbErrorLike = { code?: string; message?: string; details?: string | null };

export type FriendlyError = { message: string; field?: string };

// restricción → campo del formulario y mensaje
const CONSTRAINTS: Record<string, FriendlyError> = {
  products_slug_key: { field: 'slug', message: 'Ya existe un producto con ese slug.' },
  products_sku_key: { field: 'sku', message: 'Ya existe un producto con ese SKU.' },
  categories_slug_key: { field: 'slug', message: 'Ya existe una categoría con ese slug.' },
  product_images_path_key: { message: 'Esa imagen ya está asociada al producto.' },
  products_price_check: { field: 'priceCentavos', message: 'El precio no puede ser negativo.' },
  products_stock_check: { field: 'stock', message: 'El stock no puede ser negativo.' },
  products_category_id_fkey: { field: 'categoryId', message: 'La categoría elegida no existe.' },
};

export function describeDbError(error: DbErrorLike): FriendlyError {
  const text = `${error.message ?? ''} ${error.details ?? ''}`;
  const constraint = Object.keys(CONSTRAINTS).find((name) => text.includes(name));

  switch (error.code) {
    case '23505':
      return constraint ? CONSTRAINTS[constraint] : { message: 'Ya existe un registro con esos datos.' };
    case '23503':
      if (text.includes('products_category_id_fkey')) {
        // borrar una categoría referenciada (on delete restrict):
        // 'update or delete on table "categories" violates foreign key constraint …'
        if (/on table "categories"/.test(error.message ?? '')) {
          return { message: 'La categoría tiene productos asociados: movelos o desactivala en lugar de borrarla.' };
        }
        // insertar o editar un producto con una categoría inexistente
        return CONSTRAINTS.products_category_id_fkey;
      }
      return { message: 'El registro tiene datos asociados que impiden la operación. Desactivalo en lugar de borrarlo.' };
    case '23514':
      return constraint ? CONSTRAINTS[constraint] : { message: 'Algún dato no cumple las reglas del catálogo.' };
    case '42501':
      return { message: 'Tu sesión no tiene permisos para esta operación. Volvé a iniciar sesión.' };
    case 'PGRST116':
      return { message: 'El registro ya no existe.' };
    default:
      return { message: 'No se pudo completar la operación. Intentá de nuevo.' };
  }
}
