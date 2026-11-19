-- ════════════════════════════════════════════════════════════════
-- Reactivación automática por consumo
--
-- Cuando una SIM vuelve a figurar ACTIVA (con MB > 0) en el último reporte
-- del operador, y ese consumo es de un día posterior a su desactivación:
--   - la línea del inventario (lineas o lineas_legado) pasa de 'desactivada'
--     a 'asignada' (aunque no tenga RC: está en uso);
--   - el RC que la usa pasa de 'desactivado' / 'desactivado_manual' a 'activo'
--     (la app recalcula después el estado de cada SIM del RC).
-- Además, una línea 'disponible' sin RC que tiene consumo pasa a 'asignada'
-- (en la app se ve con la etiqueta "Sin RC asignado").
-- Cada cambio queda en historial_estados con usuario 'sistema'.
--
-- Corre sola dentro de refresh_lineas_estado(), que llama el cargador diario
-- de reportes después de cada importación (no hace falta reinstalarlo).
-- Para correrla a mano:   select reactivar_por_consumo();
-- Ejecutar todo junto en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════

create or replace function reactivar_por_consumo()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    n_lineas int := 0;
    n_legado int := 0;
    n_rc     int := 0;
    n_sin_rc int := 0;
    k        int := 0;
begin
    -- Líneas activas hoy: consumo > 0 y estado 'activo' (lo pone la importación
    -- solo a las que tienen consumo en su último reporte). Se miran 7 días para
    -- no recorrer toda la tabla; clave = número (si no es M2M) o ICCID.
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
        select trim(imei), fecha_consumo
          from consumo_sim
         where estado = 'activo' and consumo_mb > 0 and fecha_consumo >= current_date - 7
           and trim(coalesce(imei, '')) <> ''
    ) x
    group by key;
    create index on _act (key);

    -- Última desactivación registrada de cada línea / RC
    create temp table _des on commit drop as
    select tipo, referencia, max(fecha)::date as f
      from historial_estados
     where estado_nuevo in ('desactivada', 'desactivado', 'desactivado_manual')
     group by tipo, referencia;
    create index on _des (tipo, referencia);

    -- ── Líneas (inventario normal y legado) ──
    for i in 1..2 loop
        execute format($f$
            with cand as (
                select l.id,
                       coalesce(nullif(case when lower(trim(coalesce(l.numero, ''))) = 'm2m' then '' else trim(coalesce(l.numero, '')) end, ''),
                                trim(l.iccid))                           as ref,
                       greatest(an.f, ai.f)                              as f,
                       'asignada'::text                                  as nuevo
                  from %1$I l
                  left join _act an on an.key = trim(l.numero) and lower(trim(coalesce(l.numero, ''))) <> 'm2m'
                  left join _act ai on ai.key = trim(l.iccid)
                 where l.estado = 'desactivada'
                   and (an.key is not null or ai.key is not null)
            ), ok as (
                select c.* from cand c
                  left join _des d on d.tipo = 'linea' and d.referencia = c.ref
                  join %1$I l on l.id = c.id
                 where c.f > coalesce(d.f, l.creado_en::date)
            ), upd as (
                update %1$I l set estado = ok.nuevo
                  from ok where l.id = ok.id
                returning ok.ref, ok.nuevo, ok.f
            )
            insert into historial_estados (tipo, referencia, estado_anterior, estado_nuevo, motivo, usuario)
            select 'linea', ref, 'desactivada', nuevo,
                   'Reactivada automáticamente%2$s: consumo en el reporte del ' || to_char(f, 'DD/MM/YYYY'), 'sistema'
              from upd
        $f$, case i when 1 then 'lineas' else 'lineas_legado' end,
             case i when 1 then '' else ' (legado)' end);
        if i = 1 then get diagnostics n_lineas = row_count;
        else          get diagnostics n_legado = row_count; end if;
    end loop;

    -- ── Líneas disponibles sin RC que tienen consumo: están en uso → asignada ──
    for i in 1..2 loop
        execute format($f$
            with ok as (
                select l.id,
                       coalesce(nullif(case when lower(trim(coalesce(l.numero, ''))) = 'm2m' then '' else trim(coalesce(l.numero, '')) end, ''),
                                trim(l.iccid))  as ref,
                       greatest(an.f, ai.f)     as f
                  from %1$I l
                  left join _act an on an.key = trim(l.numero) and lower(trim(coalesce(l.numero, ''))) <> 'm2m'
                  left join _act ai on ai.key = trim(l.iccid)
                 where l.estado = 'disponible'
                   and coalesce(trim(l.rc_codigo), '') = ''
                   and (an.key is not null or ai.key is not null)
            ), upd as (
                update %1$I l set estado = 'asignada'
                  from ok where l.id = ok.id
                returning ok.ref, ok.f
            )
            insert into historial_estados (tipo, referencia, estado_anterior, estado_nuevo, motivo, usuario)
            select 'linea', ref, 'disponible', 'asignada',
                   'En uso sin RC asignado%2$s: consumo en el reporte del ' || to_char(f, 'DD/MM/YYYY'), 'sistema'
              from upd
        $f$, case i when 1 then 'lineas' else 'lineas_legado' end,
             case i when 1 then '' else ' (legado)' end);
        get diagnostics k = row_count;
        n_sin_rc := n_sin_rc + k;
    end loop;

    -- ── RC desactivados con alguna SIM que volvió a consumir ──
    with cand as (
        select d.codigo, d.estado as anterior,
               greatest(a1.f, a2.f, a3.f, a4.f) as f
          from dispositivos_ande d
          left join _act a1 on a1.key = trim(d.sim1_num)  and upper(trim(coalesce(d.sim1_num, ''))) <> 'M2M'
          left join _act a2 on a2.key = trim(d.sim2_num)  and upper(trim(coalesce(d.sim2_num, ''))) <> 'M2M'
          left join _act a3 on a3.key = trim(d.sim1_imei)
          left join _act a4 on a4.key = trim(d.sim2_imei)
         where lower(coalesce(d.estado, '')) in ('desactivado', 'desactivado_manual')
           and coalesce(a1.f, a2.f, a3.f, a4.f) is not null
    ), ok as (
        select c.* from cand c
          left join _des h on h.tipo = 'rc' and h.referencia = c.codigo
         where h.f is null or c.f > h.f
    ), upd as (
        update dispositivos_ande d set estado = 'activo'
          from ok where d.codigo = ok.codigo
        returning ok.codigo, ok.anterior, ok.f
    )
    insert into historial_estados (tipo, referencia, estado_anterior, estado_nuevo, motivo, usuario)
    select 'rc', codigo, anterior, 'activo',
           'Reactivado automáticamente: una SIM volvió a consumir (reporte del ' || to_char(f, 'DD/MM/YYYY') || ')', 'sistema'
      from upd;
    get diagnostics n_rc = row_count;

    return jsonb_build_object('lineas', n_lineas, 'legado', n_legado, 'sin_rc', n_sin_rc, 'rc', n_rc);
end;
$$;

revoke execute on function reactivar_por_consumo() from public, anon;
grant  execute on function reactivar_por_consumo() to authenticated, service_role;


-- refresh_lineas_estado: refresca las vistas y después reactiva por consumo.
-- Si la reactivación falla, el refresco igual queda hecho.
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
end;
$$;

notify pgrst, 'reload schema';
