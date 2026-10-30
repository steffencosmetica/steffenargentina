'use client';

import { useEffect, useRef } from 'react';

type Props = {
  count: number;
  prefix?: string;
  className?: string;
};

/* Contador: anima de 0 al número cuando aparece en pantalla */
export default function CountUp({ count, prefix = '', className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;

    const runCounter = () => {
      if (reduceMotion) {
        el.textContent = prefix + count;
        return;
      }
      const duration = 4500;
      let start: number | null = null;
      const step = (now: number) => {
        if (start === null) start = now;
        const t = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 5); // arranca rápido y frena cada vez más al acercarse al final
        el.textContent = prefix + Math.round(count * eased);
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };

    const counterObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          runCounter();
          counterObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.6 },
    );
    el.textContent = prefix + '0';
    counterObserver.observe(el);

    return () => {
      counterObserver.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [count, prefix]);

  // el texto lo maneja la animación directamente, sin volver a renderizar en cada cuadro
  return (
    <span ref={ref} className={className} data-count={count} data-prefix={prefix}>
      {prefix + count}
    </span>
  );
}
