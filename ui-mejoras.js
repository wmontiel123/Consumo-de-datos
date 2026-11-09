// ══════════════════════════════════════════════════════════════════
// ── MEJORAS DE INTERFAZ ───────────────────────────────────────────
//  - Tarjetas de resumen arriba de cada tabla
//  - Filtros plegables y "chips" con los filtros aplicados (✕ para quitar uno)
// Se engancha a funciones de app.js (se carga después) sin cambiar su lógica.
// ══════════════════════════════════════════════════════════════════

// Ejecuta fn después de cada llamada a la función global "nombre" (también si es async)
function _despuesDe(nombre, fn) {
    const orig = window[nombre];
    if (typeof orig !== 'function') return;
    window[nombre] = function (...args) {
        const r = orig.apply(this, args);
        Promise.resolve(r).finally(() => { try { fn(...args); } catch (e) { console.warn('ui-mejoras:', e); } });
        return r;
    };
}

const _mb = v => `${formatearNumero(v)} MB`;
const _pct = (a, b) => !b ? '' : (a > 0 && a * 100 / b < 1) ? '<1%' : `${Math.round(a * 100 / b)}%`;

// ── Tarjetas de resumen ───────────────────────────────────────────

// tarjetas: [{ titulo, valor, detalle, tono }]  tono: azul | verde | rojo | naranja | gris | <telefonía>
function pintarTarjetas(contId, antesDeId, tarjetas) {
    let cont = document.getElementById(contId);
    if (!cont) {
        const ref = document.getElementById(antesDeId);
        if (!ref) return;
        cont = document.createElement('div');
        cont.id = contId;
        cont.className = 'kpi-row';
        ref.parentNode.insertBefore(cont, ref);
    }
    cont.innerHTML = tarjetas.map(t => {
        if (t.separador) return `<div class="kpi-separador">${escHtml(t.separador)}</div>`;
        const marca = TEL_MARCA[t.tono];
        const estilo = marca ? ` style="--kpi-acento:${marca.color}"` : '';
        return `<div class="kpi kpi-${marca ? 'tel' : (t.tono || 'azul')}"${estilo}>
            <div class="kpi-titulo">${escHtml(t.titulo)}</div>
            <div class="kpi-valor">${escHtml(t.valor)}</div>
            ${t.detalle ? `<div class="kpi-detalle">${escHtml(t.detalle)}</div>` : ''}
        </div>`;
    }).join('');
}

function _mayor(obj) {
    const e = Object.entries(obj).sort((a, b) => b[1] - a[1])[0];
    return e ? { clave: e[0], valor: e[1] } : null;
}

let _ultimosTotalesLineas = null;

function kpiConsumo() {
    if (vistaConsumo === 'lineas-bd') {
        const t = _ultimosTotalesLineas;
        if (!t) return pintarTarjetas('kpiConsumo', 'paginacion-info-consumo', []);
        const top = _mayor(t.porTel || {});
        return pintarTarjetas('kpiConsumo', 'paginacion-info-consumo', [
            { titulo: 'Líneas', valor: formatearNumero(t.lineas ?? 0), tono: 'azul' },
            { titulo: 'Activas', valor: formatearNumero((t.lineas ?? 0) - (t.desactivadas ?? 0)), detalle: _pct((t.lineas ?? 0) - (t.desactivadas ?? 0), t.lineas), tono: 'verde' },
            { titulo: 'Desactivadas', valor: formatearNumero(t.desactivadas ?? 0), detalle: _pct(t.desactivadas, t.lineas), tono: 'rojo' },
            { titulo: 'MB este mes', valor: _mb(t.mes), tono: 'azul' },
            { titulo: 'MB total', valor: _mb(t.total), tono: 'gris' },
            top && top.valor > 0 ? { titulo: 'Más consumo este mes', valor: top.clave, detalle: `${_mb(top.valor)} · ${_pct(top.valor, t.mes)}`, tono: top.clave } : null,
        ].filter(Boolean));
    }

    const lineas = consumosFiltrados || [];
    if (vistaConsumo === 'equipos') {
        const rcText   = (document.getElementById('filtroRCBuscar')?.value || '').trim().toLowerCase();
        const regional = (document.getElementById('filtroRCRegional')?.value || '').trim();
        const rcs = buildConsolidado(lineas).filter(x => x.rc && x.rc !== '-' &&
            (!rcText || x.rc.toLowerCase().includes(rcText)) && (!regional || x.regional === regional));
        const total = rcs.reduce((s, x) => s + (x.totalMB || 0), 0);
        const porReg = {};
        rcs.forEach(x => { porReg[x.regional || 'Sin regional'] = (porReg[x.regional || 'Sin regional'] || 0) + (x.totalMB || 0); });
        const top = _mayor(porReg);
        const sinConsumo = rcs.filter(x => !x.totalMB).length;
        return pintarTarjetas('kpiConsumo', 'paginacion-info-consumo', [
            { titulo: 'RC con datos', valor: formatearNumero(rcs.length), tono: 'azul' },
            { titulo: 'Total consumo', valor: _mb(total), tono: 'azul' },
            { titulo: 'Promedio por RC', valor: _mb(rcs.length ? total / rcs.length : 0), tono: 'gris' },
            { titulo: 'RC sin consumo', valor: formatearNumero(sinConsumo), detalle: _pct(sinConsumo, rcs.length), tono: sinConsumo ? 'naranja' : 'verde' },
            top && top.valor > 0 ? { titulo: 'Regional con más consumo', valor: top.clave, detalle: `${_mb(top.valor)} · ${_pct(top.valor, total)}`, tono: 'azul' } : null,
        ].filter(Boolean));
    }

    // Vista Consumo: una fila por línea con el total del período
    const total = lineas.reduce((s, c) => s + (parseFloat(c.consumo_mb) || 0), 0);
    const desact = lineas.filter(c => estadoSimple(estadoConsDisplay(c)) === 'desactivado').length;
    const porTel = {};
    lineas.forEach(c => { const t = c.telefonia || 'Sin dato'; porTel[t] = (porTel[t] || 0) + (parseFloat(c.consumo_mb) || 0); });
    const top = _mayor(porTel);
    pintarTarjetas('kpiConsumo', 'paginacion-info-consumo', [
        { titulo: 'Total consumo', valor: _mb(total), tono: 'azul' },
        { titulo: 'Líneas', valor: formatearNumero(lineas.length), tono: 'gris' },
        { titulo: 'Activas', valor: formatearNumero(lineas.length - desact), detalle: _pct(lineas.length - desact, lineas.length), tono: 'verde' },
        { titulo: 'Desactivadas', valor: formatearNumero(desact), detalle: _pct(desact, lineas.length), tono: 'rojo' },
        top && top.valor > 0 ? { titulo: 'Más consumo', valor: top.clave, detalle: `${_mb(top.valor)} · ${_pct(top.valor, total)}`, tono: top.clave } : null,
    ].filter(Boolean));
}

function kpiInventario() {
    const filas = typeof filasInventario === 'function' ? filasInventario() : [];
    const cuenta = e => filas.filter(l => l.estado === e).length;
    const porTel = {};
    filas.forEach(l => { const t = l.telefonia || 'Sin dato'; porTel[t] = (porTel[t] || 0) + 1; });
    pintarTarjetas('kpiInventario', 'lineasInfo', [
        { separador: 'Por estado' },
        { titulo: 'Líneas', valor: formatearNumero(filas.length), tono: 'azul' },
        { titulo: 'Asignadas', valor: formatearNumero(cuenta('asignada')), detalle: _pct(cuenta('asignada'), filas.length), tono: 'verde' },
        { titulo: 'Disponibles', valor: formatearNumero(cuenta('disponible')), detalle: _pct(cuenta('disponible'), filas.length), tono: 'naranja' },
        { titulo: 'Desactivadas', valor: formatearNumero(cuenta('desactivada')), detalle: _pct(cuenta('desactivada'), filas.length), tono: 'rojo' },
        { separador: 'Por telefonía' },
        ...Object.entries(porTel).sort((a, b) => b[1] - a[1])
            .map(([t, n]) => ({ titulo: t, valor: formatearNumero(n), detalle: _pct(n, filas.length), tono: TEL_MARCA[t] ? t : marcaTelefoniaClave(t) })),
    ]);
}
const marcaTelefoniaClave = t => Object.keys(TEL_MARCA).find(k => k.toLowerCase() === String(t).toLowerCase()) || 'gris';

function kpiActivaciones() {
    const filas = typeof filasActivaciones === 'function' ? filasActivaciones() : [];
    const hace30 = Date.now() - 30 * 86400000;
    const cuenta = fn => filas.filter(fn).length;
    pintarTarjetas('kpiActivaciones', 'activacionesInfo', [
        { titulo: 'Registros', valor: formatearNumero(filas.length), tono: 'azul' },
        { titulo: 'Altas', valor: formatearNumero(cuenta(h => h.estado_nuevo === 'alta')), tono: 'gris' },
        { titulo: 'Activaciones', valor: formatearNumero(cuenta(h => ['activo', 'asignada', 'disponible'].includes(h.estado_nuevo))), tono: 'verde' },
        { titulo: 'Desactivaciones', valor: formatearNumero(cuenta(h => String(h.estado_nuevo).startsWith('desactivad'))), tono: 'rojo' },
        { titulo: 'Últimos 30 días', valor: formatearNumero(cuenta(h => new Date(h.fecha).getTime() >= hace30)), tono: 'naranja' },
    ]);
}

function kpiHistorialSIM() {
    const filas = typeof filasHistorialSIM === 'function' ? filasHistorialSIM() : [];
    const hace30 = Date.now() - 30 * 86400000;
    const porUsuario = {};
    filas.forEach(h => { const u = h.usuario || 'Sin dato'; porUsuario[u] = (porUsuario[u] || 0) + 1; });
    const top = _mayor(porUsuario);
    pintarTarjetas('kpiHistorialSim', 'historialSimInfo', [
        { titulo: 'Cambios de SIM', valor: formatearNumero(filas.length), tono: 'azul' },
        { titulo: 'Últimos 30 días', valor: formatearNumero(filas.filter(h => new Date(h.fecha_cambio).getTime() >= hace30).length), tono: 'naranja' },
        { titulo: 'RC distintos', valor: formatearNumero(new Set(filas.map(h => h.rc_codigo)).size), tono: 'gris' },
        top ? { titulo: 'Más cambios registró', valor: top.clave, detalle: `${formatearNumero(top.valor)} cambio(s)`, tono: 'verde' } : null,
    ].filter(Boolean));
}

// ── Filtros plegables + chips de filtros aplicados ────────────────

const GRUPOS_FILTRO = {
    consumo: {
        cont: () => document.getElementById('filtrosConsumo'), plegable: true,
        aplicar: () => aplicarFiltrosConsumo(),
        campos: [['filtroTelefonia', 'Telefonía'], ['filtroEstadoConsumo', 'Estado'], ['filtroRCConsumo', 'RC'],
                 ['filtroNumConsumo', 'Nº / ICCID'], ['filtroFechaDesde', 'Desde'], ['filtroFechaHasta', 'Hasta'],
                 ['filtroObservacion', 'Observación']],
    },
    lineas: {
        cont: () => document.getElementById('filtroLineasBar'),
        aplicar: () => aplicarFiltrosLineas(),
        campos: [['filtroLineasBuscar', 'Búsqueda'], ['filtroLineasTelefonia', 'Telefonía'], ['filtroLineasEstado', 'Estado']],
    },
    rc: {
        cont: () => document.getElementById('filtroRCBar'),
        aplicar: () => aplicarFiltroRC(),
        campos: [['filtroRCBuscar', 'RC'], ['filtroRCRegional', 'Regional']],
    },
    dispositivos: {
        cont: () => document.querySelector('#tab-dispositivos .filters'), plegable: true,
        aplicar: () => aplicarFiltros(),
        campos: [['filtroRegional', 'Regional'], ['filtroCodigo', 'Código'], ['filtroSim', 'Nº SIM'],
                 ['filtroFecha', 'Fecha activación'], ['filtroEstado', 'Estado'], ['filtroTipo', 'Tipo']],
    },
};

function _valorVisible(el) {
    if (!el || !String(el.value || '').trim()) return '';
    if (el.tagName === 'SELECT') return el.selectedOptions[0]?.text || el.value;
    if (el.type === 'date') return formatearFecha(el.value);
    return el.value.trim();
}

function _plegados() {
    try { return JSON.parse(localStorage.getItem('filtrosPlegados') || '{}'); } catch { return {}; }
}
function _guardarPlegados(p) {
    try { localStorage.setItem('filtrosPlegados', JSON.stringify(p)); } catch { /* sin almacenamiento */ }
}

function prepararGrupoFiltro(clave) {
    const g = GRUPOS_FILTRO[clave];
    const cont = g.cont();
    if (!cont || cont.dataset.mejorado) return;
    cont.dataset.mejorado = '1';

    const chips = document.createElement('div');
    chips.className = 'filtros-activos';
    chips.id = 'chips-' + clave;
    cont.appendChild(chips);

    if (g.plegable) {
        const h2 = cont.querySelector('h2');
        if (h2) {
            h2.classList.add('filtros-titulo');
            h2.setAttribute('role', 'button');
            h2.setAttribute('tabindex', '0');
            h2.title = 'Mostrar u ocultar los filtros';
            h2.insertAdjacentHTML('beforeend', '<span class="filtros-contador"></span><span class="filtros-chevron" aria-hidden="true">▾</span>');
            const alternar = () => {
                const p = _plegados();
                p[clave] = !cont.classList.contains('plegado');
                cont.classList.toggle('plegado', p[clave]);
                h2.setAttribute('aria-expanded', String(!p[clave]));
                _guardarPlegados(p);
            };
            h2.addEventListener('click', alternar);
            h2.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); } });
            const plegado = !!_plegados()[clave];
            cont.classList.toggle('plegado', plegado);
            h2.setAttribute('aria-expanded', String(!plegado));
        }
    }
    pintarChips(clave);
}

function pintarChips(clave) {
    const g = GRUPOS_FILTRO[clave];
    const cont = g.cont();
    const chips = document.getElementById('chips-' + clave);
    if (!cont || !chips) return;
    const activos = g.campos
        .map(([id, etq]) => ({ id, etq, val: _valorVisible(document.getElementById(id)) }))
        .filter(x => x.val);
    chips.innerHTML = activos.map(x =>
        `<span class="chip-filtro"><span class="chip-etq">${escHtml(x.etq)}:</span> ${escHtml(x.val)}
            <button type="button" class="chip-quitar" title="Quitar este filtro" aria-label="Quitar filtro ${escHtml(x.etq)}"
                    onclick="quitarFiltro('${clave}', '${x.id}')">✕</button></span>`).join('') +
        (activos.length > 1 ? `<button type="button" class="chip-limpiar" onclick="quitarFiltro('${clave}')">Quitar todos</button>` : '');
    chips.style.display = activos.length ? '' : 'none';
    const contador = cont.querySelector('.filtros-contador');
    if (contador) contador.textContent = activos.length ? `${activos.length} activo${activos.length > 1 ? 's' : ''}` : '';
}

function quitarFiltro(clave, id) {
    const g = GRUPOS_FILTRO[clave];
    (id ? [id] : g.campos.map(c => c[0])).forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });
    g.aplicar();
}

function pintarTodosLosChips() { Object.keys(GRUPOS_FILTRO).forEach(pintarChips); }

// ── Tablas legibles en celular ────────────────────────────────────
// Cada celda recibe data-label con el nombre de su columna: en pantallas
// angostas el CSS muestra cada fila como una tarjeta "Columna: valor".

const TABLAS_RESPONSIVAS = ['#tablaConsumo', '#tablaConsumo2', '#tablaConsolidado', '#tablaLineasBD',
                            '#tab-historial .panel-historial', '#tab-activaciones .panel-historial', '#subtab-inventario .panel-historial',
                            '#tablaCargasSesion'];

function etiquetarTabla(tabla) {
    const titulos = [...tabla.querySelectorAll('thead th')].map(th => th.textContent.replace(/[⇅▲▼]/g, '').trim());
    tabla.querySelectorAll('tbody tr').forEach(tr => {
        [...tr.children].forEach((td, i) => {
            if (td.colSpan > 1) { td.classList.add('td-mensaje'); return; }
            if (titulos[i] && td.dataset.label !== titulos[i]) td.dataset.label = titulos[i];
        });
    });
}

function prepararTablasResponsivas() {
    TABLAS_RESPONSIVAS.forEach(sel => {
        const tabla = document.querySelector(sel);
        if (!tabla || tabla.dataset.responsiva) return;
        tabla.dataset.responsiva = '1';
        tabla.classList.add('tabla-responsiva');
        etiquetarTabla(tabla);
        const tbody = tabla.querySelector('tbody');
        if (tbody) new MutationObserver(() => etiquetarTabla(tabla)).observe(tbody, { childList: true });
    });
}

// ── Tarjetas de resumen al costado de la tabla ────────────────────
// Reacomoda un .table-container: el encabezado arriba y, debajo, una columna
// con las tarjetas (aside) y el resto del contenido a la derecha.
function ponerResumenAlCostado(contenedor, kpiId) {
    if (!contenedor) return;
    const encabezado = contenedor.querySelector(':scope > .table-header-row');
    // El título va en la columna de la tabla, alineado con la primera columna
    const yaArmado = contenedor.querySelector('.inv-principal');
    if (yaArmado) { if (encabezado) yaArmado.prepend(encabezado); return; }
    const layout = document.createElement('div');
    layout.className = 'inv-layout';
    layout.innerHTML = `<aside class="inv-lado" aria-label="Resumen"><div id="${kpiId}" class="kpi-row kpi-lateral"></div></aside>`;
    const principal = document.createElement('div');
    principal.className = 'inv-principal';
    [...contenedor.children].forEach(el => principal.appendChild(el));
    layout.appendChild(principal);
    contenedor.appendChild(layout);
}

// ── Altas: formularios desplegables, elegir cuáles ver y "Cargado en esta sesión" ──

const FORMULARIOS_ALTA = [
    { clave: 'rc',     titulo: 'Nuevo RC' },
    { clave: 'lector', titulo: 'Carga rápida con lector' },
    { clave: 'linea',  titulo: 'Nueva línea' },
];

function _prefsAltas() {
    try { return JSON.parse(localStorage.getItem('prefsAltas') || '{}'); } catch { return {}; }
}
function _guardarPrefsAltas(p) {
    try { localStorage.setItem('prefsAltas', JSON.stringify(p)); } catch { /* sin almacenamiento */ }
}

function prepararFormulariosAlta() {
    const cont = document.getElementById('subtab-altas');
    if (!cont || cont.dataset.mejorado) return;
    cont.dataset.mejorado = '1';
    const tarjetas = [...cont.querySelectorAll(':scope > .filters')];
    const prefs = _prefsAltas();

    // Barra "Mostrar:" para elegir qué formularios ver
    const barra = document.createElement('div');
    barra.className = 'altas-barra';
    barra.innerHTML = '<span class="altas-barra-tit">Mostrar:</span>' + FORMULARIOS_ALTA.map(f =>
        `<label class="rep-chip"><input type="checkbox" data-form="${f.clave}" ${prefs.ocultos?.includes(f.clave) ? '' : 'checked'}>
         <span>${escHtml(f.titulo)}</span></label>`).join('') +
        '<span class="altas-vacio" style="display:none">Elegí al menos un formulario para cargar.</span>';
    cont.prepend(barra);

    tarjetas.forEach((card, i) => {
        const f = FORMULARIOS_ALTA[i];
        if (!f) return;
        card.dataset.form = f.clave;
        card.classList.add('alta-card');
        const h2 = card.querySelector('h2');
        if (h2) {
            h2.classList.add('filtros-titulo');
            h2.setAttribute('role', 'button');
            h2.setAttribute('tabindex', '0');
            h2.title = 'Desplegar o plegar';
            h2.insertAdjacentHTML('beforeend', '<span class="filtros-chevron" aria-hidden="true">▾</span>');
            const alternar = () => {
                const p = _prefsAltas();
                p.plegados = p.plegados || [];
                const plegar = !card.classList.contains('plegado');
                card.classList.toggle('plegado', plegar);
                h2.setAttribute('aria-expanded', String(!plegar));
                p.plegados = plegar ? [...new Set([...p.plegados, f.clave])] : p.plegados.filter(x => x !== f.clave);
                _guardarPrefsAltas(p);
            };
            h2.addEventListener('click', alternar);
            h2.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); } });
            const plegado = !!prefs.plegados?.includes(f.clave);
            card.classList.toggle('plegado', plegado);
            h2.setAttribute('aria-expanded', String(!plegado));
        }
    });

    barra.querySelectorAll('[data-form]').forEach(chk => chk.addEventListener('change', aplicarVisibilidadAltas));
    aplicarVisibilidadAltas();

    // Panel con lo cargado en esta sesión, debajo de los formularios
    const panel = document.createElement('div');
    panel.className = 'table-container cargas-sesion';
    panel.innerHTML = `
        <div class="table-header-row">
            <h2>Cargado en esta sesión</h2>
            <div class="header-acciones">
                <span id="cargasSesionResumen" class="cargas-resumen"></span>
                <button type="button" class="btn-accion" onclick="limpiarCargasSesion()">Limpiar lista</button>
            </div>
        </div>
        <div class="historial-sim-lista">
            <table class="panel-historial" id="tablaCargasSesion">
                <thead><tr><th>Hora</th><th>Tipo</th><th>Número / Código</th><th>ICCID</th><th>Telefonía</th><th>Estado</th><th>RC / Detalle</th><th>Origen</th></tr></thead>
                <tbody id="cargasSesionBody"></tbody>
            </table>
        </div>`;
    cont.appendChild(panel);
    pintarCargasSesion();
}

function aplicarVisibilidadAltas() {
    const cont = document.getElementById('subtab-altas');
    const visibles = [...cont.querySelectorAll('.altas-barra [data-form]:checked')].map(c => c.dataset.form);
    cont.querySelectorAll(':scope > .alta-card').forEach(card => {
        card.style.display = visibles.includes(card.dataset.form) ? '' : 'none';
    });
    cont.querySelector('.altas-vacio').style.display = visibles.length ? 'none' : '';
    const p = _prefsAltas();
    p.ocultos = FORMULARIOS_ALTA.map(f => f.clave).filter(k => !visibles.includes(k));
    _guardarPrefsAltas(p);
}

// Lo cargado se guarda en sessionStorage: sobrevive a recargar la página, no a cerrar la pestaña
let _cargasSesion = [];
try { _cargasSesion = JSON.parse(sessionStorage.getItem('cargasSesion') || '[]'); } catch { _cargasSesion = []; }
let _origenCarga = 'Manual';

function registrarCarga(c) {
    _cargasSesion.unshift({ hora: new Date().toISOString(), ...c });
    try { sessionStorage.setItem('cargasSesion', JSON.stringify(_cargasSesion.slice(0, 500))); } catch { /* sin almacenamiento */ }
    pintarCargasSesion();
}

function limpiarCargasSesion() {
    if (_cargasSesion.length && !confirm('¿Vaciar la lista de lo cargado en esta sesión?\n(No borra nada de la base: solo esta lista.)')) return;
    _cargasSesion = [];
    try { sessionStorage.removeItem('cargasSesion'); } catch { /* sin almacenamiento */ }
    pintarCargasSesion();
}

function pintarCargasSesion() {
    const tbody = document.getElementById('cargasSesionBody');
    if (!tbody) return;
    const rcs = _cargasSesion.filter(c => c.tipo === 'RC').length;
    document.getElementById('cargasSesionResumen').textContent = _cargasSesion.length
        ? `${rcs} RC · ${_cargasSesion.length - rcs} línea(s)` : '';
    if (!_cargasSesion.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="panel-empty">Todavía no cargaste nada en esta sesión. Lo que des de alta arriba aparece acá.</td></tr>';
        return;
    }
    const hora = ts => new Date(ts).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    tbody.innerHTML = _cargasSesion.map(c => `
        <tr>
            <td class="td-fecha">${hora(c.hora)}</td>
            <td><span class="badge-tipo-carga ${c.tipo === 'RC' ? 'carga-rc' : 'carga-linea'}">${escHtml(c.tipo)}</span></td>
            <td>${c.tipo === 'RC'
                    ? `<span class="link-rc" onclick="abrirPanelRC(this.textContent)">${escHtml(c.ref)}</span>`
                    : escHtml(c.ref) || '-'}</td>
            <td class="td-imei">${c.iccid ? iccidVisual(c.iccid) : '-'}</td>
            <td>${c.telefonia ? badgeTelefonia(c.telefonia) : '-'}</td>
            <td>${escHtml(c.estado) || '-'}</td>
            <td>${c.rc && c.tipo !== 'RC' ? `<span class="link-rc" onclick="abrirPanelRC(this.textContent)">${escHtml(c.rc)}</span>` : escHtml(c.rc && c.tipo === 'RC' ? c.rc : '') || '-'}</td>
            <td>${escHtml(c.origen)}</td>
        </tr>`).join('');
}

// Engancha las altas de app.js para anotar lo que se carga
function engancharCargasSesion() {
    const crear = window.crearLineaInventario;
    if (typeof crear === 'function') {
        window.crearLineaInventario = async function (datos) {
            const fila = await crear.call(this, datos);   // si falla, lanza y no se anota
            if (fila) registrarCarga({
                tipo: 'Línea',
                ref: fila.numero || '',
                iccid: fila.iccid || '',
                telefonia: fila.telefonia,
                estado: ESTADO_HIST_LABEL[fila.estado] || fila.estado,
                rc: fila.rc_codigo || '',
                origen: _origenCarga,
            });
            return fila;
        };
    }
    const conOrigen = (nombre, origen) => {
        const orig = window[nombre];
        if (typeof orig !== 'function') return;
        window[nombre] = async function (...args) {
            _origenCarga = origen;
            try { return await orig.apply(this, args); } finally { _origenCarga = 'Manual'; }
        };
    };
    conOrigen('guardarEscaneo', 'Lector');
    conOrigen('guardarAltaLinea', 'Nueva línea');

    const altaRC = window.guardarAltaRC;
    if (typeof altaRC === 'function') {
        window.guardarAltaRC = async function (...args) {
            const v = id => (document.getElementById(id)?.value || '').trim();
            const datos = { codigo: v('altaRcCodigo'), regional: v('altaRcRegional'),
                            sim1: v('altaRcSim1Num'), iccid1: v('altaRcSim1Iccid'), sim2: v('altaRcSim2Num') };
            const antes = todosLosDatos.length;
            const r = await altaRC.apply(this, args);
            const creado = todosLosDatos.length > antes && todosLosDatos.some(d => d.codigo === datos.codigo);
            if (creado) registrarCarga({
                tipo: 'RC',
                ref: datos.codigo,
                iccid: datos.iccid1,
                telefonia: typeof telefoniaDeIccid === 'function' ? telefoniaDeIccid(limpiarIccid(datos.iccid1)) : '',
                estado: 'Activado',
                rc: [datos.regional, datos.sim1 && `SIM 1: ${datos.sim1}`, datos.sim2 && `SIM 2: ${datos.sim2}`].filter(Boolean).join(' · '),
                origen: 'Nuevo RC',
            });
            return r;
        };
    }
}

// ── Sub-pestañas de Altas: "Nuevo RC y líneas" / "Inventario de líneas" ──

function cambiarSubtabAltas(cual) {
    ['altas', 'inventario'].forEach(k => {
        const panel = document.getElementById('subtab-' + k);
        const btn = document.getElementById('subtabBtn' + (k === 'altas' ? 'Altas' : 'Inventario'));
        if (panel) panel.style.display = k === cual ? '' : 'none';
        btn?.classList.toggle('subtab-activa', k === cual);
        btn?.setAttribute('aria-selected', String(k === cual));
    });
    try { localStorage.setItem('subtabAltas', cual); } catch { /* sin almacenamiento */ }
    if (cual === 'inventario') kpiInventario();
}

// ── Enganches ─────────────────────────────────────────────────────

function iniciarMejorasUI() {
    ponerResumenAlCostado(document.querySelector('#tab-consumo .table-container'), 'kpiConsumo');
    ponerResumenAlCostado(document.querySelector('#subtab-inventario .table-container'), 'kpiInventario');
    prepararFormulariosAlta();
    engancharCargasSesion();
    prepararTablasResponsivas();
    let sub = 'altas';
    try { sub = localStorage.getItem('subtabAltas') || 'altas'; } catch { /* sin almacenamiento */ }
    cambiarSubtabAltas(sub);
    Object.keys(GRUPOS_FILTRO).forEach(prepararGrupoFiltro);

    ['aplicarFiltrosConsumo', 'limpiarFiltrosConsumo', 'cargarConsumos', 'aplicarFiltrosLineas', 'limpiarFiltrosLineas',
     'aplicarFiltroRC', 'limpiarFiltroRC', 'aplicarFiltros', 'limpiarFiltros', 'cambiarVista']
        .forEach(n => _despuesDe(n, pintarTodosLosChips));

    _despuesDe('actualizarTotalesLineas', t => { _ultimosTotalesLineas = t; kpiConsumo(); });
    ['actualizarTotalConsumo', 'mostrarConsolidado', 'aplicarFiltroRC', 'limpiarFiltroRC', 'cambiarVista']
        .forEach(n => _despuesDe(n, () => kpiConsumo()));
    _despuesDe('renderInventarioLineas', kpiInventario);
    _despuesDe('renderActivaciones', kpiActivaciones);
    _despuesDe('renderHistorialSIMLista', kpiHistorialSIM);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarMejorasUI);
else iniciarMejorasUI();
