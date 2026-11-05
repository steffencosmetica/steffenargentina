import { legalDocuments, type LegalSlug } from '@/lib/legal/documents';
import { EMAIL, WHATSAPP_NUMERO } from '@/lib/site';
import { notFound } from 'next/navigation';
import { isLegalPagesEnabled, isRevocationEnabled } from '@/lib/legal/flag';

// Páginas del Botón de Arrepentimiento: dependen de su propio interruptor; las demás, del de páginas legales.
const REVOCATION_SLUGS: LegalSlug[] = ['arrepentimiento', 'recuperar-constancia'];

export default function LegalPage({ slug, children }: { slug: LegalSlug; children?: React.ReactNode }) {
  if (!(REVOCATION_SLUGS.includes(slug) ? isRevocationEnabled() : isLegalPagesEnabled())) notFound();
  const doc = legalDocuments[slug];
  return <main className="legal-page" id="contenido">
    <header className="legal-heading"><p className="legal-eyebrow">STEFFEN · INFORMACIÓN PARA VOS</p><h1>{doc.title}</h1><p>{doc.intro}</p></header>
    <aside className="legal-draft" aria-label="Estado del documento"><strong>Borrador pendiente de aprobación</strong><p>Identificación fiscal y condiciones pendientes de confirmación. Las compras públicas continúan deshabilitadas. Este borrador no limita tus derechos legales.</p></aside>
    <div className="legal-columns"><nav aria-label="En esta página"><strong>En esta página</strong>{doc.sections.map(([title], i) => <a key={title} href={`#seccion-${i + 1}`}>{title}</a>)}{children && <a href="#solicitud">Enviar solicitud</a>}</nav>
      <article>{doc.sections.map(([title, text], i) => <section id={`seccion-${i + 1}`} key={title}><h2>{title}</h2><p>{text}</p></section>)}{children}
        <section><h2>Contacto institucional</h2><p><a href={`mailto:${EMAIL}`}>{EMAIL}</a> · <a href="tel:+5492235590428">{WHATSAPP_NUMERO}</a></p><p>Atención: lunes a viernes de 8:00 a 16:00, por email y WhatsApp institucional. Área responsable: pendiente de confirmación.</p><p><a href="https://www.argentina.gob.ar/aaip/datospersonales">Protección de datos personales · AAIP</a></p></section>
      </article></div>
  </main>;
}
