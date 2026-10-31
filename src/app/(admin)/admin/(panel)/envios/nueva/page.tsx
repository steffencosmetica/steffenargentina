import type { Metadata } from 'next';
import Link from 'next/link';
import { listProvincesWithZone, listShippingZones } from '@/lib/shipping/admin';
import ZoneForm from '@/components/admin/ZoneForm';
import { IconLeft } from '@/components/admin/icons';

export const metadata: Metadata = { title: 'Nueva zona de envío' };

export default async function NuevaZonaPage() {
  const [zones, provinces] = await Promise.all([listShippingZones(), listProvincesWithZone()]);
  return (
    <>
      <div className="adm-page-header">
        <div>
          <Link href="/admin/envios" className="adm-breadcrumb">
            <IconLeft /> Envíos
          </Link>
          <h1>Nueva zona de envío</h1>
        </div>
      </div>
      <ZoneForm provinces={provinces} zoneNames={Object.fromEntries(zones.map((z) => [z.id, z.name]))} />
    </>
  );
}
