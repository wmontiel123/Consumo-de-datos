// ════════════════════════════════════════════════════════════════
// Edge Function "solicitud-usuario"
//
// Acciones (POST JSON { accion, ... }):
//   solicitar : formulario público del login → guarda la solicitud y manda
//               el mail de aprobación a los aprobadores
//   ver       : la página cuenta.html muestra qué hay detrás de un enlace
//   resolver  : aprobar (viewer/admin) o rechazar → mail al solicitante
//   activar   : el usuario aprobado crea su contraseña
//   solicitar_reseteo : el login (tras una contraseña incorrecta) pide restablecerla
//   resolver_reseteo  : un aprobador aprueba o rechaza → mail con el enlace al usuario
//   resetear          : el usuario crea su contraseña nueva
//   aviso_solicitud_linea : mail a los aprobadores cuando alguien pide activar / desactivar una línea
//   cerrar_ticket_linea   : la app avisa que resolvió una solicitud de línea → se cierra su ticket
//
// Tickets en Zammad (opcional; sin ZAMMAD_URL / ZAMMAD_TOKEN todo sigue por mail):
//   ZAMMAD_URL      ej. https://soporte.inovasi.com.py
//   ZAMMAD_TOKEN    token de acceso de un agente (Perfil → Token de acceso, permiso ticket.agent)
//   ZAMMAD_GRUPO    grupo donde se crean los tickets (por defecto "Inovasi - Soporte")
//   ZAMMAD_CLIENTE  correo del cliente del ticket (por defecto SMTP_USER)
//   ZAMMAD_BUZON    aprobador que es el buzón de Zammad (por defecto soporte@inovasi.com.py):
//                   recibe ticket en lugar de mail; si Zammad falla, le llega el mail
//   Requiere la tabla tickets_zammad (scripts/tickets_zammad.sql).
//
// Secretos (Supabase → Edge Functions → Secrets):
//   SMTP_USER       (obligatorio) cuenta de Zoho que envía, ej. soporte@inovasi.com.py
//   SMTP_PASS       (obligatorio) contraseña de aplicación de Zoho (no la contraseña normal)
//   SMTP_HOST       por defecto "smtppro.zoho.com" (cuentas de organización; personales: smtp.zoho.com)
//   SMTP_PORT       por defecto 465 (SSL). Supabase bloquea 25 y 587.
//   MAIL_FROM       por defecto "Gestión ANDE <SMTP_USER>" (debe ser SMTP_USER o un alias suyo en Zoho)
//   APROBADORES     por defecto "soporte@inovasi.com.py,wmontiel@inovasi.com.py,sinsaurralde@inovasi.com.py"
//   APP_URL         por defecto "https://gcnoc.inovasi.com.py"
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los provee Supabase automáticamente.
// ════════════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SMTP_HOST      = Deno.env.get('SMTP_HOST') ?? 'smtppro.zoho.com';
const SMTP_PORT      = Number(Deno.env.get('SMTP_PORT') ?? '465');
const SMTP_USER      = Deno.env.get('SMTP_USER') ?? '';
const SMTP_PASS      = Deno.env.get('SMTP_PASS') ?? '';
const MAIL_FROM      = Deno.env.get('MAIL_FROM') ?? `Gestión ANDE <${SMTP_USER}>`;
const APP_URL        = (Deno.env.get('APP_URL') ?? 'https://gcnoc.inovasi.com.py').replace(/\/$/, '');
const APROBADORES    = (Deno.env.get('APROBADORES') ?? 'soporte@inovasi.com.py,wmontiel@inovasi.com.py,sinsaurralde@inovasi.com.py')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const ORIGENES = [APP_URL, 'http://localhost:8765'];   // localhost: pruebas locales
// Zammad (soporte.inovasi.com.py): si están ZAMMAD_URL y ZAMMAD_TOKEN, cada solicitud abre un
// ticket por API (en lugar del mail al buzón ZAMMAD_BUZON) y se cierra al resolverla.
const ZAMMAD_URL     = (Deno.env.get('ZAMMAD_URL') ?? '').replace(/\/$/, '');
const ZAMMAD_TOKEN   = Deno.env.get('ZAMMAD_TOKEN') ?? '';
const ZAMMAD_GRUPO   = Deno.env.get('ZAMMAD_GRUPO') ?? 'Inovasi - Soporte';
const ZAMMAD_CLIENTE = (Deno.env.get('ZAMMAD_CLIENTE') ?? SMTP_USER).trim().toLowerCase();
const ZAMMAD_BUZON   = (Deno.env.get('ZAMMAD_BUZON') ?? 'soporte@inovasi.com.py').trim().toLowerCase();
const zammadActivo   = () => !!(ZAMMAD_URL && ZAMMAD_TOKEN);

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Mensajes para el usuario según el código que lanza la base de datos
const MENSAJES: Record<string, [number, string]> = {
    LIMITE_IP:                 [429, 'Se enviaron demasiadas solicitudes desde esta conexión. Probá de nuevo en una hora.'],
    LIMITE_GLOBAL:             [429, 'Se alcanzó el máximo de solicitudes del día. Probá mañana o contactá a soporte.'],
    EMAIL_PENDIENTE:           [409, 'Ya hay una solicitud pendiente con ese correo.'],
    USUARIO_NO_DISPONIBLE:     [409, 'Ese nombre de usuario no está disponible. Elegí otro.'],
    TOKEN_INVALIDO:            [410, 'El enlace no es válido, ya se usó o venció.'],
    YA_RESUELTA:               [409, 'Esta solicitud ya fue resuelta.'],
    DECISION_INVALIDA:         [400, 'Decisión no válida.'],
    PASSWORD_DEBIL:            [400, 'La contraseña no cumple la política: mínimo 12 caracteres, con letras, números y un símbolo.'],
    PASSWORD_CONTIENE_USUARIO: [400, 'La contraseña no puede contener el nombre de usuario.'],
    USUARIO_NO_ENCONTRADO:     [404, 'No se encontró el usuario. Contactá a soporte.'],
    PASSWORD_REPETIDA:         [400, 'La contraseña nueva tiene que ser distinta de la anterior.'],
};

function cors(req: Request): Record<string, string> {
    const origin = req.headers.get('origin') ?? '';
    return {
        'Access-Control-Allow-Origin': ORIGENES.includes(origin) ? origin : APP_URL,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Vary': 'Origin',
    };
}

function json(req: Request, status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
}

function errorDb(req: Request, err: { message?: string } | null): Response {
    const codigo = Object.keys(MENSAJES).find(k => err?.message?.includes(k));
    if (codigo) {
        const [status, mensaje] = MENSAJES[codigo];
        return json(req, status, { error: mensaje, codigo });
    }
    console.error('Error BD:', err?.message);
    return json(req, 500, { error: 'No se pudo procesar la solicitud. Probá de nuevo más tarde.' });
}

// Token aleatorio de 256 bits (base64url) y su SHA-256 (lo único que se guarda)
function nuevoToken(): string {
    const b = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(texto: string): Promise<string> {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const tokenValido = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);

const esc = (s: unknown) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function ipDe(req: Request): string {
    return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'desconocida';
}

// SMTP de Zoho con TLS directo (465). Se crea una vez por instancia de la función.
let smtp: ReturnType<typeof nodemailer.createTransport> | null = null;
function transporte() {
    if (!smtp) smtp = nodemailer.createTransport({
        host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    });
    return smtp;
}

async function enviarMail(para: string[], asunto: string, html: string): Promise<boolean> {
    if (!SMTP_USER || !SMTP_PASS) { console.error('Faltan los secretos SMTP_USER / SMTP_PASS'); return false; }
    try {
        await transporte().sendMail({ from: MAIL_FROM, to: para.join(', '), subject: asunto, html });
        return true;
    } catch (e) {
        console.error('SMTP', (e as Error).message);
        smtp = null;   // la próxima vez reconecta
        return false;
    }
}

// ── Zammad ───────────────────────────────────────────────────────
async function zammad(metodo: string, ruta: string, body: unknown): Promise<Record<string, any>> {
    const r = await fetch(`${ZAMMAD_URL}/api/v1/${ruta}`, {
        method: metodo,
        headers: { 'Authorization': `Token token=${ZAMMAD_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
    });
    const texto = await r.text();
    if (!r.ok) throw new Error(`Zammad ${r.status}: ${texto.slice(0, 200)}`);
    return texto ? JSON.parse(texto) : {};
}

// Abre un ticket y guarda a qué solicitud corresponde (tipo + clave). Devuelve false si no se pudo.
async function crearTicket(tipo: string, clave: string, titulo: string, html: string): Promise<boolean> {
    if (!zammadActivo()) return false;
    try {
        const t = await zammad('POST', 'tickets', {
            title: titulo, group: ZAMMAD_GRUPO, customer_id: `guess:${ZAMMAD_CLIENTE}`,
            article: { subject: titulo, body: html, content_type: 'text/html', type: 'note', internal: false },
        });
        const { error } = await db.from('tickets_zammad').insert({ tipo, clave, ticket_id: t.id, numero: String(t.number ?? '') });
        if (error) console.error('tickets_zammad:', error.message);
        return true;
    } catch (e) {
        console.error('Zammad crear ticket:', (e as Error).message);
        return false;
    }
}

// Agrega la resolución al último ticket abierto de esa solicitud y lo cierra
async function cerrarTicket(tipo: string, clave: string, titulo: string, html: string): Promise<boolean> {
    if (!zammadActivo()) return false;
    const { data } = await db.from('tickets_zammad').select('id,ticket_id')
        .eq('tipo', tipo).eq('clave', clave).is('cerrado_en', null).order('id', { ascending: false }).limit(1);
    const fila = data?.[0];
    if (!fila) return false;
    try {
        await zammad('PUT', `tickets/${fila.ticket_id}`, {
            state: 'closed',
            article: { subject: titulo, body: html, content_type: 'text/html', type: 'note', internal: false },
        });
        await db.from('tickets_zammad').update({ cerrado_en: new Date().toISOString() }).eq('id', fila.id);
        return true;
    } catch (e) {
        console.error('Zammad cerrar ticket:', (e as Error).message);
        return false;
    }
}

// Mail a los aprobadores; el buzón de Zammad recibe un ticket nuevo o el cierre del existente
// (si Zammad no responde, le llega el mail como antes)
async function avisarAprobadores(asunto: string, html: string,
                                 ticket?: { tipo: string, clave: string, cerrar?: boolean }): Promise<boolean> {
    let otros = APROBADORES;
    let okTicket = false;
    if (ticket && zammadActivo() && APROBADORES.includes(ZAMMAD_BUZON)) {
        okTicket = ticket.cerrar
            ? await cerrarTicket(ticket.tipo, ticket.clave, asunto, html)
            : await crearTicket(ticket.tipo, ticket.clave, asunto, html);
        if (okTicket) otros = APROBADORES.filter(a => a !== ZAMMAD_BUZON);
    }
    const okMail = otros.length ? await enviarMail(otros, asunto, html) : false;
    return okMail || okTicket;
}

// Un aprobador con su propio enlace: si es el buzón de Zammad va como ticket
async function enviarAAprobador(aprobador: string, tipo: string, clave: string, asunto: string, html: string): Promise<boolean> {
    if (aprobador === ZAMMAD_BUZON && zammadActivo() && await crearTicket(tipo, clave, asunto, html)) return true;
    return enviarMail([aprobador], asunto, html);
}

// ── Plantillas de mail ───────────────────────────────────────────
const marco = (titulo: string, cuerpo: string) => `
<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #e5e8f5;border-radius:12px;overflow:hidden">
  <div style="background:#35398C;color:#fff;padding:18px 24px;font-size:18px;font-weight:700">${titulo}</div>
  <div style="padding:22px 24px;color:#1A1A2E;font-size:14px;line-height:1.55">${cuerpo}</div>
  <div style="padding:12px 24px;background:#f5f6fc;color:#64748b;font-size:12px">
    Gestión de Equipos ANDE · INOVASI — mensaje automático, no respondas este correo.</div>
</div>`;

const boton = (url: string, texto: string, color: string) =>
    `<a href="${url}" style="display:inline-block;margin:4px 6px 4px 0;padding:10px 16px;border-radius:8px;` +
    `background:${color};color:#fff;text-decoration:none;font-weight:600">${texto}</a>`;

function mailAprobacion(s: Record<string, string>, token: string): string {
    const url = (d: string) => `${APP_URL}/cuenta.html#t=${token}&d=${d}`;
    return marco('Solicitud de acceso', `
      <p>Se pidió un usuario para la aplicación de Gestión de Equipos ANDE:</p>
      <table style="border-collapse:collapse;margin:8px 0 16px">
        <tr><td style="padding:3px 12px 3px 0;color:#64748b">Nombre</td><td><b>${esc(s.nombre)}</b></td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#64748b">Correo</td><td>${esc(s.email)}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#64748b">Usuario</td><td>${esc(s.usuario)}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#64748b;vertical-align:top">Motivo</td><td>${esc(s.motivo)}</td></tr>
      </table>
      <p>${boton(url('viewer'), 'Aprobar como Viewer', '#16a34a')}
         ${boton(url('admin'), 'Aprobar como Admin', '#35398C')}
         ${boton(url('rechazar'), 'Rechazar', '#dc2626')}</p>
      <p style="color:#64748b;font-size:12px">Cada botón abre una página para confirmar. El enlace es personal,
      de un solo uso y vence en 72 horas. Si otro aprobador resuelve primero, este enlace queda sin efecto.</p>`);
}

// ── Acciones ─────────────────────────────────────────────────────
async function solicitar(req: Request, b: Record<string, unknown>): Promise<Response> {
    // Trampa para bots: campo oculto que una persona nunca completa
    if (typeof b.web === 'string' && b.web.trim() !== '') return json(req, 200, { ok: true });

    const nombre  = String(b.nombre ?? '').trim();
    const email   = String(b.email ?? '').trim().toLowerCase();
    const usuario = String(b.usuario ?? '').trim().toLowerCase();
    const motivo  = String(b.motivo ?? '').trim();
    if (nombre.length < 3 || nombre.length > 100)
        return json(req, 400, { error: 'Ingresá tu nombre completo (3 a 100 caracteres).' });
    if (email.length > 254 || !/^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$/i.test(email))
        return json(req, 400, { error: 'Ingresá un correo válido.' });
    if (!/^[a-z0-9._-]{3,30}$/.test(usuario))
        return json(req, 400, { error: 'El usuario debe tener de 3 a 30 caracteres: letras minúsculas, números, punto, guion o guion bajo.' });
    if (motivo.length < 10 || motivo.length > 500)
        return json(req, 400, { error: 'Contá brevemente para qué necesitás el acceso (10 a 500 caracteres).' });

    const ip = ipDe(req);
    const { data: id, error } = await db.rpc('crear_solicitud_usuario', {
        p_nombre: nombre, p_email: email, p_usuario: usuario, p_motivo: motivo,
        p_ip: ip, p_user_agent: req.headers.get('user-agent') ?? '',
    });
    if (error) return errorDb(req, error);

    // Un enlace distinto por aprobador: así queda registrado quién aprobó
    const expira = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
    const envios: Promise<boolean>[] = [];
    for (const aprobador of APROBADORES) {
        const token = nuevoToken();
        const { error: e } = await db.from('tokens_cuenta').insert({
            token_hash: await sha256(token), solicitud_id: id, tipo: 'aprobacion',
            destinatario: aprobador, expira_en: expira,
        });
        if (e) return errorDb(req, e);
        envios.push(enviarAAprobador(aprobador, 'acceso', usuario, `Solicitud de acceso: ${usuario}`,
                                     mailAprobacion({ nombre, email, usuario, motivo }, token)));
    }
    const enviados = (await Promise.all(envios)).filter(Boolean).length;
    await db.from('auditoria_seguridad').insert({
        evento: enviados ? 'mail_aprobacion_enviado' : 'mail_aprobacion_fallido',
        usuario, ip, detalle: { solicitud: id, enviados, aprobadores: APROBADORES.length },
    });
    if (!enviados)
        return json(req, 502, { error: 'La solicitud se guardó, pero no se pudo enviar el aviso. Contactá a soporte@inovasi.com.py.' });
    return json(req, 200, { ok: true });
}

async function ver(req: Request, b: Record<string, unknown>): Promise<Response> {
    if (!tokenValido(b.token)) return json(req, 200, { valido: false });
    const hash = await sha256(b.token);
    const { data, error } = await db.rpc('ver_token_cuenta', { p_token_hash: hash });
    if (error) return errorDb(req, error);
    if ((data as Record<string, unknown>)?.tipo) return json(req, 200, data);
    // No es de alta de usuario: ¿es de reseteo de contraseña?
    const { data: r, error: e2 } = await db.rpc('ver_token_reseteo', { p_token_hash: hash });
    if (e2) return errorDb(req, e2);
    return json(req, 200, r);
}

// ── Reseteo de contraseña ────────────────────────────────────────
// La respuesta al solicitante es siempre la misma: no revela si el usuario existe.
const OK_RESETEO = { ok: true };

async function solicitarReseteo(req: Request, b: Record<string, unknown>): Promise<Response> {
    if (typeof b.web === 'string' && b.web.trim() !== '') return json(req, 200, OK_RESETEO);
    const usuario = String(b.usuario ?? '').trim().toLowerCase();
    const email   = String(b.email ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{1,60}$/.test(usuario))
        return json(req, 400, { error: 'Ingresá tu nombre de usuario.' });
    if (email.length > 254 || !/^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$/i.test(email))
        return json(req, 400, { error: 'Ingresá un correo válido.' });

    const ip = ipDe(req);
    const { data, error } = await db.rpc('crear_solicitud_reseteo', {
        p_usuario: usuario, p_email: email, p_ip: ip, p_user_agent: req.headers.get('user-agent') ?? '',
    });
    if (error) return errorDb(req, error);
    const s = data as Record<string, unknown>;
    if (!s?.avisar) return json(req, 200, OK_RESETEO);

    const expira = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const coincide = s.coincide === true;
    const aviso = coincide
        ? `<p style="color:#16a34a">✔ El correo coincide con el registrado para este usuario.</p>`
        : `<p style="color:#dc2626;font-weight:600">⚠ ${s.email_registrado
              ? `El correo NO coincide con el registrado (${esc(s.email_registrado)}).`
              : 'Este usuario no tiene correo registrado.'}
           Confirmá con la persona por otro medio antes de aprobar: el enlace se enviará a ${esc(s.email)}.</p>`;
    let enviados = 0;
    for (const aprobador of APROBADORES) {
        const token = nuevoToken();
        const { error: e } = await db.from('tokens_reseteo').insert({
            token_hash: await sha256(token), reseteo_id: s.id, tipo: 'aprobacion_reseteo',
            destinatario: aprobador, expira_en: expira,
        });
        if (e) { console.error('tokens_reseteo:', e.message); continue; }
        const url = (d: string) => `${APP_URL}/cuenta.html#t=${token}&d=${d}`;
        const ok = await enviarAAprobador(aprobador, 'reseteo', usuario, `Reseteo de contraseña: ${usuario}`, marco('Reseteo de contraseña', `
          <p>Se pidió restablecer la contraseña de un usuario de Gestión de Equipos ANDE:</p>
          <table style="border-collapse:collapse;margin:8px 0 12px">
            <tr><td style="padding:3px 12px 3px 0;color:#64748b">Usuario</td><td><b>${esc(s.usuario)}</b> (${esc(s.rol)})</td></tr>
            <tr><td style="padding:3px 12px 3px 0;color:#64748b">Enviar enlace a</td><td>${esc(s.email)}</td></tr>
            <tr><td style="padding:3px 12px 3px 0;color:#64748b">Desde IP</td><td>${esc(ip)}</td></tr>
          </table>
          ${aviso}
          <p>${boton(url('aprobar'), 'Aprobar reseteo', '#16a34a')}
             ${boton(url('rechazar'), 'Rechazar', '#dc2626')}</p>
          <p style="color:#64748b;font-size:12px">Cada botón abre una página para confirmar. El enlace es personal,
          de un solo uso y vence en 24 horas. Si no reconocés este pedido, rechazalo.</p>`));
        if (ok) enviados++;
    }
    await db.from('auditoria_seguridad').insert({
        evento: enviados ? 'mail_reseteo_enviado' : 'mail_reseteo_fallido',
        usuario, ip, detalle: { reseteo: s.id, enviados },
    });
    return json(req, 200, OK_RESETEO);
}

async function resolverReseteo(req: Request, b: Record<string, unknown>): Promise<Response> {
    if (!tokenValido(b.token)) return json(req, 410, { error: MENSAJES.TOKEN_INVALIDO[1] });
    const decision = String(b.decision ?? '');
    const enlace = nuevoToken();
    const { data, error } = await db.rpc('resolver_reseteo', {
        p_token_hash: await sha256(b.token), p_decision: decision,
        p_hash_reseteo: await sha256(enlace), p_ip: ipDe(req),
    });
    if (error) return errorDb(req, error);
    const r = data as Record<string, string>;
    const aprobada = decision === 'aprobar';
    let mailOk = true;
    if (aprobada) {
        mailOk = await enviarMail([r.email], 'Restablecé tu contraseña', marco('Restablecer contraseña', `
          <p>Se aprobó tu pedido para restablecer la contraseña del usuario <b>${esc(r.usuario)}</b>.</p>
          <p>Creá una contraseña nueva desde este enlace (un solo uso, vence en 24 horas):</p>
          <p>${boton(`${APP_URL}/cuenta.html#t=${enlace}`, 'Crear contraseña nueva', '#35398C')}</p>
          <p style="color:#64748b;font-size:12px">Si no lo pediste vos, no uses el enlace y avisá a soporte@inovasi.com.py.</p>`));
    }
    await avisarAprobadores(`Reseteo ${aprobada ? 'aprobado' : 'rechazado'}: ${r.usuario}`, marco('Reseteo resuelto', `
      <p>El reseteo de contraseña de <b>${esc(r.usuario)}</b> fue <b>${aprobada ? 'aprobado' : 'rechazado'}</b>
      por ${esc(r.resuelto_por)}.${aprobada ? ` Enlace enviado a ${esc(r.email)}.` : ''}</p>
      ${aprobada && !mailOk ? '<p style="color:#dc2626">No se pudo enviar el enlace al usuario.</p>' : ''}`),
      { tipo: 'reseteo', clave: String(r.usuario).toLowerCase(), cerrar: true });
    return json(req, 200, { ok: true, decision, usuario: r.usuario, email: r.email, mail_solicitante: mailOk });
}

async function resetear(req: Request, b: Record<string, unknown>): Promise<Response> {
    if (!tokenValido(b.token)) return json(req, 410, { error: MENSAJES.TOKEN_INVALIDO[1] });
    const password = String(b.password ?? '');
    if (password.length < 12 || password.length > 128 || !/[A-Za-z]/.test(password)
        || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password))
        return json(req, 400, { error: MENSAJES.PASSWORD_DEBIL[1] });
    const { data, error } = await db.rpc('completar_reseteo', {
        p_token_hash: await sha256(b.token), p_password: password, p_ip: ipDe(req),
    });
    if (error) return errorDb(req, error);
    const r = data as Record<string, string>;
    // Aviso de seguridad: si no fue el usuario, se entera
    await enviarMail([r.email], 'Tu contraseña fue cambiada', marco('Contraseña cambiada', `
      <p>La contraseña del usuario <b>${esc(r.usuario)}</b> se cambió el ${new Date().toLocaleString('es-PY', { timeZone: 'America/Asuncion' })}.
      Se cerraron las sesiones abiertas.</p>
      <p>Si no fuiste vos, escribí de inmediato a soporte@inovasi.com.py.</p>`));
    return json(req, 200, { ok: true, usuario: r.usuario });
}

async function resolver(req: Request, b: Record<string, unknown>): Promise<Response> {
    if (!tokenValido(b.token)) return json(req, 410, { error: MENSAJES.TOKEN_INVALIDO[1] });
    const decision = String(b.decision ?? '');
    const activacion = nuevoToken();
    const ip = ipDe(req);
    const { data, error } = await db.rpc('resolver_solicitud_usuario', {
        p_token_hash: await sha256(b.token), p_decision: decision,
        p_hash_activacion: await sha256(activacion), p_ip: ip,
    });
    if (error) return errorDb(req, error);

    const r = data as Record<string, string>;
    const aprobada = decision !== 'rechazar';
    const rolTxt = decision === 'admin' ? 'Administrador' : 'Consulta (viewer)';
    let mailOk: boolean;
    if (aprobada) {
        mailOk = await enviarMail([r.email], 'Tu acceso fue aprobado — activá tu cuenta', marco('Acceso aprobado', `
          <p>Hola ${esc(r.nombre)}, tu solicitud fue aprobada.</p>
          <p>Usuario: <b>${esc(r.usuario)}</b><br>Perfil: <b>${rolTxt}</b></p>
          <p>Para usarlo, creá tu contraseña desde este enlace (un solo uso, vence en 48 horas):</p>
          <p>${boton(`${APP_URL}/cuenta.html#t=${activacion}`, 'Crear mi contraseña', '#35398C')}</p>
          <p style="color:#64748b;font-size:12px">Si no pediste este acceso, ignorá este correo y avisá a soporte@inovasi.com.py.</p>`));
    } else {
        mailOk = await enviarMail([r.email], 'Tu solicitud de acceso', marco('Solicitud no aprobada', `
          <p>Hola ${esc(r.nombre)}, tu solicitud de acceso (usuario <b>${esc(r.usuario)}</b>) no fue aprobada.</p>
          <p>Si creés que es un error, escribí a soporte@inovasi.com.py.</p>`));
    }
    // Aviso a los aprobadores de cómo quedó resuelta
    await avisarAprobadores(`Solicitud ${aprobada ? 'aprobada' : 'rechazada'}: ${r.usuario}`, marco('Solicitud resuelta', `
      <p>La solicitud de <b>${esc(r.nombre)}</b> (usuario <b>${esc(r.usuario)}</b>) fue
      <b>${aprobada ? 'aprobada como ' + rolTxt : 'rechazada'}</b> por ${esc(r.resuelto_por)}.</p>
      ${aprobada && !mailOk ? '<p style="color:#dc2626">No se pudo enviar el enlace de activación al solicitante.</p>' : ''}`),
      { tipo: 'acceso', clave: String(r.usuario).toLowerCase(), cerrar: true });

    return json(req, 200, { ok: true, decision, usuario: r.usuario, mail_solicitante: mailOk });
}

async function activar(req: Request, b: Record<string, unknown>): Promise<Response> {
    if (!tokenValido(b.token)) return json(req, 410, { error: MENSAJES.TOKEN_INVALIDO[1] });
    const password = String(b.password ?? '');
    if (password.length < 12 || password.length > 128 || !/[A-Za-z]/.test(password)
        || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password))
        return json(req, 400, { error: MENSAJES.PASSWORD_DEBIL[1] });
    const { data, error } = await db.rpc('activar_cuenta_usuario', {
        p_token_hash: await sha256(b.token), p_password: password, p_ip: ipDe(req),
    });
    if (error) return errorDb(req, error);
    return json(req, 200, { ok: true, ...(data as object) });
}

// ── Aviso de solicitud de activar / desactivar una línea ─────────
// La app la llama justo después de guardar la fila en "solicitudes" (el viewer no puede leer
// esa tabla, por eso no pasa el id). Avisa las solicitudes de línea pendientes de los últimos
// 10 minutos que todavía no se avisaron: no sirve para mandar correos arbitrarios ni repetidos.
async function avisoSolicitudLinea(req: Request): Promise<Response> {
    const desde = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data, error } = await db.from('solicitudes').select('*')
        .in('tipo', ['activar_linea', 'desactivar_linea']).eq('estado', 'pendiente')
        .gte('creado_at', desde).order('id').limit(20);
    if (error) return errorDb(req, error);
    let enviados = 0;
    for (const s of data ?? []) {
        if ((s.datos ?? {}).mail_enviado) continue;
        if (await mailSolicitudLinea(s)) enviados++;
    }
    return json(req, 200, { ok: true, enviados });
}

async function mailSolicitudLinea(s: Record<string, any>): Promise<boolean> {
    const d = (s.datos ?? {}) as Record<string, unknown>;
    const activar = s.tipo === 'activar_linea';
    const accion  = activar ? 'activación' : 'desactivación';
    const linea   = String(d.numero || d.iccid || '-');
    const fila = (k: string, v: unknown) => v ? `<tr><td style="padding:3px 12px 3px 0;color:#64748b;vertical-align:top">${k}</td><td>${esc(v)}</td></tr>` : '';
    const ok = await avisarAprobadores(`Solicitud de ${accion}: ${linea}`, marco(`Solicitud de ${accion} de línea`, `
      <p><b>${esc(s.usuario)}</b> pidió la <b style="color:${activar ? '#16a34a' : '#dc2626'}">${accion}</b> de una línea:</p>
      <table style="border-collapse:collapse;margin:8px 0 16px">
        ${fila('Número', d.numero)}${fila('ICCID', d.iccid)}${fila('RC', d.rc)}${fila('Motivo', d.motivo)}
        ${fila('Fecha', new Date(s.creado_at).toLocaleString('es-PY', { timeZone: 'America/Asuncion' }))}
      </table>
      <p>${boton(APP_URL, 'Abrir la aplicación', '#35398C')}</p>
      <p style="color:#64748b;font-size:12px">Se aprueba o rechaza en la pestaña Activaciones → Solicitudes pendientes.</p>`),
      { tipo: 'linea', clave: String(s.id) });
    if (ok) await db.from('solicitudes').update({ datos: { ...d, mail_enviado: true } }).eq('id', s.id);
    return ok;
}

// La app la llama después de aprobar o rechazar una solicitud de línea: cierra su ticket.
// Solo actúa sobre solicitudes ya resueltas, así que no sirve para cerrar tickets arbitrarios.
async function cerrarTicketLinea(req: Request, b: Record<string, unknown>): Promise<Response> {
    const id = Number(b.id);
    if (!Number.isInteger(id) || id <= 0) return json(req, 400, { error: 'Solicitud no válida' });
    const { data: s, error } = await db.from('solicitudes').select('*').eq('id', id).maybeSingle();
    if (error) return errorDb(req, error);
    if (!s || !['activar_linea', 'desactivar_linea'].includes(s.tipo)) return json(req, 404, { error: 'Solicitud no encontrada' });
    if (s.estado === 'pendiente') return json(req, 409, { error: 'La solicitud todavía está pendiente' });
    const d = (s.datos ?? {}) as Record<string, unknown>;
    const accion = s.tipo === 'activar_linea' ? 'activación' : 'desactivación';
    const linea  = String(d.numero || d.iccid || '-');
    const aprobada = s.estado === 'aprobada';
    const cerrado = await cerrarTicket('linea', String(id), `Solicitud ${aprobada ? 'aprobada' : 'rechazada'}: ${linea}`,
        `<p>La solicitud de ${accion} de la línea <b>${esc(linea)}</b> fue <b>${aprobada ? 'aprobada' : 'rechazada'}</b>` +
        `${d.resuelto_por ? ' por ' + esc(d.resuelto_por) : ''}.</p>`);
    return json(req, 200, { ok: true, cerrado });
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
    if (req.method !== 'POST') return json(req, 405, { error: 'Método no permitido' });

    let b: Record<string, unknown>;
    try {
        const texto = await req.text();
        if (texto.length > 5000) return json(req, 413, { error: 'Solicitud demasiado grande' });
        b = JSON.parse(texto);
    } catch {
        return json(req, 400, { error: 'JSON inválido' });
    }
    try {
        switch (b.accion) {
            case 'solicitar': return await solicitar(req, b);
            case 'ver':       return await ver(req, b);
            case 'resolver':  return await resolver(req, b);
            case 'activar':   return await activar(req, b);
            case 'solicitar_reseteo': return await solicitarReseteo(req, b);
            case 'resolver_reseteo':  return await resolverReseteo(req, b);
            case 'resetear':          return await resetear(req, b);
            case 'aviso_solicitud_linea': return await avisoSolicitudLinea(req);
            case 'cerrar_ticket_linea':   return await cerrarTicketLinea(req, b);
            default:          return json(req, 400, { error: 'Acción no válida' });
        }
    } catch (e) {
        console.error('Error inesperado:', e);
        return json(req, 500, { error: 'Error interno. Probá de nuevo más tarde.' });
    }
});
