-- ════════════════════════════════════════════════════════════════
-- Optimización de carga de consumos (app.js)
--
-- Antes la app descargaba TODAS las filas de consumo_sim dos veces al
-- entrar (≈170.000 filas, cientos de requests). Con esto:
--   - consumo_ultimo:      solo la fila más reciente de cada número / IMEI
--                          (para calcular estados de SIM y RC)
--   - consumo_por_linea(): consumo sumado por línea con los filtros de la
--                          pestaña Consumos (para gráficos y vista por RC)
--
-- Ejecutar todo junto en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════

create index if not exists idx_consumo_numero_fecha on consumo_sim (numero, fecha_consumo desc, id desc);
create index if not exists idx_consumo_imei_fecha   on consumo_sim (imei,   fecha_consumo desc, id desc);


-- ── Última fila por número y por IMEI ──
create or replace view consumo_ultimo with (security_invoker = true) as
select c.id, c.numero, c.imei, c.observacion, c.estado_operador,
       c.consumo_mb, c.estado, c.fecha_consumo, c.telefonia
from consumo_sim c
where c.id in (
    select distinct on (numero) id
    from consumo_sim
    where numero is not null and numero <> ''
    order by numero, fecha_consumo desc, id desc
)
or c.id in (
    select distinct on (imei) id
    from consumo_sim
    where imei is not null and imei <> ''
    order by imei, fecha_consumo desc, id desc
);

grant select on consumo_ultimo to anon, authenticated;


-- ── Consumo sumado por línea, con los mismos filtros que la app ──
-- Devuelve un JSON (un solo request, sin el límite de 1000 filas).
create or replace function consumo_por_linea(
    p_telefonia text    default null,
    p_estados   text[]  default null,
    p_desde     date    default null,
    p_hasta     date    default null,
    p_numeros   text[]  default null,
    p_imeis     text[]  default null,
    p_num_like  text    default null,
    p_obs_like  text    default null
) returns json
language sql stable
as $$
    with f as (
        select *
        from consumo_sim c
        where (p_telefonia is null or c.telefonia = p_telefonia)
          and (p_desde     is null or c.fecha_consumo >= p_desde)
          and (p_hasta     is null or c.fecha_consumo <= p_hasta)
          and (p_estados   is null or c.estado = any(p_estados))
          and (p_num_like  is null or c.numero ilike '%' || p_num_like || '%'
                                   or c.imei   ilike '%' || p_num_like || '%')
          and (p_obs_like  is null or c.observacion ilike '%' || p_obs_like || '%')
          and ((p_numeros is null and p_imeis is null)
               or c.numero = any(coalesce(p_numeros, '{}'))
               or c.imei   = any(coalesce(p_imeis,   '{}')))
    ),
    lineas as (
        select numero,
               imei,
               telefonia,
               sum(coalesce(consumo_mb, 0))                                   as consumo_mb,
               max(fecha_consumo)                                             as fecha_consumo,
               (array_agg(estado          order by fecha_consumo desc, id desc))[1] as estado,
               (array_agg(estado_operador order by fecha_consumo desc, id desc))[1] as estado_operador,
               (array_agg(observacion     order by fecha_consumo desc, id desc))[1] as observacion,
               count(*)                                                       as dias
        from f
        group by numero, imei, telefonia
    )
    select coalesce(json_agg(lineas), '[]'::json) from lineas;
$$;

grant execute on function consumo_por_linea(text, text[], date, date, text[], text[], text, text) to anon, authenticated;

notify pgrst, 'reload schema';
