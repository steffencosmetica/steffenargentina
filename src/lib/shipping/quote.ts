import 'server-only';
import { centavosToDecimal, parseCentavos, type Centavos } from '@/lib/money';
import { createPublicClient } from '@/lib/supabase/public';
import { isProvinceCode } from './regions';

// Cotización de envíos para el servidor. La regla vive en la base (public.cotizar_envio): esta función
// solo la llama y convierte los importes a centavos. Usa el cliente público sin caché, así que un
// cambio de tarifa en /admin/envios vale desde la próxima cotización.
//
// El subtotal que llega acá es una estimación para mostrar (por ejemplo, el del carrito). El costo
// definitivo lo calculará la transacción de creación de pedidos, con el subtotal calculado en la base.

export type ShippingQuote =
  | { hasCoverage: false }
  | {
      hasCoverage: true;
      zone: { id: string; name: string };
      rateCentavos: Centavos;
      freeFromCentavos: Centavos | null;
      isFree: boolean;
      costCentavos: Centavos;
    };

export class ShippingQuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShippingQuoteError';
  }
}

type QuoteRow = {
  has_coverage: boolean;
  zone_id: string | null;
  zone_name: string | null;
  rate_ars: string | null;
  free_from_ars: string | null;
  is_free: boolean;
  cost_ars: string | null;
};

export async function quoteShipping(provinceCode: string, subtotalCentavos: Centavos): Promise<ShippingQuote> {
  if (!isProvinceCode(provinceCode)) throw new ShippingQuoteError('Provincia inválida.');
  // centavosToDecimal valida que sea un importe entero de centavos, no negativo y dentro de numeric(12,2)
  const subtotal = centavosToDecimal(subtotalCentavos);

  const { data, error } = await createPublicClient({ cache: false })
    .rpc('cotizar_envio', { p_province_code: provinceCode, p_subtotal_ars: subtotal as unknown as number })
    // importes como texto exacto, sin pasar por float
    .select('has_coverage, zone_id, zone_name, rate_ars::text, free_from_ars::text, is_free, cost_ars::text')
    .single()
    .overrideTypes<QuoteRow, { merge: false }>();
  if (error) {
    if (error.code === '22023') throw new ShippingQuoteError('Provincia o subtotal inválidos.');
    throw error;
  }

  if (!data.has_coverage || !data.zone_id || !data.zone_name || data.rate_ars === null || data.cost_ars === null) {
    return { hasCoverage: false };
  }
  return {
    hasCoverage: true,
    zone: { id: data.zone_id, name: data.zone_name },
    rateCentavos: parseCentavos(data.rate_ars),
    freeFromCentavos: data.free_from_ars === null ? null : parseCentavos(data.free_from_ars),
    isFree: data.is_free,
    costCentavos: parseCentavos(data.cost_ars),
  };
}

export type ProvinceCoverage = { code: string; name: string; hasCoverage: boolean };

/** Las 24 provincias con su cobertura (para el selector del checkout). Sin precios ni zonas. */
export async function listProvinceCoverage(): Promise<ProvinceCoverage[]> {
  const { data, error } = await createPublicClient({ cache: false }).rpc('provincias_cobertura');
  if (error) throw error;
  return data.map((p) => ({ code: p.code, name: p.name, hasCoverage: p.has_coverage }));
}
