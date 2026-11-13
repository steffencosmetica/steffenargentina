'use client';
import { useEffect, useState } from 'react';
import { isOrderCode } from '@/lib/checkout/order-view';
export default function OrderRecovery(){
 const[token,setToken]=useState<string|null>(null),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const m=/^#t=([A-Za-z0-9_-]{43})$/.exec(location.hash);if(location.hash)history.replaceState(null,'',location.pathname);if(m)setToken(m[1]);},[]);
 async function send(event:React.FormEvent<HTMLFormElement>){event.preventDefault();if(busy)return;setBusy(true);setError('');const f=new FormData(event.currentTarget);
  try{const r=await fetch('/api/pedido/recuperar',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',referrerPolicy:'no-referrer',
   body:JSON.stringify({code:f.get('code'),email:f.get('email'),website:f.get('website')??''})});
   if(!r.ok)throw new Error(r.status===429?'Se alcanzó el límite temporal. Probá más tarde o escribinos.':'No pudimos procesar la solicitud. Revisá los datos e intentá de nuevo.');setSent(true);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function redeem(){if(busy||!token)return;setBusy(true);setError('');
  try{const r=await fetch('/api/pedido/acceso',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',referrerPolicy:'no-referrer',body:JSON.stringify({token})});
   const data=await r.json();if(!r.ok||!isOrderCode(data.code))throw new Error('El acceso venció, ya se usó o no es válido. Solicitá uno nuevo.');
   setToken(null);location.assign(`/pedido/${data.code}?recuperado=1`);
  }catch(e){setError((e as Error).message);setToken(null);}finally{setBusy(false);}
 }
 return <section className="ck-card" aria-labelledby="recovery-title"><h2 id="recovery-title">Recuperar seguimiento</h2>
  {token?<><p>Este acceso sirve una sola vez y vence en 15 minutos. Confirmá para consultar tu pedido; la sesión privada dura 30 minutos.</p><button className="store-btn" disabled={busy} onClick={redeem}>Ver mi pedido</button></>:
   sent?<p role="status">Si el código y el email coinciden con un pedido, vas a recibir un acceso privado. Revisá también spam. Esta página no confirma el envío del correo ni revela si existe un pedido.</p>:
   <form className="adm-stack ck-recovery-form" onSubmit={send}>
    <label>Código del pedido<input name="code" required maxLength={25} placeholder="STF-…" autoComplete="off" /></label>
    <label>Email de la compra<input name="email" required type="email" maxLength={254} autoComplete="email" /></label>
    <div className="ck-recovery-honey" aria-hidden="true"><label>Sitio web<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
    <button className="store-btn" disabled={busy}>Enviarme un acceso privado</button>
   </form>}
  {error&&<p role="alert">{error}</p>}<p>No necesitás registrarte. Contacto: info@steffenargentina.com.ar.</p>
 </section>;
}
