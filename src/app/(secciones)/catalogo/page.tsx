import { CATALOGO_PDF } from '@/lib/site';
import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata(
  'Catálogo',
  'Descargá el catálogo 2025 de Steffen Cosmética Capilar con toda la línea de productos profesionales.',
  '/catalogo',
);

export default function CatalogoPage() {
  return (
    <>
      {/* Catalogo */}
      <section className="catalogo-section">
        <div className="catalogo-contenido">
          <a href={CATALOGO_PDF} target="_blank">
            <img className="pdf" src="/img/pdf.jpg" alt="" /> DESCARGAR CATALOGO <br />{' '}
            <img className="catalogo" src="/img/catalogo.png" alt="" />
          </a>
        </div>
      </section>
    </>
  );
}
