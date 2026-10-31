// Importes en pesos argentinos sin errores de punto flotante.
// Dentro de la app un importe es un entero de centavos; la base guarda numeric(12,2)
// y lo devuelve como texto ("12500.50"), que se convierte acá sin pasar por float.

export type Centavos = number;

// numeric(12,2): hasta 9.999.999.999,99 pesos
export const MAX_CENTAVOS: Centavos = 999_999_999_999;

const DECIMAL_RE = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Convierte el texto de un importe ("12500", "12500.5", "12500.50") a centavos.
 * Acepta punto como separador decimal, que es como lo entrega PostgreSQL.
 * Lanza un error si el texto no es un importe válido, es negativo o tiene más de dos decimales.
 */
export function parseCentavos(value: string): Centavos {
  const match = DECIMAL_RE.exec(value.trim());
  if (!match) throw new Error(`Importe inválido: "${value}"`);
  const pesos = match[1].replace(/^0+(?=\d)/, '');
  const decimales = (match[2] ?? '').padEnd(2, '0');
  // se arma el número a partir de dígitos enteros: no hay ninguna operación con decimales
  const centavos = Number(pesos + decimales);
  if (!Number.isSafeInteger(centavos) || centavos > MAX_CENTAVOS) {
    throw new Error(`Importe fuera de rango: "${value}"`);
  }
  return centavos;
}

/** Centavos al formato que espera PostgreSQL para numeric(12,2): "12500.50". */
export function centavosToDecimal(centavos: Centavos): string {
  assertCentavos(centavos);
  const pesos = Math.trunc(centavos / 100);
  const resto = centavos % 100;
  return `${pesos}.${String(resto).padStart(2, '0')}`;
}

/** Formato para mostrar: "$ 12.500,50" (los centavos se omiten si son cero: "$ 12.500"). */
export function formatArs(centavos: Centavos): string {
  assertCentavos(centavos);
  const pesos = Math.trunc(centavos / 100);
  const resto = centavos % 100;
  const entero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(pesos);
  return resto === 0 ? `$ ${entero}` : `$ ${entero},${String(resto).padStart(2, '0')}`;
}

/**
 * Importe escrito por una persona en formato argentino → centavos, o null si no es válido.
 * Acepta "12500", "12.500", "12.500,50", "12500,5", "$ 12.500" y también "12500.50"
 * (un punto seguido de 1 o 2 dígitos se toma como decimal; seguido de 3, como separador de miles).
 */
export function parsePesosInput(text: string): Centavos | null {
  const value = text.replace(/\$/g, '').replace(/\s/g, '');
  let normalized: string | null = null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(value) || /^\d+(,\d{1,2})?$/.test(value)) {
    normalized = value.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+\.\d{1,2}$/.test(value)) {
    normalized = value;
  }
  if (normalized === null) return null;
  try {
    return parseCentavos(normalized);
  } catch {
    return null;
  }
}

/** Centavos al formato de un campo de formulario: "12.500,50" (o "12.500" si no hay centavos). */
export function formatPesosInput(centavos: Centavos): string {
  return formatArs(centavos).replace(/^\$\s/, '');
}

function assertCentavos(centavos: Centavos) {
  if (!Number.isSafeInteger(centavos) || centavos < 0 || centavos > MAX_CENTAVOS) {
    throw new Error(`Importe en centavos inválido: ${centavos}`);
  }
}
