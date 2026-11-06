-- ════════════════════════════════════════════════════════════════
-- vista_lineas_estado: una fila por línea M2M
--
-- Antes, las líneas M2M (numero = 'M2M') compartían la clave 'M2M':
-- quedaban todas en UNA sola fila (con la suma de todas y un ICCID al
-- azar) y se cruzaban con cualquier RC que tuviera 'M2M' en el número.
-- Ahora 'M2M' se trata como "sin número" → la clave es el ICCID.
-- El resto (consumo del mes, total, estado, RC) se calcula igual que antes.
--
-- Ejecutar en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════

create or replace view vista_lineas_estado as
with base as (
    select
        case
            when upper(trim(coalesce(c.numero, ''))) not in ('', 'M2M') then trim(c.numero)
            when trim(coalesce(c.imei, '')) <> '' then trim(c.imei)
            else null
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
    select distinct on (base.linea_key)
        base.linea_key, base.numero, base.imei, base.telefonia,
        base.estado_operador, base.observacion,
        base.fecha_consumo as ultima_fecha
    from base
    order by base.linea_key, base.fecha_consumo desc nulls last
), cm as (
    select base.linea_key, sum(base.consumo_mb) as consumo_mes_mb
    from base
    where base.fecha_consumo >= date_trunc('month', current_date::timestamptz)
    group by base.linea_key
), ct as (
    select base.linea_key, sum(base.consumo_mb) as consumo_total_mb
    from base
    group by base.linea_key
), disp as (
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
    ue.numero,
    ue.imei,
    ue.telefonia,
    ue.estado_operador,
    ue.observacion,
    ue.ultima_fecha,
    coalesce(disp.rc, '')               as rc,
    coalesce(disp.regional, '')         as regional,
    coalesce(cm.consumo_mes_mb, 0)      as consumo_mes_mb,
    coalesce(ct.consumo_total_mb, 0)    as consumo_total_mb
from ue
left join cm   on cm.linea_key   = ue.linea_key
left join ct   on ct.linea_key   = ue.linea_key
left join disp on disp.key       = ue.linea_key;

notify pgrst, 'reload schema';
