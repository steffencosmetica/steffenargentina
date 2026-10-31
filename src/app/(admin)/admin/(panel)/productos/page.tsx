import type { Metadata } from 'next';
import Link from 'next/link';
import { listAdminCategories, listAdminProducts, type AdminProductFilters } from '@/lib/catalog/admin-queries';
import { ActiveToggle, FeaturedToggle, QuickPrice, QuickStock } from '@/components/admin/ProductQuickEdit';
import CleanupImages from '@/components/admin/CleanupImages';
import { IconImage, IconPlus, IconSearch } from '@/components/admin/icons';
import { Notice } from '@/components/admin/ui';

export const metadata: Metadata = { title: 'Productos' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function param(params: Record<string, string | string[] | undefined>, name: string) {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

export default async function ProductosPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const estado = param(params, 'estado');
  const filters: AdminProductFilters = {
    q: param(params, 'q'),
    categoryId: param(params, 'categoria'),
    estado: estado === 'activos' || estado === 'inactivos' || estado === 'destacados' ? estado : undefined,
  };
  const [products, categories] = await Promise.all([listAdminProducts(filters), listAdminCategories()]);
  const filtering = Boolean(filters.q || filters.categoryId || filters.estado);
  const huerfanos = Number(param(params, 'huerfanos') ?? 0);

  return (
    <>
      <div className="adm-page-header">
        <div>
          <h1>Productos</h1>
          <p>
            {products.length} producto{products.length === 1 ? '' : 's'}
            {filtering ? ' con los filtros aplicados' : ' en el catálogo'}
          </p>
        </div>
        {categories.length > 0 && (
          <Link href="/admin/productos/nuevo" className="adm-btn adm-btn-primary">
            <IconPlus /> Nuevo producto
          </Link>
        )}
      </div>

      {param(params, 'eliminado') && (
        <div className="adm-stack adm-block">
          <Notice kind="ok">Producto eliminado.</Notice>
          {huerfanos > 0 && (
            <Notice kind="warning">
              No se pudieron borrar {huerfanos} archivo{huerfanos === 1 ? '' : 's'} de imagen. Podés reintentarlo con «Limpiar
              imágenes sin uso», al pie de esta página.
            </Notice>
          )}
        </div>
      )}

      {categories.length === 0 ? (
        <div className="adm-card">
          <div className="adm-empty">
            <strong>Primero creá una categoría</strong>
            <p>Cada producto pertenece a una categoría.</p>
            <Link href="/admin/categorias/nueva" className="adm-btn adm-btn-primary">
              <IconPlus /> Nueva categoría
            </Link>
          </div>
        </div>
      ) : (
        <div className="adm-card">
          <form className="adm-toolbar" role="search" method="get">
            <label className="adm-visually-hidden" htmlFor="q">
              Buscar
            </label>
            <input id="q" name="q" className="adm-input" placeholder="Buscar por nombre o SKU" defaultValue={filters.q} type="search" />
            <label className="adm-visually-hidden" htmlFor="categoria">
              Categoría
            </label>
            <select id="categoria" name="categoria" className="adm-select" defaultValue={filters.categoryId ?? ''}>
              <option value="">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <label className="adm-visually-hidden" htmlFor="estado">
              Estado
            </label>
            <select id="estado" name="estado" className="adm-select" defaultValue={filters.estado ?? ''}>
              <option value="">Todos los estados</option>
              <option value="activos">Activos</option>
              <option value="inactivos">Inactivos</option>
              <option value="destacados">Destacados</option>
            </select>
            <button type="submit" className="adm-btn">
              <IconSearch /> Filtrar
            </button>
            {filtering && (
              <Link href="/admin/productos" className="adm-btn adm-btn-ghost">
                Limpiar
              </Link>
            )}
          </form>

          {products.length === 0 ? (
            <div className="adm-empty">
              <strong>{filtering ? 'Ningún producto coincide con la búsqueda' : 'Todavía no hay productos'}</strong>
              {!filtering && (
                <Link href="/admin/productos/nuevo" className="adm-btn adm-btn-primary">
                  <IconPlus /> Crear el primero
                </Link>
              )}
            </div>
          ) : (
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col">Categoría</th>
                  <th scope="col">Precio</th>
                  <th scope="col">Stock</th>
                  <th scope="col">Estado</th>
                  <th scope="col">
                    <span className="adm-visually-hidden">Destacado</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} data-testid="product-row">
                    <td className="adm-cell-full">
                      <div className="adm-product-cell">
                        {p.imageUrl ? (
                          <img className="adm-thumb" src={p.imageUrl} alt="" width={48} height={48} loading="lazy" />
                        ) : (
                          <span className="adm-thumb" aria-hidden="true">
                            <IconImage />
                          </span>
                        )}
                        <div className="adm-min0">
                          <Link href={`/admin/productos/${p.id}`}>{p.name}</Link>
                          <div className="adm-sku">{p.sku}</div>
                        </div>
                      </div>
                    </td>
                    <td data-label="Categoría">
                      {p.category ? (
                        <>
                          {p.category.name}
                          {!p.category.isActive && <span className="adm-muted"> (inactiva)</span>}
                        </>
                      ) : (
                        <span className="adm-muted">—</span>
                      )}
                    </td>
                    <td data-label="Precio" className="adm-cell-full">
                      <QuickPrice id={p.id} priceCentavos={p.priceCentavos} name={p.name} />
                    </td>
                    <td data-label="Stock">
                      <QuickStock id={p.id} stock={p.stock} name={p.name} />
                    </td>
                    <td data-label="Estado">
                      <ActiveToggle id={p.id} isActive={p.isActive} name={p.name} />
                    </td>
                    <td data-label="Destacado">
                      <FeaturedToggle id={p.id} isFeatured={p.isFeatured} name={p.name} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="adm-footnote">
        <span>Los productos inactivos no se muestran en la tienda.</span>
        <CleanupImages />
      </div>
    </>
  );
}
