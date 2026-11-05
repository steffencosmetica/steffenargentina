// Borradores pendientes de aprobación jurídica y contable. Incorporan las decisiones comerciales aprobadas
// (docs/legal-pendientes.md, «Decisiones comerciales ya aprobadas»). Los datos que faltan se indican como
// pendientes: no se completan con valores supuestos. Las versiones aprobadas y su evidencia de aceptación
// se definirán antes de vender.
export const legalDocuments = {
  'terminos-y-condiciones': {
    title: 'Términos y condiciones',
    intro: 'Información para comprar con claridad en Steffen Tienda.',
    sections: [
      ['Quién vende', 'Steffen Cosmética Capilar es la marca presentada en este sitio. El vendedor está inscripto en el régimen de monotributo. Su nombre o razón social, CUIT y domicilio legal están pendientes de confirmación; este borrador no reemplaza esa identificación obligatoria.'],
      ['Alcance y productos', 'La tienda ofrece cosmética capilar. Consultá las características, presentación, instrucciones y advertencias de cada producto y su rotulado. La indicación de uso profesional no elimina los derechos de quien compra como consumidor final.'],
      ['Precios y disponibilidad', 'Los importes se expresan en pesos argentinos (ARS). El resumen de compra discrimina productos, envío y total antes de confirmar. La disponibilidad se verifica nuevamente al crear el pedido; agregar al carrito no reserva unidades.'],
      ['Facturación', 'Cada compra se factura con Factura C, emitida manualmente desde los servicios de ARCA. La tienda no está integrada con ARCA: el comprobante no se genera automáticamente al comprar. El PDF se envía manualmente al email informado en la compra, desde la casilla institucional. El momento de emisión y envío, y los datos que puedan requerirse para emitirlo, están pendientes de confirmación contable.'],
      ['Proceso de compra y confirmación', 'Las compras públicas están deshabilitadas. Cuando se habiliten, podrás revisar tus datos, productos, entrega y total antes de confirmar. El pedido tendrá un código y acceso privado de seguimiento. Su recepción no implica que el pago esté aprobado. No compartas el enlace privado.'],
      ['Pagos', 'No hay pasarela de pago integrada ni cobros habilitados. Los medios y condiciones de pago se informarán antes de comprar cuando estén implementados y aprobados.'],
      ['Entrega', 'La cobertura y el costo dependen de la provincia y de las tarifas configuradas. El plazo estimado de preparación y despacho es de 1 a 3 días hábiles desde la confirmación del pago, sin incluir el tiempo del transporte. Consultá Envíos y entregas.'],
      ['Atención y comunicaciones', 'Atendemos de lunes a viernes de 8:00 a 16:00, por email y por el WhatsApp institucional indicados al final de esta página. Fuera de ese horario podés escribirnos igual; respondemos en el horario de atención. Los emails que enviamos a compradores son exclusivamente transaccionales (pedido, envío, facturación, arrepentimiento y reclamos): no enviamos publicidad por este medio.'],
      ['Cancelaciones y derechos', 'Podés comunicar una cancelación o un reclamo por los canales de atención. El arrepentimiento y los reclamos por defectos o errores de envío se explican en las páginas correspondientes. No ofrecemos por ahora beneficios comerciales adicionales a los derechos legales. Estas condiciones no implican renuncia a derechos legales ni imponen una jurisdicción distinta de la que corresponda al consumidor.'],
    ],
  },
  'politica-de-privacidad': {
    title: 'Política de privacidad',
    intro: 'Qué datos utiliza la aplicación, para qué y cómo ejercer tus derechos.',
    sections: [
      ['Responsable y contacto', 'La identificación legal y el domicilio del responsable del tratamiento están pendientes de confirmación. Podés dirigir consultas de privacidad al email institucional indicado al final de esta página, de lunes a viernes de 8:00 a 16:00.'],
      ['Datos y finalidades', 'El checkout está preparado para tratar nombre y apellido, email, teléfono, dirección de entrega e información de pedidos, con el fin de gestionar la compra, la entrega, la facturación y la atención. El formulario de arrepentimiento solicita una referencia de compra y un email para tramitar el pedido de revocación; no pide contraseña, domicilio ni datos de tarjetas. El contacto institucional solicita nombre, apellido, rubro, localidad, provincia, teléfono, email, tipo de consulta y mensaje para responder consultas comerciales.'],
      ['Emails transaccionales', 'Usamos tu email solo para comunicaciones relacionadas con tu compra o solicitud: constancias, recuperación de constancias, estado del pedido, envío, facturación y reclamos. No lo usamos para publicidad. Registramos el estado técnico de cada envío (pendiente, aceptado por el servidor de correo, error o rebote) para detectar fallos; la aceptación por el servidor no confirma que el mensaje haya sido entregado o leído.'],
      ['Seguridad y datos técnicos', 'Se utilizan controles de acceso y registros operativos para seguridad, prevención de abuso y auditoría. Los límites de solicitudes utilizan una huella criptográfica de la IP; no se guarda la IP original en las tablas de intentos de compra, arrepentimiento o recuperación. Los enlaces privados de recuperación se guardan solo como huella criptográfica, vencen a los 30 minutos y sirven una vez. El alojamiento puede procesar registros técnicos de conexión. No incluyas información sensible en los formularios.'],
      ['Proveedores y destinatarios', 'Supabase proporciona base de datos y autenticación administrativa; Vercel aloja la aplicación actual. El correo institucional y los emails transaccionales se envían mediante Zoho. El formulario institucional de contacto utiliza Formspree. Los enlaces a WhatsApp y redes sociales llevan a servicios externos con sus propias políticas. Para entregar los pedidos se comunican al transportista (habitualmente Andreani) solo los datos necesarios. Los comprobantes fiscales se emiten en los servicios de ARCA. Deben confirmarse proveedores, regiones de alojamiento y garantías para transferencias internacionales antes de aprobar esta política. Mercado Pago todavía no está integrado; se actualizará esta información antes de utilizarlo.'],
      ['Almacenamiento en el navegador', 'La administración usa cookies de sesión. El carrito, cuando está disponible, conserva productos y cantidades en el almacenamiento local del navegador. No se declara un uso de cookies de publicidad o analítica sin verificarlo. Algunas páginas institucionales cargan fuentes desde Google; estas páginas legales utilizan Montserrat alojada en el sitio.'],
      ['Conservación', 'Los pedidos, solicitudes y registros de comunicaciones se conservan para su gestión y para las obligaciones que correspondan. Los plazos definitivos y el procedimiento de revisión y supresión están pendientes de aprobación. No existe una eliminación automática general de estos datos. El acceso está restringido al personal autorizado; ninguna medida permite prometer seguridad absoluta.'],
      ['Tus derechos', 'Podés solicitar acceso, rectificación, actualización y, cuando corresponda, supresión o confidencialidad. La identidad se verifica de manera razonable sin revelar datos de terceros. El acceso debe responderse dentro de diez días corridos; la rectificación o supresión, dentro de cinco días hábiles. El acceso es gratuito cada seis meses, salvo interés legítimo. Las obligaciones de conservación pueden impedir la supresión. Podés reclamar ante la Agencia de Acceso a la Información Pública (AAIP).'],
    ],
  },
  'envios-y-entregas': {
    title: 'Envíos y entregas',
    intro: 'Cobertura, costos, plazos y gestión de la entrega de tu pedido.',
    sections: [
      ['Cobertura y tarifas', 'La cobertura se consulta por provincia según las zonas activas configuradas por Steffen. Antes de confirmar una compra se informa el costo definitivo de envío. Si no hay cobertura, no se puede completar la compra para ese destino.'],
      ['Envío gratuito', 'Puede ofrecerse envío gratuito cuando la zona tenga configurado un importe mínimo y el subtotal del pedido cumpla esa condición. El resumen indica el costo aplicable; no hay una promesa general de envío gratis.'],
      ['Preparación y despacho', 'El plazo estimado de preparación y despacho es de 1 a 3 días hábiles desde la confirmación del pago. Ese plazo no incluye el tiempo que demora el transporte, que depende del destino y del transportista. La preparación requiere pago aprobado y disponibilidad confirmada.'],
      ['Transportista', 'Trabajamos habitualmente con Andreani. Según el destino o la disponibilidad, podemos utilizar otro transportista; en ese caso te lo informamos con los datos de seguimiento.'],
      ['Seguimiento y recepción', 'Al registrar el despacho, el seguimiento privado del pedido muestra el transportista, el código de seguimiento y la fecha. El código se informa cuando está disponible; no se garantiza un enlace automático de seguimiento. Revisá tus datos de entrega antes de confirmar.'],
      ['Envíos fallidos', 'Si una entrega no se concreta (por ejemplo, ausencia, dirección incompleta o devolución del transportista), evaluamos cada caso según su causa y coordinamos con vos la solución. No aplicamos cargos automáticos por reenvío y esta gestión no desconoce las obligaciones del vendedor ni tus derechos como consumidor.'],
      ['Demoras o incidencias', 'Contactanos con la referencia del pedido para consultar una demora, un faltante o un inconveniente en la entrega. Atendemos de lunes a viernes de 8:00 a 16:00, por email y WhatsApp institucional. La gestión del transporte no limita las obligaciones del vendedor ni los derechos del consumidor.'],
    ],
  },
  'cambios-y-devoluciones': {
    title: 'Cambios y devoluciones',
    intro: 'Tus derechos legales y cómo coordinamos una devolución.',
    sections: [
      ['Arrepentimiento de compras a distancia', 'Tenés diez días corridos desde la entrega o la celebración del contrato, lo último que ocurra, para comunicar la revocación, sin necesidad de justificarla. Si el vencimiento es inhábil se extiende al primer día hábil siguiente. Los gastos de devolución corresponden al vendedor. Poné el producto a disposición para coordinar su devolución. Si no se informó debidamente este derecho, no se extingue por el mero transcurso del plazo.'],
      ['Cosméticos abiertos, usados o consumidos', 'Abrir un envase no equivale automáticamente a usar o consumir el producto. No se establece una exclusión general por tratarse de cosmética. La Disposición 954/2025 contempla el uso o consumo efectivo y otras excepciones; su aplicación debe analizarse junto con las normas de mayor jerarquía y las circunstancias concretas, sin rechazar automáticamente solicitudes. El formulario permite comunicar el caso para su evaluación.'],
      ['Defectos o producto incorrecto', 'Los reclamos por defectos, daños, faltantes o envío de un producto distinto se atienden de forma independiente del arrepentimiento. La apertura necesaria para detectar un defecto no elimina por sí misma estos derechos. Contactanos con la referencia de compra para coordinar la solución legal que corresponda, sin cargos indebidos.'],
      ['Cambios voluntarios', 'Por ahora no ofrecemos cambios ni beneficios comerciales adicionales a los derechos legales (por ejemplo, cambios por preferencia de producto o fragancia). Esto no limita el arrepentimiento ni los reclamos por defectos o errores, que siempre podés ejercer.'],
      ['Cómo se coordina una devolución', 'Cuando corresponda una devolución, coordinamos con vos de forma individual el envío o el retiro del producto. Esa coordinación es operativa: no condiciona el ejercicio de tus derechos ni el plazo en que los comunicaste. No envíes productos a una dirección sin coordinarlo previamente, para que podamos recibirlos.'],
      ['Gestión y reintegros', 'La recepción de una solicitud no acredita por sí sola un reintegro. Steffen debe verificar la compra y coordinar la devolución y la restitución que correspondan. No se realizan reembolsos automáticos desde este formulario.'],
    ],
  },
  arrepentimiento: {
    title: 'Botón de Arrepentimiento',
    intro: 'Solicitá la revocación de una compra a distancia, sin registrarte ni iniciar sesión.',
    sections: [
      ['Cómo solicitarlo', 'Ingresá una referencia de la compra y tu email de contacto. No necesitás explicar un motivo ni adjuntar documentos para registrar la solicitud. La recepción no consulta ni confirma la existencia del pedido, para proteger tus datos. Podés enviarla en cualquier momento: la recepción web no depende del horario de atención.'],
      ['Plazo y constancia', 'El plazo general es de diez días corridos desde la entrega o la contratación, lo último que ocurra. Si el vencimiento es inhábil se extiende al primer día hábil siguiente. El código de solicitud se comunica en esta misma web al completar el envío. Conservá esa constancia: es el comprobante principal de tu solicitud. El equipo gestiona luego la revocación y coordina los pasos que correspondan.'],
      ['Copia por email y recuperación', 'Además, intentamos enviarte una copia de la constancia por email como respaldo. Ese envío puede demorar o fallar y no reemplaza la constancia web. Si la perdiste, podés pedir un enlace privado a tu email para consultarla: vence a los 30 minutos y sirve una sola vez. Por privacidad, la página no informa si existen solicitudes asociadas a un email.'],
      ['Devolución y contacto', 'Los gastos de la devolución por arrepentimiento corresponden al vendedor. Coordinamos con vos el envío o el retiro del producto; esa coordinación no condiciona tu derecho. Consultá Cambios y devoluciones para conocer las distinciones sobre productos abiertos, usados o consumidos y otros reclamos. Podrá requerirse una verificación razonable de identidad para gestionar la compra, sin exigir una cuenta. Si no podés enviar el formulario, usá el email institucional indicado abajo.'],
    ],
  },
  'recuperar-constancia': {
    title: 'Recuperar constancia de arrepentimiento',
    intro: 'Consultá tus constancias con un enlace privado enviado a tu email, sin crear una cuenta.',
    sections: [
      ['Cómo funciona', 'Ingresá el email que usaste al presentar la solicitud. Si hay solicitudes asociadas, te enviamos un enlace privado. Al abrirlo vas a ver solo el código, la fecha de recepción y el estado de cada solicitud.'],
      ['Privacidad del enlace', 'El enlace vence a los 30 minutos, sirve una sola vez y es distinto del enlace de seguimiento de pedidos. Pedir un enlace nuevo invalida el anterior que no se haya usado. Esta página nunca informa si un email tiene solicitudes.'],
    ],
  },
} as const;
export type LegalSlug = keyof typeof legalDocuments;
