# Fase 4B.6 — Registro histórico de aplicación y detención inicial

La incidencia UTF-8 de este registro ya fue resuelta mediante regeneración de la referencia desde las fuentes originales, sin cambios adicionales en Cloud. La auditoría posterior está en el [informe de cierre](admin-pedidos-cierre.md). Las secciones siguientes conservan el estado observado durante la detención inicial.

## Resultado

La migración **`20261104120000_admin_pedidos.sql` fue aplicada** exclusivamente al proyecto **Steffen Web tienda (`zzxlghpopmccwsaqbsko`)**. Cloud tiene ahora **12 migraciones**.

La publicación del código se detuvo porque la comparación posterior detectó una diferencia de codificación en dos cuerpos de función respecto de la referencia local. Se respetó la instrucción de detenerse ante una anomalía: **sin corrección automática en Cloud, sin commit ni push**.

## Última comprobación previa

- Identidad PostgreSQL: endpoint directo `db.zzxlghpopmccwsaqbsko.supabase.co`, base y usuario `postgres`, servidor 17.11, TLS `verify-full`.
- Referencia nueva conservada por separado de la referencia previamente aprobada.
- Esquema, datos e historial remotos idénticos a la referencia aprobada.
- Checkout apagado, cero pedidos e intentos, pg_cron ausente.
- Historial remoto: 11 migraciones previas; las migraciones anteriores no se alteraron.
- Dos dry-runs consecutivos mostraron exclusivamente la migración autorizada, sin seeds ni roles.
- Huella del archivo aplicado: `579f4e8e3b5f8725996ba4595cd526289a0c938b806df27ae83911b5ef1d17cd` (SHA-256).

Se usó la conexión PostgreSQL con la contraseña aislada, sin cambiar el login global. La escritura se habilitó únicamente para el proceso que ejecutó `db push --db-url ... --skip-vault --yes`, sin `--include-all`, seeds, roles ni operaciones destructivas. Las lecturas posteriores volvieron a transacciones explícitas de solo lectura.

## Comparación posterior

La referencia posterior se obtuvo el **3 de noviembre de 2026 a las 22:26 UTC**.

| Comprobación | Resultado observado |
|---|---|
| Migración nueva registrada | `20261104120000`, nombre `admin_pedidos` |
| Total de migraciones remotas | **12** |
| Historial de las 11 migraciones anteriores | Sin cambios |
| Políticas RLS | Idénticas a la referencia previa |
| RLS de pedidos, artículos y eventos | Activa en las tres tablas |
| Funciones anteriores | Cuerpos, firmas, grants y propiedades sin cambios |
| Productos, precios, stock, categorías, imágenes y demás datos comparados | Huellas idénticas a la referencia previa |
| Producto comercial | Conserva **25 unidades**, `stock_version = 1`, por igualdad de la huella completa del registro previamente verificado |
| `checkout_enabled` | **false** |
| Pedidos / intentos | **0 / 0** |
| pg_cron | Ausente |
| Metadatos de claves internas | Sin cambios; nunca se exportaron sus valores |

Las tres funciones nuevas existen. Sus cuerpos en Cloud coinciden exactamente, normalizando solo los finales de línea y espacios exteriores, con el archivo de migración aprobado:

- `private.orders_incrementar_version`: EXECUTE solo del propietario `postgres`.
- `public.admin_operar_pedido`: EXECUTE de `postgres` y `authenticated`.
- `public.admin_listar_pedidos`: EXECUTE de `postgres` y `authenticated`.

No tienen EXECUTE de PUBLIC, anon ni service_role. Las propiedades y grants de función coinciden con lo esperado. La única diferencia detectada frente al esquema local está en `prosrc` de las dos RPC públicas nuevas.

## Diferencia exacta de codificación

| Función | Cloud y archivo aprobado | Referencia local |
|---|---|---|
| `admin_listar_pedidos` | `Página inválida` | `P?gina inv?lida` |
| `admin_operar_pedido` | `El pedido cambió. Recargá y revisá…` | `El pedido cambi?. Recarg? y revis?…` |

También difieren, por el mismo motivo, los textos `El estado ya cambió`, `Fecha de despacho inválida`, `Operación no disponible` y un comentario sobre la integración de Fase 5.

**Cloud conserva el UTF-8 correcto del archivo autorizado.** La referencia local contiene signos `?` donde debían estar las tildes. Esto es consistente con la carga local inicial a través de un pipe de PowerShell hacia `psql`, que no preservó esos caracteres. No se encontraron diferencias en los permisos ni en la lógica SQL de esas líneas; son mensajes de error y un comentario.

No se modificó Cloud para igualarlo a la referencia local dañada. Tampoco se corrigió automáticamente la base local en esta etapa.

## Verificaciones pendientes

El proceso se frenó en la comparación de funciones. Por ello **no se completó el bloque posterior de pruebas efectivas de rechazo de las nuevas RPC con anon y authenticated no administrador**. Los grants y las políticas sí están comprobados en la referencia obtenida, pero no se presenta ese bloque pendiente como ejecutado.

El siguiente paso propuesto es corregir únicamente la referencia/base local para preservar UTF-8, volver a validar las comparaciones y ejecutar las verificaciones de solo lectura pendientes sobre Cloud. No se propone una migración correctiva ni un cambio de las funciones en Cloud: sus cuerpos coinciden con el archivo aprobado.

## Git y Preview

- Rama: `feat/catalogo-supabase`.
- HEAD: `17d0d94e03e848fa3d08205b36faad87d1f5acb4`.
- No se creó commit ni se hizo push.
- No se generó un Preview nuevo; Ready, noindex y revisión de rutas del nuevo código quedan pendientes.
- Sin modificaciones en `main`, `feat/nextjs-migracion`, ERP o Portal Profesional.
- Sin pagos, pedidos de prueba, activación de ventas o pg_cron, ni avance a Fase 4B.7.

## Evidencia local fuera de Git

En `%TEMP%\steffen-4b6-publicacion\` se conservaron la referencia previa, el dry-run, `apply.txt`, `cloud-after-apply.json`, `stopped-comparison.json` y `encoding-diagnosis.json`. No contienen valores de las credenciales. Las referencias comerciales guardan conteos y huellas, no compradores.
