import LegalPage from '@/components/legal/LegalPage';
import { pageMetadata } from '@/lib/metadata';
export const metadata = pageMetadata('Términos y condiciones', 'Borrador de condiciones de compra de Steffen Tienda, pendiente de aprobación.', '/terminos-y-condiciones');
export default function Page() { return <LegalPage slug="terminos-y-condiciones" />; }
