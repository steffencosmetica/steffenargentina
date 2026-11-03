-- Desactiva las tareas programadas de pedidos (inverso de pg_cron_pedidos.sql).
-- No desinstala pg_cron (puede tener otros jobs). Sin la liberación automática, las reservas vencidas
-- quedan descontadas del stock hasta que se ejecute public.liberar_reservas_vencidas() a mano.

select cron.unschedule(jobname) from cron.job where jobname in ('stf-liberar-reservas-vencidas', 'stf-purgar-intentos-checkout');
