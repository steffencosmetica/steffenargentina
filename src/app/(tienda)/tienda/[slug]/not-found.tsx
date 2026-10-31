import Link from 'next/link';
import StoreHeading from '@/components/tienda/StoreHeading';

// Producto inexistente, inactivo o de una categoría inactiva (responde 404)
export default function ProductoNoEncontrado() {
  return (
    <main className="store">
      <StoreHeading kicker="Descubrí Steffen" title="TIENDA ONLINE" />
      <div className="store-empty" role="status">
        <h1>Este producto no está disponible</h1>
        <p>Puede que se haya dado de baja o que el enlace no sea correcto.</p>
        <Link href="/tienda" className="store-btn store-btn-ghost">
          Volver a la tienda
        </Link>
      </div>
    </main>
  );
}
