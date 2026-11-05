'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type Item = { code: string; receivedAt: string; status: string };
const STATUS: Record<string, string> = { recibida: 'Recibida', en_gestion: 'En gestión', cerrada: 'Cerrada' };
const when = (iso: string) => `${new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })} (Argentina)`;

// Recuperación privada de constancias, sin cuenta:
//  1. se pide un enlace por email (respuesta siempre igual: no revela si hay solicitudes);
//  2. el enlace trae el token en el fragmento (#t=...), que el navegador no envía al servidor;
//  3. al confirmar, se canjea una sola vez y se muestra solo código, fecha y estado.
export default function RecoveryForm() {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const result = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const match = /^#t=([A-Za-z0-9_-]{43})$/.exec(window.location.hash);
    if (match) {
      setToken(match[1]);
      // El token no queda en el historial ni en la barra de direcciones.
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);
  useEffect(() => { if (sent || items) result.current?.focus(); }, [sent, items]);

  async function requestLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/arrepentimiento/recuperar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ email: String(form.get('email') ?? ''), website: String(form.get('website') ?? '') }) });
      if (response.status === 429) throw new Error('Se alcanzó el límite temporal de pedidos. Probá más tarde o escribinos por email.');
      if (!response.ok) throw new Error('No pudimos procesar el pedido. Revisá el email y reintentá.');
      setSent(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'No pudimos procesar el pedido.'); }
    finally { setBusy(false); }
  }

  async function redeem() {
    if (busy || !token) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/arrepentimiento/constancia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ token }) });
      if (response.status === 429) throw new Error('Se alcanzó el límite temporal de consultas. Probá más tarde.');
      const data = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(data?.items)) throw new Error('El enlace venció o ya se usó. Pedí uno nuevo con tu email.');
      setItems(data.items); setToken(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'No pudimos abrir el enlace.'); setToken(null); }
    finally { setBusy(false); }
  }

  if (items) return <section id="solicitud" className="legal-receipt" ref={result} tabIndex={-1} role="status"><h2>Tus constancias</h2>
    {items.length === 0 ? <p>No encontramos constancias para mostrar.</p> : <ul className="legal-receipts-list">{items.map(i => <li key={i.code}><strong>{i.code}</strong><span>Recibida: <time dateTime={i.receivedAt}>{when(i.receivedAt)}</time></span><span>Estado: {STATUS[i.status] ?? i.status}</span></li>)}</ul>}
    <p>Este enlace ya se usó. Para volver a consultar, pedí uno nuevo. La constancia no confirma un reembolso.</p>
    <button type="button" onClick={() => window.print()}>Imprimir o guardar</button></section>;

  if (token) return <section id="solicitud"><h2>Ver tus constancias</h2><p>Este enlace privado sirve una sola vez y vence a los 30 minutos de enviado.</p>
    {error && <p role="alert" className="legal-error">{error}</p>}
    <button type="button" className="legal-primary" disabled={busy} onClick={redeem}>{busy ? 'Abriendo…' : 'Ver mis constancias'}</button></section>;

  return <section id="solicitud"><h2>Recuperar una constancia</h2>
    {sent ? <div className="legal-receipt" ref={result} tabIndex={-1} role="status"><h3>Pedido recibido</h3><p>Si hay solicitudes de arrepentimiento asociadas a ese email, en unos minutos vas a recibir un enlace privado. Vence en 30 minutos y sirve una sola vez. Revisá también la carpeta de spam.</p><p>Si no llega, escribinos por los canales de contacto. El envío del email no se confirma en esta página.</p></div>
    : <form className="legal-form" onSubmit={requestLink} aria-busy={busy}>
      <label htmlFor="recovery-email">Email usado en la solicitud<input id="recovery-email" name="email" type="email" required maxLength={254} autoComplete="email" /></label>
      <div className="legal-honey" aria-hidden="true"><label>Sitio web<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <small>Por privacidad, esta página no informa si existen solicitudes. Solo quien controla la casilla puede abrir el enlace. Ver la <Link href="/politica-de-privacidad" prefetch={false}>política de privacidad</Link>.</small>
      {error && <p role="alert" className="legal-error">{error}</p>}
      <button disabled={busy} type="submit">{busy ? 'Enviando…' : 'Enviarme un enlace privado'}</button>
    </form>}
    {error && sent && <p role="alert" className="legal-error">{error}</p>}
    <p><Link href="/arrepentimiento" prefetch={false}>Presentar una nueva solicitud de arrepentimiento</Link></p>
  </section>;
}
