'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';

type Item = {
  href: string;
  img: string;
  alt: string;
  objectPosition: string;
  tag: string;
  title: string;
  label: string;
};

const ITEMS: Item[] = [
  { href: '/reparadores', img: '/img/productos/serums.jpg', alt: 'Serum Cristal Semi de Lino', objectPosition: '25% 60%', tag: 'Reparador de puntas', title: 'SERUMS', label: 'SERUMS' },
  { href: '/biphases', img: '/img/productos/biphases.jpg', alt: 'Bi-phase Semi de Lino', objectPosition: '50% 50%', tag: 'Tratamiento nutritivo', title: 'BI-PHASES', label: 'BI-PHASES' },
  { href: '/triples', img: '/img/productos/triple-accion.jpg', alt: 'Emulsión capilar Triple Acción', objectPosition: '30% 50%', tag: 'Emulsión capilar', title: 'TRIPLE ACCIÓN', label: 'TRIPLE ACCIÓN' },
  { href: '/shampoos', img: '/img/productos/shampoos.jpg', alt: 'Shampoo y acondicionador Extra Ácido', objectPosition: '55% 50%', tag: 'Lavado y acondicionado', title: 'SHAMPOOS / ACONDICIONADORES', label: 'SHAMPOOS' },
  { href: '/cremas', img: '/img/productos/mascaras.jpg', alt: 'Máscara capilar Olio de Argán', objectPosition: '35% 60%', tag: 'Tratamientos', title: 'MÁSCARAS CAPILARES', label: 'MÁSCARAS' },
  { href: '/finishing', img: '/img/productos/finishing.jpg', alt: 'Brillo finishing', objectPosition: '50% 55%', tag: 'Terminación', title: 'FINISHING', label: 'FINISHING' },
];

// columna abierta al cargar (Triple Acción)
const INICIAL = 2;

/* Galería elástica de productos: la columna activa se expande */
export default function ElasticGallery() {
  const [active, setActive] = useState(INICIAL);
  // copia sincrónica del activo: el click que sigue al primer toque tiene que ver el valor ya actualizado
  const activeRef = useRef(INICIAL);

  const activate = (i: number) => {
    activeRef.current = i;
    setActive(i);
  };

  return (
    <div className="elastic-gallery">
      {ITEMS.map((item, i) => (
        <Link
          key={item.href}
          className={i === active ? 'eg-item active' : 'eg-item'}
          href={item.href}
          // las páginas de categorías usan otro layout raíz: se cargan completas, así que precargarlas
          // solo baja imágenes y fuentes que el inicio no usa
          prefetch={false}
          data-num={String(i + 1).padStart(2, '0')}
          onMouseEnter={() => activate(i)}
          onFocus={() => activate(i)}
          onClick={(e) => {
            // en pantallas táctiles el primer toque abre la columna y el segundo entra a la página
            if (activeRef.current !== i) {
              e.preventDefault();
              activate(i);
            }
          }}
        >
          <img src={item.img} alt={item.alt} loading="lazy" style={{ objectPosition: item.objectPosition }} />
          <div className="eg-overlay"></div>
          <div className="eg-content">
            <span className="eg-tag">{item.tag}</span>
            <h3>{item.title}</h3>
            <span className="eg-cta">
              Ver productos{' '}
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 17 17 7M8 7h9v9" />
              </svg>
            </span>
          </div>
          <span className="eg-label">{item.label}</span>
        </Link>
      ))}
    </div>
  );
}
