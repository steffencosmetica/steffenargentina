'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { REQUEST_STATUS_LABEL } from '@/lib/legal/communications';
import { manageRevocation } from '@/app/(admin)/admin/(panel)/arrepentimientos/actions';

export default function RevocationManagement({ id, version, status }: { id: string; version: number; status: string }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const router = useRouter();
  const next = status === 'recibida' ? 'en_gestion' : status === 'en_gestion' ? 'cerrada' : null;
  return <div><p>Estado de la solicitud: <strong>{REQUEST_STATUS_LABEL[status] ?? status}</strong></p>{next && <button className="adm-btn" disabled={busy} onClick={async () => {
    if (!window.confirm(next === 'cerrada' ? '¿Cerrar esta solicitud? Confirmá que ya se gestionó y se contactó al solicitante. Esto no confirma un reembolso.' : '¿Comenzar la gestión de esta solicitud?')) return;
    setBusy(true); setError('');
    try { const result = await manageRevocation(id, version, next); if (result.error) setError(result.error); else router.refresh(); }
    catch { setError('No se pudo guardar. Revisá tu sesión y recargá la página.'); }
    finally { setBusy(false); }
  }}>{busy ? 'Guardando…' : next === 'en_gestion' ? 'Comenzar gestión' : 'Cerrar solicitud'}</button>}{error && <p role="alert">{error}</p>}</div>;
}
