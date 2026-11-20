-- ════════════════════════════════════════════════════════════════
-- Carga de consumos: el inventario de líneas ya NO cambia de estado solo.
--
-- Después de cada importación (y cada 30 min por pg_cron) refresh_lineas_estado():
--   1. refresca las vistas de consumo;
--   2. crear_lineas_desde_reporte(): cada línea que figura en el ÚLTIMO reporte de
--      su operadora y no está en el inventario (ni en Líneas ni en Legado) se crea
--      como 'asignada'. Si el operador la informa como "Legado" va a lineas_legado,
--      si no a lineas. Si la SIM figura en un único RC y ese lugar está libre en el
--      inventario, se le pone ese RC.
--      No se crean los números de la tabla lineas_no_crear.
--   3. reactivar_por_consumo(): solo los RC desactivados con una SIM que volvió a
--      consumir (ya no toca las líneas del inventario);
--   4. actualizar_estados_rc(): estado de los RC según sus SIM (sin cambios).
--
-- Para correrlo a mano:   select crear_lineas_desde_reporte();
-- Ejecutar todo junto en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════

-- Números que no se deben dar de alta aunque aparezcan en el reporte
create table if not exists lineas_no_crear (
    numero    text primary key,
    motivo    text,
    creado_en timestamptz not null default now()
);
alter table lineas_no_crear enable row level security;   -- solo la base (funciones) la usa
insert into lineas_no_crear (numero, motivo) values
    ('992926003', 'Excluida a pedido'),
    ('994310240', 'Excluida a pedido'),
    ('994443099', 'Excluida a pedido')
on conflict (numero) do nothing;


create or replace function crear_lineas_desde_reporte()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    n_lineas int := 0;
    n_legado int := 0;
begin
    drop table if exists _inv;
    drop table if exists _nuevas;

    -- Claves del inventario (número si no es M2M, e ICCID sin el dígito verificador)
    create temp table _inv on commit drop as
    select key from (
        select trim(numero) as key from lineas        where upper(trim(coalesce(numero, ''))) not in ('', 'M2M')
        union select clave_iccid(iccid) from lineas        where trim(coalesce(iccid, '')) <> ''
        union select trim(numero)       from lineas_legado where upper(trim(coalesce(numero, ''))) not in ('', 'M2M')
        union select clave_iccid(iccid) from lineas_legado where trim(coalesce(iccid, '')) <> ''
    ) x;
    create index on _inv (key);

    -- Líneas del último reporte de cada operadora que no están en el inventario
    create temp table _nuevas on commit drop as
    with ult as (
        select telefonia, max(ultima_fecha) as f from lineas_estado_mv group by telefonia
    ), rep as (
        select m.linea_key, m.telefonia, m.ultima_fecha,
               lower(trim(coalesce(m.estado_operador, ''))) = 'legado'                 as es_legado,
               case when upper(trim(coalesce(m.numero, ''))) in ('', 'M2M') then null else trim(m.numero) end as num,
               nullif(trim(coalesce(m.imei, '')), '')                                  as icc
          from lineas_estado_mv m
          join ult u on u.telefonia = m.telefonia and u.f = m.ultima_fecha
    )
    select distinct on (coalesce(r.num, clave_iccid(r.icc)))
           r.*, null::text as rc_codigo, null::text as sim_slot
      from rep r
     where coalesce(r.num, r.icc) is not null
       and not exists (select 1 from _inv i where i.key = r.num or i.key = clave_iccid(r.icc))
       and (r.num is null or r.num not in (select numero from lineas_no_crear))
     order by coalesce(r.num, clave_iccid(r.icc)), r.ultima_fecha desc;

    -- RC: si la SIM está en un único RC y ese lugar no tiene otra línea en el inventario
    with s as (
        select d.codigo, v.slot, v.num, v.ic
          from dispositivos_ande d
          cross join lateral (values
              ('sim1', nullif(case when upper(trim(coalesce(d.sim1_num, ''))) in ('', 'M2M') then '' else trim(d.sim1_num) end, ''),
                       nullif(clave_iccid(d.sim1_imei), '')),
              ('sim2', nullif(case when upper(trim(coalesce(d.sim2_num, ''))) in ('', 'M2M') then '' else trim(d.sim2_num) end, ''),
                       nullif(clave_iccid(d.sim2_imei), ''))
          ) v(slot, num, ic)
    ), m as (
        select n.linea_key, min(s.codigo) as codigo, min(s.slot) as slot, count(*) as cuantos
          from _nuevas n
          join s on (n.num is not null and s.num = n.num) or (n.icc is not null and s.ic = clave_iccid(n.icc))
         group by n.linea_key
    )
    update _nuevas n set rc_codigo = m.codigo, sim_slot = m.slot
      from m
     where m.linea_key = n.linea_key and m.cuantos = 1
       and not exists (select 1 from lineas        l where l.rc_codigo = m.codigo and l.sim_slot = m.slot)
       and not exists (select 1 from lineas_legado l where l.rc_codigo = m.codigo and l.sim_slot = m.slot);

    insert into lineas (numero, iccid, telefonia, estado, rc_codigo, sim_slot, observacion, creado_por)
    select num, icc, telefonia, 'asignada', rc_codigo, sim_slot,
           'Alta automática: figura en el reporte del ' || to_char(ultima_fecha, 'DD/MM/YYYY'), 'reporte de consumo'
      from _nuevas where not es_legado;
    get diagnostics n_lineas = row_count;

    insert into lineas_legado (numero, iccid, telefonia, estado, rc_codigo, sim_slot, observacion, creado_por)
    select num, icc, telefonia, 'asignada', rc_codigo, sim_slot,
           'Alta automática: figura en el reporte del ' || to_char(ultima_fecha, 'DD/MM/YYYY'), 'reporte de consumo'
      from _nuevas where es_legado;
    get diagnostics n_legado = row_count;

    insert into historial_estados (tipo, referencia, estado_anterior, estado_nuevo, motivo, usuario)
    select 'linea', coalesce(num, icc), 'nueva', 'asignada',
           'Alta automática' || case when es_legado then ' (legado)' else '' end
             || ': figura en el reporte del ' || to_char(ultima_fecha, 'DD/MM/YYYY')
             || coalesce(' · ' || rc_codigo || ' ' || upper(sim_slot), ''), 'sistema'
      from _nuevas;

    return jsonb_build_object('lineas', n_lineas, 'legado', n_legado);
end;
$$;

revoke execute on function crear_lineas_desde_reporte() from public, anon;
grant  execute on function crear_lineas_desde_reporte() to authenticated, service_role;


-- reactivar_por_consumo: ahora solo reactiva RC (no toca las líneas del inventario)
create or replace function reactivar_por_consumo()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    n_rc int := 0;
begin
    drop table if exists _act;
    drop table if exists _des;
    create temp table _act on commit drop as
    select key, max(fecha_consumo) as f
    from (
        select trim(numero) as key, fecha_consumo
          from consumo_sim
         where estado = 'activo' and consumo_mb > 0 and fecha_consumo >= current_date - 7
           and upper(trim(coalesce(numero, ''))) not in ('', 'M2M')
        union all
        select clave_iccid(imei), fecha_consumo
          from consumo_sim
         where estado = 'activo' and consumo_mb > 0 and fecha_consumo >= current_date - 7
           and trim(coalesce(imei, '')) <> ''
    ) x
    group by key;
    create index on _act (key);

    create temp table _des on commit drop as
    select referencia, max(fecha)::date as f
      from historial_estados
     where tipo = 'rc' and estado_nuevo in ('desactivado', 'desactivado_manual')
     group by referencia;

    with cand as (
        select d.id, d.codigo, d.estado as anterior,
               greatest(a1.f, a2.f, a3.f, a4.f) as f
          from dispositivos_ande d
          left join _act a1 on a1.key = trim(d.sim1_num)  and upper(trim(coalesce(d.sim1_num, ''))) <> 'M2M'
          left join _act a2 on a2.key = trim(d.sim2_num)  and upper(trim(coalesce(d.sim2_num, ''))) <> 'M2M'
          left join _act a3 on a3.key = clave_iccid(d.sim1_imei) and trim(coalesce(d.sim1_imei, '')) <> ''
          left join _act a4 on a4.key = clave_iccid(d.sim2_imei) and trim(coalesce(d.sim2_imei, '')) <> ''
         where lower(coalesce(d.estado, '')) in ('desactivado', 'desactivado_manual')
           and coalesce(a1.f, a2.f, a3.f, a4.f) is not null
    ), ok as (
        select c.* from cand c
          left join _des h on h.referencia = c.codigo
         where h.f is null or c.f > h.f
    ), upd as (
        update dispositivos_ande d set estado = 'activo'
          from ok where d.id = ok.id
        returning ok.codigo, ok.anterior, ok.f
    )
    insert into historial_estados (tipo, referencia, estado_anterior, estado_nuevo, motivo, usuario)
    select 'rc', codigo, anterior, 'activo',
           'Reactivado automáticamente: una SIM volvió a consumir (reporte del ' || to_char(f, 'DD/MM/YYYY') || ')', 'sistema'
      from upd;
    get diagnostics n_rc = row_count;

    return jsonb_build_object('rc', n_rc);
end;
$$;


create or replace function refresh_lineas_estado()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    refresh materialized view lineas_estado_mv;
    refresh materialized view lineas_mes_mv;
    begin
        perform crear_lineas_desde_reporte();
    exception when others then
        raise warning 'crear_lineas_desde_reporte falló: %', sqlerrm;
    end;
    begin
        perform reactivar_por_consumo();
    exception when others then
        raise warning 'reactivar_por_consumo falló: %', sqlerrm;
    end;
    begin
        perform actualizar_estados_rc();
    exception when others then
        raise warning 'actualizar_estados_rc falló: %', sqlerrm;
    end;
end;
$$;

notify pgrst, 'reload schema';

-- Prueba (no crea nada si todas las líneas del último reporte ya están en el inventario):
-- select crear_lineas_desde_reporte();
