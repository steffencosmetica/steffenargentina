import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isRevocationEnabled } from '@/lib/legal/flag';
import { requireAdminPage } from '@/lib/admin/guard';
import RevocationManagement from '@/components/admin/RevocationManagement';
import CommunicationActions from '@/components/admin/CommunicationActions';
import { evaluateHealth, parseStats, HEALTH_MESSAGES } from '@/lib/mail/health';
import { allowedActions, attentionReason, KIND_LABEL, REQUEST_STATUS_LABEL, STATUS_LABEL, type MessageRow } from '@/lib/legal/communications';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Arrepentimientos' };

const MESSAGE_COLUMNS = 'id,request_id,kind,recipient,status,attempts,max_attempts,next_attempt_at,last_attempt_at,last_error_code,last_error,accepted_at,related_message_id,version,created_at';
const ATTENTION_TEXT = { fallido: 'Requiere intervención: envío fallido', rebotado: 'Requiere intervención: rebote', demorado: 'Requiere intervención: envío demorado' } as const;
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '—');

function Message({ m, now, events }: { m: MessageRow; now: Date; events: { id: number; message_id: string; created_at: string; action: string; actor_id: string | null; note: string | null }[] }) {
  const attention = attentionReason(m, now);
  const history = events.filter(e => e.message_id === m.id);
  return <li className="adm-comm" data-status={m.status} data-kind={m.kind}>
    <p><strong>{KIND_LABEL[m.kind] ?? m.kind}</strong> · <span className={`adm-badge ${attention ? 'adm-badge-off' : m.status === 'aceptado' ? 'adm-badge-on' : ''}`}>{STATUS_LABEL[m.status] ?? m.status}</span>{attention && <> <span className="adm-badge adm-badge-gold">{ATTENTION_TEXT[attention]}</span></>}</p>
    {m.kind !== 'constancia' && <p className="adm-muted">Destinatario: {m.recipient}</p>}
    <p className="adm-muted">Intentos: {m.attempts} de {m.max_attempts} · Último intento: {fmt(m.last_attempt_at)}{m.status === 'pendiente' && <> · Próximo intento: {fmt(m.next_attempt_at)}</>}</p>
    {m.accepted_at && <p className="adm-muted">Aceptado por el servidor de correo: {fmt(m.accepted_at)}. No confirma entrega ni lectura.</p>}
    {m.last_error_code && <p className="adm-muted">Último error: <code>{m.last_error_code}</code>{m.last_error && <> — {m.last_error}</>}</p>}
    <CommunicationActions id={m.id} version={m.version} actions={allowedActions(m)} />
    {history.length > 0 && <details><summary>Historial de la comunicación ({history.length})</summary><ol className="adm-order-events">{history.map(e => <li key={e.id}>{fmt(e.created_at)} · {e.action.replace(/_/g, ' ')}{e.actor_id ? ' · administrador' : ' · sistema'}{e.note && <> · «{e.note}»</>}</li>)}</ol></details>}
  </li>;
}

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string; filtro?: string }> }) {
  const { supabase } = await requireAdminPage();
  if (!isRevocationEnabled()) notFound();
  const params = await searchParams;
  const page = Math.max(1, Math.min(100000, Number.parseInt(params.page ?? '1', 10) || 1));
  const onlyAttention = params.filtro === 'intervencion';
  const now = new Date();

  const { data: statsData } = await supabase.rpc('admin_estado_comunicaciones');
  const stats = parseStats(statsData);
  const health = stats ? evaluateHealth(stats) : null;

  // Comunicaciones que requieren intervención (todas las clases), para el filtro y el resumen.
  const threshold = new Date(now.getTime() - 10 * 60_000).toISOString();
  const { data: attentionRows, error: attentionError } = await supabase.from('revocation_messages').select(MESSAGE_COLUMNS)
    .or(`status.in.(fallido,rebotado),and(status.in.(pendiente,enviando),next_attempt_at.lt.${threshold})`)
    .order('created_at', { ascending: false }).limit(200);
  if (attentionError) throw new Error('No se pudieron consultar las comunicaciones.');
  const attention = (attentionRows ?? []).filter(m => attentionReason(m, now));
  const attentionRequestIds = [...new Set(attention.map(m => m.request_id).filter((id): id is string => Boolean(id)))];
  const orphanAttention = attention.filter(m => m.kind !== 'constancia' && (!m.request_id || m.kind === 'recuperacion'));

  let query = supabase.from('revocation_requests').select('id,code,purchase_reference,contact_email,received_at,status,version,updated_at', { count: 'exact' });
  if (onlyAttention) query = query.in('id', attentionRequestIds.length ? attentionRequestIds : ['00000000-0000-0000-0000-000000000000']);
  const { data, error, count } = await query.order('received_at', { ascending: false }).order('id').range((page - 1) * 20, page * 20 - 1);
  if (error) throw new Error('No se pudieron consultar las solicitudes.');
  const ids = data?.map(row => row.id) ?? [];
  const [{ data: events, error: eventError }, { data: messages, error: messageError }] = ids.length
    ? await Promise.all([
        supabase.from('revocation_events').select('id,request_id,created_at,status').in('request_id', ids).order('created_at').order('id'),
        supabase.from('revocation_messages').select(MESSAGE_COLUMNS).in('request_id', ids).order('created_at'),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (eventError || messageError) throw new Error('No se pudo consultar el historial.');
  const shownMessages = [...(messages ?? []), ...orphanAttention.filter(m => !(messages ?? []).some(x => x.id === m.id))];
  const messageIds = shownMessages.map(m => m.id);
  const { data: messageEvents, error: messageEventError } = messageIds.length
    ? await supabase.from('revocation_message_events').select('id,message_id,created_at,action,actor_id,note').in('message_id', messageIds).order('created_at').order('id')
    : { data: [], error: null };
  if (messageEventError) throw new Error('No se pudo consultar el historial de comunicaciones.');
  const filterHref = (filtro: boolean) => (filtro ? '?filtro=intervencion' : '?');

  return <><div className="adm-page-header"><div><h1>Arrepentimientos</h1>
      <p>Solicitudes recibidas por la web. La constancia inmediata en la web es el canal principal; el email es un respaldo que se envía solo y puede fallar. «Aceptado» significa que el servidor de correo lo aceptó: no confirma entrega ni lectura.</p>
      <p>Verificá identidad y compra antes de actuar sobre un pedido. Cerrar una solicitud no acredita un reembolso. Este módulo no modifica pagos, reembolsos ni stock.</p></div></div>

    <section className={`adm-notice ${!health ? 'adm-notice-error' : health.ok ? 'adm-notice-ok' : 'adm-notice-warning'}`} aria-label="Estado de las comunicaciones">
      <strong>Comunicaciones por email</strong>
      {!health ? <p>No se pudo consultar el estado de las comunicaciones.</p> : <>
        <p>Pendientes: {health.pendientes} · Demoradas: {health.vencidas} · Fallidas o rebotadas: {health.fallidas} · Último ejecutor: {health.minutosSinEjecutor === null ? 'nunca' : `hace ${health.minutosSinEjecutor} min`}</p>
        {health.problemas.map(p => <p key={p}>{HEALTH_MESSAGES[p]}</p>)}
        {health.ok && <p>Sin problemas detectados.</p>}
      </>}
    </section>

    <nav className="adm-toolbar" aria-label="Filtro de solicitudes">
      <Link href={filterHref(false)} aria-current={!onlyAttention ? 'page' : undefined} className={`adm-btn ${!onlyAttention ? 'adm-btn-primary' : ''}`}>Todas</Link>
      <Link href={filterHref(true)} aria-current={onlyAttention ? 'page' : undefined} className={`adm-btn ${onlyAttention ? 'adm-btn-primary' : ''}`}>Requieren intervención ({attentionRequestIds.length + orphanAttention.length})</Link>
    </nav>

    {orphanAttention.length > 0 && <section className="adm-card adm-card-body adm-block" style={{ overflowWrap: 'anywhere' }}><h2>Alertas y recuperaciones con problemas</h2>
      <ul className="adm-comm-list">{orphanAttention.map(m => <Message key={m.id} m={m} now={now} events={messageEvents ?? []} />)}</ul></section>}

    {!data?.length && <div className="adm-empty">{onlyAttention ? 'No hay solicitudes que requieran intervención.' : 'No hay solicitudes para mostrar.'}</div>}
    {data?.map(row => {
      const rowMessages = (messages ?? []).filter(m => m.request_id === row.id);
      return <section key={row.id} className="adm-card adm-card-body adm-block adm-revocation" style={{ overflowWrap: 'anywhere' }}><h2>{row.code}</h2>
        <p>Recibida: {fmt(row.received_at)}</p><p>Referencia informada: {row.purchase_reference}</p><p>Contacto: <a href={`mailto:${row.contact_email}`}>{row.contact_email}</a></p>
        <RevocationManagement id={row.id} version={row.version} status={row.status} />
        <h3>Comunicaciones</h3>
        {rowMessages.length ? <ul className="adm-comm-list">{rowMessages.map(m => <Message key={m.id} m={m} now={now} events={messageEvents ?? []} />)}</ul> : <p className="adm-muted">Sin comunicaciones registradas (solicitud anterior al envío por email).</p>}
        <h3>Historial de la solicitud</h3><ol>{events?.filter(e => e.request_id === row.id).map(e => <li key={e.id}>{fmt(e.created_at)} · {REQUEST_STATUS_LABEL[e.status] ?? e.status}</li>)}</ol></section>;
    })}
    <nav aria-label="Páginas de solicitudes" className="adm-order-pagination">{page > 1 && <Link href={`?${onlyAttention ? 'filtro=intervencion&' : ''}page=${page - 1}`}>Anterior</Link>}<span>Página {page}</span>{page * 20 < (count ?? 0) && <Link href={`?${onlyAttention ? 'filtro=intervencion&' : ''}page=${page + 1}`}>Siguiente</Link>}</nav></>;
}
