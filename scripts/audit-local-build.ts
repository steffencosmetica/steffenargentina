// Ejecutar después del build local de Playwright. Nunca imprime la clave auditada.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAIL_E2E, MOCK_WEBHOOK_FIXTURE, PROXY_E2E, SMTP_CANARY, localSecretKey } from '../e2e/local.ts';

const secrets = [localSecretKey(), SMTP_CANARY, MAIL_E2E.healthToken, PROXY_E2E.secret, PROXY_E2E.diagnosticToken, MOCK_WEBHOOK_FIXTURE].map((s) => Buffer.from(s));
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
  if (/simular_reembolso_posventa|resolver_reembolso_posventa|resolver_posventa_simulada/.test(content.toString('utf8'))) {
    throw new Error('Una operación financiera privilegiada apareció en un asset público.');
  }
}
console.log(`${assets.length} assets públicos auditados: sin la clave secreta local, la contraseña SMTP, el token del monitor ni los secretos del proxy.`);
