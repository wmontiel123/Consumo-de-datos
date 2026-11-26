-- ════════════════════════════════════════════════════════════════
-- Saldo disponible ("plan disponible", en MB) de cada línea.
--
-- Los reportes de consumo traen una 7ª columna con el plan disponible de la línea:
--   numero, iccid, estado, consumo_mb, fecha, observacion, plan_disponible
-- 1. Cada fila del reporte lo guarda en consumo_sim.plan_disponible_mb (historial).
-- 2. Después de cada carga (y cada 30 min por pg_cron) refresh_lineas_estado() llama a
--    actualizar_saldos_lineas(), que copia el valor del reporte MÁS NUEVO de cada línea a
--    lineas.saldo_mb / saldo_fecha (y lo mismo en lineas_legado), sin límite de fecha. Se busca por número y
--    por ICCID (sin el dígito verificador, como en el resto del inventario).
--    Una línea que no vuelve a figurar en un reporte conserva su último saldo y su fecha.
--
-- Ejecutar todo junto en el SQL Editor de Supabase ANTES de instalar el cargador nuevo.
-- ════════════════════════════════════════════════════════════════

alter table consumo_sim   add column if not exists plan_disponible_mb numeric;
alter table lineas        add column if not exists saldo_mb    numeric;
alter table lineas        add column if not exists saldo_fecha date;
alter table lineas_legado add column if not exists saldo_mb    numeric;
alter table lineas_legado add column if not exists saldo_fecha date;

-- Solo las filas que traen saldo (las de antes de este cambio no lo tienen)
create index if not exists consumo_sim_plan_fecha
    on consumo_sim (fecha_consumo) where plan_disponible_mb is not null;


create or replace function actualizar_saldos_lineas()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    n_lineas int := 0;
    n_legado int := 0;
    n int;
begin
    drop table if exists _saldo;

    -- Último saldo informado por línea (sin límite de fecha), por número y por ICCID
    create temp table _saldo on commit drop as
    select distinct on (key) key, plan, f
      from (
        select trim(numero) as key, plan_disponible_mb as plan, fecha_consumo as f, id
          from consumo_sim
         where plan_disponible_mb is not null
           and upper(trim(coalesce(numero, ''))) not in ('', 'M2M')
        union all
        select clave_iccid(imei), plan_disponible_mb, fecha_consumo, id
          from consumo_sim
         where plan_disponible_mb is not null
           and trim(coalesce(imei, '')) <> ''
      ) x
     order by key, f desc, id desc;
    create index on _saldo (key);

    -- Por número (si el reporte es igual o más nuevo que el saldo que ya tiene)
    update lineas l set saldo_mb = s.plan, saldo_fecha = s.f
      from _saldo s
     where s.key = trim(l.numero) and upper(trim(coalesce(l.numero, ''))) not in ('', 'M2M')
       and (l.saldo_fecha is null or s.f > l.saldo_fecha
            or (s.f = l.saldo_fecha and l.saldo_mb is distinct from s.plan));
    get diagnostics n = row_count; n_lineas := n_lineas + n;
    -- Por ICCID (M2M o líneas sin número): solo si es más nuevo, para no pisar lo anterior
    update lineas l set saldo_mb = s.plan, saldo_fecha = s.f
      from _saldo s
     where s.key = clave_iccid(l.iccid) and trim(coalesce(l.iccid, '')) <> ''
       and (l.saldo_fecha is null or s.f > l.saldo_fecha);
    get diagnostics n = row_count; n_lineas := n_lineas + n;

    update lineas_legado l set saldo_mb = s.plan, saldo_fecha = s.f
      from _saldo s
     where s.key = trim(l.numero) and upper(trim(coalesce(l.numero, ''))) not in ('', 'M2M')
       and (l.saldo_fecha is null or s.f > l.saldo_fecha
            or (s.f = l.saldo_fecha and l.saldo_mb is distinct from s.plan));
    get diagnostics n = row_count; n_legado := n_legado + n;
    update lineas_legado l set saldo_mb = s.plan, saldo_fecha = s.f
      from _saldo s
     where s.key = clave_iccid(l.iccid) and trim(coalesce(l.iccid, '')) <> ''
       and (l.saldo_fecha is null or s.f > l.saldo_fecha);
    get diagnostics n = row_count; n_legado := n_legado + n;

    return jsonb_build_object('lineas', n_lineas, 'legado', n_legado);
end;
$$;

revoke execute on function actualizar_saldos_lineas() from public, anon;
grant  execute on function actualizar_saldos_lineas() to authenticated, service_role;


-- Igual que en altas_desde_reporte.sql, más el paso de saldos (después de crear las
-- líneas nuevas, así también reciben su saldo)
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

-- Prueba (devuelve cuántas líneas actualizó; 0 hasta que se cargue un reporte con saldo):
-- select actualizar_saldos_lineas();
