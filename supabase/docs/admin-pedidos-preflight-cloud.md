# Fase 4B.6 — Verificación previa de Cloud por PostgreSQL

Verificación completada el 3 de noviembre de 2026, 21:57 UTC. **No se aplicaron migraciones, no se hizo commit ni push.**

## Proyecto y credenciales

- Único destino: **Steffen Web tienda**, `zzxlghpopmccwsaqbsko`.
- Los archivos aislados `steffen-tienda` y `steffen-tienda-db` siguen disponibles en `%USERPROFILE%\.supabase-tokens\`.
- Sus valores no se imprimieron ni se copiaron a informes, argumentos de comandos, archivos nuevos o Git. La contraseña se pasó al cliente mediante el entorno de cada proceso.
- No se ejecutó `supabase login` ni se modificó el login global.
- Conexión verificada: `db.zzxlghpopmccwsaqbsko.supabase.co:5432`, base `postgres`, usuario `postgres`, PostgreSQL 17.11. La dirección del servidor coincide con la dirección IPv6 de ese endpoint.

## Conectividad y TLS

El cliente `psql` está en el contenedor local. Ese contenedor no tiene ruta IPv6, aunque Windows sí puede alcanzar el endpoint directo. Se utilizó un puente TCP **temporal, limitado a 127.0.0.1**, que reenvía bytes hacia el endpoint autorizado y se cierra al terminar cada consulta. No registra tráfico ni termina TLS.

La conexión de `psql` mantuvo `sslmode=verify-full`: se verificaron la cadena de certificados y el nombre del servidor. La CA pública se obtuvo desde la URL usada por el [Dashboard oficial de Supabase](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json); se configuró únicamente para los clientes temporales, sin cambiar la confianza global del equipo.

No se dedujo ni se probó un host de pooler a partir de la región. La consulta oficial del pooler requiere `database_pooling_config_read`, que el PAT actual no tiene; la conexión directa permitió evitar esa dependencia.

## Referencia previa

Las consultas de Cloud se ejecutaron dentro de:

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- SELECT de metadatos, historial, conteos y huellas.
ROLLBACK;
```

Además, la conexión se inició con `default_transaction_read_only=on`. Se comprobó que `transaction_read_only` devolviera `on`.

La referencia contiene columnas, constraints, índices, funciones y sus cuerpos, propietarios, grants, políticas RLS, triggers, historial de migraciones y huellas de datos relevantes. Se incluyen metadatos de claves internas, sin sus valores. Los registros comerciales se comparan mediante conteos y huellas calculadas en PostgreSQL; no se exportaron compradores ni credenciales.

Los archivos completos están fuera del repositorio, en `%TEMP%\steffen-4b6-postgres-preflight\`:

- `cloud-before.json`: referencia previa.
- `identity.json`: identidad y modo de solo lectura.
- `local-expected-metadata.json`: esquema local esperado.
- `schema-comparison.json`: diferencias detectadas, **lista vacía**.
- `read-only-permissions.json`: comprobaciones de permisos con rol no administrador.
- `dry-run.txt`: salida del dry-run, sin credenciales.
- `cloud-after-dry-run.json`: referencia posterior, idéntica a la previa.
- `result.json`: resultado, fecha y SHA-256 de la migración revisada.

## Estado confirmado

| Comprobación | Resultado |
|---|---|
| `checkout_enabled` | **false** |
| Pedidos / artículos / eventos | **0 / 0 / 0** |
| Intentos de checkout | **0** |
| `pg_cron` instalado | **No** |
| Productos | **1**, con **25** unidades disponibles y `stock_version = 1` |
| Categorías | **1** |
| Imágenes de producto / objetos de Storage | **2 / 2** |
| Zonas / asignaciones de provincias | **1 / 2** |
| Historial remoto | **11 migraciones anteriores** |
| Historial local | Las mismas 11 y la migración administrativa, **12** en total |
| Esquema remoto frente al local sin los objetos nuevos de 4B.6 | **Sin diferencias** |
| Referencia previa frente a posterior al dry-run | **Idénticas**: esquema, grants, políticas, triggers, historial y huellas de datos |

La referencia de metadatos abarca 15 tablas/secuencias, 40 funciones, 30 políticas y 11 triggers de los esquemas incluidos. Las huellas también cubren productos completos —incluidos precios y stock—, categorías, imágenes, envíos, configuración y referencias de identidad. No se modificó ninguno de esos datos.

## RLS y permisos existentes

- RLS está activa en `orders`, `order_items` y `order_events`; las políticas administrativas coinciden con el esquema local validado.
- Se comprobó un rol `authenticated` con un sujeto sin permisos administrativos: `is_admin() = false`, cero pedidos visibles y ausencia de UPDATE directo sobre pedidos.
- Anon no tiene SELECT de pedidos ni EXECUTE para cancelar pedidos.
- `crear_pedido`, `consultar_pedido` y `liberar_reservas_vencidas` conservan EXECUTE para `service_role`, sin EXECUTE para `anon` ni `authenticated`.
- Las funciones administrativas anteriores conservan EXECUTE para `authenticated`, controles `private.exigir_admin()`, `SECURITY DEFINER` y `search_path` vacío. Sus cuerpos y permisos coinciden con los de la base local validada.
- No se invocaron funciones que creen pedidos, cambien stock, aprueben pagos o cancelen reservas en Cloud.
- La columna `admin_version` y las funciones nuevas todavía **no existen en Cloud**, como corresponde a una migración pendiente.

## Dry-run sin Management API de base de datos

Se utilizó el ejecutable nativo instalado del CLI, con una URL **sin contraseña** hacia el endpoint directo, la CA explícita y opciones de conexión de solo lectura. La contraseña estuvo únicamente en el entorno del proceso.

Forma del comando, sin datos de conexión secretos:

```text
supabase db push --db-url <URL_SIN_PASSWORD_CON_TLS_Y_SOLO_LECTURA> --dry-run --skip-vault
```

No se usaron `--linked`, `--include-all`, `--include-seed` ni `--include-roles`. `--skip-vault` excluyó las actualizaciones de Vault. La ejecución nativa sin shell preservó exactamente la codificación del DSN.

Resultado del CLI:

```json
{
  "upToDate": false,
  "dryRun": true,
  "migrations": ["20261104120000_admin_pedidos.sql"],
  "seeds": [],
  "roles": []
}
```

**Única migración pendiente:** `20261104120000_admin_pedidos.sql`.

SHA-256 del archivo revisado:

```text
579f4e8e3b5f8725996ba4595cd526289a0c938b806df27ae83911b5ef1d17cd
```

El helper temporal usado para esta revisión no contiene una acción de aplicación. La comparación posterior confirmó que el dry-run no cambió Cloud.

## PAT

**No es necesario reemplazar el PAT para continuar por conexión PostgreSQL con la contraseña existente.** La ayuda del CLI confirma que `db push --db-url` no necesita permisos del PAT. La [documentación oficial](https://supabase.com/docs/guides/platform/personal-access-tokens) también distingue los comandos que usan Management API de los que se conectan con contraseña de base de datos.

Si se prefiriera volver a Management API para estas lecturas, la variante mínima sería un token scoped al único proyecto `zzxlghpopmccwsaqbsko`, con **Database: Read** (`database_read`) y **Project Settings: Read** para verificar su identidad. **Database Pooling Config: Read** (`database_pooling_config_read`) solo sería necesario si también se quiere obtener el host del pooler por API. No hace falta acceso de escritura para la referencia previa.

Ese token se crea en Dashboard → Account → Access Tokens → Generate new token, seleccionando solo **Steffen Web tienda**, sin alcance global ni de toda la organización, con los permisos Read indicados y una expiración limitada. Se guardaría exclusivamente en el archivo aislado, sin compartir el valor por chat ni ejecutar un login global. Esta alternativa no se realizó.

## Procedimiento propuesto para continuar

1. Volver a validar el destino, la huella del archivo y que la referencia no haya cambiado desde esta revisión.
2. Repetir el dry-run y exigir nuevamente que solo aparezca la migración administrativa.
3. Cuando se indique proceder con la aplicación, utilizar la misma conexión PostgreSQL y CA, habilitando escritura **solo en ese proceso** para aplicar esa única migración. No tocar `checkout_enabled`, Vault, seeds, roles, pg_cron ni datos comerciales.
4. Ejecutar inmediatamente comprobaciones de solo lectura: historial, columna y funciones nuevas, EXECUTE/RLS, compatibilidad de funciones anteriores, datos comerciales y stock idénticos, checkout apagado y cero pedidos/intentos.
5. Retomar commit, push exclusivo de `feat/catalogo-supabase` y revisión del Preview únicamente cuando se autorice esa etapa. Las capturas temporales y las referencias privadas quedan fuera del commit.

Estado de Git durante esta verificación: `feat/catalogo-supabase`, HEAD `17d0d94e03e848fa3d08205b36faad87d1f5acb4`. No hubo commit, push, migraciones aplicadas, cambios en otros proyectos ni avance a Fase 4B.7.
