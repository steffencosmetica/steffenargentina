'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

// Efectos que recorren toda la página (como hacía interacciones.js); se vuelven a armar en cada cambio de ruta
export default function SiteEffects() {
  const pathname = usePathname();

  /* Aparición de elementos al hacer scroll */
  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const reveals = document.querySelectorAll<HTMLElement>('.reveal:not(.visible)');
    if (!reveals.length) return;
    if (!('IntersectionObserver' in window) || reduceMotion) {
      reveals.forEach((el) => el.classList.add('visible'));
      return;
    }
    const revealObserver = new IntersectionObserver(
      (entries) => {
        let i = 0;
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;
          el.style.transitionDelay = i++ * 120 + 'ms';
          el.classList.add('visible');
          revealObserver.unobserve(el);
        });
      },
      { threshold: 0.2, rootMargin: '0px 0px -40px 0px' },
    );
    reveals.forEach((el) => revealObserver.observe(el));
    return () => revealObserver.disconnect();
  }, [pathname]);

  /* Menú lateral de categorías y menú de arriba: cada botón pasa a texto claro cuando está sobre una sección oscura */
  useEffect(() => {
    const catLinks = document.querySelectorAll<HTMLElement>('.cat-nav a, .main-nav a');
    const darkSections = document.querySelectorAll<HTMLElement>('.seccion-oscura');
    if (!catLinks.length || !darkSections.length) {
      catLinks.forEach((a) => a.classList.remove('sobre-oscuro'));
      return;
    }
    const updateCatNav = () => {
      const rects = Array.from(darkSections, (s) => s.getBoundingClientRect());
      catLinks.forEach((a) => {
        const r = a.getBoundingClientRect();
        const cy = r.top + r.height / 2;
        const dark = rects.some((s) => cy >= s.top && cy <= s.bottom);
        a.classList.toggle('sobre-oscuro', dark);
      });
    };
    window.addEventListener('scroll', updateCatNav, { passive: true });
    window.addEventListener('resize', updateCatNav);
    updateCatNav();
    return () => {
      window.removeEventListener('scroll', updateCatNav);
      window.removeEventListener('resize', updateCatNav);
    };
  }, [pathname]);

  return null;
}
