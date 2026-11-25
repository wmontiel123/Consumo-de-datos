-- ════════════════════════════════════════════════════════════════
-- Integración con Zammad (soporte.inovasi.com.py): tickets de cambio de SIM de la cola ANDE.
--
-- La Edge Function "zammad-webhook" recibe cada cambio de un ticket de la cola ANDE y:
--   · registra el ticket en tickets_ande (lo muestra el panel del RC);
--   · al finalizar el trabajo (hora_finalizacion + ICCID retirada / instalada) llama a
--     aplicar_cambio_sim_ticket(), que hace en una sola transacción lo mismo que el botón
--     "Cambiar SIM" de la app:
--       - historial_sim (con el número de ticket),
--       - ICCID nuevo en dispositivos_ande,
--       - SIM retirada → DESACTIVADA en el inventario (libera el RC / slot),
--       - SIM instalada → ASIGNADA a ese RC / slot (si no está en el inventario se crea),
--       - historial_estados de cada línea.
--     Si algo no coincide no cambia nada y devuelve { ok: false, error, detalle }.
--
-- Ejecutar todo junto en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════

alter table historial_sim add column if not exists ticket text;

create table if not exists tickets_ande (
    ticket_id      bigint primary key,           -- id interno de Zammad
    numero         text,                         -- número visible (#281xxx)
    titulo         text,
    rc_codigo      text,
    sim_afectada   text,                         -- principal | backup | ambas
    estado         text,                         -- estado del ticket en Zammad
    creado_en      timestamptz,
    finalizado_en  timestamptz,                  -- hora_finalizacion
    cerrado_en     timestamptz,
    snapshot_rc    text,                         -- RC del que se mandó el resumen al ticket
    aplicado_firma text,                         -- datos del cambio de SIM ya procesados
    aplicado_en    timestamptz,                  -- cambio de SIM aplicado en el inventario
    revisar        boolean not null default false, -- el cambio no se pudo aplicar solo
    resultado      jsonb,
    actualizado_en timestamptz not null default now()
);
create index if not exists tickets_ande_rc on tickets_ande (upper(rc_codigo));
alter table tickets_ande enable row level security;
drop policy if exists tickets_ande_leer on tickets_ande;
create policy tickets_ande_leer on tickets_ande for select to authenticated using (true);
-- Solo la Edge Function (service_role) escribe


-- Busca una línea del inventario (lineas y luego lineas_legado) por ICCID sin dígito verificador
create or replace function _linea_por_iccid(p_iccid text)
returns table (tabla text, id bigint, numero text, iccid text, estado text, rc_codigo text, sim_slot text)
language sql
stable
set search_path = public
as $$
    select * from (
        select 'lineas'::text, l.id, l.numero, l.iccid, l.estado, l.rc_codigo, l.sim_slot
          from lineas l where clave_iccid(l.iccid) = clave_iccid(p_iccid)
        union all
        select 'lineas_legado'::text, l.id, l.numero, l.iccid, l.estado, l.rc_codigo, l.sim_slot
          from lineas_legado l where clave_iccid(l.iccid) = clave_iccid(p_iccid)
    ) x
    order by (x.estado = 'asignada') desc, x.id
    limit 1;
$$;


create or replace function aplicar_cambio_sim_ticket(
    p_ticket      text,          -- número de ticket (#281xxx)
    p_rc          text,
    p_slot        text,          -- sim1 | sim2
    p_iccid_ret   text,
    p_iccid_inst  text,
    p_fecha       timestamptz,   -- hora_finalizacion
    p_usuario     text           -- quién lo hizo (dueño del ticket o "Zammad")
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    d        dispositivos_ande%rowtype;
    n_rc     int;
    cur_icc  text;
    cur_num  text;
    inst     text := nullif(regexp_replace(coalesce(p_iccid_inst, ''), '\D', '', 'g'), '');
    ret      text := nullif(regexp_replace(coalesce(p_iccid_ret,  ''), '\D', '', 'g'), '');
    otro     text;
    li       record;
    lr       record;
    num_new  text;
    tel      text;
    motivo   text := 'Cambio de SIM · ticket #' || p_ticket;
    usr      text := coalesce(nullif(trim(p_usuario), ''), 'Zammad');
    res      jsonb := '{}'::jsonb;
begin
    if p_slot not in ('sim1', 'sim2') then
        return jsonb_build_object('ok', false, 'error', 'slot_invalido', 'detalle', 'SIM ' || coalesce(p_slot, '?'));
    end if;
    if inst is null or inst !~ '^89\d{17,18}$' then
        return jsonb_build_object('ok', false, 'error', 'iccid_instalada_invalida',
                                  'detalle', 'ICCID instalada «' || coalesce(p_iccid_inst, '') || '» no tiene formato de ICCID');
    end if;

    -- Ya aplicado (el mismo aviso llegó dos veces)
    if exists (select 1 from historial_sim where ticket = p_ticket and sim_slot = p_slot
                  and clave_iccid(imei_nuevo) = clave_iccid(inst)) then
        return jsonb_build_object('ok', true, 'ya_aplicado', true);
    end if;

    select count(*) into n_rc from dispositivos_ande where upper(trim(codigo)) = upper(trim(p_rc));
    if n_rc = 0 then
        return jsonb_build_object('ok', false, 'error', 'rc_no_existe', 'detalle', 'No existe el RC «' || coalesce(p_rc, '') || '»');
    elsif n_rc > 1 then
        return jsonb_build_object('ok', false, 'error', 'rc_repetido', 'detalle', 'Hay ' || n_rc || ' RC con el código «' || p_rc || '»');
    end if;
    select * into d from dispositivos_ande where upper(trim(codigo)) = upper(trim(p_rc)) for update;

    cur_icc := case p_slot when 'sim1' then d.sim1_imei else d.sim2_imei end;
    cur_num := case p_slot when 'sim1' then d.sim1_num  else d.sim2_num  end;

    if clave_iccid(cur_icc) = clave_iccid(inst) then
        return jsonb_build_object('ok', true, 'sin_cambio', true, 'detalle', 'El RC ya tenía esa SIM');
    end if;
    -- La SIM retirada tiene que ser la registrada (si el RC tenía un ICCID válido cargado)
    if ret is not null and trim(coalesce(cur_icc, '')) ~ '^89\d{17,18}$'
       and clave_iccid(cur_icc) <> clave_iccid(ret) then
        return jsonb_build_object('ok', false, 'error', 'retirada_no_coincide',
            'detalle', 'La SIM retirada (' || ret || ') no es la registrada en ' || d.codigo || ' ' || upper(p_slot) || ' (' || cur_icc || ')');
    end if;
    -- La SIM instalada no puede estar en otro RC
    select codigo into otro from dispositivos_ande
     where id <> d.id and (clave_iccid(sim1_imei) = clave_iccid(inst) or clave_iccid(sim2_imei) = clave_iccid(inst))
     limit 1;
    if otro is not null then
        return jsonb_build_object('ok', false, 'error', 'instalada_en_otro_rc',
            'detalle', 'La SIM instalada (' || inst || ') figura en el RC ' || otro);
    end if;
    select * into li from _linea_por_iccid(inst);
    if li.id is not null and li.estado = 'asignada' and li.rc_codigo is not null
       and (upper(li.rc_codigo) <> upper(d.codigo) or coalesce(li.sim_slot, p_slot) <> p_slot) then
        return jsonb_build_object('ok', false, 'error', 'instalada_asignada_a_otro_rc',
            'detalle', 'En el inventario la SIM instalada (' || inst || ') está asignada a ' || li.rc_codigo || coalesce(' ' || upper(li.sim_slot), ''));
    end if;

    -- ── Desde acá se aplica todo ──
    -- 1. SIM retirada → desactivada (y libera el RC / slot)
    select * into lr from _linea_por_iccid(coalesce(ret, cur_icc));
    if lr.id is null and trim(coalesce(cur_num, '')) <> '' and upper(trim(cur_num)) <> 'M2M' then
        select 'lineas'::text as tabla, l.id, l.numero, l.iccid, l.estado, l.rc_codigo, l.sim_slot into lr
          from lineas l where trim(l.numero) = trim(cur_num) and l.estado = 'asignada'
           and upper(coalesce(l.rc_codigo, '')) = upper(d.codigo) limit 1;
    end if;
    if lr.id is not null and (li.id is null or lr.id <> li.id or lr.tabla <> li.tabla) then
        execute format('update %I set estado = ''desactivada'', rc_codigo = null, sim_slot = null,
                               observacion = concat_ws('' · '', nullif(observacion, ''''), $1)
                         where id = $2', lr.tabla)
          using 'Retirada de ' || d.codigo || ' ' || upper(p_slot) || ' (ticket #' || p_ticket || ')', lr.id;
        insert into historial_estados (tipo, referencia, estado_anterior, estado_nuevo, motivo, usuario)
        values ('linea', coalesce(nullif(case when upper(trim(coalesce(lr.numero, ''))) = 'M2M' then '' else trim(lr.numero) end, ''), lr.iccid),
                lr.estado, 'desactivada', motivo || ' · SIM retirada de ' || d.codigo || ' ' || upper(p_slot), usr);
        res := res || jsonb_build_object('retirada', jsonb_build_object('linea', coalesce(lr.numero, lr.iccid), 'antes', lr.estado));
    else
        res := res || jsonb_build_object('retirada', jsonb_build_object('linea', null, 'nota', 'no estaba en el inventario'));
    end if;

    -- 2. SIM instalada → asignada a este RC / slot (se crea si no está)
    if li.id is not null then
        execute format('update %I set estado = ''asignada'', rc_codigo = $1, sim_slot = $2, linea_inactiva = false
                         where id = $3', li.tabla)
          using d.codigo, p_slot, li.id;
        num_new := case when upper(trim(coalesce(li.numero, ''))) in ('', 'M2M') then null else trim(li.numero) end;
        insert into historial_estados (tipo, referencia, estado_anterior, estado_nuevo, motivo, usuario)
        values ('linea', coalesce(num_new, li.iccid), li.estado, 'asignada',
                motivo || ' · instalada en ' || d.codigo || ' ' || upper(p_slot), usr);
        res := res || jsonb_build_object('instalada', jsonb_build_object('linea', coalesce(num_new, li.iccid), 'antes', li.estado, 'creada', false));
    else
        -- Telefonía: la del último reporte de consumo con ese ICCID, si lo hay
        select telefonia into tel from consumo_sim
         where fecha_consumo >= current_date - 30 and imei like left(inst, 19) || '%'
         order by fecha_consumo desc limit 1;
        insert into lineas (numero, iccid, telefonia, estado, rc_codigo, sim_slot, observacion, creado_por)
        values (null, inst, tel, 'asignada', d.codigo, p_slot,
                'Alta automática: instalada en ' || d.codigo || ' ' || upper(p_slot) || ' (ticket #' || p_ticket || ')', usr);
        insert into historial_estados (tipo, referencia, estado_anterior, estado_nuevo, motivo, usuario)
        values ('linea', inst, 'nueva', 'asignada', motivo || ' · instalada en ' || d.codigo || ' ' || upper(p_slot), usr);
        res := res || jsonb_build_object('instalada', jsonb_build_object('linea', inst, 'antes', null, 'creada', true));
    end if;

    -- 3. RC: ICCID nuevo; el número cambia solo si el inventario conoce el de la SIM nueva
    if p_slot = 'sim1' then
        update dispositivos_ande set sim1_imei = inst, sim1_num = coalesce(num_new, sim1_num) where id = d.id;
    else
        update dispositivos_ande set sim2_imei = inst, sim2_num = coalesce(num_new, sim2_num) where id = d.id;
    end if;

    -- 4. Historial de cambios de SIM
    insert into historial_sim (rc_codigo, sim_slot, numero_ant, imei_ant, numero_nuevo, imei_nuevo,
                               usuario, observacion, fecha_campo, ticket)
    values (d.codigo, p_slot, cur_num, cur_icc, coalesce(num_new, cur_num), inst, usr,
            'Ticket #' || p_ticket || ' (Zammad)' || case when num_new is null then ' · número sin confirmar' else '' end,
            (p_fecha at time zone 'America/Asuncion')::date, p_ticket);

    return res || jsonb_build_object('ok', true, 'rc', d.codigo, 'slot', p_slot,
                                     'iccid_anterior', cur_icc, 'iccid_nueva', inst,
                                     'numero_anterior', cur_num, 'numero_nuevo', coalesce(num_new, cur_num),
                                     'numero_confirmado', num_new is not null);
end;
$$;

revoke execute on function aplicar_cambio_sim_ticket(text, text, text, text, text, timestamptz, text) from public, anon, authenticated;
grant  execute on function aplicar_cambio_sim_ticket(text, text, text, text, text, timestamptz, text) to service_role;
revoke execute on function _linea_por_iccid(text) from public, anon;

notify pgrst, 'reload schema';
