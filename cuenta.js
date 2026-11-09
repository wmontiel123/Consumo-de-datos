// Página de los enlaces que llegan por mail:
//   · aprobación (a los aprobadores): aprobar como viewer/admin o rechazar
//   · activación (al usuario aprobado): crear su contraseña
// El token viaja en el fragmento (#t=...) y no se envía a ningún servidor salvo
// a la Edge Function; apenas se lee, se borra de la barra de direcciones.
(function () {
    'use strict';

    // Misma clave pública que app.js (es pública por diseño; los datos se protegen en el servidor)
    const SUPABASE_URL = 'https://rnnsvvujedwcvcjyyajm.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJubnN2dnVqZWR3Y3Zjanl5YWptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4MjM2NjcsImV4cCI6MjA4NDM5OTY2N30.VhmUP-tal_iMwmJU_MDDAploV5sDqkzgbi9E2hyCqZc';
    const FUNCION = `${SUPABASE_URL}/functions/v1/solicitud-usuario`;
    const APP = 'index.html';

    const cuerpo = document.getElementById('cuentaCuerpo');
    const titulo = document.getElementById('cuentaTitulo');
    const subtitulo = document.getElementById('cuentaSubtitulo');

    const params = new URLSearchParams(location.hash.slice(1));
    const token = params.get('t') || '';
    const decisionInicial = params.get('d') || '';
    history.replaceState(null, '', location.pathname);   // el token no queda en la URL ni en el historial

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fecha = f => f ? new Date(f).toLocaleString('es-PY', { dateStyle: 'short', timeStyle: 'short', hour12: false }) : '';
    const ROL = { viewer: 'Consulta (viewer)', admin: 'Administrador' };

    async function llamar(cuerpoJson) {
        const r = await fetch(FUNCION, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
            body: JSON.stringify(cuerpoJson),
        });
        let data = {};
        try { data = await r.json(); } catch (_) { /* respuesta vacía */ }
        if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
        return data;
    }

    function mensaje(tipo, html, conLink = true) {
        cuerpo.innerHTML = `<div class="cuenta-msg cuenta-msg-${tipo}">${html}</div>` +
            (conLink ? `<a class="login-btn cuenta-link" href="${APP}">Ir a la aplicación</a>` : '');
    }

    function detalle(d) {
        const fila = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
        return `<table class="cuenta-detalle">
            ${fila('Nombre', esc(d.nombre))}
            ${fila('Correo', esc(d.email))}
            ${fila('Usuario', `<b>${esc(d.usuario)}</b>`)}
            ${d.motivo ? fila('Motivo', esc(d.motivo)) : ''}
            ${fila('Solicitado', fecha(d.creado_en))}
        </table>`;
    }

    // ── Aprobación ─────────────────────────────────────────────
    function vistaAprobacion(d) {
        titulo.textContent = 'Solicitud de acceso';
        subtitulo.textContent = 'Revisá los datos y confirmá';
        if (!d.valido) {
            const estado = d.estado === 'pendiente'
                ? (d.vencido ? 'El enlace venció (72 horas). La solicitud sigue pendiente: pedí al usuario que la envíe de nuevo.' : 'Este enlace ya no es válido.')
                : `La solicitud ya fue <b>${d.estado === 'rechazada' ? 'rechazada' : 'aprobada'}</b>` +
                  (d.resuelto_por ? ` por ${esc(d.resuelto_por)}` : '') + (d.resuelto_en ? ` el ${fecha(d.resuelto_en)}` : '') +
                  (d.rol ? ` (perfil: ${ROL[d.rol] || esc(d.rol)})` : '') + '.';
            cuerpo.innerHTML = detalle(d) + `<div class="cuenta-msg cuenta-msg-info">${estado}</div>`;
            return;
        }
        const opcion = (valor, texto, clase) =>
            `<label class="cuenta-opcion ${clase}"><input type="radio" name="decision" value="${valor}"
                ${decisionInicial === valor ? 'checked' : ''}> ${texto}</label>`;
        cuerpo.innerHTML = detalle(d) + `
            <div class="cuenta-opciones">
                ${opcion('viewer', 'Aprobar como Viewer <small>solo consulta</small>', 'op-viewer')}
                ${opcion('admin', 'Aprobar como Admin <small>puede modificar datos</small>', 'op-admin')}
                ${opcion('rechazar', 'Rechazar', 'op-rechazar')}
            </div>
            <div id="cuentaError" class="login-error" style="display:none"></div>
            <button class="login-btn" id="btnConfirmar">Confirmar</button>`;
        document.getElementById('btnConfirmar').addEventListener('click', async () => {
            const sel = document.querySelector('input[name="decision"]:checked');
            const err = document.getElementById('cuentaError');
            if (!sel) { err.textContent = 'Elegí una opción.'; err.style.display = 'flex'; return; }
            if (sel.value === 'admin' && !confirm(`¿Dar perfil de ADMINISTRADOR a "${d.usuario}"? Podrá modificar datos.`)) return;
            const btn = document.getElementById('btnConfirmar');
            btn.disabled = true; btn.textContent = 'Procesando…';
            try {
                const r = await llamar({ accion: 'resolver', token, decision: sel.value });
                if (r.decision === 'rechazar') {
                    mensaje('info', `Solicitud de <b>${esc(r.usuario)}</b> rechazada. Se avisó al solicitante.`, false);
                } else {
                    mensaje('ok', `Usuario <b>${esc(r.usuario)}</b> aprobado como <b>${ROL[r.decision]}</b>.<br>` +
                        (r.mail_solicitante
                            ? 'Se le envió un enlace para crear su contraseña (vence en 48 horas).'
                            : '<span class="cuenta-alerta">No se pudo enviar el mail al solicitante. Avisá a soporte.</span>'), false);
                }
            } catch (e) {
                btn.disabled = false; btn.textContent = 'Confirmar';
                err.textContent = e.message; err.style.display = 'flex';
            }
        });
    }

    // ── Aprobación de reseteo de contraseña ────────────────────
    function vistaAprobacionReseteo(d) {
        titulo.textContent = 'Reseteo de contraseña';
        subtitulo.textContent = 'Revisá los datos y confirmá';
        const fila = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
        const tabla = `<table class="cuenta-detalle">
            ${fila('Usuario', `<b>${esc(d.usuario)}</b>${d.rol ? ` (${ROL[d.rol] || esc(d.rol)})` : ''}`)}
            ${fila('Enviar enlace a', esc(d.email))}
            ${fila('Solicitado', fecha(d.creado_en))}
        </table>`;
        if (!d.valido) {
            const estado = d.estado === 'pendiente'
                ? (d.vencido ? 'El enlace venció (24 horas). El usuario puede pedir el reseteo de nuevo.' : 'Este enlace ya no es válido.')
                : `El pedido ya fue <b>${d.estado === 'rechazada' ? 'rechazado' : 'aprobado'}</b>` +
                  (d.resuelto_por ? ` por ${esc(d.resuelto_por)}` : '') + (d.resuelto_en ? ` el ${fecha(d.resuelto_en)}` : '') + '.';
            cuerpo.innerHTML = tabla + `<div class="cuenta-msg cuenta-msg-info">${estado}</div>`;
            return;
        }
        const aviso = d.coincide
            ? `<div class="cuenta-msg cuenta-msg-ok">El correo coincide con el registrado para este usuario.</div>`
            : `<div class="cuenta-msg cuenta-msg-error"><b>Atención:</b> ${d.email_registrado
                  ? `el correo no coincide con el registrado (${esc(d.email_registrado)}).`
                  : 'este usuario no tiene correo registrado.'}
               Confirmá con la persona por otro medio antes de aprobar.</div>`;
        const opcion = (valor, texto, clase) =>
            `<label class="cuenta-opcion ${clase}"><input type="radio" name="decision" value="${valor}"
                ${decisionInicial === valor ? 'checked' : ''}> ${texto}</label>`;
        cuerpo.innerHTML = tabla + aviso + `
            <div class="cuenta-opciones">
                ${opcion('aprobar', 'Aprobar reseteo <small>se envía el enlace al correo indicado</small>', 'op-viewer')}
                ${opcion('rechazar', 'Rechazar', 'op-rechazar')}
            </div>
            <div id="cuentaError" class="login-error" style="display:none"></div>
            <button class="login-btn" id="btnConfirmar">Confirmar</button>`;
        document.getElementById('btnConfirmar').addEventListener('click', async () => {
            const sel = document.querySelector('input[name="decision"]:checked');
            const err = document.getElementById('cuentaError');
            if (!sel) { err.textContent = 'Elegí una opción.'; err.style.display = 'flex'; return; }
            if (sel.value === 'aprobar' && !d.coincide &&
                !confirm(`El correo no coincide con el registrado. ¿Confirmaste que ${d.email} es de "${d.usuario}"?`)) return;
            const btn = document.getElementById('btnConfirmar');
            btn.disabled = true; btn.textContent = 'Procesando…';
            try {
                const r = await llamar({ accion: 'resolver_reseteo', token, decision: sel.value });
                if (r.decision === 'rechazar') {
                    mensaje('info', `Reseteo de <b>${esc(r.usuario)}</b> rechazado.`, false);
                } else {
                    mensaje('ok', `Reseteo de <b>${esc(r.usuario)}</b> aprobado.<br>` +
                        (r.mail_solicitante
                            ? `Se envió el enlace a ${esc(r.email)} (vence en 24 horas).`
                            : '<span class="cuenta-alerta">No se pudo enviar el mail al usuario. Avisá a soporte.</span>'), false);
                }
            } catch (e) {
                btn.disabled = false; btn.textContent = 'Confirmar';
                err.textContent = e.message; err.style.display = 'flex';
            }
        });
    }

    // ── Activación / contraseña nueva ──────────────────────────
    const REGLAS = [
        ['largo', 'Al menos 12 caracteres', p => p.length >= 12 && p.length <= 128],
        ['letra', 'Una letra', p => /[A-Za-z]/.test(p)],
        ['numero', 'Un número', p => /[0-9]/.test(p)],
        ['simbolo', 'Un símbolo (ej. ! @ # . -)', p => /[^A-Za-z0-9]/.test(p)],
    ];

    // reseteo = true: contraseña nueva por reseteo; false: activación de cuenta nueva
    function vistaActivacion(d, reseteo = false) {
        titulo.textContent = reseteo ? 'Contraseña nueva' : 'Activá tu cuenta';
        subtitulo.textContent = reseteo ? 'Restablecé tu contraseña' : 'Creá tu contraseña';
        if (!d.valido) {
            if (d.estado === 'activada') mensaje('info', 'Esta cuenta ya fue activada. Ingresá con tu usuario y contraseña.');
            else if (d.estado === 'completada') mensaje('info', 'La contraseña ya se cambió con este enlace. Ingresá con la nueva.');
            else mensaje('error', d.vencido
                ? (reseteo
                    ? 'El enlace venció (24 horas). Pedí el reseteo de nuevo desde el inicio de sesión.'
                    : 'El enlace de activación venció (48 horas). Escribí a soporte@inovasi.com.py para que te envíen uno nuevo.')
                : 'Este enlace ya no es válido.');
            return;
        }
        cuerpo.innerHTML = `
            <p class="cuenta-intro">${reseteo
                ? `Usuario <b>${esc(d.usuario)}</b>. Creá una contraseña nueva, distinta de la anterior. Al guardarla se cierran tus sesiones abiertas.`
                : `Hola <b>${esc(d.nombre)}</b>. Tu usuario es <b>${esc(d.usuario)}</b>
               (${ROL[d.rol] || ''}). Creá una contraseña que no uses en otro sitio.`}</p>
            <div class="login-group"><div class="input-icon-wrap">
                <input type="password" id="pwd1" placeholder="Contraseña nueva" autocomplete="new-password" maxlength="128">
            </div></div>
            <div class="login-group"><div class="input-icon-wrap">
                <input type="password" id="pwd2" placeholder="Repetir contraseña" autocomplete="new-password" maxlength="128">
            </div></div>
            <label class="cuenta-ver"><input type="checkbox" id="pwdVer"> Mostrar contraseña</label>
            <ul class="cuenta-reglas" id="pwdReglas">
                ${REGLAS.map(([id, txt]) => `<li data-r="${id}">${txt}</li>`).join('')}
                <li data-r="usuario">Que no contenga el usuario</li>
                <li data-r="igual">Las dos coinciden</li>
            </ul>
            <div id="cuentaError" class="login-error" style="display:none"></div>
            <button class="login-btn" id="btnActivar" disabled>${reseteo ? 'Guardar contraseña' : 'Activar cuenta'}</button>`;

        const p1 = document.getElementById('pwd1'), p2 = document.getElementById('pwd2');
        const btn = document.getElementById('btnActivar');
        const evaluar = () => {
            const p = p1.value;
            const ok = {};
            REGLAS.forEach(([id, , f]) => { ok[id] = f(p); });
            ok.usuario = p.length > 0 && !p.toLowerCase().includes(String(d.usuario).toLowerCase());
            ok.igual = p.length > 0 && p === p2.value;
            document.querySelectorAll('#pwdReglas li').forEach(li => li.classList.toggle('ok', !!ok[li.dataset.r]));
            btn.disabled = !Object.values(ok).every(Boolean);
        };
        p1.addEventListener('input', evaluar);
        p2.addEventListener('input', evaluar);
        document.getElementById('pwdVer').addEventListener('change', e => {
            p1.type = p2.type = e.target.checked ? 'text' : 'password';
        });
        btn.addEventListener('click', async () => {
            const err = document.getElementById('cuentaError');
            const textoBtn = btn.textContent;
            btn.disabled = true; btn.textContent = 'Guardando…'; err.style.display = 'none';
            try {
                const r = await llamar({ accion: reseteo ? 'resetear' : 'activar', token, password: p1.value });
                p1.value = p2.value = '';
                mensaje('ok', reseteo
                    ? `¡Listo! Se cambió la contraseña de <b>${esc(r.usuario)}</b>. Ya podés ingresar con la nueva.`
                    : `¡Listo! La cuenta <b>${esc(r.usuario)}</b> está activa. Ya podés ingresar.`);
            } catch (e) {
                btn.textContent = textoBtn; evaluar();
                err.textContent = e.message; err.style.display = 'flex';
            }
        });
        p1.focus();
    }

    // ── Inicio ─────────────────────────────────────────────────
    (async () => {
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
            mensaje('error', 'El enlace está incompleto o no es válido. Abrilo de nuevo desde el correo.');
            return;
        }
        try {
            const d = await llamar({ accion: 'ver', token });
            if (d.tipo === 'aprobacion') vistaAprobacion(d);
            else if (d.tipo === 'activacion') vistaActivacion(d);
            else if (d.tipo === 'aprobacion_reseteo') vistaAprobacionReseteo(d);
            else if (d.tipo === 'reseteo') vistaActivacion(d, true);
            else mensaje('error', 'El enlace no es válido o ya no existe.');
        } catch (e) {
            mensaje('error', `No se pudo verificar el enlace: ${esc(e.message)}`);
        }
    })();
})();
