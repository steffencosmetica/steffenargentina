// Ejecutar después del build local de Playwright. Nunca imprime la clave auditada.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { localSecretKey } from '../e2e/local.ts';

const secret = Buffer.from(localSecretKey());
function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const file = join(path, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
const assets = files(process.argv[2] ?? '.next-e2e/static');
for (const file of assets) {
  if (readFileSync(file).includes(secret)) throw new Error('Se detectó una clave secreta local en los assets públicos.');
}
console.log(`${assets.length} assets públicos auditados: sin la clave secreta local.`);
