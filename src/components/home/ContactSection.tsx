'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EMAIL, FORMSPREE_URL, PORTAL_PROFESIONAL_URL, WHATSAPP_NUMERO, WHATSAPP_URL } from '@/lib/site';
import { CONTACTO_SALON_EVENT } from '@/lib/eventos';

const TABS = [
  { id: 'distribuidora', label: 'Quiero sumar a Steffen a mi distribuidora', rubro: 'Distribuidora' },
  { id: 'salon', label: 'Quiero sumar a Steffen a mi salón', rubro: 'Salón de belleza' },
] as const;

type TabId = (typeof TABS)[number]['id'];
type Status = { text: string; color: string };

export default function ContactSection() {
  const [tab, setTab] = useState<TabId>('distribuidora');
  const [status, setStatus] = useState<Status>({ text: '', color: '' });
  const formRef = useRef<HTMLFormElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  /* Contacto: pestañas distribuidora / salón */
  const activateTab = useCallback((id: TabId) => {
    setTab(id);
    const form = formRef.current;
    const t = TABS.find((x) => x.id === id)!;
    // el formulario indica desde qué pestaña se envió (campo "consulta", sale del estado) y preselecciona la categoría
    if (form) (form.elements.namedItem('rubro') as HTMLSelectElement).value = t.rubro;
  }, []);

  // "Sumar a mi salón" (/#contacto-salon) abre la pestaña de salones y baja hasta el formulario
  useEffect(() => {
    const goToSalon = () => {
      if (location.hash !== '#contacto-salon') return;
      activateTab('salon');
      tabsRef.current?.scrollIntoView({ block: 'start' });
    };
    goToSalon();
    window.addEventListener('hashchange', goToSalon);
    window.addEventListener(CONTACTO_SALON_EVENT, goToSalon);
    return () => {
      window.removeEventListener('hashchange', goToSalon);
      window.removeEventListener(CONTACTO_SALON_EVENT, goToSalon);
    };
  }, [activateTab]);

  /* Contacto: envío del formulario sin salir de la página (Formspree) */
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setStatus({ text: 'Enviando...', color: '#555' });
    fetch(form.action, {
      method: form.method,
      body: new FormData(form),
      headers: { Accept: 'application/json' },
    })
      .then((response) => {
        if (response.ok) {
          setStatus({ text: 'Mensaje enviado correctamente. Gracias por contactarnos.', color: 'green' });
          const rubro = (form.elements.namedItem('rubro') as HTMLSelectElement).value;
          form.reset();
          (form.elements.namedItem('rubro') as HTMLSelectElement).value = rubro;
        } else {
          setStatus({ text: 'Revisa la direccion de Email.', color: 'red' });
        }
      })
      .catch(() => {
        setStatus({ text: 'Error de conexión.', color: 'red' });
      });
  };

  return (
    <section className="contacto-home" id="contacto">
      <div className="cf-head">
        <span className="cf-pill reveal">Contacto</span>
        <h2 className="reveal">ENVIANOS TU CONSULTA</h2>
        <p className="reveal">Contanos cómo querés trabajar con Steffen y te respondemos a la brevedad.</p>
      </div>

      {/* Pestañas */}
      <div ref={tabsRef} className="cf-tabs reveal" role="tablist" aria-label="Tipo de consulta">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'cf-tab active' : 'cf-tab'}
            role="tab"
            aria-selected={tab === t.id ? 'true' : 'false'}
            aria-controls={`cf-panel-${t.id}`}
            data-tab={t.id}
            data-rubro={t.rubro}
            onClick={() => activateTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="cf-grid">
        {/* Columna de información (cambia según la pestaña) */}
        <div className="cf-info reveal">
          <div
            className={tab === 'distribuidora' ? 'cf-panel active' : 'cf-panel'}
            id="cf-panel-distribuidora"
            role="tabpanel"
            hidden={tab !== 'distribuidora'}
          >
            <p className="cf-exclusiva">Tenemos zonas disponibles con exclusividad para trabajar Steffen.</p>
            <h3>Ponete en contacto</h3>
            <p>Si querés adquirir nuestros productos para tu salón de belleza o te interesa sumar Steffen Cosmética Capilar a tu distribuidora.</p>
            <div className="cf-links">
              <a href={`mailto:${EMAIL}`} target="_blank">
                <span className="cf-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></svg>
                </span>
                <span><small>Mail</small>{EMAIL}</span>
              </a>
              <a href={WHATSAPP_URL} target="_blank">
                <span className="cf-icon cf-icon-wa">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 21.8c-1.8 0-3.5-.5-5-1.4l-.4-.2-3.7 1 1-3.6-.2-.4C2.7 15.6 2.2 13.8 2.2 12 2.2 6.6 6.6 2.2 12 2.2c2.6 0 5.1 1 6.9 2.9 1.8 1.8 2.9 4.3 2.9 6.9 0 5.4-4.4 9.8-9.8 9.8zm8.4-18.2C18.2 1.3 15.2 0 12 0 5.4 0 0 5.4 0 12c0 2.1.6 4.2 1.6 6L0 24l6.2-1.6c1.8 1 3.8 1.5 5.8 1.5 6.6 0 12-5.4 12-12 0-3.2-1.2-6.2-3.6-8.4z" /></svg>
                </span>
                <span><small>WhatsApp</small>{WHATSAPP_NUMERO}</span>
              </a>
            </div>
          </div>

          <div
            className={tab === 'salon' ? 'cf-panel active' : 'cf-panel'}
            id="cf-panel-salon"
            role="tabpanel"
            hidden={tab !== 'salon'}
          >
            <h3>Portal profesional</h3>
            <p>Accedé al nuevo portal profesional de Steffen para salones.</p>
            <a href={PORTAL_PROFESIONAL_URL} className="cf-portal" target="_blank" rel="noopener">
              Ir al portal profesional{' '}
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </a>
          </div>
        </div>

        {/* Formulario */}
        <div className="cf-card reveal">
          <div>
            <h3>Envianos un mensaje</h3>
            <p>Completá el formulario y te responderemos a la brevedad.</p>
          </div>
          <div className="cf-dots" aria-hidden="true"></div>

          <form ref={formRef} id="contact-form" className="cf-form" action={FORMSPREE_URL} method="POST" onSubmit={onSubmit}>
            <input type="hidden" name="consulta" value={TABS.find((x) => x.id === tab)!.label} />

            <label className="cf-field">
              <span>Nombre</span>
              <input type="text" name="nombre" placeholder="Nombre" required />
            </label>
            <label className="cf-field">
              <span>Apellido</span>
              <input type="text" name="apellido" placeholder="Apellido" required />
            </label>
            <label className="cf-field">
              <span>Categoría</span>
              <select name="rubro" required defaultValue="Distribuidora">
                <option value="">Categoría</option>
                <option value="Salón de belleza">Salón de belleza</option>
                <option value="Perfumería">Perfumería</option>
                <option value="Distribuidora">Distribuidora</option>
                <option value="Particular">Particular</option>
              </select>
            </label>
            <label className="cf-field">
              <span>Localidad/Ciudad</span>
              <input type="text" name="localidad" placeholder="Localidad/Ciudad" required />
            </label>
            <label className="cf-field">
              <span>Provincia</span>
              <input type="text" name="provincia" placeholder="Provincia" required />
            </label>
            <label className="cf-field">
              <span>Teléfono</span>
              <input type="tel" name="telefono" placeholder="Teléfono" required />
            </label>
            <label className="cf-field cf-full">
              <span>Email</span>
              <input type="email" name="email" placeholder="Email" required />
            </label>
            <label className="cf-field cf-full">
              <span>Mensaje</span>
              <textarea name="message" placeholder="Escribir mensaje" rows={4} required></textarea>
            </label>

            <div className="cf-full cf-actions">
              <button type="submit" className="cf-submit">
                Enviar mensaje{' '}
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
              <p id="form-status" role="status" style={status.color ? { color: status.color } : undefined}>
                {status.text}
              </p>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
