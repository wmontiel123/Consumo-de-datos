-- ════════════════════════════════════════════════════════════════
-- Apaga la sincronización automática del inventario de líneas.
--
-- Desde el 12/11/2026 el inventario se arma con la planilla "stock y
-- activaciones" (activadas = asignada, stock = disponible) y no con los
-- reportes de consumo. refresh_lineas_estado() vuelve a solo refrescar las
-- vistas; sincronizar_lineas_desde_consumos() queda disponible para correrla
-- a mano si algún día hace falta:  select sincronizar_lineas_desde_consumos();
--
-- Para volver a encenderla: ejecutar de nuevo scripts/lineas_desde_consumos.sql
-- (sin la "Carga inicial" del final).
-- ════════════════════════════════════════════════════════════════
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
