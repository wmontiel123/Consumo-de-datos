-- ════════════════════════════════════════════════════════════════
-- vista_lineas_estado rápida (pre-calculada)
--
-- La vista recalculaba en cada consulta los totales sobre TODO consumo_sim
-- (~235.000 filas): tardaba ~3 s y con filtros (ej. Telefonía = Tigo)
-- superaba el límite de 3 s de la app → error 500.
--
-- Ahora lo pesado se guarda en dos vistas materializadas que se refrescan
-- después de cada importación:
--   lineas_estado_mv : última fila de cada línea + consumo total
--   lineas_mes_mv    : consumo de cada línea por mes
-- vista_lineas_estado conserva las MISMAS columnas (la app no cambia);
-- el cruce con el RC sigue en vivo y "MB Mes" se calcula para el mes actual.
-- Mantiene la corrección M2M: cada línea M2M es una fila (clave = ICCID).
--
-- Ejecutar TODO junto en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════

-- ── 1. Vistas materializadas ─────────────────────────────────────
drop materialized view if exists lineas_estado_mv;
drop materialized view if exists lineas_mes_mv;

create materialized view lineas_estado_mv as
with base as (
    select
        case
            when upper(trim(coalesce(c.numero, ''))) not in ('', 'M2M') then trim(c.numero)
            else trim(c.imei)
        end                                   as linea_key,
        trim(coalesce(c.numero, ''))          as numero,
        trim(coalesce(c.imei, ''))            as imei,
        c.telefonia,
        trim(coalesce(c.estado_operador, '')) as estado_operador,
        c.observacion,
        c.fecha_consumo,
        c.consumo_mb
    from consumo_sim c
    where upper(trim(coalesce(c.numero, ''))) not in ('', 'M2M')
       or trim(coalesce(c.imei, '')) <> ''
), ue as (
    select distinct on (linea_key)
        linea_key, numero, imei, telefonia, estado_operador, observacion,
        fecha_consumo as ultima_fecha
    from base
    order by linea_key, fecha_consumo desc nulls last
), ct as (
    select linea_key, sum(consumo_mb) as consumo_total_mb
    from base
    group by linea_key
)
select ue.*, coalesce(ct.consumo_total_mb, 0) as consumo_total_mb
from ue
left join ct on ct.linea_key = ue.linea_key;

create unique index lineas_estado_mv_key on lineas_estado_mv (linea_key);
create index lineas_estado_mv_numero    on lineas_estado_mv (numero);
create index lineas_estado_mv_telefonia on lineas_estado_mv (telefonia);

create materialized view lineas_mes_mv as
select
    case
        when upper(trim(coalesce(c.numero, ''))) not in ('', 'M2M') then trim(c.numero)
        else trim(c.imei)
    end                                         as linea_key,
    date_trunc('month', c.fecha_consumo)::date  as mes,
    sum(c.consumo_mb)                           as mb
from consumo_sim c
where upper(trim(coalesce(c.numero, ''))) not in ('', 'M2M')
   or trim(coalesce(c.imei, '')) <> ''
group by 1, 2;

create unique index lineas_mes_mv_key on lineas_mes_mv (linea_key, mes);

grant select on lineas_estado_mv, lineas_mes_mv to anon, authenticated;


-- ── 2. La vista que usa la app (mismas columnas que antes) ───────
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
    coalesce(disp.rc, '')       as rc,
    coalesce(disp.regional, '') as regional,
    coalesce(m.mb, 0)           as consumo_mes_mb,
    l.consumo_total_mb
from lineas_estado_mv l
left join lineas_mes_mv m
       on m.linea_key = l.linea_key
      and m.mes = date_trunc('month', current_date)::date
left join disp on disp.key = l.linea_key;


-- ── 3. Refresco (lo llaman el script de importación y la app) ────
create or replace function refresh_lineas_estado()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    refresh materialized view lineas_estado_mv;
    refresh materialized view lineas_mes_mv;
end;
$$;

grant execute on function refresh_lineas_estado() to anon, authenticated;

notify pgrst, 'reload schema';


-- ── 4. (Opcional) Refresco automático cada 30 min con pg_cron ────
-- Solo si la extensión pg_cron está activada (Database → Extensions).
-- Si da error porque no existe "cron", ignoralo: todo lo anterior ya quedó aplicado.
select cron.schedule('refresh-lineas-estado', '*/30 * * * *', $$select refresh_lineas_estado()$$);
