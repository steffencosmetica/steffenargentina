# Fase 4B.6 — Cierre de la auditoría previa a publicación

## Cloud verificado

Proyecto exclusivo: **Steffen Web tienda (`zzxlghpopmccwsaqbsko`)**. La migración `20261104120000_admin_pedidos.sql` ya estaba aplicada y **no se volvió a ejecutar** durante este cierre.

La auditoría final de solo lectura terminó el 3 de noviembre de 2026 a las 22:45 UTC. El esquema coincide íntegramente con el esperado, sin diferencias semánticas.

| Comprobación | Resultado |
|---|---|
| Migraciones remotas | **12**, las 11 anteriores y únicamente la nueva administrativa |
| Esquema, grants y definiciones | Coinciden con las fuentes originales y el estado esperado |
| Funciones anteriores e historial previo | Sin cambios |
| Datos comerciales y metadatos de Storage | Huellas idénticas a la referencia previa a la aplicación |
| Producto existente | **25 unidades**, `stock_version = 1` |
| `checkout_enabled` | **false** |
| Pedidos e intentos de checkout | **0 / 0** |
| pg_cron | Ausente |
| Migraciones, escrituras comerciales y RPC de escritura ejecutadas en este cierre de Cloud | **Ninguna** |

## Referencia UTF-8 corregida

La diferencia anterior estaba en la referencia local: el transporte de texto por un pipe de PowerShell había convertido tildes en signos `?`. Cloud conservaba los textos correctos del archivo aprobado.

El procedimiento reproducible queda en `scripts/admin-orders-reference.ts`:

```text
node scripts/admin-orders-reference.ts
```

Lee la migración original con un decodificador UTF-8 estricto y extrae sus tres declaraciones de función. En el contenedor **local**, las compila mediante `CREATE OR REPLACE FUNCTION` dentro de una transacción que termina en `ROLLBACK`. No ejecuta la migración completa, no altera su historial y no deja cambios en la base local.

El cliente recibe y devuelve buffers UTF-8, con `PGCLIENTENCODING=UTF8`; el JSON se guarda como bytes UTF-8 y se relee para comprobar que no haya pérdidas. La salida se guarda por defecto en TEMP, fuera de Git. No se reemplazan tildes ni caracteres manualmente.

La referencia completa regenerada se comparó con Cloud mediante `psql`, TLS `verify-full` y transacciones `REPEATABLE READ READ ONLY`. Las comparaciones ignoran únicamente orden de filas de catálogo, finales CRLF/LF y espacios exteriores. No se enmascaran diferencias en literales ni en lógica SQL.

La referencia local fue regenerada desde el archivo con SHA-256:

```text
579f4e8e3b5f8725996ba4595cd526289a0c938b806df27ae83911b5ef1d17cd
```

## Auditoría de permisos

- RLS sigue activa en `orders`, `order_items` y `order_events`.
- Las dos RPC administrativas nuevas son `SECURITY DEFINER` con `search_path` vacío.
- EXECUTE está concedido al propietario y a `authenticated`; PUBLIC, anon y service_role no lo tienen.
- El rol `authenticated` necesita EXECUTE para acceder por la API, pero las funciones verifican `private.exigir_admin()` antes de consultar, bloquear o modificar un pedido.
- Anon no puede consultar pedidos ni ejecutar `admin_listar_pedidos`: se verificó el rechazo `42501`.
- Un usuario autenticado no administrador recibe `42501` en `admin_listar_pedidos`, tiene `is_admin() = false`, no ve pedidos, artículos ni eventos y carece de UPDATE directo.
- Los errores no devolvieron la entrada de prueba privada enviada como centinela. No se usaron datos personales reales para esas comprobaciones.
- Un administrador existente obtuvo `is_admin() = true` y una respuesta vacía válida del listado, coherente con los cero pedidos de Cloud.
- Los roles de la API carecen de INSERT, UPDATE, DELETE y TRUNCATE sobre pedidos, artículos y eventos.
- Las funciones anteriores de checkout, reservas, stock y administración conservan sus definiciones y permisos.

`admin_operar_pedido` y las demás RPC de escritura **no se invocaron en Cloud**. Su autorización se validó mediante grants, definiciones originales y las pruebas locales de administradores y no administradores. La comparación final de Cloud contra la referencia inicial confirmó que las comprobaciones no dejaron cambios.

## Pruebas locales y alcance del commit

- pgTAP: **591/591**, incluidas las 83 comprobaciones adicionales de seguridad y compatibilidad.
- Unitarias: **107/107**.
- TypeScript: sin errores.
- Procedimiento de referencia UTF-8: tres cuerpos compilados idénticos a la fuente, archivo UTF-8 verificado y cambios locales revertidos.
- Se conserva la validación aprobada de Playwright general **137/137**, concurrencia **15/15** y compras apagadas **8/8**. El código de aplicación no cambió después de esas corridas; este cierre agrega el procedimiento de referencia, documentación e ignorado de evidencia temporal.

Las credenciales aisladas, las referencias JSON de Cloud, sesiones de autenticación, reportes de ejecución y capturas generadas no forman parte del commit. Los fixtures SQL versionados contienen únicamente datos ficticios necesarios para ejecutar las pruebas locales.

La publicación se limita a `feat/catalogo-supabase`; no se habilitan ventas, Mercado Pago ni pg_cron, no se toca producción y no se inicia Fase 4B.7. El deployment y la revisión de acceso se comprueban sobre el Preview asociado al commit publicado; si Vercel Authentication intercepta una ruta, esa respuesta no se considera evidencia del comportamiento de Next.js.

## Evidencia privada local

Las referencias UTF-8 y resultados se conservaron fuera del repositorio, en `%TEMP%\steffen-4b6-verificacion-utf8\`. Contienen metadatos y huellas, no valores de credenciales ni filas de compradores. La referencia anterior y el registro de aplicación permanecen en sus directorios originales.
