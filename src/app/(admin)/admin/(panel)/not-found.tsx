import Link from 'next/link';

export default function AdminNotFound() {
  return (
    <div className="adm-card">
      <div className="adm-empty">
        <strong>No encontramos lo que buscabas</strong>
        <p>Puede que se haya eliminado.</p>
        <Link href="/admin/productos" className="adm-btn">
          Volver a productos
        </Link>
      </div>
    </div>
  );
}
