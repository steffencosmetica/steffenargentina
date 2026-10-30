import CategoryNav from '@/components/layout/CategoryNav';
import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata(
  'Finishing',
  'Finishing Steffen para el peinador: Brillo Semi de Lino, que seca en segundos y protege de la humedad, y Cera antiestática para definir el peinado.',
  '/finishing',
);

export default function FinishingPage() {
  return (
    <>
      <CategoryNav active="/finishing" />

      {/* Brillo y cera */}
      <section className="brillo-section">
        <div className="brillo-contenido">
          <div className="texto">
            <h3>finishing</h3>
            <h1>BRILLO</h1>
            <h2>Semi de Lino</h2>
            <div>
              Creado para el peinador. Producto desarrollado para ser aplicado al finalizar el peinado, otorgándole un brillo superior. Seca en segundos y protege el peinado de la humedad. No contiene gas ni deja polvillo.{' '}
              <br />
              <br />
              Modo de uso: Aplicar a una distancia de 30cm. del peinado en forma de lluvia.
            </div>
            <div> Presentación:<br /> 75ml. en estuche<br />125ml. en estuche.</div>
          </div>
        </div>
      </section>

      <section className="cera-section">
        <div className="cera-contenido">
          <div className="texto">
            <h1>CERA ANTIESTATICA</h1>
            <div>Producto desarrollado para el peinador. Al quitar la estática del cabello, lo ayudará a definir su peinado. <br /><br />Modo de uso: Aplicar con la yema de los dedos, en pequeñas cantidades, modelando el cabello. Si lo que desea es esculpir el cabello, aplique mayor cantidad de producto.</div>
            <div> Presentación: 50grs.</div>
          </div>
        </div>
      </section>
    </>
  );
}
