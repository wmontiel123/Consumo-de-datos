-- ════════════════════════════════════════════════════════════════
-- consumo_consolidado optimizado
--
-- La versión original hace un JOIN dispositivos_ande × consumo_sim con
-- una condición llena de OR y TRIM(), así que Postgres no puede usar los
-- índices y compara cada RC contra todas las filas de consumo_sim.
--
-- Esta versión arma primero la lista de claves (número / IMEI) de cada
-- SIM y cruza por igualdad simple, usando idx_consumo_numero e
-- idx_consumo_imei. Devuelve las mismas columnas con la misma lógica:
--   - slot M2M        → coincide solo por IMEI
--   - slot con número → coincide por número o por IMEI
--   - total_mb cuenta cada fila de consumo una sola vez por dispositivo
--
-- Ejecutar en el SQL Editor de Supabase, PASO POR PASO.
-- ════════════════════════════════════════════════════════════════


-- ── PASO 0: frenar la tarea de cron y el refresh que esté corriendo ──
select cron.unschedule('refresh-consolidado');

select pg_cancel_backend(pid)
from pg_stat_activity
where query ilike '%refresh%consumo_consolidado%'
  and pid <> pg_backend_pid();


-- ── PASO 1: anotar los índices que tiene hoy la vista (para recrearlos) ──
select indexdef from pg_indexes where tablename = 'consumo_consolidado';


-- ── PASO 2: crear la versión nueva al lado de la vieja ──
drop materialized view if exists consumo_consolidado_v2;

create materialized view consumo_consolidado_v2 as
with d as (
    select row_number() over ()                       as dev,   -- el codigo se repite (p.ej. 'Site Survey')
           codigo,
           regional,
           sim1_num, sim1_imei, sim2_num, sim2_imei,
           lower(trim(coalesce(sim1_num,  ''))) = 'm2m' as s1_m2m,
           trim(coalesce(sim1_num,  ''))               as s1_num,
           trim(coalesce(sim1_imei, ''))               as s1_imei,
           lower(trim(coalesce(sim2_num,  ''))) = 'm2m' as s2_m2m,
           trim(coalesce(sim2_num,  ''))               as s2_num,
           trim(coalesce(sim2_imei, ''))               as s2_imei
    from dispositivos_ande
    where codigo is not null
),
claves as (
    -- SIM 1
    select dev, 1 as slot, 'imei'   as tipo, s1_imei as valor from d where s1_m2m and s1_imei <> ''
    union all
    select dev, 1,         'numero',         s1_num           from d where not s1_m2m and s1_num <> ''
    union all
    select dev, 1,         'imei',           s1_imei          from d where not s1_m2m and s1_num <> '' and s1_imei <> ''
    -- SIM 2
    union all
    select dev, 2,         'imei',           s2_imei          from d where s2_m2m and s2_imei <> ''
    union all
    select dev, 2,         'numero',         s2_num           from d where not s2_m2m and s2_num <> ''
    union all
    select dev, 2,         'imei',           s2_imei          from d where not s2_m2m and s2_num <> '' and s2_imei <> ''
),
cruce as (
    select k.dev, k.slot, c.id, c.consumo_mb
    from claves k join consumo_sim c on c.numero = k.valor
    where k.tipo = 'numero'
    union all
    select k.dev, k.slot, c.id, c.consumo_mb
    from claves k join consumo_sim c on c.imei = k.valor
    where k.tipo = 'imei'
),
por_fila as (
    -- una fila de consumo por dispositivo, marcando a qué SIM corresponde
    select dev,
           id,
           max(consumo_mb)    as mb,
           bool_or(slot = 1)  as en_sim1,
           bool_or(slot = 2)  as en_sim2
    from cruce
    group by dev, id
)
select d.codigo                                       as rc,
       coalesce(d.regional, '-')                      as regional,
       case when d.s1_m2m then 'M2M'
            when d.s1_num <> '' then d.s1_num
            else '-' end                              as sim1_label,
       coalesce(sum(case when p.en_sim1 then coalesce(p.mb, 0) else 0 end), 0)::numeric as sim1_mb,
       case when d.s2_m2m then 'M2M'
            when d.s2_num <> '' then d.s2_num
            else '-' end                              as sim2_label,
       coalesce(sum(case when p.en_sim2 then coalesce(p.mb, 0) else 0 end), 0)::numeric as sim2_mb,
       coalesce(sum(coalesce(p.mb, 0)), 0)::numeric   as total_mb
from d
join por_fila p on p.dev = d.dev
-- mismo agrupamiento que la vista original
group by d.codigo, d.regional, d.sim1_num, d.sim1_imei, d.sim2_num, d.sim2_imei,
         d.s1_m2m, d.s1_num, d.s2_m2m, d.s2_num
order by d.codigo;


-- ── PASO 3: revisar que tenga datos ──
select count(*) as rcs, sum(total_mb) as total_mb from consumo_consolidado_v2;
select * from consumo_consolidado_v2 order by total_mb desc limit 10;


-- ── PASO 4: reemplazar la vieja por la nueva ──
begin;
drop materialized view consumo_consolidado;
alter materialized view consumo_consolidado_v2 rename to consumo_consolidado;
grant select on consumo_consolidado to anon, authenticated;
-- rc NO es único (dispositivos_ande repite códigos), por eso índice normal
create index consumo_consolidado_rc_idx       on consumo_consolidado using btree (rc);
create index consumo_consolidado_regional_idx on consumo_consolidado using btree (regional);
create index consumo_consolidado_total_mb_idx on consumo_consolidado using btree (total_mb desc);
commit;


-- ── PASO 5: probar el refresh (debería tardar segundos) ──
select refresh_consumo_consolidado();
