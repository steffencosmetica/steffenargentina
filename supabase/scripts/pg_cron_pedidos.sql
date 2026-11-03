-- Tareas programadas de pedidos (Fase 4B.3). NO es una migración: `supabase db push` no lo aplica.
-- Se ejecuta a mano en el SQL Editor del proyecto cuando se decida activar (junto con la Fase 5).
-- Es idempotente: volver a ejecutarlo actualiza los jobs con el mismo nombre.
-- Para desactivar: supabase/scripts/pg_cron_pedidos_baja.sql
--
-- Requiere la extensión pg_cron (Dashboard → Database → Extensions → pg_cron, o la línea siguiente).
-- Los jobs corren como el usuario que los programa (postgres), que puede ejecutar ambas funciones.

create extension if not exists pg_cron;

-- Cada minuto: devuelve al stock las reservas vencidas sin pago. Procesa hasta 200 pedidos por
-- ejecución; si quedaran más, los toma la ejecución siguiente. Dos ejecuciones superpuestas no se
-- pisan (SKIP LOCKED) y cada reserva se libera una sola vez.
select cron.schedule(
  'stf-liberar-reservas-vencidas',
  '* * * * *',
  $$select public.liberar_reservas_vencidas(200)$$
);

-- Todos los días 04:17 UTC: borra los intentos de checkout de más de 7 días (retención mínima).
select cron.schedule(
  'stf-purgar-intentos-checkout',
  '17 4 * * *',
  $$select public.purgar_intentos_checkout(7)$$
);

-- Verificación:
--   select jobid, jobname, schedule, command, active from cron.job where jobname like 'stf-%';
--   select jobid, status, return_message, start_time from cron.job_run_details
--    where jobid in (select jobid from cron.job where jobname like 'stf-%') order by start_time desc limit 20;
