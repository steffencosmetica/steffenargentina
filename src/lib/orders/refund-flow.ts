// El acuse de envío nunca determina el resultado financiero.
export async function refundOutcome(send: () => Promise<string | null>, observe: (error: string | null) => Promise<string | null>) {
  let error: string | null;
  try { error = await send(); } catch { error = 'network'; }
  try {
    const result = await observe(error);
    return result === 'confirmed' || result === 'rejected' ? result : 'unknown';
  } catch { return 'unknown'; }
}
