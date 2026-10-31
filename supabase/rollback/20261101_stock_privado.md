# Rollback — Fase 4B.1: stock privado

Migraciones involucradas:

| Paso | Migración | Qué hace | Tipo |
|---|---|---|---|
| 1 | `20261101120000_productos_disponibilidad.sql` | Agrega `products.availability` (columna generada) y la función `admin_product_stock()` | Aditivo: no quita permisos |
| 2 | `20261101120100_productos_stock_privado.sql` | Reemplaza el `SELECT` de tabla de `anon` y `authenticated` por listas de columnas sin `stock` | Restrictivo |

Ninguna de las dos modifica datos: el stock, los precios y el resto de las filas no cambian.
Por eso un rollback nunca necesita restaurar datos, solo permisos o estructura.

## Principios

1. **Primero corregir hacia adelante.** Casi cualquier falla después del paso 2 es una consulta que pide
   una columna que no está en la lista permitida. Se corrige otorgando *esa* columna (nunca `stock`).
2. **El `SELECT` completo para `anon`/`authenticated` es solo una medida temporal de emergencia**:
   vuelve a exponer el stock exacto. Se registra, se investiga y se vuelve al modelo restringido el mismo día.
3. **Orden inverso al despliegue.** Código y base se revierten en el orden que mantiene la tienda funcionando:
   el código viejo (`d009721`) necesita leer `stock`; el código nuevo funciona con o sin el paso 2.
4. **Historial coherente.** Los ajustes temporales por SQL no se registran como migraciones. El estado final
   tiene que volver a coincidir con los archivos de `supabase/migrations/`; si un cambio debe quedar, se hace
   con una migración nueva.

## Diagnóstico rápido

```sql
-- ¿qué columnas puede leer cada rol?
select grantee, string_agg(column_name, ', ' order by column_name)
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'products' and privilege_type = 'SELECT'
   and grantee in ('anon', 'authenticated')
 group by grantee;

-- ¿hay SELECT de tabla (stock expuesto)?
select has_table_privilege('anon', 'public.products', 'select') as anon_tabla,
       has_table_privilege('authenticated', 'public.products', 'select') as auth_tabla;
```

El error típico en los logs de la app es `42501 permission denied for table products` con el `hint`
`GRANT SELECT ON public.products TO anon`: buscar qué columna pide la consulta.

## Escenarios

### A. Después del paso 2, la tienda o el panel fallan por una columna no otorgada (corrección hacia adelante)

```sql
-- reemplazar <columna> por la que falta; NUNCA stock
grant select (<columna>) on public.products to anon;           -- si falla la tienda
grant select (<columna>) on public.products to authenticated;  -- si falla el panel
```

Después, crear una migración nueva con el mismo `grant` para que el historial lo refleje.

### B. Después del paso 2, la tienda está caída y no hay diagnóstico inmediato (emergencia temporal)

1. Restaurar el acceso anterior (**re-expone el stock**):
   ```sql
   grant select on public.products to anon, authenticated;
   ```
2. Verificar la tienda (`/tienda`, una ficha, `/sitemap.xml`) y el panel.
3. Registrar la hora; investigar con el diagnóstico rápido.
4. Volver al modelo restringido (sección «Volver al modelo restringido»).

### C. El código nuevo (Preview) falla y hay que volver al código anterior

El código anterior (`d009721`) lee `stock` con `SELECT`, así que **primero** la base y **después** el código:

1. Si el paso 2 está aplicado: escenario B, paso 1 (emergencia temporal).
2. En Vercel, volver a desplegar el deployment anterior de la rama (Deployments → deployment de `d009721` →
   Redeploy). No usar Promote to Production ni tocar la Production Branch.
3. Corregir el código, desplegarlo y volver al modelo restringido.

### D. Revertir también el paso 1 (solo si la columna o la función causan el problema)

Requiere que el código desplegado ya no use `availability` ni `admin_product_stock()` (es decir, `d009721`)
y que el paso 2 esté revertido (escenario B).

```sql
drop function if exists public.admin_product_stock(uuid[]);
alter table public.products drop column if exists availability;
```

`availability` es una columna generada: borrarla no pierde información. Para reaplicar el paso 1 más tarde,
borrar su registro del historial antes de volver a hacer `db push`:

```sql
delete from supabase_migrations.schema_migrations where version = '20261101120000';
```

## Volver al modelo restringido

Ejecutar exactamente el contenido de `20261101120100_productos_stock_privado.sql`
(es idempotente: el `revoke` de tabla también quita los permisos por columna y después se vuelven a otorgar).
Luego correr las verificaciones REST de la entrega 4B.1:

- `anon`: `select=stock`, `select=*`, filtro y orden por stock, embebidos desde `product_images` y `categories`
  → todos `401 / 42501`.
- `authenticated` no admin: lo mismo → `403 / 42501`; `rpc/admin_product_stock` → `42501`.
- admin: `rpc/admin_product_stock` devuelve el stock exacto; editar stock desde `/admin` cambia la
  disponibilidad pública.

## Verificar que los datos siguen intactos

Antes de cualquier operación, guardar una referencia; después, comparar:

```sql
select json_build_object(
  'productos', (select json_agg(row_to_json(p) order by p.sku) from public.products p),
  'categorias', (select json_agg(row_to_json(c) order by c.slug) from public.categories c),
  'imagenes',  (select json_agg(row_to_json(i) order by i.storage_path) from public.product_images i),
  'archivos',  (select count(*) from storage.objects where bucket_id = 'catalogo'),
  'admins',    (select json_agg(user_id order by user_id) from public.admin_users),
  'usuarios',  (select count(*) from auth.users),
  'politicas', (select json_agg(tablename || ':' || policyname order by tablename, policyname)
                  from pg_policies where schemaname = 'public')
);
```

Ninguna operación de este documento cambia filas: `productos` debe coincidir campo por campo
(incluidos `stock`, `price_ars` y `updated_at`), salvo la presencia o ausencia de `availability`.
