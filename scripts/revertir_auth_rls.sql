-- ════════════════════════════════════════════════════════════════
-- Revierte auth_rls_fase2.sql y auth_rls_fase1.sql: vuelve a dejar los
-- datos accesibles con la clave pública, como estaban el 2026-11-08.
-- Usar solo si algo falla. Después hay que volver a publicar un app.js
-- que ingrese con verificar_login (commit anterior a la migración).
-- ════════════════════════════════════════════════════════════════

-- ── Fase 2: políticas y privilegios originales ───────────────────
grant all on all tables    in schema public to anon;
grant all on all sequences in schema public to anon;
alter default privileges in schema public grant all on tables    to anon;
alter default privileges in schema public grant all on sequences to anon;
alter default privileges in schema public grant all on functions to anon;
-- Las tablas internas siguen cerradas
revoke all on auditoria_seguridad, intentos_login, respaldo_funciones,
              solicitudes_usuario, tokens_cuenta, usuarios_app from anon;

grant execute on function consumo_por_linea(text, text[], date, date, text[], text[], text, text) to anon;
grant execute on function consumo_resumen(text, text[], date, date, text[], text[], text)         to anon;
grant execute on function lineas_charts(text, text, text, text)                                  to anon;
grant execute on function refresh_consumo_consolidado()                                          to anon;
grant execute on function refresh_lineas_estado()                                                to anon;
grant execute on function verificar_login(text, text)                                             to anon, authenticated;

drop policy if exists "Polit" on consumo_datos;
create policy "Polit" on consumo_datos for select to anon, authenticated using (true);
drop policy if exists "acceso total demo" on consumo_sim;
create policy "acceso total demo" on consumo_sim for all to public using (true) with check (true);
drop policy if exists "allow_all_operations" on dispositivos_ande;
create policy "allow_all_operations" on dispositivos_ande for all to public using (true) with check (true);
drop policy if exists "lectura publica" on dispositivos_ande;
create policy "lectura publica" on dispositivos_ande for select to public using (true);
drop policy if exists "insercion publica" on dispositivos_ande;
create policy "insercion publica" on dispositivos_ande for insert to public with check (true);
drop policy if exists "eliminacion publica" on dispositivos_ande;
create policy "eliminacion publica" on dispositivos_ande for delete to public using (true);
drop policy if exists "app inserta historial_estados" on historial_estados;
create policy "app inserta historial_estados" on historial_estados for insert to anon, authenticated with check (true);
drop policy if exists "app lee historial_estados" on historial_estados;
create policy "app lee historial_estados" on historial_estados for select to anon, authenticated using (true);
drop policy if exists "historial_sim_insert" on historial_sim;
create policy "historial_sim_insert" on historial_sim for insert to public with check (true);
drop policy if exists "historial_sim_select" on historial_sim;
create policy "historial_sim_select" on historial_sim for select to public using (true);
drop policy if exists "app inserta lineas" on lineas;
create policy "app inserta lineas" on lineas for insert to anon, authenticated with check (true);
drop policy if exists "app actualiza lineas" on lineas;
create policy "app actualiza lineas" on lineas for update to anon, authenticated using (true) with check (true);
drop policy if exists "app lee lineas" on lineas;
create policy "app lee lineas" on lineas for select to anon, authenticated using (true);
drop policy if exists "insertar solicitudes" on solicitudes;
create policy "insertar solicitudes" on solicitudes for insert to anon with check (true);
drop policy if exists "leer solicitudes" on solicitudes;
create policy "leer solicitudes" on solicitudes for select to anon using (true);

-- ── Fase 1: políticas por rol ────────────────────────────────────
do $$
declare t text;
begin
    foreach t in array array['consumo_datos','consumo_sim','dispositivos_ande',
                             'historial_estados','historial_sim','lineas','sim_estados'] loop
        execute format('drop policy if exists rol_leer on %I', t);
        execute format('drop policy if exists rol_admin_escribe on %I', t);
    end loop;
end $$;
drop policy if exists rol_crear_solicitud   on solicitudes;
drop policy if exists rol_admin_solicitudes on solicitudes;
alter table historial_sim disable row level security;   -- estaba sin RLS

notify pgrst, 'reload schema';
