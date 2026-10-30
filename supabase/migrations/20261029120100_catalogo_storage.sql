-- Bucket público para las imágenes del catálogo (categorías y productos).
-- Lectura: pública por URL (/storage/v1/object/public/catalogo/...), sin permitir listar el bucket.
-- Subir, reemplazar y borrar: solo administradores (public.is_admin()).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'catalogo',
  'catalogo',
  true,
  5242880, -- 5 MB por archivo
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Los administradores necesitan ver los objetos para poder reemplazarlos o borrarlos desde la API
create policy "catalogo: admin lista objetos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'catalogo' and (select public.is_admin()));

create policy "catalogo: admin sube imágenes"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'catalogo' and (select public.is_admin()));

create policy "catalogo: admin reemplaza imágenes"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'catalogo' and (select public.is_admin()))
  with check (bucket_id = 'catalogo' and (select public.is_admin()));

create policy "catalogo: admin borra imágenes"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'catalogo' and (select public.is_admin()));
