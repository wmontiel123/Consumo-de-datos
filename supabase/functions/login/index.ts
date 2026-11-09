// ════════════════════════════════════════════════════════════════
// Edge Function "login"
//
// POST { usuario, password } → { access_token, refresh_token, usuario, rol }
//
// 1. verificar_login (en la base) valida la contraseña contra usuarios_app,
//    aplica el bloqueo por intentos fallidos y registra el intento.
// 2. Si es correcta, se asegura de que el usuario exista en Supabase Auth
//    (correo interno <usuario>@usuarios.gcnoc.inovasi.com.py, contraseña
//    aleatoria que nadie conoce: solo se ingresa por esta función).
// 3. Emite una sesión de Supabase Auth para ese usuario. Con ese JWT la base
//    aplica las políticas RLS según su rol (app_rol()).
//
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY los provee Supabase.
// Opcional: APP_URL (por defecto https://gcnoc.inovasi.com.py) para CORS.
// ════════════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;
const APP_URL      = (Deno.env.get('APP_URL') ?? 'https://gcnoc.inovasi.com.py').replace(/\/$/, '');
const ORIGENES     = [APP_URL, 'http://localhost:8765'];
const DOMINIO      = 'usuarios.gcnoc.inovasi.com.py';   // correos internos, nunca reciben mail

const sinSesion = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(SUPABASE_URL, SERVICE_KEY, sinSesion);

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
        status, headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
}
const ipDe = (req: Request) => (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'desconocida';
const aleatorio = () => [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');

// Crea (una sola vez) el usuario de Auth y lo vincula en usuarios_app.auth_id
async function asegurarUsuarioAuth(u: { id: number; usuario: string; rol: string; auth_id: string | null }): Promise<string> {
    const email = `${u.usuario}@${DOMINIO}`;
    const app_metadata = { rol: u.rol, usuario: u.usuario };
    if (u.auth_id) {
        const { error } = await admin.auth.admin.updateUserById(u.auth_id, { app_metadata });
        if (!error) return email;
        console.warn('auth_id no válido, se recrea:', error.message);
    }
    let authId: string | undefined;
    const { data, error } = await admin.auth.admin.createUser({
        email, email_confirm: true, password: aleatorio(), app_metadata,
    });
    if (data?.user) authId = data.user.id;
    else {
        // Ya existía (p. ej. se perdió el vínculo): buscarlo por correo
        console.warn('createUser:', error?.message);
        for (let page = 1; !authId && page <= 20; page++) {
            const { data: lista } = await admin.auth.admin.listUsers({ page, perPage: 200 });
            authId = lista?.users.find(x => x.email === email)?.id;
            if (!lista || lista.users.length < 200) break;
        }
        if (!authId) throw new Error('No se pudo crear el usuario de Auth');
        await admin.auth.admin.updateUserById(authId, { app_metadata });
    }
    const { error: e2 } = await admin.from('usuarios_app').update({ auth_id: authId }).eq('id', u.id);
    if (e2) throw new Error('No se pudo vincular auth_id: ' + e2.message);
    return email;
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
    if (req.method !== 'POST') return json(req, 405, { error: 'Método no permitido' });

    let usuario = '', password = '';
    try {
        const texto = await req.text();
        if (texto.length > 1000) return json(req, 413, { error: 'Solicitud demasiado grande' });
        const b = JSON.parse(texto);
        usuario  = String(b.usuario ?? '').trim().toLowerCase();
        password = String(b.password ?? '');
    } catch {
        return json(req, 400, { error: 'JSON inválido' });
    }
    if (!usuario || !password || usuario.length > 60 || password.length > 128)
        return json(req, 401, { error: 'Usuario o contraseña incorrectos.' });

    const ip = ipDe(req);
    try {
        // 1. Contraseña + bloqueo + registro (la IP real va en x-ip-cliente)
        const db = createClient(SUPABASE_URL, SERVICE_KEY, { ...sinSesion, global: { headers: { 'x-ip-cliente': ip } } });
        const { data: rol, error } = await db.rpc('verificar_login', { p_usuario: usuario, p_password: password });
        if (error) {
            if (error.message.includes('bloqueado')) return json(req, 429, { error: error.message });
            console.error('verificar_login:', error.message);
            return json(req, 500, { error: 'No se pudo verificar el usuario. Probá de nuevo.' });
        }
        if (!rol) return json(req, 401, { error: 'Usuario o contraseña incorrectos.' });

        // 2. Usuario de Auth
        const { data: filas, error: eu } = await admin.from('usuarios_app')
            .select('id, usuario, rol, auth_id').eq('activo', true);
        if (eu) throw new Error(eu.message);
        const u = (filas ?? []).find(f => String(f.usuario).toLowerCase() === usuario);
        if (!u) return json(req, 401, { error: 'Usuario o contraseña incorrectos.' });
        const email = await asegurarUsuarioAuth(u);

        // 3. Sesión: enlace mágico generado en el servidor (no se envía ningún mail)
        const { data: link, error: el } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
        if (el || !link?.properties?.hashed_token) throw new Error('generateLink: ' + el?.message);
        const pub = createClient(SUPABASE_URL, ANON_KEY, sinSesion);
        const { data: s, error: ev } = await pub.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token });
        if (ev || !s?.session) throw new Error('verifyOtp: ' + ev?.message);

        await admin.from('auditoria_seguridad').insert({ evento: 'login_ok', usuario: u.usuario, ip });
        return json(req, 200, {
            access_token: s.session.access_token,
            refresh_token: s.session.refresh_token,
            usuario: u.usuario,
            rol: u.rol,
        });
    } catch (e) {
        console.error('login:', (e as Error).message);
        return json(req, 500, { error: 'Error interno al iniciar sesión. Probá de nuevo.' });
    }
});
