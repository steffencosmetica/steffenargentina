import Link from 'next/link';

export type Crumb = { label: string; href?: string };

/** Migas de pan; el último elemento es la página actual. */
export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="store-breadcrumbs" aria-label="Ruta de navegación">
      <ol>
        {items.map((item, i) => (
          <li key={item.label}>
            {item.href && i < items.length - 1 ? (
              <Link href={item.href}>{item.label}</Link>
            ) : (
              <span aria-current="page">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
