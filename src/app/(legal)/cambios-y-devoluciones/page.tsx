import LegalPage from '@/components/legal/LegalPage';
import { pageMetadata } from '@/lib/metadata';
export const metadata = pageMetadata('Cambios y devoluciones', 'Arrepentimiento, defectos y cambios comerciales. Borrador pendiente de aprobación.', '/cambios-y-devoluciones');
export default function Page() { return <LegalPage slug="cambios-y-devoluciones" />; }
