'use client';

import { useEffect, useRef } from 'react';

// React no escribe el atributo "muted" en el HTML del servidor y sin él los navegadores bloquean
// el autoplay hasta que hidrata; por eso el <video> va como HTML tal cual estaba en el sitio original.
// El contenedor usa display: contents para no agregar una caja entre .hero-flag y el video.
const VIDEO_HTML = `<video class="hero-video" autoplay muted loop playsinline preload="auto"
  disablepictureinpicture disableremoteplayback controlslist="nodownload nofullscreen noremoteplayback"
  poster="/video/hero-fondo-poster.jpg" aria-hidden="true" tabindex="-1">
  <source src="/video/hero-fondo-720.mp4" type="video/mp4" media="(max-width: 768px)">
  <source src="/video/hero-fondo.mp4" type="video/mp4">
</video>`;

export default function HeroVideo() {
  const wrapRef = useRef<HTMLDivElement>(null);

  /* Video de fondo del inicio: si el navegador lo pausó (pestaña en segundo plano, ahorro de
     batería), lo vuelve a reproducir cuando la página está a la vista */
  useEffect(() => {
    const heroVideo = wrapRef.current?.querySelector('video');
    if (!heroVideo) return;
    const playHero = () => {
      if (document.visibilityState === 'visible' && heroVideo.paused) {
        heroVideo.play().catch(() => {
          /* autoplay bloqueado: queda la imagen fija */
        });
      }
    };
    document.addEventListener('visibilitychange', playHero);
    heroVideo.addEventListener('canplay', playHero);
    playHero();
    return () => {
      document.removeEventListener('visibilitychange', playHero);
      heroVideo.removeEventListener('canplay', playHero);
    };
  }, []);

  return <div ref={wrapRef} style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: VIDEO_HTML }} />;
}
