'use client';
export default function OrdersError({ reset }: { reset: () => void }) { return <div className="adm-card adm-card-body" role="alert"><h1>No se pudieron cargar los pedidos</h1><p>Intentá nuevamente.</p><button className="adm-btn" onClick={reset}>Reintentar</button></div>; }
