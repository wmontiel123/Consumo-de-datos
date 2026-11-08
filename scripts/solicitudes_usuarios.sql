-- ════════════════════════════════════════════════════════════════
-- Solicitud y aprobación de usuarios (controles ISO/IEC 27034)
--
--  · solicitudes_usuario : pedidos de acceso (formulario público del login)
--  · tokens_cuenta       : enlaces de un solo uso (solo se guarda el SHA-256)
--  · auditoria_seguridad : registro de eventos de seguridad (solo agregar)
--  · intentos_login      : base del bloqueo por intentos fallidos
--
-- Ninguna de estas tablas es accesible con la clave pública (anon): solo la
-- Edge Function "solicitud-usuario" (service_role) llama a estas funciones.
--
-- Ejecutar TODO junto en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

-- ── 0. Respaldo del login actual (para volver atrás con revertir_login.sql) ──
-- Guarda la definición vigente de verificar_login antes de reemplazarla.
-- Si el script se ejecuta dos veces, conserva el primer respaldo (el original).
create table if not exists respaldo_funciones (
    nombre      text primary key,
    definicion  text not null,
    guardado_en timestamptz not null default now()
);
alter table respaldo_funciones enable row level security;
revoke all on respaldo_funciones from anon, authenticated;
insert into respaldo_funciones (nombre, definicion)
select 'verificar_login', pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'verificar_login'
on conflict (nombre) do nothing;

-- ── 1. Columnas nuevas en usuarios_app ───────────────────────────
alter table usuarios_app add column if not exists email                text;
alter table usuarios_app add column if not exists creado_en            timestamptz default now();
alter table usuarios_app add column if not exists solicitud_id         uuid;
alter table usuarios_app add column if not exists aprobado_por         text;
alter table usuarios_app add column if not exists password_cambiado_en timestamptz;
-- Un usuario aprobado existe sin contraseña (inactivo) hasta que la crea con su enlace
alter table usuarios_app alter column password_hash drop not null;
create unique index if not exists usuarios_app_usuario_lower_uq on usuarios_app (lower(usuario));


-- ── 2. Tablas ────────────────────────────────────────────────────
create table if not exists solicitudes_usuario (
    id           uuid primary key default gen_random_uuid(),
    nombre       text not null check (char_length(nombre) between 3 and 100),
    email        text not null check (char_length(email) <= 254
                                      and email ~* '^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$'),
    usuario      text not null check (usuario ~ '^[a-z0-9._-]{3,30}$'),
    motivo       text not null check (char_length(motivo) between 10 and 500),
    estado       text not null default 'pendiente'
                 check (estado in ('pendiente', 'aprobada', 'rechazada', 'activada')),
    rol          text check (rol in ('viewer', 'admin')),
    resuelto_por text,
    resuelto_en  timestamptz,
    ip           text,
    user_agent   text,
    creado_en    timestamptz not null default now()
);
create index if not exists solicitudes_usuario_creado_idx on solicitudes_usuario (creado_en desc);

create table if not exists tokens_cuenta (
    token_hash   text primary key,                 -- SHA-256 (hex) del token; el token no se guarda
    solicitud_id uuid not null references solicitudes_usuario (id) on delete cascade,
    tipo         text not null check (tipo in ('aprobacion', 'activacion')),
    destinatario text not null,
    expira_en    timestamptz not null,
    usado_en     timestamptz
);
create index if not exists tokens_cuenta_solicitud_idx on tokens_cuenta (solicitud_id);

create table if not exists auditoria_seguridad (
    id      bigint generated always as identity primary key,
    fecha   timestamptz not null default now(),
    evento  text not null,
    usuario text,
    detalle jsonb,
    ip      text
);
create index if not exists auditoria_seguridad_fecha_idx on auditoria_seguridad (fecha desc);

create table if not exists intentos_login (
    id      bigint generated always as identity primary key,
    usuario text not null,
    exito   boolean not null,
    ip      text,
    fecha   timestamptz not null default now()
);
create index if not exists intentos_login_usuario_idx on intentos_login (usuario, fecha desc);

-- Sin políticas: con RLS activo y sin "policy", anon/authenticated no ven ni escriben nada
alter table solicitudes_usuario enable row level security;
alter table tokens_cuenta       enable row level security;
alter table auditoria_seguridad enable row level security;
alter table intentos_login      enable row level security;
revoke all on solicitudes_usuario, tokens_cuenta, auditoria_seguridad, intentos_login from anon, authenticated;

-- La auditoría no se puede modificar ni borrar (ni siquiera desde la Edge Function)
create or replace function auditoria_inmutable() returns trigger language plpgsql as $$
begin
    raise exception 'auditoria_seguridad es de solo agregar';
end;
$$;
drop trigger if exists auditoria_seguridad_inmutable on auditoria_seguridad;
create trigger auditoria_seguridad_inmutable
    before update or delete on auditoria_seguridad
    for each row execute function auditoria_inmutable();


-- ── 3. Crear solicitud (con límites anti-abuso) ──────────────────
create or replace function crear_solicitud_usuario(
    p_nombre text, p_email text, p_usuario text, p_motivo text,
    p_ip text, p_user_agent text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
    v_id      uuid;
    v_usuario text := lower(trim(p_usuario));
    v_email   text := lower(trim(p_email));
begin
    if (select count(*) from solicitudes_usuario
         where ip = p_ip and creado_en > now() - interval '1 hour') >= 3 then
        raise exception 'LIMITE_IP' using errcode = 'P0001';
    end if;
    if (select count(*) from solicitudes_usuario
         where creado_en > now() - interval '24 hours') >= 30 then
        raise exception 'LIMITE_GLOBAL' using errcode = 'P0001';
    end if;
    if exists (select 1 from solicitudes_usuario where email = v_email and estado = 'pendiente') then
        raise exception 'EMAIL_PENDIENTE' using errcode = 'P0001';
    end if;
    if exists (select 1 from usuarios_app where lower(usuario) = v_usuario)
       or exists (select 1 from solicitudes_usuario
                   where usuario = v_usuario and estado in ('pendiente', 'aprobada')) then
        raise exception 'USUARIO_NO_DISPONIBLE' using errcode = 'P0001';
    end if;

    insert into solicitudes_usuario (nombre, email, usuario, motivo, ip, user_agent)
    values (trim(p_nombre), v_email, v_usuario, trim(p_motivo), p_ip, left(p_user_agent, 300))
    returning id into v_id;

    insert into auditoria_seguridad (evento, usuario, detalle, ip)
    values ('solicitud_creada', v_usuario, jsonb_build_object('solicitud', v_id, 'email', v_email), p_ip);
    return v_id;
end;
$$;


-- ── 4. Ver qué hay detrás de un token (para la página cuenta.html) ──
create or replace function ver_token_cuenta(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t tokens_cuenta; s solicitudes_usuario;
begin
    select * into t from tokens_cuenta where token_hash = p_token_hash;
    if not found then return jsonb_build_object('valido', false); end if;
    select * into s from solicitudes_usuario where id = t.solicitud_id;
    return jsonb_build_object(
        'valido',       t.usado_en is null and t.expira_en > now(),
        'usado',        t.usado_en is not null,
        'vencido',      t.expira_en <= now(),
        'tipo',         t.tipo,
        'estado',       s.estado,
        'nombre',       s.nombre,
        'email',        s.email,
        'usuario',      s.usuario,
        'motivo',       case when t.tipo = 'aprobacion' then s.motivo end,
        'rol',          s.rol,
        'creado_en',    s.creado_en,
        'resuelto_por', case when t.tipo = 'aprobacion' then s.resuelto_por end,
        'resuelto_en',  s.resuelto_en
    );
end;
$$;


-- ── 5. Aprobar / rechazar (todo en una transacción) ──────────────
-- p_decision: 'viewer' | 'admin' | 'rechazar'
-- p_hash_activacion: SHA-256 del enlace de activación que se mandará al solicitante
create or replace function resolver_solicitud_usuario(
    p_token_hash text, p_decision text, p_hash_activacion text, p_ip text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t tokens_cuenta; s solicitudes_usuario;
begin
    if p_decision not in ('viewer', 'admin', 'rechazar') then
        raise exception 'DECISION_INVALIDA' using errcode = 'P0001';
    end if;

    -- Consumir el token de forma atómica (un solo uso, no vencido)
    update tokens_cuenta set usado_en = now()
     where token_hash = p_token_hash and tipo = 'aprobacion'
       and usado_en is null and expira_en > now()
    returning * into t;
    if not found then raise exception 'TOKEN_INVALIDO' using errcode = 'P0001'; end if;

    select * into s from solicitudes_usuario where id = t.solicitud_id for update;
    if s.estado <> 'pendiente' then raise exception 'YA_RESUELTA' using errcode = 'P0001'; end if;

    -- Los enlaces del otro aprobador quedan sin efecto
    update tokens_cuenta set usado_en = now()
     where solicitud_id = s.id and tipo = 'aprobacion' and usado_en is null;

    if p_decision = 'rechazar' then
        update solicitudes_usuario
           set estado = 'rechazada', resuelto_por = t.destinatario, resuelto_en = now()
         where id = s.id;
    else
        if exists (select 1 from usuarios_app where lower(usuario) = s.usuario) then
            raise exception 'USUARIO_NO_DISPONIBLE' using errcode = 'P0001';
        end if;
        update solicitudes_usuario
           set estado = 'aprobada', rol = p_decision, resuelto_por = t.destinatario, resuelto_en = now()
         where id = s.id;
        -- Usuario creado INACTIVO y sin contraseña: se activa con el enlace (48 h)
        insert into usuarios_app (usuario, rol, activo, password_hash, email, solicitud_id, aprobado_por)
        values (s.usuario, p_decision, false, null, s.email, s.id, t.destinatario);
        insert into tokens_cuenta (token_hash, solicitud_id, tipo, destinatario, expira_en)
        values (p_hash_activacion, s.id, 'activacion', s.email, now() + interval '48 hours');
    end if;

    insert into auditoria_seguridad (evento, usuario, detalle, ip)
    values (case when p_decision = 'rechazar' then 'solicitud_rechazada' else 'solicitud_aprobada' end,
            s.usuario,
            jsonb_build_object('solicitud', s.id, 'por', t.destinatario, 'rol', nullif(p_decision, 'rechazar')),
            p_ip);

    return jsonb_build_object('decision', p_decision, 'nombre', s.nombre, 'email', s.email,
                              'usuario', s.usuario, 'resuelto_por', t.destinatario);
end;
$$;


-- ── 6. Activar la cuenta (el usuario crea su contraseña) ─────────
create or replace function activar_cuenta_usuario(p_token_hash text, p_password text, p_ip text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare t tokens_cuenta; s solicitudes_usuario;
begin
    -- Política de contraseña (también se valida en la página y en la Edge Function)
    if char_length(p_password) < 12 or char_length(p_password) > 128
       or p_password !~ '[A-Za-z]' or p_password !~ '[0-9]' or p_password !~ '[^A-Za-z0-9]' then
        raise exception 'PASSWORD_DEBIL' using errcode = 'P0001';
    end if;

    update tokens_cuenta set usado_en = now()
     where token_hash = p_token_hash and tipo = 'activacion'
       and usado_en is null and expira_en > now()
    returning * into t;
    if not found then raise exception 'TOKEN_INVALIDO' using errcode = 'P0001'; end if;

    select * into s from solicitudes_usuario where id = t.solicitud_id for update;
    if position(lower(s.usuario) in lower(p_password)) > 0 then
        raise exception 'PASSWORD_CONTIENE_USUARIO' using errcode = 'P0001';
    end if;

    update usuarios_app
       set password_hash = crypt(p_password, gen_salt('bf', 12)),
           activo = true, password_cambiado_en = now()
     where solicitud_id = s.id and lower(usuario) = s.usuario;
    if not found then raise exception 'USUARIO_NO_ENCONTRADO' using errcode = 'P0001'; end if;

    update solicitudes_usuario set estado = 'activada' where id = s.id;
    insert into auditoria_seguridad (evento, usuario, detalle, ip)
    values ('cuenta_activada', s.usuario, jsonb_build_object('solicitud', s.id), p_ip);
    return jsonb_build_object('usuario', s.usuario, 'rol', s.rol);
end;
$$;


-- Estas funciones solo las puede llamar la Edge Function (service_role)
revoke all on function crear_solicitud_usuario(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function ver_token_cuenta(text)                                     from public, anon, authenticated;
revoke all on function resolver_solicitud_usuario(text, text, text, text)         from public, anon, authenticated;
revoke all on function activar_cuenta_usuario(text, text, text)                   from public, anon, authenticated;
grant execute on function crear_solicitud_usuario(text, text, text, text, text, text) to service_role;
grant execute on function ver_token_cuenta(text)                                     to service_role;
grant execute on function resolver_solicitud_usuario(text, text, text, text)         to service_role;
grant execute on function activar_cuenta_usuario(text, text, text)                   to service_role;


-- ── 7. Login: solo usuarios activos + bloqueo por intentos ───────
-- 5 intentos fallidos en 15 minutos bloquean ese usuario 15 minutos.
drop function if exists verificar_login(text, text);
create function verificar_login(p_usuario text, p_password text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
    v_usuario text := lower(trim(p_usuario));
    v_rol     text;
    v_ip      text := split_part(coalesce(
                        current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
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
revoke all on function verificar_login(text, text) from public;
grant execute on function verificar_login(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
