import Link from 'next/link';

/** Mensaje centrado para catálogo vacío, búsqueda sin resultados o error. */
export default function StoreEmpty({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: { href: string; label: string } | React.ReactNode;
}) {
  return (
    <div className="store-empty" role="status">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action && typeof action === 'object' && 'href' in action ? (
        <Link href={action.href} className="store-btn store-btn-ghost">
          {action.label}
        </Link>
      ) : (
        action
      )}
    </div>
  );
}
