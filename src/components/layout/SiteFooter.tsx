import Link from 'next/link';
import { FACEBOOK_URL, INSTAGRAM_URL, WHATSAPP_NUMERO, WHATSAPP_URL } from '@/lib/site';

type Props = {
  // el sitio original muestra © 2024 en el inicio y © 2025 en el resto de las páginas
  year: number;
  // páginas legales publicadas (src/lib/legal/flag.ts); apagado, el footer queda como antes
  legalLinks?: boolean;
};

export default function SiteFooter({ year, legalLinks = false }: Props) {
  return (
    <footer className="footer">
      {/* los enlaces son inline: los espacios entre ellos forman parte de la separación original */}
      {/* sin prefetch: el footer también está en el inicio, que usa otro layout raíz */}
      <div className="footer-nav">
        <Link href="/" prefetch={false}>INICIO</Link>{' '}
        <Link href="/productos" prefetch={false}>PRODUCTOS</Link>{' '}
        <Link href="/catalogo" prefetch={false}>CATÁLOGO</Link>{' '}
        <a href="/#contacto">CONTACTO</a>
      </div>

      {legalLinks && <nav className="footer-legal" aria-label="Información legal y comercial">
        <Link href="/terminos-y-condiciones" prefetch={false}>Términos y condiciones</Link>
        <Link href="/politica-de-privacidad" prefetch={false}>Privacidad</Link>
        <Link href="/envios-y-entregas" prefetch={false}>Envíos y entregas</Link>
        <Link href="/cambios-y-devoluciones" prefetch={false}>Cambios y devoluciones</Link>
      </nav>}

      <div className="footer-info">
        <p>© {year} Steffen Cosmética Capilar. Uso profesional.</p>
        <p>| {WHATSAPP_NUMERO}. Argentina | Buenos Aires</p>
      </div>

      <div className="footer-social">
        <a href={FACEBOOK_URL} target="_blank">
          <img src="/img/facebook.png" alt="Facebook" />
        </a>
        <a href={INSTAGRAM_URL} target="_blank">
          <img src="/img/instagram.png" alt="Instagram" />
        </a>
        <a href={WHATSAPP_URL} target="_blank">
          <img src="/img/whatsapp.png" alt="WhatsApp" />
        </a>
      </div>
    </footer>
  );
}
