'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CATALOGO_PDF } from '@/lib/site';
import { CONTACTO_SALON_EVENT } from '@/lib/eventos';

export default function SiteHeader() {
  /* Header: se achica y se vuelve translúcido al bajar */
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // si ya estamos en el inicio con #contacto-salon, volver a tocar el botón igual tiene que bajar
  const onSalonClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (location.pathname === '/' && location.hash === '#contacto-salon') {
      e.preventDefault();
      window.dispatchEvent(new Event(CONTACTO_SALON_EVENT));
    }
  };

  return (
    <header className={scrolled ? 'site-header scrolled' : 'site-header'}>
      <div className="container nav-content">
        <img src="/img/logo.png" alt="Logo" className="logo" />

        {/* las anclas del inicio van como <a> comunes para que el navegador maneje el salto y el evento hashchange */}
        <nav className="main-nav">
          <Link href="/" prefetch={false}>INICIO</Link>
          <a href="/#productos">PRODUCTOS</a>
          <a href="/#quienes">QUIÉNES SOMOS</a>
          <a href={CATALOGO_PDF} target="_blank" rel="noopener">CATÁLOGO</a>
          <a href="/#contacto">CONTACTO</a>
        </nav>

        <a href="/#contacto-salon" className="btn-salon" onClick={onSalonClick}>Sumar a mi salón</a>
      </div>
    </header>
  );
}
