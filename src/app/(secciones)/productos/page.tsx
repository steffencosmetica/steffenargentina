import Link from 'next/link';
import TiltSection from '@/components/productos/TiltSection';
import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata(
  'Productos',
  'Líneas profesionales Steffen: reparadores de puntas, finishing, emulsiones Triple Acción, bi-phases, shampoos, acondicionadores y máscaras capilares.',
  '/productos',
);

export default function ProductosPage() {
  return (
    <>
      {/* Reparadores */}
      <TiltSection className="productofirst-seccion" cardClassName="productofirst-contenido" background="/img/6.jpg">
        <h4>TERMINACION</h4>
        <h2>REPARADORES DE PUNTAS</h2>
        <Link href="/reparadores">Ver más &gt;</Link>
      </TiltSection>

      {/* Finishing */}
      <TiltSection className="producto-seccionizq" cardClassName="producto-contenidoizq" background="/img/8.jpg">
        <h4 className="finishing">TERMINACION</h4>
        <h2 className="finishingh2">FINISHING</h2>
        <Link href="/finishing">Ver más &gt;</Link>
      </TiltSection>

      {/* Triple acción */}
      <TiltSection className="producto-seccion" cardClassName="producto-contenido" background="/img/1.jpg">
        <h4>EMULSIÓN CAPILAR</h4>
        <h2>TRIPLE ACCIÓN</h2>
        <Link href="/triples">Ver más &gt;</Link>
      </TiltSection>

      {/* Bifásicos */}
      <TiltSection className="producto-seccionizq" cardClassName="producto-contenidoizq" background="/img/4.jpg">
        <h2>BI-PHASES</h2>
        <Link href="/biphases">Ver más &gt;</Link>
      </TiltSection>

      {/* Shampoo y Acondicionador */}
      <TiltSection className="producto-seccionder" cardClassName="producto-contenidoder" background="/img/5.jpg">
        <h2>SHAMPOO / ACONDICIONADOR</h2>
        <Link href="/shampoos">Ver más &gt;</Link>
      </TiltSection>

      {/* Máscara */}
      <TiltSection className="producto-seccion" cardClassName="producto-contenido" background="/img/7.jpg">
        <h4>TRATAMIENTOS</h4>
        <h2>MÁSCARA CAPILAR</h2>
        <Link href="/cremas">Ver más &gt;</Link>
      </TiltSection>
    </>
  );
}
