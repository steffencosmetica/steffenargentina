import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAdminProduct, listAdminCategories } from '@/lib/catalog/admin-queries';
import ProductForm from '@/components/admin/ProductForm';
import ImageManager from '@/components/admin/ImageManager';
import DeleteProduct from '@/components/admin/DeleteProduct';
import { IconLeft } from '@/components/admin/icons';
import { Notice } from '@/components/admin/ui';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await getAdminProduct((await params).id);
  return { title: product ? product.name : 'Producto' };
}

export default async function EditarProductoPage({ params, searchParams }: Props) {
  const { id } = await params;
  const [product, categories, query] = await Promise.all([getAdminProduct(id), listAdminCategories(), searchParams]);
  if (!product) notFound();

  return (
    <>
      <div className="adm-page-header">
        <div>
          <Link href="/admin/productos" className="adm-breadcrumb">
            <IconLeft /> Productos
          </Link>
          <h1>{product.name}</h1>
          <p>
            <span className="adm-sku">{product.sku}</span> ·{' '}
            <span className={`adm-badge ${product.isActive ? 'adm-badge-on' : 'adm-badge-off'}`}>
              {product.isActive ? 'Activo' : 'Inactivo'}
            </span>
          </p>
        </div>
      </div>

      {query.creado && (
        <div className="adm-block">
          <Notice kind="ok">Producto creado. Ahora podés agregarle imágenes.</Notice>
        </div>
      )}

      <div className="adm-split">
        <ProductForm product={product} categories={categories.map(({ id, name, isActive }) => ({ id, name, isActive }))} />

        <div className="adm-stack">
          <section className="adm-card" aria-labelledby="imagenes">
            <div className="adm-card-body">
              <h2 className="adm-section-title" id="imagenes">
                Imágenes
              </h2>
              <p className="adm-section-help">La principal (★) es la que se muestra en listados. Usá las flechas para ordenarlas.</p>
              <ImageManager productId={product.id} productName={product.name} images={product.images} />
            </div>
          </section>

          <section className="adm-card adm-danger-zone" aria-labelledby="eliminar">
            <div className="adm-card-body">
              <h2 className="adm-section-title" id="eliminar">
                Eliminar producto
              </h2>
              <p className="adm-section-help">
                Solo se puede eliminar si no tiene ventas registradas. Para ocultarlo de la tienda alcanza con desactivarlo.
              </p>
              <DeleteProduct id={product.id} name={product.name} />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
