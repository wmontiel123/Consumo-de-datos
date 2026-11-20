-- Marca "línea inactiva": la línea puede estar disponible (o asignada) en el inventario
-- pero la columna Línea la muestra Desactivado (p. ej. SIM en stock sin activar).
-- El botón Activar del inventario la borra.
-- Ejecutar en el SQL Editor de Supabase.
alter table lineas        add column if not exists linea_inactiva boolean not null default false;
alter table lineas_legado add column if not exists linea_inactiva boolean not null default false;
notify pgrst, 'reload schema';
