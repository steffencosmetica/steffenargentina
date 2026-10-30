import CategoryNav from '@/components/layout/CategoryNav';
import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata(
  'Bi-Phases',
  'Bi-Phase Steffen, tratamiento nutritivo y desenredante natural: Semi de Lino, Keratina y Aceite de Coco. No engrasa el cabello.',
  '/biphases',
);

export default function BiphasesPage() {
  return (
    <>
      <CategoryNav active="/biphases" />

      {/* Biphases */}
      <section className="BphL-section">
        <div className="BphL-contenido">
          <div className="texto">
            <h3>Tratamiento nutritivo</h3>
            <h1>BI-PHASE</h1>
            <h2>Semi de Lino</h2>
            <div>Desenredante natural. Restaura e hidrata los cabellos sensibilizados por efectos químicos o naturales. Formulado especialmente para cabellos dañados. Creado con las mas finas materias primas, logrando un complejo nutritivo de excelentes caracteristicas. No engrasa el cabello. </div>
            <div> Presentación: 200ml.</div>
          </div>
        </div>
      </section>

      <section className="BphK-section">
        <div className="BphK-contenido">
          <div className="texto">
            <h3>Tratamiento nutritivo</h3>
            <h1>BI-PHASE</h1>
            <h2>Keratina</h2>
            <div>Desenredante natural. Restaura e hidrata los cabellos sensibilizados por efectos químicos o naturales. Formulado especialmente para cabellos dañados. Creado con las mas finas materias primas, logrando un complejo nutritivo de excelentes caracteristicas. No engrasa el cabello. </div>
            <div> Presentación: 200ml.</div>
          </div>
        </div>
      </section>

      <section className="BphC-section">
        <div className="BphC-contenido">
          <div className="texto">
            <img src="/img/linea-coconut.png" alt="" />
            <h3>Tratamiento nutritivo</h3>
            <h1>BI-PHASE</h1>
            <h2>Aceite de Coco</h2>
            <div>Desenredante natural. Hidrata de manera intensiva otorgándole suavidad y soltura al cabello. Fabricado con las más finas materias primas, logrando un complejo nutritivo de excelentes características. No engrasa el cabello</div>
            <div> Presentación: 200ml.</div>
          </div>
        </div>
      </section>
    </>
  );
}
