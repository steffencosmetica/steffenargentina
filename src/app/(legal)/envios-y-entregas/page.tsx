import LegalPage from '@/components/legal/LegalPage';
import { pageMetadata } from '@/lib/metadata';
export const metadata = pageMetadata('Envíos y entregas', 'Cobertura por provincia, tarifas y gestión de entregas de Steffen Tienda. Borrador.', '/envios-y-entregas');
export default function Page() { return <LegalPage slug="envios-y-entregas" />; }
