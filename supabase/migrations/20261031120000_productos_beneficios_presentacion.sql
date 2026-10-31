-- Beneficios y presentación de cada producto, como campos propios (no mezclados en la descripción).
-- Opcionales: los productos existentes quedan con null y no cambian.
-- RLS y permisos no cambian: las columnas nuevas heredan los de la tabla (anon solo lee lo activo;
-- solo los administradores escriben).

alter table public.products
  add column benefits text,
  add column presentation text;

comment on column public.products.benefits is 'Beneficios del producto, para la ficha pública. Opcional.';
comment on column public.products.presentation is 'Presentación (envase y contenido), para la ficha pública. Opcional.';
