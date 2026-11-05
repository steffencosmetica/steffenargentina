// Ejecutar después del build local de Playwright. Nunca imprime la clave auditada.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAIL_E2E, SMTP_CANARY, localSecretKey } from '../e2e/local.ts';

const secrets = [localSecretKey(), SMTP_CANARY, MAIL_E2E.healthToken].map((s) => Buffer.from(s));
function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const file = join(path, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
const assets = files(process.argv[2] ?? '.next-e2e/static');
for (const file of assets) {
  const content = readFileSync(file);
  if (secrets.some((secret) => content.includes(secret))) throw new Error('Se detectó una clave secreta o credencial de correo en los assets públicos.');
}
console.log(`${assets.length} assets públicos auditados: sin la clave secreta local, la contraseña SMTP ni el token del monitor.`);
