import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROXY_E2E, localSql } from './local';

// Levanta Traefik real en Docker delante del build de Next (puerto PROXY_E2E.port del host).
//   - steffen-proxy-traefik: configuración recomendada (docs/proxy-traefik.md): sin forwardedHeaders confiables
//     y middleware que fija X-Steffen-Proxy-Auth.
//   - steffen-proxy-traefik-inseguro: forwardedHeaders.insecure=true (error de configuración a detectar).
// Todo es local: red Docker propia, sin puertos publicados y sin tocar Cloud.

const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const quiet = (...args: string[]) => { try { docker(...args); } catch { /* no existía */ } };

function dynamicConfig() {
  return `http:
  routers:
    tienda:
      rule: "PathPrefix(\`/\`)"
      entryPoints: [web]
      middlewares: [proxy-auth]
      service: next
  middlewares:
    proxy-auth:
      headers:
        customRequestHeaders:
          X-Steffen-Proxy-Auth: "${PROXY_E2E.secret}"
  services:
    next:
      loadBalancer:
        servers:
          - url: "http://host.docker.internal:${PROXY_E2E.port}"
`;
}

function startTraefik(name: string, ip4: string, ip6: string | null, extra: string[], dir: string) {
  quiet('rm', '-f', name);
  docker('create', '--name', name, '--network', PROXY_E2E.network, '--ip', ip4, ...(ip6 ? ['--ip6', ip6] : []),
    '--add-host', 'host.docker.internal:host-gateway', PROXY_E2E.traefikImage,
    '--entrypoints.web.address=:80', '--providers.file.filename=/dynamic.yml', '--log.level=ERROR', ...extra);
  docker('cp', join(dir, 'dynamic.yml'), `${name}:/dynamic.yml`);
  docker('start', name);
}

export function stopProxyHarness() {
  quiet('rm', '-f', PROXY_E2E.traefik.name);
  quiet('rm', '-f', PROXY_E2E.insecure.name);
  quiet('network', 'rm', PROXY_E2E.network);
}

export default async function globalSetup() {
  stopProxyHarness();
  localSql('delete from public.revocation_requests');
  docker('network', 'create', '--ipv6', '--subnet', PROXY_E2E.subnet4, '--subnet', PROXY_E2E.subnet6, PROXY_E2E.network);
  const dir = mkdtempSync(join(tmpdir(), 'steffen-traefik-'));
  try {
    writeFileSync(join(dir, 'dynamic.yml'), dynamicConfig());
    startTraefik(PROXY_E2E.traefik.name, PROXY_E2E.traefik.ip4, PROXY_E2E.traefik.ip6, [], dir);
    startTraefik(PROXY_E2E.insecure.name, PROXY_E2E.insecure.ip4, null, ['--entrypoints.web.forwardedHeaders.insecure=true'], dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // Se ejecuta también si una prueba falla: no deja contenedores, red, solicitudes ni catálogo de prueba.
  return async () => {
    stopProxyHarness();
    localSql(`do $$ begin
      delete from public.revocation_messages; delete from public.revocation_requests;
      delete from private.revocation_rate_events; delete from private.revocation_access_tokens; delete from private.mail_workers;
      delete from public.orders; delete from public.checkout_attempts; delete from public.products; delete from public.categories;
    end $$`);
  };
}
