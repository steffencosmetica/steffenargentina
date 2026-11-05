import LegalPage from '@/components/legal/LegalPage';
import { pageMetadata } from '@/lib/metadata';
export const metadata = pageMetadata('Política de privacidad', 'Datos, finalidades y derechos. Borrador pendiente de aprobación.', '/politica-de-privacidad');
export default function Page() { return <LegalPage slug="politica-de-privacidad" />; }
