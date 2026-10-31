import type { Metadata } from 'next';
import HeroVideo from '@/components/home/HeroVideo';
import CountUp from '@/components/home/CountUp';
import ElasticGallery from '@/components/home/ElasticGallery';
import ContactSection from '@/components/home/ContactSection';
import FeaturedProducts from '@/components/tienda/FeaturedProducts';
import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/site';
import { baseMetadata } from '@/lib/metadata';

export const metadata: Metadata = {
  title: { absolute: SITE_NAME },
  alternates: { canonical: '/' },
  openGraph: { ...baseMetadata.openGraph, title: SITE_NAME, description: SITE_DESCRIPTION, url: '/' },
};

export default function InicioPage() {
  return (
    <>
      {/* Hero + Beneficios (video de fondo en loop, sin controles) */}
      <div className="hero-flag seccion-oscura">
        {/* celulares: versión 720p, más liviana; computadoras: 1080p */}
        <HeroVideo />
        <div className="hero-video-shade" aria-hidden="true"></div>

        <section className="hero">
          {/* logo en oro metálico: la forma del PNG recorta un degradado dorado con un brillo que lo recorre */}
          <div className="hero-logo-gold" role="img" aria-label="Steffen cosmética capilar">
            <span className="hlg-metal"></span>
            <span className="hlg-shine"></span>
          </div>
          <p className="years">
            <CountUp className="years-num" count={20} prefix="+" /> AÑOS
          </p>
          <h1>EN TU SALÓN DE BELLEZA</h1>
          <p className="sub">USO PROFESIONAL</p>
        </section>

        {/* Beneficios */}
        <section className="benefits">
          <div>
            <img src="/img/icon1.png" alt="" className="icon1" />
            <h3>CALIDAD CAPILAR</h3>
            <p>Productos fabricados con la más fina materia prima.</p>
          </div>
          <div>
            <img src="/img/icon2.png" alt="" className="icon2" />
            <h3>USO PROFESIONAL</h3>
            <p>Creado para el uso profesional de los salones de peinado.</p>
          </div>
          <div>
            <svg className="icon3" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" />
              <circle cx="12" cy="10" r="2.6" />
            </svg>
            <h3>INDUSTRIA ARGENTINA</h3>
            <p>Fabricados en el país y presentes en salones de todo el territorio.</p>
          </div>
        </section>
      </div>

      {/* Conocé nuestros productos (galería elástica) */}
      <section className="productos-home" id="productos">
        <p className="quienes-kicker reveal">
          <em>línea profesional</em>
        </p>
        <h2 className="reveal">CONOCÉ NUESTROS PRODUCTOS</h2>
        <span className="quienes-line reveal" aria-hidden="true"></span>

        <ElasticGallery />
      </section>

      {/* Productos destacados de la tienda (Supabase). Sin destacados no se muestra nada */}
      <FeaturedProducts />

      {/* Quiénes somos */}
      <section className="quienes" id="quienes">
        <p className="quienes-kicker reveal">
          <em>nuestra historia</em>
        </p>
        <h2 className="reveal">QUIÉNES SOMOS</h2>
        <span className="quienes-line reveal" aria-hidden="true"></span>
        <div className="quienes-texto">
          <p className="quienes-lead reveal">
            Somos una empresa argentina con <strong>más de 20 años</strong> dedicados al desarrollo y fabricación de productos profesionales para el cuidado del cabello, que prioriza la selección de materias primas de alta calidad y el desarrollo de formulaciones que respondan a las exigencias del trabajo en el salón.
          </p>
          <p className="reveal">
            Nuestra línea está pensada para acompañar al peluquero en su actividad diaria, brindándole productos confiables y de alto rendimiento que le permitan ofrecer un servicio de excelencia.
          </p>
          <p className="reveal">
            Creemos en el valor del trabajo, el trato cercano y las relaciones comerciales duraderas. Buscamos construir vínculos donde la calidad genere confianza y la confianza se transforme en oportunidades de crecimiento compartido.
          </p>
          <p className="reveal">
            Después de más de dos décadas, seguimos evolucionando junto a los profesionales, perfeccionando nuestros productos y manteniendo los valores que nos identifican desde nuestros comienzos.
          </p>
        </div>
      </section>

      {/* Contacto */}
      <ContactSection />
    </>
  );
}
