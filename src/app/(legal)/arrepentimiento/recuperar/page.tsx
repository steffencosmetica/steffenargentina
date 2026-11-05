import LegalPage from '@/components/legal/LegalPage';
import RecoveryForm from '@/components/legal/RecoveryForm';
import { pageMetadata } from '@/lib/metadata';
export const dynamic = 'force-dynamic';
export const metadata = { ...pageMetadata('Recuperar constancia de arrepentimiento', 'Recibí un enlace privado en tu email para consultar tus constancias de arrepentimiento.', '/arrepentimiento/recuperar'), robots: { index: false, follow: false } };
export default function Page() { return <LegalPage slug="recuperar-constancia"><RecoveryForm /></LegalPage>; }
