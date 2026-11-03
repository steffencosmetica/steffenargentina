# Checkout y seguimiento de pedidos (Fase 4B.5)

Página `/checkout` y seguimiento privado `/pedido/[codigo]`, conectados con el carrito (4B.4) y con las funciones de
pedidos (4B.3) y envíos (4B.2). **No hay migraciones nuevas**: toda la lógica comercial ya vive en la base.
No hay pagos: el pedido queda `pending` / `reserved` y la reserva vence sola (Mercado Pago llega en la Fase 5).

## Dónde existe

| Condición | Local (`next dev` / build e2e) | Preview / Production (Vercel) |
|---|---|---|
| Carrito (`STEFFEN_CART_ENABLED=1` + Supabase local + fuera de Vercel) | sí | **no** |
| Clave de servidor `SUPABASE_SECRET_KEY` | la del stack local | **no se carga** |
| Páginas `/checkout`, `/pedido/*` y rutas `/api/checkout/*`, `/api/pedido/*` | sí | **404** |
| Comprar (`store_settings.checkout_enabled`) | solo si se activa a mano (abajo) | `false` en Cloud, bloqueado por trigger |

`isCheckoutAvailable()` (`src/lib/checkout/server.ts`) = carrito habilitado **y** clave presente. El carrito pasa
ese dato al drawer: «Finalizar compra» solo enlaza a `/checkout` donde la página existe.

### Activar las compras en la base local (pruebas manuales)

```bash
npm run db:start
npm run checkout:local -- estado
npm run checkout:local -- activar --confirmo=local:127.0.0.1:55322
npm run checkout:local -- desactivar
```

`scripts/checkout-local.ts` solo conoce la base local de `supabase/config.toml` (no lee variables ni el proyecto
vinculado), `localSql()` se niega a cualquier host que no sea `127.0.0.1`/`localhost`, y activar exige escribir el
destino exacto. Lo cambia el rol `postgres`, el único que acepta el trigger `store_settings_bloquear_checkout`.
**Cloud no se toca.** `e2e/checkout.spec.ts` usa la misma función y deja las compras deshabilitadas al terminar.

## Flujo

```
carrito (localStorage: producto + cantidad)
  │
  ├─ POST /api/checkout/resumen {items, provinceCode}      ← en cada cambio de cantidades o provincia
  │     cotizar_carrito (precios, estado, límites) + cotizar_envio (cobertura, tarifa, envío gratis)
  │     → {quote, shipping, totalCentavos}                  (nada se calcula en el navegador)
  │
  └─ Confirmar
        1-2. datos y dirección (mismas reglas que private.normalizar_checkout)
        3-6. se vuelve a pedir el resumen: si el total cambió → se muestra «cambió de A a B» y NO se crea nada;
             el comprador confirma el nuevo total con otro clic
        7.   términos y privacidad aceptados
        8.   antiabuso: humanCheck() (Turnstile pendiente; en Vercel falla cerrado) + límites de la base
        9.   POST /api/checkout/pedido {idempotencyKey, form, items, expectedTotalCentavos, acceptTerms}
               → crear_pedido() (service_role): valida todo de nuevo, bloquea productos, recalcula precios,
                 envío y total; si el total aceptado no es el vigente → total_mismatch; reserva el stock
        → /pedido/STF-AAMM-XXXX (el token queda en sessionStorage de la pestaña, nunca en la URL)
```

Rechazos (`src/lib/orders/errors.ts`): datos inválidos → errores por campo; `total_mismatch` → nuevo total y
reconfirmación; `product_unavailable` / `insufficient_stock` / `quantity_limit` / `no_shipping_coverage` → el carrito
se vuelve a cotizar (avisos y ajustes de 4B.4) y se explica; `checkout_disabled` → aviso. **El carrito nunca se vacía**:
ni por errores, ni por cancelar, ni por crear un pedido pendiente. Se vaciará cuando el pago se confirme (Fase 5).

Nombre y apellido se piden por separado y se guardan juntos en `orders.buyer_name` (la base tiene un solo campo).

## Idempotencia

- Clave: 32 bytes de `crypto.getRandomValues` en base64url (43 caracteres), formato aceptado por la base.
- Se guarda en `sessionStorage` junto al **sha256** del contenido (datos normalizados, artículos ordenados y total
  aceptado); nunca los datos en claro. Mismo contenido → misma clave: doble clic, recarga de la página y reintento
  de red llegan a la base con la misma clave y reciben el mismo pedido (`replayed`), con una sola reserva.
- Contenido distinto (otro dato, otra cantidad, un total nuevo aceptado) → clave nueva.
- La base rechaza una clave reutilizada con otro contenido (`idempotency_conflict`) sin revelar el pedido existente.
- Doble clic: además, un candado en el cliente impide un segundo envío mientras el primero está en curso.
- Red: si no llega la respuesta, el navegador reintenta 2 veces (0,6 s y 1,5 s) con la misma clave; 502/503/504 también.

## Seguridad

- `src/lib/supabase/admin.ts` (`server-only`): único lugar que lee `SUPABASE_SECRET_KEY`. La auditoría
  `src/lib/orders/secrets.audit.test.ts` lo verifica, e impide que un componente de cliente importe módulos de
  servidor (`supabase/admin`, `checkout/server`, `cart/server`, `http/json-api`, `orders/client-ip`).
- Rutas: solo POST del mismo origen, JSON, tamaño máximo, validación estricta (claves desconocidas → 400), respuestas
  `no-store` + `Referrer-Policy: no-referrer`; otros métodos → 404. Nunca se loguea el cuerpo, solo códigos de error.
- La IP la pone el servidor (proxy de confianza o `127.0.0.1` fuera de Vercel), nunca el navegador.
- `checkout_enabled = false` → `checkout_disabled` en la base; la página lo informa y deshabilita el botón.
- No se expone ninguna función de pago: `private.aplicar_pago()` sigue fuera de la API.

## Seguimiento `/pedido/[codigo]`

- El servidor no consulta nada al renderizar: la página es igual para cualquier código.
- Token: del fragmento `#t=…` (el navegador no lo envía al servidor) o de `sessionStorage`; se quita de la barra de
  direcciones con `history.replaceState` apenas se lee y viaja solo en el **cuerpo** de `POST /api/pedido/consultar`.
- Código inexistente, token incorrecto o mal formado → la misma respuesta (404 `{error:'not_found'}` y el mismo texto).
- Vista con lista cerrada de campos (`src/lib/checkout/order-view.ts`): código, fecha, estado de pago y de envío,
  productos, subtotal, envío (con la provincia), total y vencimiento de la reserva. Sin nombre, email, teléfono,
  documento, calle, localidad ni notas.
- Cabeceras: `Cache-Control: no-store` (página dinámica), `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`
  (`next.config.ts`), `<meta name="robots" content="noindex">` y `<meta name="referrer" content="no-referrer">`.
  `robots.txt` además excluye `/checkout`, `/pedido/` y `/api/`.
- «Copiar enlace privado» arma el enlace con el fragmento para volver más tarde o desde otro dispositivo.

## Fase 5: punto de integración de Mercado Pago

`src/lib/orders/payment.ts` (`paymentStartFor`, `ONLINE_PAYMENTS_ENABLED = false`) describe el flujo previsto:
preferencia de Checkout Pro con importes leídos de la base y `external_reference` = código; webhook con firma
verificada que aplica el pago por una función de servidor dedicada; retornos solo informativos; vaciar el carrito
cuando el pedido figure pagado. Hoy no hay preferencias, webhooks, retornos, reembolsos ni credenciales, y no se
simula ningún pago.

## Pendientes

- Textos legales: el checkbox pide aceptar términos y privacidad, pero **no existen páginas** con esos textos.
  Deben redactarse y aprobarse (no se inventaron) y enlazarse desde el checkbox.
- Facturación: `BILLING_FIELDS_ENABLED = false` (`src/lib/checkout/request.ts`) hasta definir con el contador qué datos
  pedir. La base ya acepta un documento opcional (`buyer.document`).
- Turnstile: `humanCheck()` es el punto de enganche; en Vercel falla cerrado hasta implementarlo con credenciales.
- Email de confirmación con el enlace privado (hoy solo se muestra en pantalla y queda en la pestaña).

## Pruebas

- Unitarias: `src/lib/checkout/checkout.test.ts` y la auditoría de secretos.
- Playwright: `e2e/checkout.spec.ts` (flujo completo, validaciones, cobertura, envío gratis y con centavos, inactivos,
  stock insuficiente, cambios de precio, reconfirmación, doble clic, ráfaga con la misma clave, reintentos de red,
  recarga, checkout deshabilitado, seguimiento con token válido/inválido, datos personales, accesibilidad y
  responsive 390/768/1440 con capturas) y `e2e/carrito-apagado.spec.ts` (todo 404 con el carrito apagado, aun con
  la clave de servidor presente).
