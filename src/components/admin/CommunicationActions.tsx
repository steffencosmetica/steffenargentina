'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { interveneCommunication } from '@/app/(admin)/admin/(panel)/arrepentimientos/actions';
import { ACTION_LABEL, type AdminAction } from '@/lib/legal/communications';

const HELP: Record<AdminAction, string> = {
  reintento_manual: 'Vuelve a encolar la MISMA comunicación (mismo código). El ejecutor la enviará en su próximo ciclo.',
  rebote_manual: 'Usalo si llegó a la casilla institucional un aviso de no entrega (rebote) para este envío.',
  resuelto_manual: 'Usalo si el código se comunicó por otro canal (p. ej. WhatsApp). Describí cómo, sin datos sensibles.',
};

export default function CommunicationActions({ id, version, actions }: { id: string; version: number; actions: AdminAction[] }) {
  const [selected, setSelected] = useState<AdminAction | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  if (!actions.length) return null;
  async function confirm() {
    if (!selected || busy) return;
    setBusy(true); setError('');
    try {
      const result = await interveneCommunication(id, version, selected, note);
      if (result.error) setError(result.error);
      else { setSelected(null); setNote(''); router.refresh(); }
    } catch { setError('No se pudo guardar. Revisá tu sesión y recargá la página.'); }
    finally { setBusy(false); }
  }
  return <div className="adm-comm-actions">
    {!selected && actions.map(a => <button key={a} type="button" className="adm-btn" onClick={() => { setSelected(a); setError(''); }}>{ACTION_LABEL[a]}</button>)}
    {selected && <div className="adm-comm-confirm" role="group" aria-label={ACTION_LABEL[selected]}>
      <p><strong>{ACTION_LABEL[selected]}</strong>. {HELP[selected]}</p>
      <label>Nota para la auditoría{selected === 'resuelto_manual' ? ' (obligatoria)' : ' (opcional)'}<textarea value={note} maxLength={500} rows={2} onChange={e => setNote(e.target.value)} /></label>
      <div><button type="button" className="adm-btn" disabled={busy} onClick={confirm}>{busy ? 'Guardando…' : 'Confirmar'}</button> <button type="button" className="adm-btn" disabled={busy} onClick={() => setSelected(null)}>Cancelar</button></div>
    </div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
