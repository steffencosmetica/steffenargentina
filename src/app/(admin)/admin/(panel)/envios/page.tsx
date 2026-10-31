import type { Metadata } from 'next';
import Link from 'next/link';
import { listProvincesWithZone, listShippingZones } from '@/lib/shipping/admin';
import ZoneRow from '@/components/admin/ZoneRow';
import QuoteSimulator from '@/components/admin/QuoteSimulator';
import { IconPlus } from '@/components/admin/icons';
import { Notice } from '@/components/admin/ui';

export const metadata: Metadata = { title: 'Envíos' };

export default async function EnviosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [zones, provinces, params] = await Promise.all([listShippingZones(), listProvincesWithZone(), searchParams]);

  const activeZones = new Set(zones.filter((z) => z.isActive).map((z) => z.id));
  const zoneName = new Map(zones.map((z) => [z.id, z.name]));
  const covered = provinces.filter((p) => p.zoneId && activeZones.has(p.zoneId));
  const uncovered = provinces.filter((p) => !p.zoneId || !activeZones.has(p.zoneId));

  return (
    <>
      <div className="adm-page-header">
        <div>
          <h1>Envíos</h1>
          <p>Tarifa fija por zona. Las provincias sin una zona activa no tienen cobertura.</p>
        </div>
        <Link href="/admin/envios/nueva" className="adm-btn adm-btn-primary">
          <IconPlus /> Nueva zona
        </Link>
      </div>

      {params.creada && (
        <div className="adm-block">
          <Notice kind="ok">Zona creada.</Notice>
        </div>
      )}
      {params.eliminada && (
        <div className="adm-block">
          <Notice kind="ok">Zona eliminada.</Notice>
        </div>
      )}

      <section className="adm-card adm-block" aria-labelledby="cobertura-titulo" data-testid="coverage">
        <div className="adm-card-body adm-stack-sm">
          <h2 className="adm-section-title" id="cobertura-titulo">
            Cobertura: {covered.length} de {provinces.length} provincias
          </h2>
          {uncovered.length === 0 ? (
            <p className="adm-section-help">Todas las provincias tienen una zona activa.</p>
          ) : (
            <>
              <p className="adm-section-help">Sin cobertura (el checkout no permitirá confirmar pedidos a estos destinos):</p>
              <ul className="adm-chip-list" aria-label="Provincias sin cobertura">
                {uncovered.map((p) => (
                  <li key={p.code}>
                    {p.name}
                    {p.zoneId && <em> (zona {zoneName.get(p.zoneId)} inactiva)</em>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <div className="adm-card adm-block">
        {zones.length === 0 ? (
          <div className="adm-empty">
            <strong>Todavía no hay zonas de envío</strong>
            <p>Creá la primera y asignale las provincias que cubre.</p>
            <Link href="/admin/envios/nueva" className="adm-btn adm-btn-primary">
              <IconPlus /> Nueva zona
            </Link>
          </div>
        ) : (
          <ul className="adm-list" aria-label="Zonas de envío">
            {zones.map((z, i) => (
              <ZoneRow key={z.id} zone={z} index={i} total={zones.length} />
            ))}
          </ul>
        )}
      </div>

      <section className="adm-card" aria-labelledby="simulador-titulo">
        <div className="adm-card-body">
          <h2 className="adm-section-title" id="simulador-titulo">
            Probar una cotización
          </h2>
          <p className="adm-section-help">Calcula el envío con la misma regla que usará el checkout.</p>
          <QuoteSimulator provinces={provinces.map(({ code, name }) => ({ code, name }))} />
        </div>
      </section>
    </>
  );
}
