import { AVAILABILITY_LABEL, availability } from '@/lib/catalog/store';

/** Disponible / Últimas unidades / Sin stock. Nunca muestra la cantidad exacta. */
export default function AvailabilityBadge({ stock }: { stock: number }) {
  const level = availability(stock);
  return (
    <span className="store-availability" data-level={level}>
      {AVAILABILITY_LABEL[level]}
    </span>
  );
}
