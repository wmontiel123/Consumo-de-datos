-- ════════════════════════════════════════════════════════════════
-- Manual de administrador guardado en la base (no en el sitio público)
--
-- La app lo lee de la tabla "manuales" (id = 'admin') y lo muestra desde el
-- botón Ayuda. Por RLS solo un usuario con rol admin puede leerlo: un viewer
-- recibe 0 filas aunque haga la consulta a mano. Nadie lo escribe desde la app:
-- se sube con scripts/subir_manual_admin.py (clave service_role).
-- El manual de usuario sigue siendo el archivo público manual-ande.html.
--
-- Ejecutar en el SQL Editor de Supabase (se puede repetir).
-- ════════════════════════════════════════════════════════════════

create table if not exists manuales (
    id             text primary key,
    contenido      text not null,
    actualizado_en timestamptz not null default now()
);

alter table manuales enable row level security;

revoke all on manuales from anon, authenticated;
grant select on manuales to authenticated;

drop policy if exists manuales_admin_leer on manuales;
create policy manuales_admin_leer on manuales
    for select to authenticated
    using ((select app_rol()) = 'admin');

notify pgrst, 'reload schema';
