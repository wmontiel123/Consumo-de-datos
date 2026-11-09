-- ════════════════════════════════════════════════════════════════
-- Autorización en el servidor — FASE 2 (cierra el acceso con la clave pública)
--
-- Requisitos antes de ejecutar:
--   1. La app publicada ya ingresa por la Edge Function "login" (fase 1).
--   2. El importador (scripts/importar_consumos.py) ya usa SUPABASE_SERVICE_KEY.
--
-- Después de esto, la clave pública (anon) solo sirve para llamar a las
-- Edge Functions "login" y "solicitud-usuario". Los datos requieren sesión.
-- Se revierte con revertir_auth_rls.sql.
-- ════════════════════════════════════════════════════════════════

-- ── 1. Quitar las políticas abiertas ─────────────────────────────
drop policy if exists "Polit"                          on consumo_datos;
drop policy if exists "acceso total demo"              on consumo_sim;
drop policy if exists "allow_all_operations"           on dispositivos_ande;
drop policy if exists "lectura publica"                on dispositivos_ande;
drop policy if exists "insercion publica"              on dispositivos_ande;
drop policy if exists "eliminacion publica"            on dispositivos_ande;
drop policy if exists "app inserta historial_estados"  on historial_estados;
drop policy if exists "app lee historial_estados"      on historial_estados;
drop policy if exists "historial_sim_insert"           on historial_sim;
drop policy if exists "historial_sim_select"           on historial_sim;
drop policy if exists "app inserta lineas"             on lineas;
drop policy if exists "app actualiza lineas"           on lineas;
drop policy if exists "app lee lineas"                 on lineas;
drop policy if exists "insertar solicitudes"           on solicitudes;
drop policy if exists "leer solicitudes"               on solicitudes;

-- ── 2. Sin privilegios para anon en tablas, vistas y secuencias ──
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;

-- ── 3. Funciones: solo con sesión (o solo el servidor) ───────────
revoke execute on function consumo_por_linea(text, text[], date, date, text[], text[], text, text) from public, anon;
revoke execute on function consumo_resumen(text, text[], date, date, text[], text[], text)         from public, anon;
revoke execute on function lineas_charts(text, text, text, text)                                  from public, anon;
revoke execute on function refresh_consumo_consolidado()                                          from public, anon;
revoke execute on function refresh_lineas_estado()                                                from public, anon;
-- El importador (clave de servicio) las sigue usando
grant  execute on function refresh_consumo_consolidado(), refresh_lineas_estado() to service_role;
-- El login lo verifica solo la Edge Function "login" (service_role)
revoke execute on function verificar_login(text, text) from public, anon, authenticated;
grant  execute on function verificar_login(text, text) to service_role;

-- ── 4. Lo que se cree en adelante tampoco queda abierto a anon ───
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

notify pgrst, 'reload schema';
