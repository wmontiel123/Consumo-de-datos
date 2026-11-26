-- ════════════════════════════════════════════════════════════════
-- Disponible en la vista Líneas (para poder ordenar por esa columna)
--
-- lineas_plan_mv guarda el ÚLTIMO plan disponible registrado de cada línea
-- (sin límite de fecha; misma clave de línea que lineas_estado_mv: número,
-- o ICCID si es M2M). vista_lineas_estado suma dos columnas al final:
--   plan_disponible_mb, plan_fecha
-- y refresh_lineas_estado() refresca también esta vista materializada.
--
-- Ejecutar TODO junto en el SQL Editor de Supabase (se puede repetir).
-- ════════════════════════════════════════════════════════════════

-- ── 1. Último disponible por línea ───────────────────────────────
create materialized view if not exists lineas_plan_mv as
select distinct on (linea_key)
    linea_key,
    plan_disponible_mb,
    fecha_consumo as plan_fecha
from (
    select
        case
            when upper(trim(coalesce(c.numero, ''))) not in ('', 'M2M') then trim(c.numero)
            else trim(c.imei)
        end as linea_key,
        c.plan_disponible_mb,
        c.fecha_consumo,
        c.id
    from consumo_sim c
    where c.plan_disponible_mb is not null
      and (upper(trim(coalesce(c.numero, ''))) not in ('', 'M2M') or trim(coalesce(c.imei, '')) <> '')
) b
order by linea_key, fecha_consumo desc nulls last, id desc;

create unique index if not exists lineas_plan_mv_key on lineas_plan_mv (linea_key);
refresh materialized view lineas_plan_mv;
grant select on lineas_plan_mv to authenticated;


-- ── 2. La vista de la app (mismas columnas + 2 nuevas al final) ──
create or replace view vista_lineas_estado as
with disp as (
    select distinct on (d.key) d.key, d.codigo as rc, d.regional
    from (
        select trim(sim1_num)  as key, codigo, regional from dispositivos_ande
         where upper(trim(coalesce(sim1_num, ''))) not in ('', 'M2M')
        union all
        select trim(sim2_num),  codigo, regional from dispositivos_ande
         where upper(trim(coalesce(sim2_num, ''))) not in ('', 'M2M')
        union all
        select trim(sim1_imei), codigo, regional from dispositivos_ande
         where trim(coalesce(sim1_imei, '')) <> ''
        union all
        select trim(sim2_imei), codigo, regional from dispositivos_ande
         where trim(coalesce(sim2_imei, '')) <> ''
    ) d
    where d.key is not null and d.key <> ''
    order by d.key
)
select
    l.numero,
    l.imei,
    l.telefonia,
    l.estado_operador,
    l.observacion,
    l.ultima_fecha,
    nullif(coalesce(disp.rc, ''), '')       as rc,        -- null (no '') sin RC: al ordenar queda al final
    nullif(coalesce(disp.regional, ''), '') as regional,
    coalesce(m.mb, 0)           as consumo_mes_mb,
    l.consumo_total_mb,
    p.plan_disponible_mb,
    p.plan_fecha
from lineas_estado_mv l
left join lineas_mes_mv m
       on m.linea_key = l.linea_key
      and m.mes = date_trunc('month', current_date)::date
left join disp on disp.key = l.linea_key
left join lineas_plan_mv p on p.linea_key = l.linea_key;


-- ── 3. Refresco: igual que en saldo_lineas.sql + lineas_plan_mv ──
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
        refresh materialized view lineas_plan_mv;   -- Disponible de la vista Líneas
    exception when others then
        raise warning 'lineas_plan_mv falló: %', sqlerrm;
    end;
    begin
        perform crear_lineas_desde_reporte();
    exception when others then
        raise warning 'crear_lineas_desde_reporte falló: %', sqlerrm;
    end;
    begin
        perform actualizar_saldos_lineas();
    exception when others then
        raise warning 'actualizar_saldos_lineas falló: %', sqlerrm;
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
