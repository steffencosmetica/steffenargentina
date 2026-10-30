import CategoryNav from '@/components/layout/CategoryNav';
import PaginaNoDisponible from '@/components/productos/PaginaNoDisponible';
import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata(
  'Máscaras capilares',
  'Máscaras capilares Steffen de uso profesional. Consultá el catálogo para ver la línea completa.',
  '/cremas',
);

export default function CremasPage() {
  return (
    <>
      <CategoryNav active="/cremas" />

      {/* CONSTRUCCION */}
      <PaginaNoDisponible />
    </>
  );
}
