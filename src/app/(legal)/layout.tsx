import type { Metadata } from 'next';
import SiteShell from '@/components/layout/SiteShell';
import { baseMetadata } from '@/lib/metadata';
import '@/styles/montserrat.css';
import '@/styles/style.css';
import '@/styles/legal.css';

// Evitar indexar textos incompletos hasta la aprobación fiscal y legal.
export const metadata: Metadata = { ...baseMetadata, robots: { index: false, follow: true } };
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <SiteShell footerYear={2026}>{children}</SiteShell>;
}
