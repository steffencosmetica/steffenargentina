'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import type { ProductImage } from '@/lib/catalog/types';
import NoImage from './NoImage';

/**
 * Galería de la ficha. Una tira con scroll-snap que se desliza con el dedo en celulares
 * (con puntos de posición) y se controla con miniaturas en escritorio.
 * Las fotos usan object-fit: contain, así que nunca se recortan ni deforman.
 */
export default function ProductGallery({ images, name }: { images: ProductImage[]; name: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);

  // la foto visible se deduce del desplazamiento de la tira
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onScroll = () => setCurrent(Math.round(track.scrollLeft / track.clientWidth));
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => track.removeEventListener('scroll', onScroll);
  }, []);

  function show(index: number) {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: index * track.clientWidth });
    setCurrent(index);
  }

  if (!images.length) {
    return (
      <div className="store-gallery">
        <div className="store-gallery-track">
          <div className="store-gallery-slide">
            <NoImage />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="store-gallery" aria-roledescription="carrusel" aria-label={`Fotos de ${name}`}>
      <div
        className="store-gallery-track"
        ref={trackRef}
        tabIndex={0}
        aria-label={`Foto ${current + 1} de ${images.length}. Usá las flechas para cambiar.`}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') show(Math.min(current + 1, images.length - 1));
          if (e.key === 'ArrowLeft') show(Math.max(current - 1, 0));
        }}
        data-testid="store-gallery"
      >
        {images.map((img, i) => (
          <div className="store-gallery-slide" key={img.id} aria-hidden={i !== current}>
            <Image
              src={img.url}
              alt={img.altText || name}
              fill
              sizes="(max-width: 900px) 100vw, 640px"
              loading={i === 0 ? 'eager' : 'lazy'}
              fetchPriority={i === 0 ? 'high' : undefined}
            />
          </div>
        ))}
      </div>

      {images.length > 1 && (
        <>
          <ul className="store-thumbs" aria-label="Elegir foto">
            {images.map((img, i) => (
              <li key={img.id}>
                <button
                  type="button"
                  className="store-thumb"
                  aria-current={i === current ? 'true' : undefined}
                  aria-label={`Ver foto ${i + 1}`}
                  onClick={() => show(i)}
                >
                  <Image src={img.url} alt="" fill sizes="76px" />
                </button>
              </li>
            ))}
          </ul>
          <div className="store-dots" aria-hidden="true">
            {images.map((img, i) => (
              <button
                key={img.id}
                type="button"
                className="store-dot"
                tabIndex={-1}
                aria-current={i === current ? 'true' : undefined}
                onClick={() => show(i)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
