'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { SORT_LABEL, STORE_SORTS, storeHref, type StoreQuery, type StoreSort } from '@/lib/catalog/store';

type Category = { slug: string; name: string };

/**
 * Filtros de la tienda. La URL es el estado: buscar, elegir categoría u ordenar cambia la URL
 * (compartible) y el servidor vuelve a renderizar los resultados.
 * Sin JavaScript sigue funcionando: el formulario es GET y las categorías son enlaces.
 */
export default function StoreBrowser({
  categories,
  query,
  children,
}: {
  categories: Category[];
  query: StoreQuery;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(query.q);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  // si la URL cambia por fuera (por ejemplo, «Limpiar filtros»), el buscador la sigue
  useEffect(() => setQ(query.q), [query.q]);
  useEffect(() => () => clearTimeout(debounce.current), []);

  function go(next: Partial<StoreQuery>) {
    clearTimeout(debounce.current);
    // cualquier filtro nuevo vuelve a la primera página
    const href = storeHref({ q: query.q, categoria: query.categoria, orden: query.orden, ...next, mostrar: undefined });
    startTransition(() => router.replace(href, { scroll: false }));
  }

  function onSearch(value: string) {
    setQ(value);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => go({ q: value.trim() }), 350);
  }

  return (
    <>
      <form
        className="store-toolbar"
        role="search"
        action="/tienda"
        method="get"
        onSubmit={(e) => {
          e.preventDefault();
          go({ q: q.trim() });
        }}
      >
        {query.categoria && <input type="hidden" name="categoria" value={query.categoria} />}
        <div className="store-toolbar-row">
          <label className="store-search">
            <span className="store-sr-only">Buscar productos por nombre o SKU</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              className="store-input"
              type="search"
              name="q"
              value={q}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Buscar por nombre o SKU"
              autoComplete="off"
              enterKeyHint="search"
              maxLength={80}
            />
          </label>
          <label className="store-sort">
            <span className="store-sr-only">Ordenar por</span>
            <select
              className="store-select"
              name="orden"
              value={query.orden}
              onChange={(e) => go({ orden: e.target.value as StoreSort })}
            >
              {STORE_SORTS.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <noscript>
            <button type="submit" className="store-btn store-btn-ghost">
              Buscar
            </button>
          </noscript>
        </div>

        {categories.length > 1 && (
          <nav className="store-chips" aria-label="Categorías">
            {[{ slug: '', name: 'Todas' }, ...categories].map((c) => {
              const active = query.categoria === c.slug;
              return (
                <Link
                  key={c.slug || 'todas'}
                  href={storeHref({ q: query.q, orden: query.orden, categoria: c.slug })}
                  className="store-chip"
                  aria-current={active ? 'true' : undefined}
                  scroll={false}
                  onClick={(e) => {
                    e.preventDefault();
                    if (!active) go({ categoria: c.slug });
                  }}
                >
                  {c.name}
                </Link>
              );
            })}
          </nav>
        )}
      </form>

      <div className="store-results" data-pending={pending} aria-busy={pending}>
        {children}
      </div>
    </>
  );
}
