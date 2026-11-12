-- ════════════════════════════════════════════════════════════════
-- Inventario de líneas ← líneas que aparecen en los reportes de consumo
--
-- sincronizar_lineas_desde_consumos() agrega a "lineas" cada línea de
-- lineas_estado_mv (una fila por línea, con su último ICCID) que todavía
-- no esté en el inventario por número ni por ICCID:
--   - si está puesta en un RC  → asignada (con rc_codigo y sim_slot)
--   - si no                    → disponible
-- No modifica las líneas que ya estaban. Deja un "alta" en historial_estados.
--
-- refresh_lineas_estado() (que corre después de cada importación) la llamaba,
-- así las líneas nuevas de los reportes entraban solas al inventario.
-- ⚠ APAGADO desde el 12/11/2026 (scripts/inventario_sin_sincronizar.sql): el
--   inventario se arma con la planilla "stock y activaciones".
--
-- Ejecutar TODO junto en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════

create or replace function sincronizar_lineas_desde_consumos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_n integer;
begin
    with origen as (
        select
            nullif(case when upper(l.numero) = 'M2M' then 'M2M' else l.numero end, '') as numero,
            nullif(l.imei, '')                                                        as iccid,
            l.telefonia
        from lineas_estado_mv l
    ),
    -- Un mismo ICCID con dos claves (ej. figuró como M2M y luego con número): se queda la del número
    unicos as (
        select distinct on (coalesce(iccid, numero)) *
        from origen
        where numero is not null and upper(numero) <> 'M2M' or iccid is not null
        order by coalesce(iccid, numero), (upper(coalesce(numero, 'M2M')) = 'M2M')
    ),
    -- Solo las que no están en el inventario (comparación directa: usa los índices de lineas)
    nuevas as (
        select u.*
        from unicos u
        where not exists (select 1 from lineas x
                           where u.numero is not null and upper(u.numero) <> 'M2M' and x.numero = u.numero)
          and not exists (select 1 from lineas x
                           where u.iccid is not null and x.iccid = u.iccid)
    ),
    rc as (
        select distinct on (key) key, codigo, slot
        from (
            select trim(sim1_num)  as key, codigo, 'sim1' as slot from dispositivos_ande where upper(trim(coalesce(sim1_num, ''))) not in ('', 'M2M')
            union all
            select trim(sim2_num),          codigo, 'sim2'          from dispositivos_ande where upper(trim(coalesce(sim2_num, ''))) not in ('', 'M2M')
            union all
            select trim(sim1_imei),         codigo, 'sim1'          from dispositivos_ande where trim(coalesce(sim1_imei, '')) <> ''
            union all
            select trim(sim2_imei),         codigo, 'sim2'          from dispositivos_ande where trim(coalesce(sim2_imei, '')) <> ''
        ) d
        order by key, codigo
    ),
    insertadas as (
        insert into lineas (numero, iccid, telefonia, estado, rc_codigo, sim_slot, observacion, creado_por)
        select n.numero, n.iccid, n.telefonia,
               case when r.codigo is not null then 'asignada' else 'disponible' end,
               r.codigo, r.slot,
               'Importada desde los reportes de consumo',
               'sistema'
        from nuevas n
        left join lateral (
            select codigo, slot from rc
             where (n.numero is not null and upper(n.numero) <> 'M2M' and rc.key = n.numero)
                or (n.iccid is not null and rc.key = n.iccid)
             order by (rc.key = n.numero) desc
             limit 1
        ) r on true
        on conflict do nothing
        returning numero, iccid, rc_codigo
    ),
    hist as (
        insert into historial_estados (tipo, referencia, estado_anterior, estado_nuevo, motivo, usuario)
        select 'linea', coalesce(nullif(case when upper(numero) = 'M2M' then null else numero end, ''), iccid),
               null, 'alta',
               'Importada desde los reportes de consumo' || coalesce(' (ya estaba en ' || rc_codigo || ')', ''),
               'sistema'
        from insertadas
        returning 1
    )
    select count(*) into v_n from hist;
    return v_n;
end;
$$;

revoke execute on function sincronizar_lineas_desde_consumos() from public, anon;
grant  execute on function sincronizar_lineas_desde_consumos() to authenticated, service_role;


-- refresh_lineas_estado: además de refrescar, suma al inventario las líneas nuevas
create or replace function refresh_lineas_estado()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    refresh materialized view lineas_estado_mv;
    refresh materialized view lineas_mes_mv;
    perform sincronizar_lineas_desde_consumos();
end;
$$;

-- Carga inicial
select sincronizar_lineas_desde_consumos() as lineas_agregadas;
