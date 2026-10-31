// Agrupación geográfica de las 24 jurisdicciones para mostrarlas ordenadas en el panel de envíos.
// Es solo de presentación: la cobertura y las tarifas las define el administrador por zona.

export const REGIONS = [
  { name: 'AMBA y Buenos Aires', codes: ['AR-C', 'AR-B'] },
  { name: 'Centro', codes: ['AR-X', 'AR-S', 'AR-E', 'AR-L'] },
  { name: 'Cuyo', codes: ['AR-M', 'AR-J', 'AR-D'] },
  { name: 'Noroeste', codes: ['AR-Y', 'AR-A', 'AR-T', 'AR-K', 'AR-F', 'AR-G'] },
  { name: 'Noreste', codes: ['AR-P', 'AR-H', 'AR-N', 'AR-W'] },
  { name: 'Patagonia', codes: ['AR-Q', 'AR-R', 'AR-U', 'AR-Z', 'AR-V'] },
] as const;

export const PROVINCE_CODES: readonly string[] = REGIONS.flatMap((r) => r.codes);

export function isProvinceCode(code: unknown): code is string {
  return typeof code === 'string' && PROVINCE_CODES.includes(code);
}
