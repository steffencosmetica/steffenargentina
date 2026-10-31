import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listAdminCategories } from '@/lib/catalog/admin-queries';
import ProductForm from '@/components/admin/ProductForm';
import { IconLeft } from '@/components/admin/icons';

export const metadata: Metadata = { title: 'Nuevo producto' };

export default async function NuevoProductoPage() {
  const categories = await listAdminCategories();
  if (!categories.length) redirect('/admin/categorias/nueva');

  return (
    <>
      <div className="adm-page-header">
        <div>
          <Link href="/admin/productos" className="adm-breadcrumb">
            <IconLeft /> Productos
          </Link>
          <h1>Nuevo producto</h1>
          <p>Después de crearlo vas a poder agregarle imágenes.</p>
        </div>
      </div>
      <ProductForm categories={categories.map(({ id, name, isActive }) => ({ id, name, isActive }))} />
    </>
  );
}
