'use client';

import { useEffect, useRef } from 'react';

type Props = {
  className: string;
  cardClassName: string;
  background: string;
  children: React.ReactNode;
};

const MAX_TILT = 12; // grados

/* Tarjetas de productos: inclinación 3D siguiendo el mouse */
export default function TiltSection({ className, cardClassName, background, children }: Props) {
  const sectionRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const card = cardRef.current;
    if (!section || !card) return;
    const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!canHover || reduceMotion) return;

    const onMove = (e: MouseEvent) => {
      const r = card.getBoundingClientRect();
      // posición del mouse relativa al centro de la tarjeta, limitada a [-1, 1]
      const x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2 + 150)));
      const y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2 + 150)));
      card.classList.add('tilting');
      card.style.setProperty('--ry', x * MAX_TILT + 'deg');
      card.style.setProperty('--rx', -y * MAX_TILT + 'deg');
      card.style.setProperty('--gx', (x + 1) * 50 + '%');
      card.style.setProperty('--gy', (y + 1) * 50 + '%');
    };
    const onLeave = () => {
      card.classList.remove('tilting');
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
    };
    section.addEventListener('mousemove', onMove);
    section.addEventListener('mouseleave', onLeave);
    return () => {
      section.removeEventListener('mousemove', onMove);
      section.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <section ref={sectionRef} className={className} data-tilt="" style={{ backgroundImage: `url(${background})` }}>
      <div ref={cardRef} className={`${cardClassName} tilt-card`}>
        {children}
      </div>
    </section>
  );
}
