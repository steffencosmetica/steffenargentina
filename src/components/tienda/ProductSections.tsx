import type { Product } from '@/lib/catalog/types';

/**
 * Descripción, beneficios, modo de uso y presentación en acordeones (<details>, sin JavaScript).
 * Las secciones sin contenido no se muestran; si no hay ninguna, no se renderiza nada.
 */
export default function ProductSections({ product }: { product: Product }) {
  const sections = [
    { id: 'descripcion', title: 'Descripción', body: product.description },
    { id: 'beneficios', title: 'Beneficios', body: product.benefits },
    { id: 'modo-de-uso', title: 'Modo de uso', body: product.usageInstructions },
    { id: 'presentacion', title: 'Presentación', body: product.presentation },
  ].filter((s): s is { id: string; title: string; body: string } => Boolean(s.body?.trim()));

  if (!sections.length) return null;

  return (
    <div className="store-sections">
      {sections.map((s, i) => (
        // la primera sección arranca abierta; el resto se despliega al tocar
        <details className="store-section" key={s.id} id={s.id} open={i === 0} data-testid={`section-${s.id}`}>
          <summary>{s.title}</summary>
          <div className="store-section-body">{s.body}</div>
        </details>
      ))}
    </div>
  );
}
