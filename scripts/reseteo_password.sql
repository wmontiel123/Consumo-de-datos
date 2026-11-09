-- ════════════════════════════════════════════════════════════════
-- Reseteo de contraseña con aprobación de soporte (ISO/IEC 27034)
--
-- 1. Tras una contraseña incorrecta, el login ofrece "Solicitar reseteo":
--    usuario + correo donde recibir el enlace.
-- 2. La Edge Function avisa a los aprobadores e indica si ese correo coincide
--    con el registrado (si no coincide, deben confirmar la identidad).
-- 3. Al aprobar, se envía al correo indicado un enlace de un solo uso (24 h)
--    para crear una contraseña nueva. Al usarlo: se desbloquea el usuario y
--    se cierran todas sus sesiones abiertas.
--
-- La respuesta al solicitante es siempre la misma (no revela si el usuario
-- existe). Ejecutar TODO junto en el SQL Editor.
-- ════════════════════════════════════════════════════════════════

create table if not exists solicitudes_reseteo (
    id            uuid primary key default gen_random_uuid(),
    usuario       text not null check (char_length(usuario) between 1 and 60),
    email         text not null check (char_length(email) <= 254
                                       and email ~* '^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$'),
    -- ignorada: usuario inexistente o inactivo (no se avisa a nadie)
    estado        text not null default 'pendiente'
                  check (estado in ('pendiente', 'aprobada', 'rechazada', 'completada', 'ignorada')),
    email_registrado text,                 -- correo que tenía el usuario al pedir el reseteo
    resuelto_por  text,
    resuelto_en   timestamptz,
    ip            text,
    user_agent    text,
    creado_en     timestamptz not null default now()
);
create index if not exists solicitudes_reseteo_creado_idx on solicitudes_reseteo (creado_en desc);

create table if not exists tokens_reseteo (
    token_hash   text primary key,         -- SHA-256 (hex); el token no se guarda
    reseteo_id   uuid not null references solicitudes_reseteo (id) on delete cascade,
    tipo         text not null check (tipo in ('aprobacion_reseteo', 'reseteo')),
    destinatario text not null,
    expira_en    timestamptz not null,
    usado_en     timestamptz
);
create index if not exists tokens_reseteo_reseteo_idx on tokens_reseteo (reseteo_id);

alter table solicitudes_reseteo enable row level security;
alter table tokens_reseteo      enable row level security;
revoke all on solicitudes_reseteo, tokens_reseteo from anon, authenticated;


-- ── 1. Crear solicitud (límites anti-abuso) ──────────────────────
-- Devuelve si hay que avisar a los aprobadores y los datos para el mail.
create or replace function crear_solicitud_reseteo(
    p_usuario text, p_email text, p_ip text, p_user_agent text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_usuario text := lower(trim(p_usuario));
    v_email   text := lower(trim(p_email));
    u         usuarios_app;
    v_id      uuid;
    v_existe  boolean;
begin
    if (select count(*) from solicitudes_reseteo
         where ip = p_ip and creado_en > now() - interval '1 hour') >= 3 then
        raise exception 'LIMITE_IP' using errcode = 'P0001';
    end if;
    if (select count(*) from solicitudes_reseteo
         where creado_en > now() - interval '24 hours') >= 30 then
        raise exception 'LIMITE_GLOBAL' using errcode = 'P0001';
    end if;

    select * into u from usuarios_app
     where lower(usuario) = v_usuario and activo is true and password_hash is not null;
    v_existe := found;   -- FOUND cambia con cada sentencia: se guarda ya

    -- Ya hay una pendiente para ese usuario: no se vuelve a avisar
    if v_existe and exists (select 1 from solicitudes_reseteo
                          where usuario = v_usuario and estado in ('pendiente', 'aprobada')
                            and creado_en > now() - interval '24 hours') then
        insert into solicitudes_reseteo (usuario, email, estado, ip, user_agent)
        values (v_usuario, v_email, 'ignorada', p_ip, left(p_user_agent, 300));
        return jsonb_build_object('avisar', false);
    end if;

    insert into solicitudes_reseteo (usuario, email, estado, email_registrado, ip, user_agent)
    values (v_usuario, v_email, case when v_existe then 'pendiente' else 'ignorada' end,
            u.email, p_ip, left(p_user_agent, 300))
    returning id into v_id;

    insert into auditoria_seguridad (evento, usuario, detalle, ip)
    values (case when v_existe then 'reseteo_solicitado' else 'reseteo_usuario_inexistente' end,
            v_usuario, jsonb_build_object('reseteo', v_id, 'email', v_email), p_ip);

    if not v_existe then return jsonb_build_object('avisar', false); end if;
    return jsonb_build_object(
        'avisar', true, 'id', v_id, 'usuario', u.usuario, 'rol', u.rol, 'email', v_email,
        'email_registrado', u.email,
        'coincide', u.email is not null and lower(u.email) = v_email);
end;
$$;


-- ── 2. Ver qué hay detrás de un enlace de reseteo ────────────────
create or replace function ver_token_reseteo(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t tokens_reseteo; s solicitudes_reseteo;
begin
    select * into t from tokens_reseteo where token_hash = p_token_hash;
    if not found then return jsonb_build_object('valido', false); end if;
    select * into s from solicitudes_reseteo where id = t.reseteo_id;
    return jsonb_build_object(
        'valido',       t.usado_en is null and t.expira_en > now(),
        'usado',        t.usado_en is not null,
        'vencido',      t.expira_en <= now(),
        'tipo',         t.tipo,
        'estado',       s.estado,
        'usuario',      s.usuario,
        'email',        s.email,
        'email_registrado', case when t.tipo = 'aprobacion_reseteo' then s.email_registrado end,
        'coincide',     s.email_registrado is not null and lower(s.email_registrado) = s.email,
        'rol',          (select rol from usuarios_app where lower(usuario) = s.usuario),
        'creado_en',    s.creado_en,
        'resuelto_por', case when t.tipo = 'aprobacion_reseteo' then s.resuelto_por end,
        'resuelto_en',  s.resuelto_en
    );
end;
$$;


-- ── 3. Aprobar / rechazar ────────────────────────────────────────
-- p_decision: 'aprobar' | 'rechazar'
create or replace function resolver_reseteo(
    p_token_hash text, p_decision text, p_hash_reseteo text, p_ip text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t tokens_reseteo; s solicitudes_reseteo;
begin
    if p_decision not in ('aprobar', 'rechazar') then
        raise exception 'DECISION_INVALIDA' using errcode = 'P0001';
    end if;
    update tokens_reseteo set usado_en = now()
     where token_hash = p_token_hash and tipo = 'aprobacion_reseteo'
       and usado_en is null and expira_en > now()
    returning * into t;
    if not found then raise exception 'TOKEN_INVALIDO' using errcode = 'P0001'; end if;

    select * into s from solicitudes_reseteo where id = t.reseteo_id for update;
    if s.estado <> 'pendiente' then raise exception 'YA_RESUELTA' using errcode = 'P0001'; end if;

    -- Los enlaces del otro aprobador quedan sin efecto
    update tokens_reseteo set usado_en = now()
     where reseteo_id = s.id and tipo = 'aprobacion_reseteo' and usado_en is null;

    update solicitudes_reseteo
       set estado = case when p_decision = 'aprobar' then 'aprobada' else 'rechazada' end,
           resuelto_por = t.destinatario, resuelto_en = now()
     where id = s.id;

    if p_decision = 'aprobar' then
        insert into tokens_reseteo (token_hash, reseteo_id, tipo, destinatario, expira_en)
        values (p_hash_reseteo, s.id, 'reseteo', s.email, now() + interval '24 hours');
    end if;

    insert into auditoria_seguridad (evento, usuario, detalle, ip)
    values (case when p_decision = 'aprobar' then 'reseteo_aprobado' else 'reseteo_rechazado' end,
            s.usuario, jsonb_build_object('reseteo', s.id, 'por', t.destinatario, 'email', s.email), p_ip);

    return jsonb_build_object('decision', p_decision, 'usuario', s.usuario, 'email', s.email,
                              'resuelto_por', t.destinatario);
end;
$$;


-- ── 4. Crear la contraseña nueva ─────────────────────────────────
create or replace function completar_reseteo(p_token_hash text, p_password text, p_ip text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare t tokens_reseteo; s solicitudes_reseteo; u usuarios_app; v_sesiones int := 0;
begin
    if char_length(p_password) < 12 or char_length(p_password) > 128
       or p_password !~ '[A-Za-z]' or p_password !~ '[0-9]' or p_password !~ '[^A-Za-z0-9]' then
        raise exception 'PASSWORD_DEBIL' using errcode = 'P0001';
    end if;

    update tokens_reseteo set usado_en = now()
     where token_hash = p_token_hash and tipo = 'reseteo'
       and usado_en is null and expira_en > now()
    returning * into t;
    if not found then raise exception 'TOKEN_INVALIDO' using errcode = 'P0001'; end if;

    select * into s from solicitudes_reseteo where id = t.reseteo_id for update;
    if position(lower(s.usuario) in lower(p_password)) > 0 then
        raise exception 'PASSWORD_CONTIENE_USUARIO' using errcode = 'P0001';
    end if;

    select * into u from usuarios_app where lower(usuario) = s.usuario and activo is true for update;
    if not found then raise exception 'USUARIO_NO_ENCONTRADO' using errcode = 'P0001'; end if;
    if u.password_hash is not null and u.password_hash = crypt(p_password, u.password_hash) then
        raise exception 'PASSWORD_REPETIDA' using errcode = 'P0001';
    end if;

    -- Contraseña nueva; si no tenía correo, queda registrado el aprobado
    update usuarios_app
       set password_hash = crypt(p_password, gen_salt('bf', 12)),
           password_cambiado_en = now(),
           email = coalesce(email, s.email)
     where id = u.id;

    -- Cerrar todas sus sesiones abiertas (el JWT vigente vence en ≤ 1 h)
    if u.auth_id is not null then
        delete from auth.sessions where user_id = u.auth_id;
        get diagnostics v_sesiones = row_count;
    end if;

    update solicitudes_reseteo set estado = 'completada' where id = s.id;
    insert into auditoria_seguridad (evento, usuario, detalle, ip)
    values ('password_reseteada', s.usuario,
            jsonb_build_object('reseteo', s.id, 'sesiones_cerradas', v_sesiones), p_ip);
    return jsonb_build_object('usuario', u.usuario, 'email', s.email);
end;
$$;

revoke all on function crear_solicitud_reseteo(text, text, text, text)  from public, anon, authenticated;
revoke all on function ver_token_reseteo(text)                         from public, anon, authenticated;
revoke all on function resolver_reseteo(text, text, text, text)        from public, anon, authenticated;
revoke all on function completar_reseteo(text, text, text)             from public, anon, authenticated;
grant execute on function crear_solicitud_reseteo(text, text, text, text) to service_role;
grant execute on function ver_token_reseteo(text)                        to service_role;
grant execute on function resolver_reseteo(text, text, text, text)       to service_role;
grant execute on function completar_reseteo(text, text, text)            to service_role;


-- ── 5. Bloqueo por intentos: se levanta al cambiar la contraseña ─
-- Igual que antes, pero solo cuenta los fallos posteriores al último cambio.
create or replace function verificar_login(p_usuario text, p_password text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
    v_usuario text := lower(trim(p_usuario));
    v_rol     text;
    v_hdr     json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
    v_ip      text := coalesce(nullif(v_hdr ->> 'x-ip-cliente', ''),
                               split_part(coalesce(v_hdr ->> 'x-forwarded-for', ''), ',', 1));
    v_desde   timestamptz := greatest(now() - interval '15 minutes',
                                      coalesce((select max(password_cambiado_en) from usuarios_app
                                                 where lower(usuario) = v_usuario), '-infinity'));
begin
    if (select count(*) from intentos_login
         where usuario = v_usuario and not exito and fecha > v_desde) >= 5 then
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
revoke execute on function verificar_login(text, text) from public, anon, authenticated;
grant  execute on function verificar_login(text, text) to service_role;

notify pgrst, 'reload schema';
