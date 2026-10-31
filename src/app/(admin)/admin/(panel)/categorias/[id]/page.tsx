import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAdminCategory } from '@/lib/catalog/admin-queries';
import CategoryForm from '@/components/admin/CategoryForm';
import { IconLeft } from '@/components/admin/icons';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const category = await getAdminCategory((await params).id);
  return { title: category ? category.name : 'Categoría' };
}

export default async function EditarCategoriaPage({ params }: Props) {
  const category = await getAdminCategory((await params).id);
  if (!category) notFound();

  return (
    <>
      <div className="adm-page-header">
        <div>
          <Link href="/admin/categorias" className="adm-breadcrumb">
            <IconLeft /> Categorías
          </Link>
          <h1>{category.name}</h1>
          <p>
            {category.productCount} producto{category.productCount === 1 ? '' : 's'} en esta categoría
          </p>
        </div>
      </div>
      <CategoryForm category={category} />
    </>
  );
}
