-- Fecha en que se hizo el cambio de SIM en campo (puede ser distinta de la
-- fecha en que se registró en el sistema, que es fecha_cambio).
-- Ejecutar en el SQL Editor de Supabase.

alter table historial_sim add column if not exists fecha_campo date;

notify pgrst, 'reload schema';
