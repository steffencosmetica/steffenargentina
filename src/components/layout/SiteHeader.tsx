'use client';

import '@/styles/header-mobile.css';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CATALOGO_PDF, PORTAL_PROFESIONAL_URL } from '@/lib/site';
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

  /* Menú mobile (≤ 768 px): barra compacta con panel desplegable */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const pathname = usePathname();

  // se cierra al cambiar de página
  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    // el foco entra al panel; Escape lo cierra y devuelve el foco al botón
    panel.current?.querySelector<HTMLElement>('a')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
      // con el menú abierto, Tab recorre solo el botón y los enlaces del panel
      if (e.key === 'Tab' && menuButton.current && panel.current) {
        const items = [menuButton.current, ...panel.current.querySelectorAll<HTMLElement>('a')];
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : index === items.length - 1 ? 0 : index + 1;
        e.preventDefault();
        items[next].focus();
      }
    };
    // si la pantalla pasa a escritorio con el menú abierto, se cierra
    const desktop = window.matchMedia('(min-width: 769px)');
    const onResize = () => desktop.matches && setMenuOpen(false);
    document.documentElement.classList.add('mnav-open');
    window.addEventListener('keydown', onKey);
    desktop.addEventListener('change', onResize);
    return () => {
      document.documentElement.classList.remove('mnav-open');
      window.removeEventListener('keydown', onKey);
      desktop.removeEventListener('change', onResize);
    };
  }, [menuOpen]);

  // las anclas del inicio (/#quienes) no cambian de página: el menú se cierra al tocar cualquier enlace
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className={scrolled ? 'site-header scrolled' : 'site-header'}>
      <div className="container nav-content">
        <img src="/img/logo.png" alt="Logo" className="logo" />

        {/* las anclas del inicio van como <a> comunes para que el navegador maneje el salto y el evento hashchange */}
        <nav className="main-nav">
          <Link href="/" prefetch={false}>INICIO</Link>
          <a href="/#productos">PRODUCTOS</a>
          <Link href="/tienda" prefetch={false}>TIENDA</Link>
          <a href="/#quienes">QUIÉNES SOMOS</a>
          <a href={CATALOGO_PDF} target="_blank" rel="noopener">CATÁLOGO</a>
          <a href="/#contacto">CONTACTO</a>
        </nav>

        <a href="/#contacto-salon" className="btn-salon" onClick={onSalonClick}>Sumar a mi salón</a>
      </div>

      {/* Barra compacta (solo celulares y tablets chicas, ver header-mobile.css) */}
      <div className="mnav-bar">
        <Link href="/" prefetch={false} className="mnav-logo" aria-label="Steffen, ir al inicio">
          <Image src="/img/logo.png" alt="" width={31} height={38} loading="eager" />
        </Link>
        <Link href="/tienda" prefetch={false} className="mnav-tienda">
          Tienda
        </Link>
        <button
          ref={menuButton}
          type="button"
          className="mnav-toggle"
          aria-expanded={menuOpen}
          aria-controls="menu-mobile"
          aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>
      </div>

      <nav id="menu-mobile" ref={panel} className="mnav-panel" aria-label="Menú principal" hidden={!menuOpen}>
        <ul>
          <li><Link href="/" prefetch={false} onClick={closeMenu}>Inicio</Link></li>
          <li><a href="/#productos" onClick={closeMenu}>Productos</a></li>
          <li><Link href="/tienda" prefetch={false} onClick={closeMenu}>Tienda</Link></li>
          <li><a href={CATALOGO_PDF} target="_blank" rel="noopener" onClick={closeMenu}>Catálogo</a></li>
          <li><a href="/#quienes" onClick={closeMenu}>Quiénes somos</a></li>
          <li><a href="/#contacto" onClick={closeMenu}>Contacto</a></li>
        </ul>
        <div className="mnav-actions">
          <a
            href="/#contacto-salon"
            className="mnav-salon"
            onClick={(e) => {
              onSalonClick(e);
              closeMenu();
            }}
          >
            Sumar a mi salón
          </a>
          <a href={PORTAL_PROFESIONAL_URL} className="mnav-portal" target="_blank" rel="noopener" onClick={closeMenu}>
            Portal Profesional
          </a>
        </div>
      </nav>
      {menuOpen && <button type="button" className="mnav-backdrop" aria-label="Cerrar menú" tabIndex={-1} onClick={closeMenu} />}
    </header>
  );
}
