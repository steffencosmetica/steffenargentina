import { randomBytes } from 'node:crypto';
import { ADMIN, CLIENTE, LOCAL_SUPABASE, localSql } from './local';

// Reinicia los datos de prueba en Supabase LOCAL antes de cada corrida:
//   - borra el catálogo local y los usuarios @steffen.test
//   - crea un administrador y un usuario sin permisos (con contraseña, email confirmado)
//   - carga dos categorías y un producto de partida
// Nada de esto toca Supabase Cloud: localSql() solo acepta 127.0.0.1.

export const IDS = {
  admin: '00000000-0000-4000-8000-00000000e2a1',
  cliente: '00000000-0000-4000-8000-00000000e2b2',
  shampoos: '00000000-0000-4000-8000-00000000e2c1',
  mascaras: '00000000-0000-4000-8000-00000000e2c2',
  productoBase: '00000000-0000-4000-8000-00000000e2d1',
};

function userSql(id: string, email: string, password: string) {
  return `
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', '${id}', 'authenticated', 'authenticated', '${email}',
      extensions.crypt('${password}', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(),
      '', '', '', '', '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), '${id}', '${id}',
      json_build_object('sub', '${id}', 'email', '${email}', 'email_verified', true), 'email', now(), now(), now());`;
}

export default async function globalSetup() {
  if (!LOCAL_SUPABASE.url.startsWith('http://127.0.0.1')) throw new Error('Las pruebas e2e solo corren contra Supabase local.');

  // contraseñas nuevas en cada corrida (solo hexadecimal: se insertan en el SQL sin escapar)
  process.env.E2E_ADMIN_PASSWORD = randomBytes(18).toString('hex');
  process.env.E2E_CLIENTE_PASSWORD = randomBytes(18).toString('hex');

  try {
    localSql('select 1');
  } catch {
    throw new Error('Supabase local no responde. Levantalo con `npm run db:start` antes de correr las pruebas.');
  }

  localSql(`
do $$
begin
  delete from auth.users where email like '%@steffen.test';
  ${userSql(IDS.admin, ADMIN.email, ADMIN.password)}
  ${userSql(IDS.cliente, CLIENTE.email, CLIENTE.password)}
  insert into public.admin_users (user_id, note) values ('${IDS.admin}', 'e2e');
end
$$`);
  seedBaseCatalog();
}

/**
 * Catálogo de partida de los specs del panel (categorías, productos, seguridad).
 * Los specs que cargan su propio catálogo (tienda-data.ts) lo restauran al terminar.
 */
export function seedBaseCatalog() {
  localSql(`
do $$
begin
  delete from public.product_images;
  delete from public.products;
  delete from public.categories;
  insert into public.categories (id, name, slug, sort_order, is_active) values
    ('${IDS.shampoos}', 'Shampoos', 'shampoos', 10, true),
    ('${IDS.mascaras}', 'Máscaras', 'mascaras', 20, true);
  insert into public.products (id, sku, name, slug, category_id, price_ars, stock, is_active) values
    ('${IDS.productoBase}', 'E2E-BASE', 'Shampoo Base E2E', 'shampoo-base-e2e', '${IDS.shampoos}', 10000, 5, true);
end
$$`);
}
