import type { CookieOptionsWithName } from '@supabase/ssr';

// Opciones de las cookies de sesión de Supabase Auth. Las comparten el proxy y el cliente de servidor:
// si no coinciden, cada uno escribiría su propia variante de la misma cookie.
//   - httpOnly: el panel hace todo desde el servidor (login, logout, Server Actions), así que el
//     JavaScript del navegador nunca necesita leer la sesión. Un XSS no puede robar los tokens.
//   - secure: solo por HTTPS en producción (en desarrollo se usa http://localhost).
//   - sameSite lax: la cookie no viaja en POST desde otros sitios.
export const SESSION_COOKIE_OPTIONS: CookieOptionsWithName = {
  path: '/',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
};
