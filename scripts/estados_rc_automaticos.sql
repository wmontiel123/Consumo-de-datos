-- ════════════════════════════════════════════════════════════════
-- Estados de los RC calculados en la base, después de cada importación
--
-- Estado de cada SIM del RC (igual que la app):
--   activo (manual) la línea se marcó activa a mano en el inventario y no hay un
--                reporte de un día posterior a la marca
--   nulo         sin número ni ICCID
--   inactivo     la línea está desactivada en el inventario (líneas o legado),
--                o el último reporte la da como desactivada
--   activo       el último reporte tiene consumo; o es una línea asignada de una
--                telefonía que no manda reportes (ej. VOX)
--   sin_consumo  el último reporte la trae con 0 MB
--   no_asignado  no aparece en ningún reporte (cuenta como desactivada)
--
-- Estado del RC:
--   activo       si al menos una SIM está activa (con consumo)
--   sin_consumo  si alguna SIM está sin consumo (y ninguna activa)
--   desactivado  si las dos están desactivadas, vacías o sin reporte
--
-- No toca los RC "desactivado_manual" (desactivados a mano desde el panel):
-- esos solo vuelven a activo con reactivar_por_consumo() cuando una SIM consume
-- después de la desactivación.
-- Cada cambio de estado del RC queda en historial_estados con usuario 'sistema'.
--
-- Corre sola dentro de refresh_lineas_estado() (cargador diario de reportes).
-- A mano:
--   select actualizar_estados_rc(true);   -- simulación: cuenta, no cambia nada
--   select actualizar_estados_rc();       -- aplica
-- Ejecutar todo junto en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════

create or replace function actualizar_estados_rc(simular boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_resumen jsonb;
begin
    drop table if exists _est;
    drop table if exists _desinv;
    drop table if exists _sinrep;
    drop table if exists _rc_calc;
    drop table if exists _man;

    -- Estado actual de cada línea según su último reporte (consumo_sim.estado lo
    -- mantiene la importación: activo / sin_consumo / desactivado). Clave por
    -- número (si no es M2M) y por ICCID (comparado sin el dígito verificador).
    create temp table _est on commit drop as
    with ult as (
        select m.numero, m.imei, m.ultima_fecha, c.estado
          from lineas_estado_mv m
          join consumo_sim c on c.numero = m.numero and c.fecha_consumo = m.ultima_fecha
         where upper(m.numero) not in ('', 'M2M')
        union all
        select m.numero, m.imei, m.ultima_fecha, c.estado
          from lineas_estado_mv m
          join consumo_sim c on c.imei = m.imei and c.fecha_consumo = m.ultima_fecha
         where upper(m.numero) in ('', 'M2M') and m.imei <> ''
    ), claves as (
        select numero as key, ultima_fecha, estado from ult where upper(numero) not in ('', 'M2M')
        union all
        select clave_iccid(imei), ultima_fecha, estado from ult where imei <> ''
    )
    select distinct on (key) key, lower(coalesce(estado, '')) as estado, ultima_fecha as fecha
      from claves
     order by key, ultima_fecha desc nulls last;
    create index on _est (key);

    -- Líneas desactivadas en el inventario (normal y legado)
    create temp table _desinv on commit drop as
    select distinct key from (
        select trim(numero) as key from lineas        where estado = 'desactivada' and upper(trim(coalesce(numero, ''))) not in ('', 'M2M')
        union all select clave_iccid(iccid) from lineas        where estado = 'desactivada' and trim(coalesce(iccid, '')) <> ''
        union all select trim(numero)       from lineas_legado where estado = 'desactivada' and upper(trim(coalesce(numero, ''))) not in ('', 'M2M')
        union all select clave_iccid(iccid) from lineas_legado where estado = 'desactivada' and trim(coalesce(iccid, '')) <> ''
    ) x;

    -- Líneas asignadas de telefonías que no mandan reportes (cuentan como activas)
    create temp table _sinrep on commit drop as
    with tel as (select distinct lower(trim(telefonia)) t from lineas_estado_mv where telefonia is not null),
    l as (
        select numero, iccid, telefonia from lineas        where estado = 'asignada'
        union all
        select numero, iccid, telefonia from lineas_legado where estado = 'asignada'
    )
    select distinct key from (
        select trim(numero) as key from l
         where upper(trim(coalesce(numero, ''))) not in ('', 'M2M') and lower(trim(coalesce(telefonia, ''))) not in (select t from tel)
        union all
        select clave_iccid(iccid) from l
         where trim(coalesce(iccid, '')) <> '' and lower(trim(coalesce(telefonia, ''))) not in (select t from tel)
    ) x;

    -- Líneas marcadas activas a mano (botón Activar del inventario): cuentan como
    -- activas mientras no haya un reporte de un día posterior a la marca
    create temp table _man on commit drop as
    select key, max(f) as f from (
        select trim(numero) as key, activa_manual::date as f from lineas        where activa_manual is not null and estado <> 'desactivada' and upper(trim(coalesce(numero, ''))) not in ('', 'M2M')
        union all select clave_iccid(iccid), activa_manual::date from lineas        where activa_manual is not null and estado <> 'desactivada' and trim(coalesce(iccid, '')) <> ''
        union all select trim(numero),       activa_manual::date from lineas_legado where activa_manual is not null and estado <> 'desactivada' and upper(trim(coalesce(numero, ''))) not in ('', 'M2M')
        union all select clave_iccid(iccid), activa_manual::date from lineas_legado where activa_manual is not null and estado <> 'desactivada' and trim(coalesce(iccid, '')) <> ''
    ) x group by key;
    create index on _man (key);

    -- Estado calculado de cada SIM y del RC
    create temp table _rc_calc on commit drop as
    with s as (
        select d.id, d.codigo, d.estado, d.sim1_estado, d.sim2_estado, v.slot, v.num, v.ic
          from dispositivos_ande d
          cross join lateral (values
              ('sim1', nullif(case when upper(trim(coalesce(d.sim1_num, ''))) in ('', 'M2M') then '' else trim(d.sim1_num) end, ''),
                       nullif(clave_iccid(d.sim1_imei), '')),
              ('sim2', nullif(case when upper(trim(coalesce(d.sim2_num, ''))) in ('', 'M2M') then '' else trim(d.sim2_num) end, ''),
                       nullif(clave_iccid(d.sim2_imei), ''))
          ) v(slot, num, ic)
         where d.codigo is not null
    ), e as (
        select s.*,
               case
                   when s.num is null and s.ic is null                                    then 'nulo'
                   when exists (select 1 from _desinv x where x.key in (s.num, s.ic))     then 'inactivo'
                   when exists (select 1 from _man m where m.key in (s.num, s.ic)
                                  and coalesce(greatest(en.fecha, ei.fecha), '-infinity'::date) <= m.f) then 'activo'
                   when en.estado is null and ei.estado is null then
                        case when exists (select 1 from _sinrep x where x.key in (s.num, s.ic)) then 'activo' else 'no_asignado' end
                   when en.estado = 'desactivado' or ei.estado = 'desactivado'            then 'inactivo'
                   when en.estado = 'activo'      or ei.estado = 'activo'                 then 'activo'
                   else 'sin_consumo'
               end as se
          from s
          left join _est en on en.key = s.num
          left join _est ei on ei.key = s.ic
    ), r as (
        -- Por FILA (id), no por código: hay RC con el mismo código cargados dos veces
        select id,
               max(codigo)      as codigo,
               max(estado)      as estado_ant,
               max(sim1_estado) as s1_ant,
               max(sim2_estado) as s2_ant,
               max(se) filter (where slot = 'sim1') as s1,
               max(se) filter (where slot = 'sim2') as s2
          from e group by id
    )
    select r.*,
           case
               when 'activo' in (s1, s2)       then 'activo'
               when 'sin_consumo' in (s1, s2)  then 'sin_consumo'
               else 'desactivado'
           end as estado_nuevo
      from r
     where lower(coalesce(estado_ant, '')) <> 'desactivado_manual';

    select jsonb_build_object(
               'rc_revisados', count(*),
               'cambian_estado', count(*) filter (where estado_ant is distinct from estado_nuevo),
               'cambios', coalesce((select jsonb_object_agg(k, n) from (
                   select coalesce(estado_ant, '(vacío)') || ' → ' || estado_nuevo as k, count(*) as n
                     from _rc_calc where estado_ant is distinct from estado_nuevo group by 1) z), '{}'::jsonb),
               'solo_sims', count(*) filter (where estado_ant is not distinct from estado_nuevo
                                               and (s1_ant is distinct from s1 or s2_ant is distinct from s2)),
               'simulacion', simular)
      into v_resumen
      from _rc_calc;

    if simular then
        return v_resumen;
    end if;

    insert into historial_estados (tipo, referencia, estado_anterior, estado_nuevo, motivo, usuario)
    select 'rc', codigo, estado_ant, estado_nuevo,
           'Actualizado automáticamente según sus SIM (SIM 1: ' || s1 || ', SIM 2: ' || s2 || ')', 'sistema'
      from _rc_calc
     where estado_ant is distinct from estado_nuevo;

    update dispositivos_ande d
       set estado = c.estado_nuevo, sim1_estado = c.s1, sim2_estado = c.s2
      from _rc_calc c
     where d.id = c.id
       and (c.estado_ant is distinct from c.estado_nuevo or c.s1_ant is distinct from c.s1 or c.s2_ant is distinct from c.s2);

    return v_resumen;
end;
$$;

revoke execute on function actualizar_estados_rc(boolean) from public, anon;
grant  execute on function actualizar_estados_rc(boolean) to authenticated, service_role;


-- refresh_lineas_estado: refresca las vistas, reactiva por consumo y recalcula
-- el estado de los RC. Si algo falla, el refresco igual queda hecho.
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
