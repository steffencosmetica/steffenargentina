import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import WhatsAppFloat from './WhatsAppFloat';
import SiteEffects from './SiteEffects';
import CartProvider from '@/components/cart/CartProvider';
import { isCartEnabled } from '@/lib/cart/server';

type Props = {
  // hoja de Google Fonts que pedía cada página del sitio original (el inicio carga más pesos que el resto).
  // La tienda no la usa: sirve Montserrat desde el propio sitio (src/styles/montserrat.css).
  fontHref?: string;
  footerYear: number;
  children: React.ReactNode;
};

// Documento común a los layouts raíz: inicio, secciones y tienda
export default function SiteShell({ fontHref, footerYear, children }: Props) {
  const content = (
    <>
      <SiteHeader />
      {children}
      <WhatsAppFloat />
      <SiteFooter year={footerYear} />
      <SiteEffects />
    </>
  );
  return (
    // data-scroll-behavior: el scroll suave queda para las anclas, los cambios de página son instantáneos
    <html lang="es" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        {/* activa las animaciones de aparición antes de pintar, igual que la clase "js" de interacciones.js */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
        {fontHref && (
          <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
            <link href={fontHref} rel="stylesheet" />
          </>
        )}
      </head>
      {/* el carrito lo habilita el servidor (src/lib/cart/flag.ts); sin él, el sitio queda como antes */}
      <body>{isCartEnabled() ? <CartProvider>{content}</CartProvider> : content}</body>
    </html>
  );
}
