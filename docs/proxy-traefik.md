# IP del cliente detrás de Traefik (Hostinger VPS con Dokploy)

Estado: **implementado y probado localmente con Traefik 3.5.6 real en Docker. Aceptación final PENDIENTE** hasta
verificarlo en el VPS real (§6). Mientras tanto, cualquier despliegue sin esta configuración falla cerrado.

## 1. Por qué importa

La IP (solo su HMAC) alimenta los límites antiabuso de `crear_pedido`, del Botón de Arrepentimiento y de la
recuperación de constancias. Si se tomara de una cabecera que el cliente puede escribir, cualquiera evadiría los
límites; si todos los compradores compartieran una IP (la del proxy o la de Docker), el límite sería global y
bloquearía a todos. Ambos casos se rechazan.

## 2. Cadena de confianza

```
Cliente ──TCP──▶ Traefik (Dokploy, :80/:443) ──red Docker interna──▶ Next.js (sin puertos publicados)
```

Únicos elementos de confianza: **Traefik** y, opcionalmente, proxies anteriores declarados explícitamente (por
ejemplo Cloudflare) en `STEFFEN_TRUSTED_UPSTREAM_CIDRS` **y** en `forwardedHeaders.trustedIPs` de Traefik.

## 3. Saneamiento de cabeceras (verificado en el código de Traefik y en el arnés local)

1. Si el par TCP **no** está en `forwardedHeaders.trustedIPs` (y `insecure` está apagado, como por defecto),
   Traefik **borra** todas las `X-Forwarded-*` y `X-Real-Ip` que mandó el cliente
   (`pkg/middlewares/forwardedheaders`, `DeleteXForwardedHeaders`).
2. Luego fija `X-Real-Ip` = dirección TCP del par y agrega esa dirección a `X-Forwarded-For`.
3. El middleware `headers.customRequestHeaders` fija `X-Steffen-Proxy-Auth` con el secreto, **reemplazando**
   cualquier valor que mande el cliente.

## 4. Cómo obtiene Next la IP efectiva (`src/lib/orders/client-ip.ts`)

Con `STEFFEN_TRUSTED_PROXY=traefik`:

1. `X-Steffen-Proxy-Auth` debe ser igual a `STEFFEN_PROXY_SECRET` (comparación en tiempo constante): prueba que la
   request pasó por nuestro Traefik. Una request directa a Next queda sin IP aunque falsifique todo.
2. `X-Forwarded-For`: todas las entradas deben ser IPs válidas (máx. 5); cualquier valor inválido → sin IP.
3. Sin proxies anteriores declarados: debe haber **exactamente una** entrada y coincidir con `X-Real-Ip`. Si hay
   más, Traefik está confiando en alguien que no declaramos (p. ej. `insecure: true`) → sin IP. No se elige una
   posición fija.
4. Con proxies anteriores declarados: de derecha a izquierda se saltean solo los rangos declarados; la primera IP
   restante es el cliente.
5. La IP resultante debe ser **pública**: privadas, loopback, CGNAT, link-local, ULA, etc. se rechazan (indican
   que Traefik ve una dirección de Docker o NAT en lugar del cliente).
6. Sin IP confiable: la operación sensible se rechaza (503 en arrepentimiento/recuperación, error en checkout).
   Nunca se usa una IP compartida. Con un proxy configurado **no** hay respaldo `127.0.0.1` ni se omite el control
   antibots (`humanCheck()` sigue fallando cerrado hasta implementar Turnstile).

Vercel (`VERCEL=1`) y el entorno local (sin proxy, Supabase local o `next dev`) conservan su comportamiento.

## 5. Configuración en Dokploy (a aplicar en el despliegue; no aplicada)

Variables del contenedor de Next (servidor, nunca `NEXT_PUBLIC_`):

```
STEFFEN_TRUSTED_PROXY=traefik
STEFFEN_PROXY_SECRET=<≥32 caracteres aleatorios, solo en Dokploy>
# solo si hay un proxy delante de Traefik (p. ej. Cloudflare):
# STEFFEN_TRUSTED_UPSTREAM_CIDRS=173.245.48.0/20,...
```

Traefik (configuración dinámica de Dokploy, Traefik → File System, o labels de la aplicación):

```yaml
http:
  middlewares:
    steffen-proxy-auth:
      headers:
        customRequestHeaders:
          X-Steffen-Proxy-Auth: "<mismo secreto>"
```

y agregar `steffen-proxy-auth` a los middlewares del router de la tienda. En la configuración estática **no**
activar `forwardedHeaders.insecure`, ni poner `trustedIPs` amplios (como `0.0.0.0/0`).

Red: la aplicación de Next **sin puertos publicados** (solo dominio en Dokploy → acceso por la red de Traefik).
Verificar con `docker ps` que el contenedor no publica puertos y con el firewall del VPS que solo 80/443 (y SSH)
están abiertos.

## 6. Aceptación en el VPS real (pendiente)

Sin habilitar ventas ni el arrepentimiento:

1. Definir temporalmente `STEFFEN_PROXY_DIAGNOSTIC_TOKEN` (≥ 32 caracteres) y desplegar.
2. Desde dos conexiones distintas (p. ej. Wi-Fi y datos móviles, IPv4 e IPv6 si el VPS tiene IPv6):
   `curl -H "Authorization: Bearer <token>" https://<dominio>/api/interno/proxy`.
   Esperado: `200` con `"ip"` igual a la IP pública de cada conexión (comparar con un servicio «¿cuál es mi IP?»),
   `"hops": 1` y distintas entre sí.
3. Repetir agregando `-H "X-Forwarded-For: 1.2.3.4" -H "X-Real-Ip: 9.9.9.9"`: la IP debe seguir siendo la real.
4. Intentar acceder al contenedor de Next sin Traefik (IP interna o puerto): no debe ser alcanzable desde fuera; si
   lo fuera, el diagnóstico debe responder `"reason": "secreto"`.
5. Si responde `ip_no_publica` (p. ej. `172.x`), Traefik no ve al cliente real (NAT de Docker, IPv6 con
   userland-proxy, modo ingress de Swarm): corregir la publicación de puertos de Traefik (modo `host`) antes de seguir.
6. Quitar `STEFFEN_PROXY_DIAGNOSTIC_TOKEN` y redesplegar.

## 7. Pruebas

- Unitarias (`src/lib/orders/client-ip.test.ts`): cabeceras falsificadas, valores inválidos, IPv4, IPv6, IPv4
  mapeada, ausencia de IP, múltiples proxies, IPs privadas, usuarios distintos, configuración incompleta.
- Traefik real (`npm run test:e2e:proxy`): red Docker con Traefik correcto, Traefik con `insecure` (error a detectar)
  y clientes con IPs distintas (IPv4 e IPv6). Verifica por el HMAC guardado en la base qué IP usó Next, límites
  independientes por usuario, rechazo del acceso directo y el diagnóstico de aceptación. Los clientes del arnés
  usan direcciones privadas de Docker: **solo** ese build define `STEFFEN_PROXY_ALLOW_PRIVATE_CLIENTS=1`.
