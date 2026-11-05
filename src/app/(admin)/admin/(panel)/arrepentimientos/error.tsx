'use client';
export default function ErrorPage({ reset }: { reset: () => void }) { return <div role="alert"><p>No se pudieron cargar las solicitudes.</p><button className="adm-btn" onClick={reset}>Reintentar</button></div>; }
