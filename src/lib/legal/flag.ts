// Interruptores de publicación de la Fase 4B.7. Los decide el SERVIDOR con variables sin prefijo
// NEXT_PUBLIC_; están APAGADOS por defecto y solo se encienden con el valor exacto "1".
//
//   STEFFEN_LEGAL_PAGES=1         publica Términos, Privacidad, Envíos y Cambios (y sus enlaces del footer).
//   STEFFEN_REVOCATION_ENABLED=1  publica el Botón de Arrepentimiento: botón flotante, formulario, recuperación,
//                                 sus API y la pantalla /admin/arrepentimientos.
//
// Apagados: las rutas responden 404 y no se muestra ningún enlace; el resto del sitio queda como antes.
// Las páginas estáticas (inicio, secciones) leen el interruptor AL COMPILAR: cambiarlo exige un nuevo build
// (en Docker/Dokploy, pasarlo también como build arg). Ver docs/despliegue-4b7.md.

type Env = Record<string, string | undefined>;

export function legalPagesEnabledFor(env: Env): boolean {
  return env.STEFFEN_LEGAL_PAGES === '1';
}

export function revocationEnabledFor(env: Env): boolean {
  return env.STEFFEN_REVOCATION_ENABLED === '1';
}

export function isLegalPagesEnabled(): boolean {
  return legalPagesEnabledFor(process.env);
}

export function isRevocationEnabled(): boolean {
  return revocationEnabledFor(process.env);
}
