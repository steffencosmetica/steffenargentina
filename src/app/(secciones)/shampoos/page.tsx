import CategoryNav from '@/components/layout/CategoryNav';
import PaginaNoDisponible from '@/components/productos/PaginaNoDisponible';
import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata(
  'Shampoos y acondicionadores',
  'Shampoos y acondicionadores Steffen de uso profesional. Consultá el catálogo para ver la línea completa.',
  '/shampoos',
);

export default function ShampoosPage() {
  return (
    <>
      <CategoryNav active="/shampoos" />

      {/* CONSTRUCCION */}
      <PaginaNoDisponible />
    </>
  );
}
