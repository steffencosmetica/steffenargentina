import { AVAILABILITY_LABEL, type Availability } from '@/lib/catalog/store';

/** Disponible / Últimas unidades / Sin stock. La tienda no tiene acceso a la cantidad exacta. */
export default function AvailabilityBadge({ level }: { level: Availability }) {
  return (
    <span className="store-availability" data-level={level}>
      {AVAILABILITY_LABEL[level]}
    </span>
  );
}
