import CategoryNav from '@/components/layout/CategoryNav';
import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata(
  'Serums reparadores de puntas',
  'Serums reparadores de puntas Steffen: Cristal Semi de Lino, serum de coco y Bio-Esfera con micro-esferas de Keratina. Nutren y protegen la fibra capilar.',
  '/reparadores',
);

export default function ReparadoresPage() {
  return (
    <>
      <CategoryNav active="/reparadores" />

      {/* Lino */}
      <section className="lino-section seccion-oscura">
        <div className="lino-contenido">
          <img src="/img/serum-lino.png" alt="" />
          <div> Realizado con combinaciones oleosas de excelente calidad disueltas en aceite de semillas de Lino. Nutre y protege el cabello dañado desde su interior, reparando la fibra capilar. Aporta brillo y suavidad.</div>
          <div> Modo de uso: Sobre la palma de la mano vierta y frote solo unas gotas, luego aplique de medios a puntas.</div>

          <div> Presentación:</div>
          <div>Envase 30cc en estuche</div>
          <div>Envase 75cc (recarga)</div>
        </div>
      </section>

      {/* Serum */}
      <section className="serum-section">
        <div className="serum-contenido">
          <img src="/img/serum-coc.png" alt="" />
          <div> Realizado con combinaciones oleosas de excelente calidad disueltas en aceite coco. Nutre y protege el cabello dañado desde su interior, reparando la fibra capilar. Aporta brillo y suavidad.</div>
          <div> Modo de uso: Sobre la palma de la mano vierta y frote solo unas gotas, luego aplique de medios a puntas.</div>

          <div> Presentación:</div>
          <div>Envase 30cc en estuche</div>
        </div>
      </section>

      {/* Bioesfera */}
      <section className="bios-section">
        <div className="bios-contenido">
          <img src="/img/bioesfera.png" alt="" />
          <div> Fluido concentrado reparador de la fibra capilar. Desarrollado con micro-esferas de Keratina. Le aporta al cabello dañado la nutrición necesaria desde el interior de la fibra capilar dejándolo dócil y con brillo.</div>
          <div> Modo de uso: Sobre la palma de la mano vierta y frote solo unas gotas, luego aplique de medios a puntas.</div>

          <div> Presentación:</div>
          <div> Dosis de 30cc en estuche</div>
        </div>
      </section>
    </>
  );
}
