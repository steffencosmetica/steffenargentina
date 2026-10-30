import Link from 'next/link';
import { CATEGORIAS, type CategoriaHref } from '@/lib/site';

type Props = {
  active: CategoriaHref;
};

/* Menú de categorías (vertical, a la izquierda) */
export default function CategoryNav({ active }: Props) {
  return (
    <nav className="cat-nav" aria-label="Categorías de productos">
      {CATEGORIAS.map((c) =>
        c.href === active ? (
          <Link key={c.href} href={c.href} className="active" aria-current="page">
            {c.label}
          </Link>
        ) : (
          <Link key={c.href} href={c.href}>
            {c.label}
          </Link>
        ),
      )}
    </nav>
  );
}
