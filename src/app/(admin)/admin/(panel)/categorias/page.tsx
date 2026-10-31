import type { Metadata } from 'next';
import Link from 'next/link';
import { listAdminCategories } from '@/lib/catalog/admin-queries';
import CategoryRow from '@/components/admin/CategoryRow';
import { IconPlus } from '@/components/admin/icons';
import { Notice } from '@/components/admin/ui';

export const metadata: Metadata = { title: 'Categorías' };

export default async function CategoriasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [categories, params] = await Promise.all([listAdminCategories(), searchParams]);

  return (
    <>
      <div className="adm-page-header">
        <div>
          <h1>Categorías</h1>
          <p>Usá las flechas para definir el orden en que se muestran en la tienda.</p>
        </div>
        <Link href="/admin/categorias/nueva" className="adm-btn adm-btn-primary">
          <IconPlus /> Nueva categoría
        </Link>
      </div>

      {params.creada && (
        <div className="adm-block">
          <Notice kind="ok">Categoría creada.</Notice>
        </div>
      )}
      {params.eliminada && (
        <div className="adm-block">
          <Notice kind="ok">Categoría eliminada.</Notice>
        </div>
      )}

      <div className="adm-card">
        {categories.length === 0 ? (
          <div className="adm-empty">
            <strong>Todavía no hay categorías</strong>
            <p>Creá la primera para empezar a cargar productos.</p>
            <Link href="/admin/categorias/nueva" className="adm-btn adm-btn-primary">
              <IconPlus /> Nueva categoría
            </Link>
          </div>
        ) : (
          <ul className="adm-list">
            {categories.map((c, i) => (
              <CategoryRow key={c.id} category={c} index={i} total={categories.length} />
            ))}
          </ul>
        )}
      </div>
      <p className="adm-footnote">Las categorías con productos no se pueden eliminar: desactivalas para ocultarlas.</p>
    </>
  );
}
