-- ════════════════════════════════════════════════════════════════
-- Volver al login anterior (solo si el login falla después de
-- ejecutar solicitudes_usuarios.sql).
--
-- Restaura la definición de verificar_login que solicitudes_usuarios.sql
-- guardó en respaldo_funciones antes de reemplazarla. No borra las tablas
-- nuevas ni los usuarios: solo devuelve el login a como estaba.
-- Ejecutar TODO junto en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════
do $$
declare
    v_def text;
begin
    select definicion into v_def from respaldo_funciones where nombre = 'verificar_login';
    if v_def is null then
        raise exception 'No hay respaldo de verificar_login en respaldo_funciones';
    end if;
    drop function if exists public.verificar_login(text, text);
    execute v_def;
end $$;

grant execute on function public.verificar_login(text, text) to anon, authenticated;
notify pgrst, 'reload schema';

-- Verificación: debe mostrar la definición restaurada
select pg_get_functiondef('public.verificar_login(text, text)'::regprocedure);
