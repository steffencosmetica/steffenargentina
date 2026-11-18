# Integración institucional Steffen y Tiendanube

Repositorio institucional: steffencosmetica/steffenargentina. Base aprobada: `16376ec2280365d09d5d16c3d176325fc42c35d3`.

## Catálogo y enlaces

El PDF del catálogo institucional 2025 se conserva byte por byte. Su vigencia comercial no está confirmada. Las presentaciones institucionales se mantienen con su fuente del PDF en el [inventario](INVENTARIO-CATALOGO-2025.md). La [auditoría comercial](AUDITORIA-COMERCIAL-CATALOGO.md) identifica los formatos con enlace exacto, los pendientes y aquellos sin ficha individual localizada.

El sitio enlaza a [Tiendanube](https://steffenargentina.com) y al [Portal Profesional](https://steffenprofesional.com). Enlaces de producto, precios y condiciones de destacados se mantienen manualmente en `tiendanube-links.js`. Cada ficha de compra corresponde al producto y a la presentación indicada. Las fotos oficiales de los destacados enlazan a la misma ficha que su botón. Las cinco rutinas enlazan a sus fichas públicas.

| Destacado | Presentación | Precio ARS | 3 cuotas sin interés | Transferencia |
|---|---|---:|---:|---:|
| Emulsión Argán Triple Acción | 180 cc | $10.320,00 | $3.440,00 | $9.288,00 |
| Brillo Semi de Lino | 125 cc | $16.095,00 | $5.365,00 | $14.485,50 |
| Bi-Phase Keratina | 200 ml | $11.202,00 | $3.734,00 | $10.081,80 |
| Cristal Semi de Lino recarga | 75 cc | $15.255,00 | $5.085,00 | $13.729,50 |

Precios, cuotas de Pago Nube y descuentos por transferencia contrastados con las fichas exactas de Tiendanube el 18/11/2026. Las condiciones pueden cambiar en la tienda.

## Pendientes comerciales

- Cera Antiestática: la ficha institucional indica 50 g y la ficha comercial indica 50 cc. La ficha institucional carece de botón de compra.
- Exhibidores Triple Acción: 12 unidades de 70 cc. Los enlaces de compra llevan exclusivamente a las emulsiones de 180 cc, con la presentación indicada en el botón.
- Máscaras Coconut y Baño de Luz: la descripción indica 1000 cc y las etiquetas fotografiadas, 900 cc. Solo se enlazan los potes verificados de 250 cc.
- Acondicionador Neutro, formatos y exhibidores sin ficha comercial exacta: consultar el detalle en la auditoría comercial.

## Alcance técnico

Sitio estático institucional. El formulario activo del inicio utiliza Formspree. La redirección de contacto conserva el enlace a ese formulario. La prueba local de envío intercepta la solicitud y simula una respuesta exitosa o un error; no genera consultas reales. El archivo heredado `enviar.php` contiene marcadores presentes en la base y carece de referencias en el sitio. GitHub Pages sirve el sitio estático y no ejecuta PHP.

Las capturas de revisión, los guiones temporales de pruebas y el ecommerce Next.js/Supabase están fuera del commit.
