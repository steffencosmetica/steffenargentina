import type { Metadata } from 'next';
import Link from 'next/link';
import CategoryForm from '@/components/admin/CategoryForm';
import { IconLeft } from '@/components/admin/icons';

export const metadata: Metadata = { title: 'Nueva categoría' };

export default function NuevaCategoriaPage() {
  return (
    <>
      <div className="adm-page-header">
        <div>
          <Link href="/admin/categorias" className="adm-breadcrumb">
            <IconLeft /> Categorías
          </Link>
          <h1>Nueva categoría</h1>
        </div>
      </div>
      <CategoryForm />
    </>
  );
}
