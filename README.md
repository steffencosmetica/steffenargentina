# Steffen Cosmética Capilar — web institucional

Sitio en Next.js (App Router + TypeScript). El sitio HTML original quedó guardado en el tag `sitio-html-original`.

## Desarrollo local

Requiere Node.js 20.9 o superior.

```bash
npm install
npm run dev        # http://localhost:3000
```

Build de producción:

```bash
npm run build
npm run start      # http://localhost:3000
```

`next.config.ts` usa `output: 'standalone'`: el build genera `.next/standalone/server.js`, que junto con `public/` y `.next/static/` alcanza para correr el sitio en un contenedor Docker.

## Estructura

- `src/app/(inicio)` — página de inicio y su layout raíz (carga más pesos de Montserrat).
- `src/app/(secciones)` — productos, categorías y catálogo, con su propio layout raíz.
- `src/app/global-not-found.tsx` — página 404.
- `src/components/layout` — header, footer, botón de WhatsApp, menú de categorías y efectos globales.
- `src/components/home` y `src/components/productos` — componentes de cada sección.
- `src/lib` — datos del sitio (contactos, categorías) y metadata.
- `src/styles/style.css` — hoja de estilos original.
- `public/` — imágenes, videos, fuentes y el catálogo en PDF.
- `recursos/sin-uso/` — imágenes del sitio original que no se usan en ninguna página (no se publican).

Las URLs viejas (`/reparadores.html`, `/contacto.html`, etc.) redirigen con 301 a las nuevas.

## Catálogo (Supabase)

El esquema de la tienda vive en `supabase/migrations/` (tablas, restricciones, RLS, bucket de imágenes)
y se prueba con `supabase/tests/database/`. El código que lo consulta está en `src/lib/supabase/`
(clientes) y `src/lib/catalog/` (consultas públicas, operaciones de administración y validación).

Local (requiere Docker; usa los puertos 553xx para no chocar con otros proyectos Supabase):

```bash
npm run db:start   # levanta Supabase y aplica las migraciones
npm run db:test    # pruebas de restricciones y políticas RLS
npm run db:types   # regenera src/lib/supabase/database.types.ts
npm test           # pruebas unitarias (importes y validaciones)
```

Para conectar la app, copiá `.env.example` como `.env.local` y completá la URL y la clave publicable
(`npx supabase status` las muestra para el entorno local).

Administradores: no hay registro público. Se invita al usuario desde Supabase (Authentication → Users)
y se lo habilita en el SQL Editor:

```sql
insert into public.admin_users (user_id, note)
select id, 'Administrador del catálogo' from auth.users where email = 'persona@steffenargentina.com.ar';
```
