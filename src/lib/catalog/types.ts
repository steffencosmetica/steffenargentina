import type { Centavos } from '@/lib/money';

// Modelo del catálogo tal como lo usa la app (camelCase, importes en centavos, URLs de imágenes resueltas)

export type Category = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
};

export type ProductImage = {
  id: string;
  url: string;
  storagePath: string;
  altText: string | null;
  isPrimary: boolean;
  sortOrder: number;
};

/** Disponibilidad pública que calcula la base (products.availability). El stock exacto no es público. */
export type Availability = 'disponible' | 'ultimas' | 'sin-stock';

export type Product = {
  id: string;
  sku: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  usageInstructions: string | null;
  benefits: string | null;
  presentation: string | null;
  category: { id: string; name: string; slug: string };
  priceCentavos: Centavos;
  availability: Availability;
  weightGrams: number | null;
  packageMm: { length: number | null; width: number | null; height: number | null };
  isFeatured: boolean;
  sortOrder: number;
  updatedAt: string;
  // la imagen principal primero, el resto por orden
  images: ProductImage[];
};

// Datos que carga un administrador (Fase 2B: panel /admin)
export type CategoryInput = {
  name: string;
  slug: string;
  description?: string | null;
  imagePath?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

export type ProductInput = {
  sku: string;
  name: string;
  slug: string;
  shortDescription?: string | null;
  description?: string | null;
  usageInstructions?: string | null;
  benefits?: string | null;
  presentation?: string | null;
  categoryId: string;
  priceCentavos: Centavos;
  stock: number;
  weightGrams?: number | null;
  packageLengthMm?: number | null;
  packageWidthMm?: number | null;
  packageHeightMm?: number | null;
  isFeatured?: boolean;
  isActive?: boolean;
  sortOrder?: number;
};
