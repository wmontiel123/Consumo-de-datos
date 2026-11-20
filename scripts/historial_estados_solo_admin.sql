-- ════════════════════════════════════════════════════════════════
-- El historial de activaciones (historial_estados) solo lo ve el admin.
--
-- Antes: política rol_leer (viewer y admin leen) + rol_admin_escribe (admin todo).
-- Ahora: se quita rol_leer; el admin sigue leyendo y escribiendo por
-- rol_admin_escribe. El viewer no ve filas. La importación (service_role) y la
-- función reactivar_por_consumo() (security definer) siguen escribiendo igual.
--
-- Ejecutar en el SQL Editor de Supabase.
-- Para volver atrás:
--   create policy rol_leer on historial_estados for select to authenticated
--       using ((select app_rol()) in ('viewer','admin'));
-- ════════════════════════════════════════════════════════════════
drop policy if exists rol_leer on historial_estados;

notify pgrst, 'reload schema';
