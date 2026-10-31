import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getShippingZone, listProvincesWithZone, listShippingZones } from '@/lib/shipping/admin';
import ZoneForm from '@/components/admin/ZoneForm';
import { IconLeft } from '@/components/admin/icons';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const zone = await getShippingZone((await params).id);
  return { title: zone ? `Zona ${zone.name}` : 'Zona de envío' };
}

export default async function EditarZonaPage({ params }: Props) {
  const { id } = await params;
  const [zone, zones, provinces] = await Promise.all([getShippingZone(id), listShippingZones(), listProvincesWithZone()]);
  if (!zone) notFound();

  return (
    <>
      <div className="adm-page-header">
        <div>
          <Link href="/admin/envios" className="adm-breadcrumb">
            <IconLeft /> Envíos
          </Link>
          <h1>{zone.name}</h1>
          <p>
            {zone.provinces.length} provincia{zone.provinces.length === 1 ? '' : 's'} ·{' '}
            <span className={`adm-badge ${zone.isActive ? 'adm-badge-on' : 'adm-badge-off'}`}>{zone.isActive ? 'Activa' : 'Inactiva'}</span>
          </p>
        </div>
      </div>
      <ZoneForm zone={zone} provinces={provinces} zoneNames={Object.fromEntries(zones.map((z) => [z.id, z.name]))} />
    </>
  );
}
