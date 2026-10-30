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
