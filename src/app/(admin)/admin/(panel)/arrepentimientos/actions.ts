'use server';
import { requireAdmin } from '@/lib/catalog/admin';
import { revalidatePath } from 'next/cache';
import { cleanNote, isAdminAction } from '@/lib/legal/communications';
import { isRevocationEnabled } from '@/lib/legal/flag';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export async function manageRevocation(id: string, version: number, status: string): Promise<{ error?: string }> {
  const { supabase } = await requireAdmin();
  if (!isRevocationEnabled()) return { error: 'Módulo deshabilitado.' };
  if (!UUID.test(id) || !Number.isSafeInteger(version) || !['en_gestion', 'cerrada'].includes(status)) return { error: 'Solicitud no válida.' };
  const { error } = await supabase.rpc('admin_gestionar_arrepentimiento', { p_id: id, p_version: version, p_status: status });
  if (error) return { error: error.code === 'SR004' ? 'La solicitud cambió. Recargá antes de continuar.' : 'No se pudo cambiar el estado. Recargá y revisá la solicitud.' };
  revalidatePath('/admin/arrepentimientos');
  return {};
}

// Intervención manual sobre una comunicación (auditada en la base con el administrador y la nota).
// Solo cambia la comunicación: nunca pedidos, pagos, reembolsos ni stock.
export async function interveneCommunication(id: string, version: number, action: string, note: string): Promise<{ error?: string }> {
  const { supabase } = await requireAdmin();
  if (!isRevocationEnabled()) return { error: 'Módulo deshabilitado.' };
  const cleaned = cleanNote(note);
  if (!UUID.test(id) || !Number.isSafeInteger(version) || !isAdminAction(action) || cleaned === null) return { error: 'Acción no válida.' };
  if (action === 'resuelto_manual' && cleaned.length < 5) return { error: 'Indicá brevemente cómo se resolvió (sin datos sensibles).' };
  const { error } = await supabase.rpc('admin_intervenir_comunicacion', { p_id: id, p_version: version, p_action: action, p_note: cleaned });
  if (error) return { error: error.code === 'SR004' ? 'La comunicación cambió. Recargá antes de continuar.' : 'No se pudo registrar la acción. Recargá y revisá el estado.' };
  revalidatePath('/admin/arrepentimientos');
  return {};
}
