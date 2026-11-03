# Carrito de compras (Fase 4B.4)

Carrito completo **sin** checkout ni pagos. No crea pedidos ni reserva stock. Oculto en Vercel (Preview y Production).

| Pieza | Archivo |
|---|---|
| Cotización en la base | `supabase/migrations/20261103120000_carrito_cotizacion.sql` → `public.cotizar_carrito(p_items jsonb)` |
| Ruta de cotización | `src/app/api/carrito/cotizar/route.ts` (`POST`) |
| Lógica pura | `src/lib/cart/` (`types`, `storage`, `model`, `quote`, `reconcile`, `flag`) |
| Servidor | `src/lib/cart/server.ts` (`isCartEnabled()`, `quoteCart()`) |
| Interfaz | `src/components/cart/` (`CartProvider`, `CartDrawer`, `CartButton`, `AddToCartButton`, `ProductPurchase`), `src/styles/carrito.css` |
| Integración | `SiteShell` (provider), `SiteHeader` (ícono), `ProductCard` y ficha (botones) |

## Interruptor (feature flag)

`isCartEnabled()` (servidor) exige las tres condiciones:

1. `STEFFEN_CART_ENABLED=1`, variable de **servidor** (sin `NEXT_PUBLIC_`): el navegador no puede activarlo.
2. `NEXT_PUBLIC_SUPABASE_URL` local (`127.0.0.1` / `localhost`): un build conectado a Cloud nunca muestra el carrito.
3. Fuera de Vercel (`VERCEL` / `VERCEL_ENV` ausentes).

Apagado: `SiteShell` no monta el `CartProvider`, así que el ícono, los botones y el panel no se renderizan (el
HTML queda como antes de 4B.4) y `POST /api/carrito/cotizar` responde 404. Aunque se mostrara, no hay compra:
`checkout_enabled = false` en la base y `crear_pedido()` lo valida.

Las páginas estáticas toman el valor en el build; la ruta de cotización lo evalúa en cada solicitud.

Para publicar el carrito más adelante hay que cambiar la condición 2 y 3 en `src/lib/cart/flag.ts` (decisión de una fase posterior).

## Estado del carrito

- `localStorage` con la clave `steffen-carrito-v1`: `{ "version": 1, "items": [{ "productId", "quantity" }] }`.
  Solo producto y cantidad. Al leer se valida todo: JSON inválido, otra versión, ids no uuid, cantidades no
  enteras → se descartan; repetidos se suman; máximo 50 líneas. Una versión futura del esquema se migra en
  `parseStoredCart` antes de normalizar.
- El HTML del servidor no conoce el carrito: el contador aparece después de leer `localStorage` (sin errores de hidratación).
- Sincronización entre pestañas con el evento `storage`.
- Límites (`max_units_per_product`, `max_units_per_order`) siempre de la cotización (store_settings). Sin constantes
  comerciales en el código; si todavía no se conocen, «Agregar» cotiza antes de aplicar el límite.

## Cotización

`POST /api/carrito/cotizar` con `{ "items": [{ "productId", "quantity" }] }`:

- Validación estricta (uuid, enteros 1–9999, sin repetidos, sin claves extra, ≤ 50, cuerpo ≤ 8 KB, JSON, mismo origen).
- Llama a `cotizar_carrito` con la clave **publicable** (sin `service_role`) y sin caché de Next: datos actuales.
- Respuesta: por artículo `status` (`ok`, `unavailable`, `out_of_stock`, `exceeds_limit`, `exceeds_stock`), nombre,
  precio vigente, imagen, `maxQuantity` y total de línea; además límites, unidades, subtotal, `exceedsOrderLimit`,
  `canCheckout`, `checkoutEnabled`. Importes como texto exacto en la base → centavos en la app.
- **Stock exacto**: nunca. `maxQuantity` = mínimo entre stock y límite por producto. Con el límite de 5, a lo sumo
  se sabe si hay 0…5 unidades (lo mismo que se deduce probando cantidades); por encima, el stock queda oculto.
- **Configuración obligatoria**: sin la fila de `store_settings`, o con `max_units_per_product` /
  `max_units_per_order` nulos o menores que 1, la función rechaza (`55000`) sin devolver datos; la ruta responde 502
  (`quote_unavailable`). Así `maxQuantity` nunca cae en el stock exacto por falta de límite.
- **Productos ocultos**: inexistente, inactivo o de categoría inactiva devuelven la misma línea `unavailable` sin
  nombre, slug, SKU, precio ni imagen (`maxQuantity` 0). La app muestra «Un producto».

Se cotiza al cargar un carrito guardado, al abrir el panel y en cada cambio de cantidad (agrupado 250 ms).
Con la respuesta, `reconcile()`:
- avisa cambios de precio («El precio de X cambió de $ A a $ B», con el precio anterior solo en memoria);
- avisa productos desactivados («ya no está disponible») o sin stock, que se pueden quitar y no suman;
- ajusta cantidades que superan lo comprable o el límite, explicando el cambio.

## API para el checkout (Fase 4B.5)

`useCartOptional()` devuelve `items`, `units`, `quote`, `refreshQuote()` (cotización actual antes de confirmar),
`clear()` (solo cuando un pedido quede confirmado). «Finalizar compra» está deshabilitado
(`CHECKOUT_PAGE_READY = false`, `CHECKOUT_PATH = '/checkout'`) y no vacía el carrito.

## Pruebas

- pgTAP: `supabase/tests/database/carrito.test.sql`.
- Unitarias: `src/lib/cart/cart.test.ts`.
- Playwright (carrito encendido, build local): `e2e/carrito.spec.ts`.
- Playwright (carrito apagado, build aparte): `npm run test:e2e:carrito-apagado` → `e2e/carrito-apagado.spec.ts`.

## Despliegue posterior (cuando se apruebe)

1. `supabase migration list --linked`: solo debe faltar `20261103120000`.
2. `supabase db push --linked --dry-run` → solo `20261103120000_carrito_cotizacion.sql`; luego `db push --linked`.
   Es aditiva (una función de solo lectura), no toca datos ni permisos existentes.
3. Verificar: `has_function_privilege('anon', 'public.cotizar_carrito(jsonb)', 'execute')` = true, `checkout_enabled` = false.
4. Push de la rama. En Vercel el carrito sigue oculto (el flag exige Supabase local y fuera de Vercel): el Preview
   debe verse igual que antes y `POST /api/carrito/cotizar` debe dar 404.
5. No definir `STEFFEN_CART_ENABLED` en Vercel (igual no tendría efecto).

Rollback: `drop function public.cotizar_carrito(jsonb);` y borrar la versión `20261103120000` del historial; el código
sin carrito no la usa.
