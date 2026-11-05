import LegalPage from '@/components/legal/LegalPage';
import RevocationForm from '@/components/legal/RevocationForm';
import { pageMetadata } from '@/lib/metadata';
export const dynamic = 'force-dynamic';
export const metadata = pageMetadata('Botón de Arrepentimiento', 'Solicitá la revocación de tu compra sin registro. Recibí una constancia en esta web.', '/arrepentimiento');
export default function Page() { return <LegalPage slug="arrepentimiento"><RevocationForm /></LegalPage>; }
