-- ════════════════════════════════════════════════════════════════
-- Autorización en el servidor — FASE 1 (no rompe nada)
--
-- Agrega lo nuevo sin quitar lo viejo: las políticas abiertas a anon
-- siguen vigentes hasta la fase 2.
--
--  · usuarios_app.auth_id : vínculo con el usuario de Supabase Auth
--    (lo crea la Edge Function "login" en el primer ingreso)
--  · app_rol(), app_usuario(), mi_perfil() : rol/usuario actual, leídos de
--    usuarios_app en cada consulta (un usuario desactivado pierde acceso
--    al instante, aunque su JWT siga vigente)
--  · Políticas RLS por rol para "authenticated":
--      viewer → solo lectura · admin → lectura y escritura
--  · verificar_login: también lee la IP real que le pasa la Edge Function
--
-- Ejecutar TODO junto. Se revierte con revertir_auth_rls.sql.
-- ════════════════════════════════════════════════════════════════

alter table usuarios_app add column if not exists auth_id uuid unique;

-- ── 1. Rol y usuario del que consulta ────────────────────────────
create or replace function app_rol() returns text
language sql stable security definer set search_path = public as $$
    select rol from usuarios_app where auth_id = auth.uid() and activo is true
$$;
create or replace function app_usuario() returns text
language sql stable security definer set search_path = public as $$
    select usuario from usuarios_app where auth_id = auth.uid() and activo is true
$$;
-- Para la app al recargar la página: quién soy y con qué perfil
create or replace function mi_perfil() returns json
language sql stable security definer set search_path = public as $$
    select json_build_object('usuario', usuario, 'rol', rol)
      from usuarios_app where auth_id = auth.uid() and activo is true
$$;
revoke all on function app_rol()     from public, anon;
revoke all on function app_usuario() from public, anon;
revoke all on function mi_perfil()   from public, anon;
grant execute on function app_rol(), app_usuario(), mi_perfil() to authenticated;


-- ── 2. Políticas por rol en las tablas de datos ──────────────────
-- (select app_rol()) se evalúa una vez por consulta, no por fila.
do $$
declare t text;
begin
    foreach t in array array['consumo_datos','consumo_sim','dispositivos_ande',
                             'historial_estados','historial_sim','lineas','sim_estados'] loop
        execute format('alter table %I enable row level security', t);
        execute format('grant select, insert, update, delete on %I to authenticated', t);
        execute format('drop policy if exists rol_leer on %I', t);
        execute format($p$create policy rol_leer on %I for select to authenticated
                          using ((select app_rol()) in ('viewer','admin'))$p$, t);
        execute format('drop policy if exists rol_admin_escribe on %I', t);
        execute format($p$create policy rol_admin_escribe on %I for all to authenticated
                          using ((select app_rol()) = 'admin')
                          with check ((select app_rol()) = 'admin')$p$, t);
    end loop;
end $$;

-- solicitudes (pedidos de cambios que hace un viewer): cualquiera con
-- sesión puede crearlas, solo a su nombre; el admin las ve todas.
grant select, insert, update, delete on solicitudes to authenticated;
drop policy if exists rol_crear_solicitud on solicitudes;
create policy rol_crear_solicitud on solicitudes for insert to authenticated
    with check ((select app_rol()) in ('viewer','admin') and usuario = (select app_usuario()));
drop policy if exists rol_admin_solicitudes on solicitudes;
create policy rol_admin_solicitudes on solicitudes for all to authenticated
    using ((select app_rol()) = 'admin') with check ((select app_rol()) = 'admin');

-- Vistas y vistas materializadas: lectura para usuarios con sesión
grant select on vista_lineas_estado, consumo_ultimo, consumo_consolidado,
                lineas_estado_mv, lineas_mes_mv to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Funciones que usa la app
grant execute on function consumo_por_linea(text, text[], date, date, text[], text[], text, text) to authenticated;
grant execute on function consumo_resumen(text, text[], date, date, text[], text[], text) to authenticated;
grant execute on function refresh_consumo_consolidado() to authenticated;
grant execute on function refresh_lineas_estado() to authenticated;


-- ── 3. verificar_login: IP real desde la Edge Function ───────────
-- La Edge Function "login" manda la IP del usuario en x-ip-cliente.
create or replace function verificar_login(p_usuario text, p_password text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
    v_usuario text := lower(trim(p_usuario));
    v_rol     text;
    v_hdr     json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
    v_ip      text := coalesce(nullif(v_hdr ->> 'x-ip-cliente', ''),
                               split_part(coalesce(v_hdr ->> 'x-forwarded-for', ''), ',', 1));
begin
    if (select count(*) from intentos_login
         where usuario = v_usuario and not exito and fecha > now() - interval '15 minutes') >= 5 then
        raise exception 'Usuario bloqueado temporalmente por intentos fallidos. Probá de nuevo en 15 minutos.';
    end if;

    select rol into v_rol
      from usuarios_app
     where lower(usuario) = v_usuario
       and activo is not false
       and password_hash is not null
       and password_hash = crypt(p_password, password_hash);

    insert into intentos_login (usuario, exito, ip) values (v_usuario, v_rol is not null, v_ip);
    if v_rol is null then
        insert into auditoria_seguridad (evento, usuario, ip) values ('login_fallido', v_usuario, v_ip);
    end if;
    return v_rol;
end;
$$;

notify pgrst, 'reload schema';
