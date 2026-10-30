import CategoryNav from '@/components/layout/CategoryNav';
import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata(
  'Triple Acción',
  'Emulsión capilar Triple Acción Steffen: nutrición, protección y brillo con Semi de Lino, Keratina, Olio de Argán o Aceite de Coco.',
  '/triples',
);

export default function TriplesPage() {
  return (
    <>
      <CategoryNav active="/triples" />

      {/* Triples */}
      <section className="Triplelino-section">
        <div className="Triplelino-contenido">
          <div className="texto">
            <h3>EMULSION CAPILAR</h3>
            <h1>TRIPLE ACCION</h1>
            <h2>Semi de Lino</h2>
            <h5>NUTRICION, PROTECCION Y BRILLO</h5>
            <div>Tratamiento reparador a base de semillas de Lino que nutre la fibra capilar desde su interior aportando brillo natural, suavidad y docilidad a todo tipo de cabello. Proporciona hidratación intensa y devuelve la elasticidad natural.</div>
            <div> Presentación: <br /> Pomo de 180cc. <br /> Caja exhibidora 12 unidades de 70cc..</div>
          </div>
        </div>
      </section>

      <section className="TripleK-section">
        <div className="TripleK-contenido">
          <div className="texto">
            <h3>EMULSION CAPILAR</h3>
            <h1>TRIPLE ACCION</h1>
            <h2>KERATINA</h2>
            <h5>NUTRICION, PROTECCION Y BRILLO</h5>
            <div>Tratamiento reparador a base de Keratina que nutre la fibra capilar desde su interior aportando brillo natural, suavidad y docilidad al cabello. Proporciona hidratación intensa y devuelve la elasticidad natural. Ideal para cabellos dañados.</div>
            <div> Presentación: <br /> Pomo de 180cc. <br /> Caja exhibidora 12 unidades de 70cc..</div>
          </div>
        </div>
      </section>

      <section className="TripleA-section">
        <div className="TripleA-contenido">
          <div className="texto">
            <h3>EMULSION CAPILAR</h3>
            <h1>TRIPLE ACCION</h1>
            <h2>OLIO DE ARGAN</h2>
            <h5>NUTRICION, PROTECCION Y BRILLO</h5>
            <div>Tratamiento reparador a base de olio de Argán que nutre la fibra capilar desde su interior aportando brillo natural, suavidad y docilidad al cabello. Proporciona hidratación intensa y devuelve la elasticidad natural. Ideal para cabellos secos. </div>
            <div> Presentación: <br /> Pomo de 180cc. <br /> Caja exhibidora 12 unidades de 70cc..</div>
          </div>
        </div>
      </section>

      <section className="TripleC-section">
        <div className="TripleC-contenido">
          <div className="texto">
            <img src="/img/linea-coconut.png" alt="" />
            <h3>EMULSION CAPILAR</h3>
            <h1>TRIPLE ACCION</h1>
            <h2>Aceite de Coco</h2>
            <h5>NUTRICION, PROTECCION Y BRILLO</h5>
            <div>Tratamiento reparador a base de aceite de coco que nutre la fibra capilar desde su interior aportando brillo natural, suavidad y docilidad al cabello. Proporciona hidratación intensa y devuelve la elasticidad natural. Ideal para cabellos secos..</div>
            <div> Presentación: <br /> Pomo de 180cc. <br /> Caja exhibidora 12 unidades de 70cc..</div>
          </div>
        </div>
      </section>
    </>
  );
}
