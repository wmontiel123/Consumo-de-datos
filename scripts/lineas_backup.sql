-- Estado de línea "Backup" en el inventario (columna Línea y tarjeta Backup).
-- Una línea marcada backup que no está desactivada se muestra como "Backup".
-- Ejecutar en el SQL Editor de Supabase.
alter table lineas        add column if not exists backup boolean not null default false;
alter table lineas_legado add column if not exists backup boolean not null default false;
notify pgrst, 'reload schema';
