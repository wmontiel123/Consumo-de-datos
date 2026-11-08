-- Definición de verificar_login vigente al 2026-11-08, antes de solicitudes_usuarios.sql.
-- Copia de respaldo local (revertir_login.sql usa la que queda guardada en la base).
drop function if exists public.verificar_login(text, text);
CREATE OR REPLACE FUNCTION public.verificar_login(p_usuario text, p_password text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_rol TEXT;
BEGIN
    SELECT rol INTO v_rol
    FROM usuarios_app
    WHERE usuario      = lower(trim(p_usuario))
      AND password_hash = extensions.crypt(p_password, password_hash)
      AND activo        = true;
    RETURN v_rol;
END;
$function$;
grant execute on function public.verificar_login(text, text) to anon, authenticated;
notify pgrst, 'reload schema';
