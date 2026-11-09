# Alta de usuarios con aprobación — controles de seguridad (ISO/IEC 27034)

## Flujo

1. **Solicitud** — En el login, "Solicitar acceso": nombre, correo, usuario deseado y motivo.
2. **Aviso a los aprobadores** — La Edge Function `solicitud-usuario` guarda la solicitud y envía un mail a
   `soporte@inovasi.com.py` y `wmontiel@inovasi.com.py`, con botones *Aprobar como Viewer*, *Aprobar como Admin* y *Rechazar*.
3. **Aprobación** — El botón abre `cuenta.html`, que pide confirmar. El primero que confirma resuelve la solicitud:
   el enlace del otro aprobador queda sin efecto y ambos reciben un aviso de cómo se resolvió.
4. **Activación** — Si se aprueba, el usuario se crea **inactivo y sin contraseña**. El solicitante recibe un enlace
   (48 h) para crear su contraseña. Recién ahí puede ingresar.

## Controles aplicados

| Control | Implementación |
|---|---|
| Aprobación por responsables (segregación de funciones) | Nadie se crea a sí mismo un usuario: lo aprueba soporte. Queda registrado **quién** aprobó (`usuarios_app.aprobado_por`). |
| Mínimo privilegio | El rol lo decide el aprobador. Para *Admin* se pide una confirmación extra. |
| Contraseña solo conocida por el usuario | Nadie la ve ni la escribe por él. Se guarda con bcrypt (costo 12), nunca en texto. |
| Política de contraseñas | 12–128 caracteres, con letra, número y símbolo. No puede contener el usuario. Se valida en la página, en la Edge Function y en la base. |
| Enlaces seguros | Token aleatorio de 256 bits, de **un solo uso** y con vencimiento (72 h aprobación / 48 h activación). En la base solo se guarda su SHA-256. |
| Protección del enlace | El token va en el fragmento `#` (no llega a logs de servidores) y se borra de la barra de direcciones al abrir la página. `cuenta.html` no envía *referrer*. |
| Protección contra escáneres de correo | Abrir el enlace no aprueba nada: hay que confirmar con un clic. |
| Datos sensibles fuera del cliente | Las tablas de solicitudes, tokens, auditoría e intentos de login no son accesibles con la clave pública (RLS sin políticas). Solo la Edge Function (service_role) ejecuta las funciones. La contraseña SMTP vive solo como secreto de la función. |
| Validación de entradas | Formato y largo de cada campo en la página, en la Edge Function y con `check` en la base. Los datos se escapan en los mails y en la página (sin inyección de HTML). |
| Anti-abuso del formulario público | Campo trampa para bots. Máximo 3 solicitudes por IP por hora, 30 por día en total y 1 pendiente por correo. |
| Bloqueo por intentos fallidos | 5 intentos fallidos en 15 min bloquean ese usuario 15 min. Los usuarios inactivos no pueden ingresar. |
| Trazabilidad | `auditoria_seguridad` registra solicitud, envío de mails, aprobación o rechazo, activación y logins fallidos, con IP. La tabla es de solo agregar: un *trigger* impide modificar o borrar. |
| Cabeceras de seguridad | `cuenta.html` tiene Content-Security-Policy restrictiva: solo scripts propios y conexión solo a Supabase. |

## Puesta en marcha (una sola vez)

1. **Zoho (correo que envía)**
   - Los mails salen por el SMTP de Zoho (`smtppro.zoho.com:465`, SSL). Requiere un plan pago de Zoho Mail: el plan gratuito no incluye SMTP.
   - Elegir la cuenta que envía (ej. `soporte@inovasi.com.py` o una dedicada como `no-reply@`).
   - En esa cuenta: *accounts.zoho.com → Seguridad → Contraseñas específicas de la aplicación* → generar una para "Supabase ANDE". Requiere tener la verificación en dos pasos activada.
   - Como el dominio ya envía por Zoho, SPF y DKIM ya están configurados; no hay que tocar el DNS.
2. **SQL**
   - Ejecutar `scripts/solicitudes_usuarios.sql` completo en el SQL Editor. Antes de reemplazar `verificar_login`, el script guarda la versión actual en `respaldo_funciones`.
   - Después, ingresar a la app con un usuario existente. Si el login falla, ejecutar `scripts/revertir_login.sql`: devuelve el login a como estaba.
3. **Edge Function**
   - Opción A (manual): *Edge Functions → Deploy a new function → Via Editor*, nombre `solicitud-usuario`, pegar `supabase/functions/solicitud-usuario/index.ts`, dejar activada la verificación de JWT.
   - Opción B (la despliega Claude): crear un token en *supabase.com/dashboard/account/tokens* (con vencimiento corto) y guardarlo en una variable de entorno con `setx SUPABASE_ACCESS_TOKEN "sbp_..."`. Revocarlo al terminar.
4. **Secretos** (*Edge Functions → Secrets*, los carga el usuario)
   - `SMTP_USER`: la cuenta que envía.
   - `SMTP_PASS`: la contraseña de aplicación del paso 1.
   - Opcionales: `SMTP_HOST` (`smtp.zoho.com` si la cuenta es personal), `MAIL_FROM` (ej. `Gestión ANDE <soporte@inovasi.com.py>`; tiene que ser `SMTP_USER` o un alias suyo), `APROBADORES`, `APP_URL`.

## Autorización en el servidor (sesión por usuario + RLS)

- **Ingreso:** la Edge Function `login` valida la contraseña con `verificar_login` (bloqueo por intentos y registro). Si es correcta, emite una sesión de Supabase Auth para ese usuario, con un JWT propio que se renueva solo y se borra al cerrar la pestaña. El usuario de Auth se crea en el primer ingreso, con el correo interno `<usuario>@usuarios.gcnoc.inovasi.com.py` y una contraseña aleatoria: solo se puede ingresar por la función.
- **Permisos en la base:** las políticas RLS consultan `app_rol()`, que lee el rol actual de `usuarios_app`. Viewer: solo lectura (y crear `solicitudes` a su nombre). Admin: lectura y escritura. Un usuario desactivado pierde el acceso al instante.
- **Registro público de Auth desactivado:** nadie puede crearse una cuenta por su cuenta.
- **Importador:** `scripts/importar_consumos.py` usa la clave de servicio de la variable de entorno `SUPABASE_SERVICE_KEY`.

Despliegue en dos fases:

1. `scripts/auth_rls_fase1.sql` agrega lo nuevo sin quitar nada (aplicada el 2026-11-09).
2. `scripts/auth_rls_fase2.sql` quita las políticas abiertas y todo privilegio de `anon`. A partir de ahí, la clave pública solo sirve para llamar a `login` y `solicitud-usuario`.

Si algo falla, `scripts/revertir_auth_rls.sql` deshace las dos fases.
