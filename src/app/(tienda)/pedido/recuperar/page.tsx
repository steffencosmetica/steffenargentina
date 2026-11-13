import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import OrderRecovery from '@/components/checkout/OrderRecovery';
import { orderRecoveryEnabled } from '@/lib/orders/recovery-server';
import '@/styles/checkout.css';
export const metadata={title:'Recuperar seguimiento',robots:{index:false,follow:false},referrer:'no-referrer' as const};
export default async function RecoveryPage(){await connection();if(!orderRecoveryEnabled())notFound();
 return <main id="contenido" className="store ck ck-order-page"><h1>Tu pedido en Steffen</h1><OrderRecovery/></main>;}
