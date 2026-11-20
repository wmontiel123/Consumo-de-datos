-- ════════════════════════════════════════════════════════════════
-- Marca "activa a mano" de las líneas del inventario (botón Activar)
--
-- activa_manual = cuándo se marcó activa. Mientras no haya un reporte del
-- operador de un día posterior, la columna "Línea" la muestra Activa y cuenta
-- como activa para el estado del RC (actualizar_estados_rc).
-- Desactivar la línea borra la marca.
--
-- Ejecutar en el SQL Editor de Supabase, ANTES de actualizar la función
-- actualizar_estados_rc (scripts/estados_rc_automaticos.sql).
-- ════════════════════════════════════════════════════════════════
alter table lineas        add column if not exists activa_manual timestamptz;
alter table lineas_legado add column if not exists activa_manual timestamptz;

notify pgrst, 'reload schema';
