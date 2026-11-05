'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export default function RevocationForm() {
  const key = useRef<string | null>(null);
  const payload = useRef('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<{ code: string; receivedAt: string } | null>(null);
  const receiptElement = useRef<HTMLDivElement>(null);
  useEffect(() => { if (receipt) receiptElement.current?.focus(); }, [receipt]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const data = { purchaseReference: String(form.get('purchaseReference') ?? ''), email: String(form.get('email') ?? ''), website: String(form.get('website') ?? '') };
    const fingerprint = JSON.stringify(data);
    if (!key.current || payload.current !== fingerprint) key.current = crypto.randomUUID();
    payload.current = fingerprint;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/arrepentimiento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ ...data, idempotencyKey: key.current }) });
      const result = await response.json();
      if (!response.ok) throw new Error(response.status === 429 ? 'Se alcanzó el límite temporal de envíos. Podés reintentar más tarde o contactarnos por email sin perder tu derecho.' : 'No pudimos registrar la solicitud. Revisá los datos y reintentá o contactanos por email.');
      if (typeof result.code !== 'string' || typeof result.receivedAt !== 'string') throw new Error('Respuesta no válida. Reintentá con los mismos datos.');
      setReceipt(result);
    } catch (e) { setError(e instanceof Error ? e.message : 'No pudimos enviar la solicitud. Reintentá o contactanos por email.'); }
    finally { setBusy(false); }
  }
  return <section id="solicitud"><h2>Enviar solicitud de arrepentimiento</h2>
    {receipt ? <div className="legal-receipt" ref={receiptElement} role="status" tabIndex={-1}><h3>Solicitud recibida</h3><p>Conservá este código de identificación:</p><strong>{receipt.code}</strong><p>Fecha de recepción: <time dateTime={receipt.receivedAt}>{new Date(receipt.receivedAt).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })} (Argentina)</time></p><p>Estado: recibida. Coordinaremos la gestión por el email informado. Esta constancia no confirma un reembolso.</p><p className="legal-note">Esta es tu constancia: guardala o imprimila. Además intentaremos enviarte una copia por email como respaldo; ese envío puede demorar o no llegar y no reemplaza esta constancia. Si la perdés, podés <Link href="/arrepentimiento/recuperar" prefetch={false}>recuperarla con tu email</Link>.</p><button type="button" onClick={() => window.print()}>Imprimir o guardar constancia</button></div>
    : <form className="legal-form" onSubmit={submit} aria-busy={busy}>
      <label htmlFor="purchase-reference">Número de pedido o referencia de compra<input id="purchase-reference" name="purchaseReference" required minLength={3} maxLength={100} autoComplete="off" /></label>
      <label htmlFor="revocation-email">Email de contacto<input id="revocation-email" name="email" type="email" required maxLength={254} autoComplete="email" /></label>
      <div className="legal-honey" aria-hidden="true"><label>Sitio web<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <small>Usamos estos datos para registrar y gestionar tu solicitud. No incluyas contraseñas ni datos de tarjetas. Consultá la <Link href="/politica-de-privacidad" prefetch={false}>política de privacidad</Link>.</small>
      {error && <p role="alert" className="legal-error">{error}</p>}
      <button disabled={busy} type="submit">{busy ? 'Enviando…' : 'Solicitar arrepentimiento'}</button>
      <p className="legal-note">¿Ya enviaste una solicitud y perdiste la constancia? <Link href="/arrepentimiento/recuperar" prefetch={false}>Recuperala con tu email</Link>.</p>
      <noscript><p>Para enviar este formulario se necesita JavaScript. También podés comunicar tu solicitud al email institucional indicado en esta página.</p></noscript>
    </form>}
  </section>;
}
