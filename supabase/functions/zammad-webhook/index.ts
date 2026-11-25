// ════════════════════════════════════════════════════════════════
// Edge Function "zammad-webhook"
//
// Zammad (soporte.inovasi.com.py) la llama con un Webhook cada vez que se crea o cambia un
// ticket. Solo procesa los de la cola ANDE (ZAMMAD_GRUPO_ANDE):
//   1. Registra el ticket en tickets_ande (el panel del RC lo muestra).
//   2. La primera vez que el ticket tiene "reconectador" (o si cambia), le agrega una nota
//      interna con lo que el inventario sabe de ese RC y completa snapshot_inventario.
//   3. Cuando el trabajo está finalizado (hora_finalizacion + iccid_retirada / iccid_instalada)
//      aplica el cambio de SIM en el inventario con aplicar_cambio_sim_ticket()
//      (scripts/zammad_cambios_sim.sql) y deja una nota interna con el resultado.
//      Si algo no coincide no cambia nada: la nota lo explica y el ticket queda "a revisar".
//   Todo es idempotente: si el mismo aviso llega dos veces no se repite nada.
//
// Secretos (Supabase → Edge Functions → Secrets):
//   ZAMMAD_WEBHOOK_SECRET  (obligatorio) el mismo "HMAC SHA1 Signature Token" del webhook en Zammad
//   ZAMMAD_URL, ZAMMAD_TOKEN  (ya cargados para solicitud-usuario). El agente del token tiene
//                         que tener acceso a la cola ANDE para leer los tickets y escribir notas.
//   ZAMMAD_GRUPO_ANDE     por defecto "ANDE - LP1999-26"
// Desplegar SIN verificación de JWT (Zammad no manda uno): la seguridad es la firma HMAC.
// ════════════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SECRETO       = Deno.env.get('ZAMMAD_WEBHOOK_SECRET') ?? '';
const ZAMMAD_URL    = (Deno.env.get('ZAMMAD_URL') ?? '').replace(/\/$/, '');
const ZAMMAD_TOKEN  = Deno.env.get('ZAMMAD_TOKEN') ?? '';
const GRUPO_ANDE    = (Deno.env.get('ZAMMAD_GRUPO_ANDE') ?? 'ANDE - LP1999-26').trim().toLowerCase();

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const resp = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const esc = (s: unknown) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const soloDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const claveIccid = (v: unknown) => { const s = soloDigitos(v); return /^89\d{18}$/.test(s) ? s.slice(0, 19) : s; };
// ilike sin comodines: en RC_50995 el "_" es un caracter, no "cualquier caracter"
const literal = (v: string) => v.trim().replace(/[\\%_]/g, m => '\\' + m);

// ── Firma: Zammad manda X-Hub-Signature: sha1=<HMAC-SHA1 del cuerpo con el token del webhook> ──
async function firmaValida(cuerpo: string, cabecera: string | null): Promise<boolean> {
    if (!SECRETO || !cabecera?.startsWith('sha1=')) return false;
    const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRETO),
        { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const firma = new Uint8Array(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(cuerpo)));
    const esperado = [...firma].map(b => b.toString(16).padStart(2, '0')).join('');
    const recibido = cabecera.slice(5).trim().toLowerCase();
    if (recibido.length !== esperado.length) return false;
    let dif = 0;
    for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i);
    return dif === 0;
}

async function zammad(metodo: string, ruta: string, body?: unknown): Promise<Record<string, any>> {
    const r = await fetch(`${ZAMMAD_URL}/api/v1/${ruta}`, {
        method: metodo,
        headers: { 'Authorization': `Token token=${ZAMMAD_TOKEN}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
    });
    const texto = await r.text();
    if (!r.ok) throw new Error(`Zammad ${r.status}: ${texto.slice(0, 200)}`);
    return texto ? JSON.parse(texto) : {};
}

// Nota interna (no la ve ANDE, no cuenta como primera respuesta). campos: otros campos del ticket.
async function notaInterna(ticketId: number, titulo: string, html: string, campos: Record<string, unknown> = {}) {
    const article = { subject: titulo, body: html, content_type: 'text/html', type: 'note', internal: true };
    try {
        await zammad('PUT', `tickets/${ticketId}`, { ...campos, article });
    } catch (e) {
        if (!Object.keys(campos).length) throw e;
        // Si un campo no se pudo escribir (p. ej. largo), al menos queda la nota
        console.warn('Zammad campos:', (e as Error).message);
        await zammad('PUT', `tickets/${ticketId}`, { article });
    }
}

const marco = (titulo: string, cuerpo: string) =>
    `<div><p><b>🗂 GCNOC · ${esc(titulo)}</b></p>${cuerpo}<p style="color:#64748b;font-size:12px">Mensaje automático de Gestión de Equipos ANDE (GCNOC).</p></div>`;

const fila = (k: string, v: unknown) =>
    `<tr><td style="padding:2px 12px 2px 0;color:#64748b">${esc(k)}</td><td>${esc(v ?? '-') || '-'}</td></tr>`;

// ── Resumen del inventario para el ticket ─────────────────────────
async function lineaInv(iccid: unknown, numero: unknown) {
    for (const tabla of ['lineas', 'lineas_legado']) {
        const k = claveIccid(iccid);
        if (k.length >= 19) {
            const { data } = await db.from(tabla).select('numero,iccid,telefonia,estado,saldo_mb').like('iccid', `${k}%`).limit(1);
            if (data?.[0]) return data[0];
        }
        const n = String(numero ?? '').trim();
        if (n && n.toUpperCase() !== 'M2M') {
            const { data } = await db.from(tabla).select('numero,iccid,telefonia,estado,saldo_mb').eq('numero', n).limit(1);
            if (data?.[0]) return data[0];
        }
    }
    return null;
}

async function resumenRC(rc: string): Promise<{ html: string, corto: string } | null> {
    const { data } = await db.from('dispositivos_ande').select('*').ilike('codigo', literal(rc)).limit(2);
    if (!data?.length) return null;
    if (data.length > 1) return { html: `<p>⚠ Hay más de un RC con el código «${esc(rc)}» en el inventario.</p>`, corto: `${rc}: código repetido` };
    const d = data[0];
    const sims = [];
    const cortos = [];
    for (const s of ['sim1', 'sim2']) {
        const num = d[`${s}_num`], icc = d[`${s}_imei`];
        const l = await lineaInv(icc, num);
        const nombre = s === 'sim1' ? 'SIM principal' : 'SIM respaldo';
        sims.push(`<tr><td colspan="2" style="padding-top:6px"><b>${nombre}</b></td></tr>`
            + fila('Número', num) + fila('ICCID', icc) + fila('Telefonía', l?.telefonia)
            + fila('Estado consumo', d[`${s}_estado`]) + fila('Inventario', l?.estado ?? 'no está en el inventario')
            + (l?.saldo_mb != null ? fila('Saldo', `${Number(l.saldo_mb).toLocaleString('es-PY')} MB`) : ''));
        cortos.push(`${s.toUpperCase()} ${num || 'M2M'} ${icc || 's/ICCID'}${l?.telefonia ? ' ' + l.telefonia : ''}`);
    }
    const html = `<table style="border-collapse:collapse">${fila('RC', d.codigo)}${fila('Regional', d.regional)}`
        + `${fila('Ubicación', d.ubicacion)}${fila('Estado', d.estado)}${sims.join('')}</table>`;
    const corto = [d.codigo, d.regional, d.ubicacion, ...cortos].filter(Boolean).join(' · ');
    return { html, corto };
}

// ── Pares de SIM del ticket: iccid_retirada / iccid_instalada (+ _2 si fueron las dos) ──
function paresSim(t: Record<string, any>) {
    const pares: Record<string, { ret?: string, inst?: string }> = {};
    for (const [k, v] of Object.entries(t)) {
        const m = k.match(/^iccid_(retirada|instalada)(?:_?(\d+))?$/);
        if (!m || !String(v ?? '').trim()) continue;
        const i = m[2] ?? '1';
        pares[i] ??= {};
        pares[i][m[1] === 'retirada' ? 'ret' : 'inst'] = String(v).trim();
    }
    return Object.keys(pares).sort().map(k => pares[k]);
}

// Slot de cada par: por la SIM retirada si coincide con la del RC; si no, por "sim_afectada"
async function slotsPares(rc: string, simAfectada: string, pares: { ret?: string, inst?: string }[]) {
    const { data } = await db.from('dispositivos_ande').select('sim1_imei,sim2_imei').ilike('codigo', literal(rc)).limit(1);
    const d = data?.[0];
    const usados = new Set<string>();
    return pares.map((p, i) => {
        let slot = '';
        if (d && p.ret) {
            if (claveIccid(p.ret) === claveIccid(d.sim1_imei)) slot = 'sim1';
            else if (claveIccid(p.ret) === claveIccid(d.sim2_imei)) slot = 'sim2';
        }
        if (!slot) slot = simAfectada === 'backup' ? 'sim2' : simAfectada === 'principal' ? 'sim1' : (i === 0 ? 'sim1' : 'sim2');
        if (usados.has(slot)) slot = slot === 'sim1' ? 'sim2' : 'sim1';
        usados.add(slot);
        return { ...p, slot };
    });
}

const ERRORES: Record<string, string> = {
    rc_no_existe: 'el RC no existe en el inventario',
    rc_repetido: 'hay más de un RC con ese código',
    retirada_no_coincide: 'la SIM retirada no es la registrada en el RC',
    instalada_en_otro_rc: 'la SIM instalada figura en otro RC',
    instalada_asignada_a_otro_rc: 'la SIM instalada está asignada a otro RC en el inventario',
    iccid_instalada_invalida: 'la ICCID instalada no tiene formato válido',
    slot_invalido: 'no se pudo determinar la SIM',
};

async function nombreAgente(t: Record<string, any>): Promise<string> {
    if (!t.owner_id || t.owner_id === 1) return 'Zammad';
    try {
        const u = await zammad('GET', `users/${t.owner_id}`);
        return [u.firstname, u.lastname].filter(Boolean).join(' ').trim() || 'Zammad';
    } catch { return 'Zammad'; }
}

// ── Proceso de un ticket ─────────────────────────────────────────
async function procesar(ticketId: number) {
    const t = await zammad('GET', `tickets/${ticketId}?expand=true`);
    if (String(t.group ?? '').trim().toLowerCase() !== GRUPO_ANDE) return { ignorado: 'otra cola' };

    const numero = String(t.number ?? ticketId);
    const rc = String(t.reconectador ?? '').trim();
    const estado = String(t.state ?? '');

    // 1. Registro del ticket
    const fila: Record<string, unknown> = {
        ticket_id: ticketId, numero, titulo: t.title ?? null, rc_codigo: rc || null,
        sim_afectada: t.sim_afectada || null, estado, creado_en: t.created_at ?? null,
        finalizado_en: t.hora_finalizacion || null,
        cerrado_en: estado === 'closed' ? (t.close_at ?? new Date().toISOString()) : null,
        actualizado_en: new Date().toISOString(),
    };
    const { error: eUp } = await db.from('tickets_ande').upsert(fila, { onConflict: 'ticket_id' });
    if (eUp) throw new Error('tickets_ande: ' + eUp.message);
    const hecho: string[] = [];

    // "Reserva" atómica: solo el aviso que logra cambiar la columna hace el trabajo. Las notas
    // que escribe esta función generan otros avisos casi simultáneos: así no se duplica nada.
    const reservar = async (col: string, valor: string) => {
        const { data } = await db.from('tickets_ande').update({ [col]: valor })
            .eq('ticket_id', ticketId).or(`${col}.is.null,${col}.neq.${JSON.stringify(valor)}`).select('ticket_id');
        return !!data?.length;
    };

    // 2. Resumen del inventario (una vez por RC)
    if (rc && await reservar('snapshot_rc', rc.toUpperCase())) {
        try {
            const r = await resumenRC(rc);
            const html = r ? r.html : `<p>⚠ El RC «${esc(rc)}» no está en el inventario de GCNOC. Revisá el código.</p>`;
            await notaInterna(ticketId, `Inventario de ${rc}`, marco(`Inventario de ${rc}`, html),
                r ? { snapshot_inventario: r.corto.slice(0, 250) } : {});
            hecho.push('resumen');
        } catch (e) {
            await db.from('tickets_ande').update({ snapshot_rc: null }).eq('ticket_id', ticketId);  // reintenta en el próximo aviso
            throw e;
        }
    }

    // 3. Cambio de SIM al finalizar el trabajo
    const pares = paresSim(t).filter(p => p.inst);
    if (rc && t.hora_finalizacion && pares.length) {
        const firma = [rc.toUpperCase(), ...pares.map(p => `${claveIccid(p.ret)}>${claveIccid(p.inst)}`)].join('|');
        if (await reservar('aplicado_firma', firma)) {
            const usuario = await nombreAgente(t);
            const conSlot = await slotsPares(rc, String(t.sim_afectada ?? ''), pares);
            const resultados = [];
            for (const p of conSlot) {
                const { data, error } = await db.rpc('aplicar_cambio_sim_ticket', {
                    p_ticket: numero, p_rc: rc, p_slot: p.slot, p_iccid_ret: p.ret ?? null,
                    p_iccid_inst: p.inst, p_fecha: t.hora_finalizacion, p_usuario: usuario,
                });
                resultados.push({ ...p, r: error ? { ok: false, error: 'error_bd', detalle: error.message } : data });
            }
            const okTodos = resultados.every(x => x.r?.ok);
            const lineas = resultados.map(x => {
                const sim = x.slot === 'sim1' ? 'SIM principal' : 'SIM respaldo';
                if (!x.r?.ok) return `<li>❌ <b>${sim}</b>: no se aplicó — ${esc(ERRORES[x.r?.error] ?? x.r?.error)}.<br><small>${esc(x.r?.detalle ?? '')}</small></li>`;
                if (x.r.ya_aplicado) return `<li>✔ <b>${sim}</b>: ya estaba aplicado.</li>`;
                if (x.r.sin_cambio) return `<li>✔ <b>${sim}</b>: el RC ya tenía la SIM ${esc(x.inst)}.</li>`;
                return `<li>✅ <b>${sim}</b>: ${esc(x.r.iccid_anterior || 'sin ICCID')} → <b>${esc(x.r.iccid_nueva)}</b>`
                    + `<br><small>SIM retirada: ${x.r.retirada?.linea ? `${esc(x.r.retirada.linea)} quedó desactivada en el inventario` : 'no estaba en el inventario'}`
                    + ` · SIM instalada: ${x.r.instalada?.creada ? 'se dio de alta en el inventario' : `${esc(x.r.instalada?.linea)} asignada`} a ${esc(x.r.rc)}`
                    + `${x.r.numero_confirmado ? '' : ' · número de línea sin confirmar (se completa con el reporte de consumo)'}</small></li>`;
            }).join('');
            await notaInterna(ticketId, okTodos ? 'Inventario actualizado' : 'Cambio de SIM sin aplicar',
                marco(okTodos ? `Inventario actualizado — ${rc}` : `Cambio de SIM sin aplicar — ${rc}`,
                    `<ul>${lineas}</ul>${okTodos ? '' : '<p>Corregí el dato en el ticket (reconectador o ICCID) y se vuelve a intentar solo, o cargá el cambio a mano en GCNOC.</p>'}`));
            const cambios: Record<string, unknown> = { revisar: !okTodos, resultado: resultados };
            if (okTodos) cambios.aplicado_en = new Date().toISOString();
            const { error } = await db.from('tickets_ande').update(cambios).eq('ticket_id', ticketId);
            if (error) console.error('tickets_ande:', error.message);
            hecho.push(okTodos ? 'cambio_aplicado' : 'cambio_a_revisar');
        }
    }
    return { ticket: numero, hecho };
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') return resp(405, { error: 'Método no permitido' });
    const cuerpo = await req.text();
    if (!(await firmaValida(cuerpo, req.headers.get('x-hub-signature')))) return resp(401, { error: 'Firma inválida' });
    if (!ZAMMAD_URL || !ZAMMAD_TOKEN) return resp(500, { error: 'Faltan ZAMMAD_URL / ZAMMAD_TOKEN' });
    let ticketId = 0;
    try {
        const b = JSON.parse(cuerpo);
        ticketId = Number(b?.ticket?.id ?? b?.ticket_id ?? 0);
    } catch { /* cuerpo no JSON */ }
    if (!ticketId) return resp(200, { ignorado: 'sin ticket' });   // p. ej. el "ping" de prueba
    try {
        return resp(200, await procesar(ticketId));
    } catch (e) {
        console.error('zammad-webhook', ticketId, (e as Error).message);
        return resp(500, { error: 'No se pudo procesar el ticket' });
    }
});
