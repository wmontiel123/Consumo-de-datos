// ══════════════════════════════════════════════════════════════════
// ── REPORTES (Excel / PDF) ────────────────────────────────────────
// Ventana "Generar reporte": se elige el tipo de reporte, los filtros
// (cada filtro admite varios valores; sin marcar = todos) y el formato.
// El reporte trae un resumen (totales por grupo) y, opcionalmente, el detalle.
// Usa funciones y variables globales de app.js (se carga después).
// ══════════════════════════════════════════════════════════════════

const etiquetaEstado = est => {
    const cfg = esViewer() ? ESTADO_CONFIG_VIEWER[estadoSimple(est)] : ESTADO_CONFIG_DISP[est];
    return String(cfg?.label || est || '').replace('● ', '');
};
const _txt = v => { const s = String(v ?? '').trim(); return s === '-' ? '' : s; };
const _norm = v => String(v ?? '').trim().toLowerCase();

// Trae todas las filas de una consulta en lotes de 1000 (límite de PostgREST)
async function traerTodasLasFilas(armarQuery, lote = 1000) {
    let filas = [];
    for (let desde = 0; ; desde += lote) {
        const { data, error } = await armarQuery().range(desde, desde + lote - 1);
        if (error) throw error;
        filas = filas.concat(data || []);
        if (!data || data.length < lote) return filas;
    }
}

// Trae en paralelo (5 a la vez) todas las filas de una consulta con count exacto
async function traerTodasEnParalelo(armarQuery, alAvanzar) {
    const { count, error } = await armarQuery({ head: true });
    if (error) throw error;
    if (!count) return [];
    const LOTE = 1000, CONC = 5, paginas = Math.ceil(count / LOTE);
    const partes = new Array(paginas);
    for (let b = 0; b < paginas; b += CONC) {
        await Promise.all(Array.from({ length: Math.min(CONC, paginas - b) }, async (_, j) => {
            const p = b + j;
            const { data, error: e } = await armarQuery().range(p * LOTE, p * LOTE + LOTE - 1);
            if (e) throw e;
            partes[p] = data || [];
        }));
        alAvanzar?.(Math.min(paginas, b + CONC) / paginas);
    }
    return partes.flat();
}

// ── Datos auxiliares ──────────────────────────────────────────────

const TELEFONIAS = ['Claro', 'Personal', 'Tigo', 'Vox'];
const _regionales = () => [...new Set(todosLosDatos.map(d => _txt(d.regional)).filter(Boolean))].sort();
const _deviceDe = (numero, iccid) => {
    const n = String(numero || '').trim(), i = normalizarImei(iccid);
    return (n && n.toLowerCase() !== 'm2m' && mapaNumADevice.get(n)) || (i && mapaImeiADevice.get(i)) || null;
};
const _deviceDeRC = codigo => todosLosDatos.find(d => d.codigo === codigo) || null;
// "RC_1, rc_2  RC_3" → ['rc_1','rc_2','rc_3']
const _listaTexto = v => String(v || '').split(/[\s,;]+/).map(_norm).filter(Boolean);
const _hoy = () => new Date().toISOString().substring(0, 10);
const _inicioMes = () => _hoy().substring(0, 8) + '01';
const _fechaDe = ts => ts ? String(ts).substring(0, 10) : '';
const _enRango = (fecha, f) => (!f.desde || fecha >= f.desde) && (!f.hasta || fecha <= f.hasta);

// Filtros reutilizables. tipo: 'multi' (casillas), 'fechas' (desde/hasta), 'texto', 'check'
const FILTROS = {
    telefonia:  { tipo: 'multi', titulo: 'Telefonía', opciones: () => TELEFONIAS.map(t => [t, t]) },
    regional:   { tipo: 'multi', titulo: 'Regional',  opciones: () => _regionales().map(r => [r, r]) },
    estadoSim:  { tipo: 'multi', titulo: 'Estado de la línea', opciones: () => [['activo', 'Activado'], ['desactivado', 'Desactivado']] },
    estadoRC:   { tipo: 'multi', titulo: 'Estado del RC', opciones: () => esViewer()
                    ? [['activo', 'Activado'], ['desactivado', 'Desactivado']]
                    : [['activo', 'Activado'], ['sin_consumo', 'Sin consumo'], ['desactivado', 'Desactivado']] },
    tipoRC:     { tipo: 'multi', titulo: 'Tipo de RC', opciones: () => Object.entries(TIPO_CONFIG).map(([k, v]) => [k, v.label]) },
    estadoInv:  { tipo: 'multi', titulo: 'Estado en inventario', opciones: () => [['disponible', 'Disponible'], ['asignada', 'Asignada'], ['desactivada', 'Desactivada']] },
    tipoAct:    { tipo: 'multi', titulo: 'Tipo', opciones: () => [['rc', 'RC'], ['linea', 'Líneas']] },
    rc:         { tipo: 'texto', titulo: 'RC (uno o varios, separados por coma)', placeholder: 'Ej: RC_55591, RC_10243' },
    fechas:     { tipo: 'fechas', titulo: 'Período' },
    fechasAct:  { tipo: 'fechas', titulo: 'Fecha de activación' },
    automaticas:{ tipo: 'check', titulo: 'Incluir altas automáticas (sistema)' },
};

// Filtra una lista con las opciones múltiples elegidas (vacío = todas)
const _pasa = (valor, elegidos, normalizar = _norm) =>
    !elegidos?.length || elegidos.some(e => normalizar(e) === normalizar(valor));

// ── Definición de reportes ────────────────────────────────────────
// obtener(f) → { columnas, filas, numericas, resumenes: [{ titulo, columnas, filas, numericas }] }

const _capital = t => t.charAt(0).toUpperCase() + t.slice(1);

function _resumenPor(titulo, filas, clave, valorMB = null) {
    const grupos = new Map();
    filas.forEach(r => {
        const k = clave(r) || '(sin dato)';
        const g = grupos.get(k) || { n: 0, mb: 0 };
        g.n++;
        if (valorMB) g.mb += valorMB(r) || 0;
        grupos.set(k, g);
    });
    const orden = [...grupos.entries()].sort((a, b) => valorMB ? b[1].mb - a[1].mb : b[1].n - a[1].n);
    const total = orden.reduce((s, [, g]) => ({ n: s.n + g.n, mb: s.mb + g.mb }), { n: 0, mb: 0 });
    return valorMB
        ? { titulo, columnas: [_capital(titulo.replace(/^Por /, '')), 'Cantidad', 'MB'], numericas: [1, 2],
            filas: [...orden.map(([k, g]) => [k, g.n, g.mb]), ['TOTAL', total.n, total.mb]] }
        : { titulo, columnas: [_capital(titulo.replace(/^Por /, '')), 'Cantidad'], numericas: [1],
            filas: [...orden.map(([k, g]) => [k, g.n]), ['TOTAL', total.n]] };
}

// Filtra filas de consumo/líneas por regional y RC (vía el RC que tiene la línea)
function _filtrarPorRC(filas, f, getNum, getIccid) {
    const rcs = _listaTexto(f.rc);
    if (!f.regional?.length && !rcs.length) return filas;
    return filas.filter(r => {
        const d = _deviceDe(getNum(r), getIccid(r));
        if (f.regional?.length && !_pasa(d?.regional, f.regional)) return false;
        if (rcs.length && !(d && rcs.some(x => _norm(d.codigo).includes(x)))) return false;
        return true;
    });
}

const _estadoLinea = c => estadoSimple(estadoConsDisplay(c));

const REPORTES = {
    consumoLinea: {
        titulo: 'Consumo por línea',
        descripcion: 'MB de cada línea sumados en el período.',
        filtros: ['fechas', 'telefonia', 'regional', 'estadoSim', 'rc'],
        async obtener(f) {
            const { data, error } = await window.clienteSupabase.rpc('consumo_por_linea', {
                p_telefonia: f.telefonia?.length === 1 ? f.telefonia[0] : null,
                p_estados: null, p_desde: f.desde || null, p_hasta: f.hasta || null,
                p_numeros: null, p_imeis: null, p_num_like: null, p_obs_like: null,
            });
            if (error) throw error;
            let filas = (data || []).filter(c => _pasa(c.telefonia, f.telefonia) && _pasa(_estadoLinea(c), f.estadoSim));
            filas = _filtrarPorRC(filas, f, c => c.numero, c => c.imei);
            filas.sort((a, b) => (parseFloat(b.consumo_mb) || 0) - (parseFloat(a.consumo_mb) || 0));
            const mb = c => parseFloat(c.consumo_mb) || 0;
            const reg = c => _deviceDe(c.numero, c.imei)?.regional;
            return {
                columnas: ['Estado', 'Número', 'ICCID', 'Telefonía', 'RC', 'Regional', 'Días', 'MB'],
                numericas: [6, 7],
                filas: filas.map(c => [etiquetaEstado(estadoConsDisplay(c)), _txt(c.numero), normalizarImei(c.imei) || '',
                    _txt(c.telefonia), _txt(encontrarRC(c)), _txt(reg(c)), c.dias || 0, mb(c)]),
                resumenes: [
                    _resumenPor('Por telefonía', filas, c => c.telefonia, mb),
                    _resumenPor('Por regional', filas, reg, mb),
                    _resumenPor('Por estado', filas, c => etiquetaEstado(_estadoLinea(c)), mb),
                ],
            };
        },
    },

    consumoRC: {
        titulo: 'Consumo por RC',
        descripcion: 'MB de la SIM principal y de respaldo de cada RC en el período.',
        filtros: ['fechas', 'telefonia', 'regional', 'rc'],
        async obtener(f) {
            const { data, error } = await window.clienteSupabase.rpc('consumo_por_linea', {
                p_telefonia: f.telefonia?.length === 1 ? f.telefonia[0] : null, p_estados: null,
                p_desde: f.desde || null, p_hasta: f.hasta || null,
                p_numeros: null, p_imeis: null, p_num_like: null, p_obs_like: null,
            });
            if (error) throw error;
            let filas = (data || []).filter(c => _pasa(c.telefonia, f.telefonia));
            filas = _filtrarPorRC(filas, f, c => c.numero, c => c.imei);
            const cons = buildConsolidado(filas).filter(x => x.rc && x.rc !== '-').sort((a, b) => b.totalMB - a.totalMB);
            const reg = x => _deviceDeRC(x.rc)?.regional || x.regional;
            return {
                columnas: ['RC', 'Regional', 'SIM Principal', 'MB SIM Principal', 'SIM Respaldo', 'MB SIM Respaldo', 'Total MB'],
                numericas: [3, 5, 6],
                filas: cons.map(x => [x.rc, _txt(reg(x)), _txt(x.sim1Label), x.sim1MB,
                    x.sim2Label !== '-' ? x.sim2Label : '', x.sim2Label !== '-' ? x.sim2MB : '', x.totalMB]),
                resumenes: [_resumenPor('Por regional', cons, reg, x => x.totalMB)],
            };
        },
    },

    consumoDiario: {
        titulo: 'Consumo diario (detalle)',
        descripcion: 'Una fila por línea y por día. Conviene acotar el período.',
        filtros: ['fechas', 'telefonia', 'regional', 'estadoSim', 'rc'],
        async obtener(f, avance) {
            const COLS = 'consumo_mb,fecha_consumo,telefonia,numero,imei,estado,observacion,estado_operador';
            let filas = await traerTodasEnParalelo(({ head } = {}) => {
                let q = window.clienteSupabase.from('consumo_sim').select(head ? '*' : COLS, head ? { count: 'exact', head: true } : undefined);
                if (f.telefonia?.length) q = q.in('telefonia', f.telefonia);
                if (f.desde) q = q.gte('fecha_consumo', f.desde);
                if (f.hasta) q = q.lte('fecha_consumo', f.hasta);
                return head ? q : q.order('fecha_consumo', { ascending: true }).order('id', { ascending: true });
            }, avance);
            filas = filas.filter(c => _pasa(_estadoLinea(c), f.estadoSim));
            filas = _filtrarPorRC(filas, f, c => c.numero, c => c.imei);
            const mb = c => parseFloat(c.consumo_mb) || 0;
            const columnas = ['Fecha', 'Estado', 'RC', 'Regional', 'Número', 'ICCID', 'Telefonía', 'MB'];
            if (!esViewer()) columnas.push('Observación');
            return {
                columnas, numericas: [7],
                filas: filas.map(c => {
                    const fila = [formatearFecha(c.fecha_consumo), etiquetaEstado(estadoConsDisplay(c)), _txt(encontrarRC(c)),
                        _txt(_deviceDe(c.numero, c.imei)?.regional), _txt(c.numero), normalizarImei(c.imei) || '',
                        _txt(c.telefonia), mb(c)];
                    if (!esViewer()) fila.push(_txt(c.observacion));
                    return fila;
                }),
                resumenes: [
                    _resumenPor('Por fecha', filas, c => formatearFecha(c.fecha_consumo), mb),
                    _resumenPor('Por telefonía', filas, c => c.telefonia, mb),
                ],
            };
        },
    },

    lineas: {
        titulo: 'Líneas',
        descripcion: 'Estado actual de cada línea, con MB del mes y totales.',
        filtros: ['telefonia', 'regional', 'estadoSim', 'rc'],
        async obtener(f) {
            let filas = await traerTodasLasFilas(() => {
                let q = window.clienteSupabase.from('vista_lineas_estado').select('*');
                if (f.telefonia?.length) q = q.in('telefonia', f.telefonia);
                return q.order('numero', { ascending: true, nullsFirst: false }).order('imei', { ascending: true });
            });
            filas = filas.filter(r => _pasa(estadoSimple(getEstadoSIM(r)), f.estadoSim));
            const rcs = _listaTexto(f.rc);
            filas = filas.filter(r => _pasa(r.regional, f.regional) && (!rcs.length || rcs.some(x => _norm(r.rc).includes(x))));
            const mbT = r => parseFloat(r.consumo_total_mb) || 0;
            return {
                columnas: ['Estado', 'Número', 'ICCID', 'Telefonía', 'RC', 'Regional', 'MB Mes', 'MB Total', 'Última fecha'],
                numericas: [6, 7],
                filas: filas.map(r => [etiquetaEstado(getEstadoSIM(r)), _txt(r.numero), normalizarImei(r.imei) || '',
                    _txt(r.telefonia), _txt(r.rc), _txt(r.regional),
                    parseFloat(r.consumo_mes_mb) || 0, mbT(r), r.ultima_fecha ? formatearFecha(r.ultima_fecha) : '']),
                resumenes: [
                    _resumenPor('Por telefonía', filas, r => r.telefonia),
                    _resumenPor('Por estado', filas, r => etiquetaEstado(estadoSimple(getEstadoSIM(r)))),
                    _resumenPor('Por regional', filas, r => r.regional || '(sin RC)'),
                ],
            };
        },
    },

    dispositivos: {
        titulo: 'Dispositivos',
        descripcion: 'RC con su ubicación, SIM y fecha de activación.',
        filtros: ['regional', 'estadoRC', 'tipoRC', 'fechasAct', 'rc'],
        async obtener(f) {
            const rcs = _listaTexto(f.rc);
            const est = d => esViewer() ? estadoSimple(estadoDisp(d)) : estadoDisp(d);
            const filas = todosLosDatos.filter(d =>
                _pasa(d.regional, f.regional) && _pasa(est(d), f.estadoRC) && _pasa(getTipoDevice(d), f.tipoRC) &&
                (!(f.desde || f.hasta) || (d.fecha_activacion && _enRango(_fechaDe(d.fecha_activacion), f))) &&
                (!rcs.length || rcs.some(x => _norm(d.codigo).includes(x))))
                .sort((a, b) => String(a.regional).localeCompare(b.regional) || String(a.codigo).localeCompare(b.codigo));
            return {
                columnas: ['Estado', 'Regional', 'Código', 'Tipo', 'Ubicación', 'SIM 1 - Número', 'SIM 1 - ICCID',
                           'SIM 2 - Número', 'SIM 2 - ICCID', 'Fecha activación'],
                filas: filas.map(d => [etiquetaEstado(estadoDisp(d)), _txt(d.regional), _txt(d.codigo),
                    TIPO_CONFIG[getTipoDevice(d)]?.label || '', _txt(d.ubicacion),
                    _txt(d.sim1_num), normalizarImei(d.sim1_imei) || '', _txt(d.sim2_num), normalizarImei(d.sim2_imei) || '',
                    d.fecha_activacion ? formatearFecha(_fechaDe(d.fecha_activacion)) : '']),
                resumenes: [
                    _resumenPor('Por regional', filas, d => d.regional),
                    _resumenPor('Por estado', filas, d => etiquetaEstado(estadoDisp(d))),
                    _resumenPor('Por tipo', filas, d => TIPO_CONFIG[getTipoDevice(d)]?.label),
                ],
            };
        },
    },

    inventario: {
        titulo: 'Inventario de líneas',
        descripcion: 'Líneas del inventario y a qué RC están asignadas.',
        soloAdmin: true,
        filtros: ['telefonia', 'estadoInv', 'regional', 'rc'],
        async obtener(f) {
            if (!inventarioLineas.length) await cargarLineas();
            const rcs = _listaTexto(f.rc);
            const reg = l => l.rc_codigo ? _deviceDeRC(l.rc_codigo)?.regional : '';
            const filas = inventarioLineas.filter(l =>
                _pasa(l.telefonia, f.telefonia) && _pasa(l.estado, f.estadoInv) &&
                (!f.regional?.length || _pasa(reg(l), f.regional)) &&
                (!rcs.length || rcs.some(x => _norm(l.rc_codigo).includes(x))));
            return {
                columnas: ['Número', 'ICCID', 'Telefonía', 'Estado', 'RC', 'Slot', 'Regional', 'Cargada', 'Por', 'Observación'],
                filas: filas.map(l => [_txt(l.numero), _txt(l.iccid), _txt(l.telefonia),
                    ESTADO_HIST_LABEL[l.estado] || l.estado, _txt(l.rc_codigo),
                    l.sim_slot ? (l.sim_slot === 'sim1' ? 'SIM 1' : 'SIM 2') : '', _txt(reg(l)),
                    formatearFechaHora(l.creado_en), _txt(l.creado_por), _txt(l.observacion)]),
                resumenes: [
                    _resumenPor('Por telefonía', filas, l => l.telefonia),
                    _resumenPor('Por estado', filas, l => ESTADO_HIST_LABEL[l.estado] || l.estado),
                ],
            };
        },
    },

    historialSim: {
        titulo: 'Cambios de SIM',
        descripcion: 'Historial de cambios de SIM en los RC.',
        filtros: ['fechas', 'regional', 'rc'],
        async obtener(f) {
            if (historialSimLista === null) await cargarHistorialSIMLista();
            const rcs = _listaTexto(f.rc);
            const reg = h => _deviceDeRC(h.rc_codigo)?.regional;
            const filas = (historialSimLista || []).filter(h =>
                _enRango(_fechaDe(h.fecha_campo || h.fecha_cambio), f) && _pasa(reg(h), f.regional) &&
                (!rcs.length || rcs.some(x => _norm(h.rc_codigo).includes(x))));
            return {
                columnas: ['Fecha en campo', 'Registrado', 'Código', 'Regional', 'Slot', 'Número anterior', 'Número nuevo',
                           'ICCID anterior', 'ICCID nuevo', 'Usuario', 'Observación'],
                filas: filas.map(h => [h.fecha_campo ? formatearFecha(h.fecha_campo) : '', formatearFechaHora(h.fecha_cambio),
                    _txt(h.rc_codigo), _txt(reg(h)), h.sim_slot === 'sim1' ? 'SIM 1' : 'SIM 2',
                    _txt(h.numero_ant), _txt(h.numero_nuevo), _txt(h.imei_ant), _txt(h.imei_nuevo),
                    _txt(h.usuario), _txt(h.observacion)]),
                resumenes: [_resumenPor('Por regional', filas, reg), _resumenPor('Por usuario', filas, h => h.usuario)],
            };
        },
    },

    activaciones: {
        titulo: 'Activaciones y desactivaciones',
        descripcion: 'Altas, activaciones y desactivaciones de RC y líneas.',
        filtros: ['fechas', 'tipoAct', 'automaticas'],
        async obtener(f) {
            if (activacionesLista === null) await cargarActivaciones();
            const est = e => e ? (ESTADO_HIST_LABEL[e] || e) : '';
            const filas = (activacionesLista || []).filter(h =>
                _enRango(_fechaDe(h.fecha), f) && _pasa(h.tipo, f.tipoAct) && (f.automaticas || h.usuario !== 'sistema'));
            return {
                columnas: ['Fecha', 'Tipo', 'RC / Línea', 'Estado anterior', 'Estado nuevo', 'Usuario', 'Motivo'],
                filas: filas.map(h => [formatearFechaHora(h.fecha), h.tipo === 'rc' ? 'RC' : 'Línea',
                    _txt(h.referencia), est(h.estado_anterior), est(h.estado_nuevo), _txt(h.usuario), _txt(h.motivo)]),
                resumenes: [
                    _resumenPor('Por estado nuevo', filas, h => est(h.estado_nuevo)),
                    _resumenPor('Por usuario', filas, h => h.usuario),
                ],
            };
        },
    },
};

// Reporte que se abre por defecto desde cada pestaña
const REPORTE_DE_VISTA = {
    consumo:      () => vistaConsumo === 'equipos' ? 'consumoRC' : vistaConsumo === 'lineas-bd' ? 'lineas' : 'consumoLinea',
    dispositivos: () => 'dispositivos',
    historial:    () => 'historialSim',
    activaciones: () => 'activaciones',
    inventario:   () => 'inventario',
};

// ── Ventana "Generar reporte" ─────────────────────────────────────

let _reporteSel = 'consumoLinea';
const _seleccion = {};   // filtros elegidos, se recuerdan mientras la página esté abierta

function abrirReporte(vista) {
    _reporteSel = REPORTE_DE_VISTA[vista]?.() || _reporteSel;
    if (!document.getElementById('modalReporte')) _crearModalReporte();
    const sel = document.getElementById('repTipo');
    sel.innerHTML = Object.entries(REPORTES)
        .filter(([, r]) => !(r.soloAdmin && esViewer()))
        .map(([k, r]) => `<option value="${k}">${escHtml(r.titulo)}</option>`).join('');
    sel.value = _reporteSel;
    _renderFiltrosReporte();
    document.getElementById('repEstado').textContent = '';
    document.getElementById('modalReporte').style.display = 'flex';
}

function cerrarReporte() {
    document.getElementById('modalReporte').style.display = 'none';
}

function _crearModalReporte() {
    const div = document.createElement('div');
    div.id = 'modalReporte';
    div.className = 'import-modal-overlay';
    div.style.cssText = 'display:none;z-index:2600';
    div.onclick = e => { if (e.target === div) cerrarReporte(); };
    div.innerHTML = `
        <div class="import-modal-card reporte-card">
            <div class="import-modal-header">
                <h3 style="display:flex;align-items:center;gap:8px">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>
                    Generar reporte
                </h3>
                <button class="import-close" onclick="cerrarReporte()">✕</button>
            </div>
            <div class="import-modal-body reporte-body">
                <div class="filter-group">
                    <label>Reporte</label>
                    <select id="repTipo" onchange="_reporteSel = this.value; _renderFiltrosReporte()"></select>
                    <div id="repDescripcion" class="rep-desc"></div>
                </div>
                <div id="repFiltros"></div>
                <div class="rep-opciones">
                    <div class="rep-formato">
                        <label class="rep-radio"><input type="radio" name="repFormato" value="pdf" checked> PDF</label>
                        <label class="rep-radio"><input type="radio" name="repFormato" value="xlsx"> Excel</label>
                    </div>
                    <label class="check-inline"><input type="checkbox" id="repDetalle" checked> Incluir el detalle (no solo el resumen)</label>
                </div>
                <div id="repEstado" class="rep-estado"></div>
                <button class="btn-import-go" id="repGenerar" onclick="generarReporte()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Generar
                </button>
            </div>
        </div>`;
    document.body.appendChild(div);
}

function _renderFiltrosReporte() {
    const rep = REPORTES[_reporteSel];
    document.getElementById('repDescripcion').textContent = rep.descripcion;
    const s = _seleccion;
    // Período por defecto: el mes actual (el consumo diario sin período sería enorme)
    if (s.desde === undefined) { s.desde = _inicioMes(); s.hasta = _hoy(); }

    document.getElementById('repFiltros').innerHTML = rep.filtros.map(k => {
        const def = FILTROS[k];
        if (def.tipo === 'fechas') {
            const act = k === 'fechasAct';
            return `<div class="rep-filtro"><div class="rep-filtro-tit">${def.titulo}</div>
                <div class="rep-fechas">
                    <label>Desde <input type="date" data-f="${act ? 'actDesde' : 'desde'}" value="${(act ? s.actDesde : s.desde) || ''}"></label>
                    <label>Hasta <input type="date" data-f="${act ? 'actHasta' : 'hasta'}" value="${(act ? s.actHasta : s.hasta) || ''}"></label>
                    ${act ? '' : `<span class="rep-atajos">
                        <button type="button" onclick="_atajoPeriodo('mes')">Este mes</button>
                        <button type="button" onclick="_atajoPeriodo('anterior')">Mes anterior</button>
                        <button type="button" onclick="_atajoPeriodo('30')">Últimos 30 días</button>
                        <button type="button" onclick="_atajoPeriodo('todo')">Todo</button></span>`}
                </div></div>`;
        }
        if (def.tipo === 'texto') {
            return `<div class="rep-filtro"><div class="rep-filtro-tit">${def.titulo}</div>
                <input type="text" data-f="${k}" value="${escHtml(s[k] || '')}" placeholder="${def.placeholder || ''}"></div>`;
        }
        if (def.tipo === 'check') {
            return `<div class="rep-filtro"><label class="check-inline"><input type="checkbox" data-f="${k}" ${s[k] ? 'checked' : ''}> ${def.titulo}</label></div>`;
        }
        const elegidos = s[k] || [];
        const opciones = def.opciones();
        return `<div class="rep-filtro"><div class="rep-filtro-tit">${def.titulo}
                <span class="rep-filtro-ayuda">${elegidos.length ? `${elegidos.length} elegido(s)` : 'todos'}</span>
                <button type="button" class="rep-link" onclick="_marcarTodos('${k}', true)">marcar todos</button>
                <button type="button" class="rep-link" onclick="_marcarTodos('${k}', false)">ninguno</button></div>
            <div class="rep-chips">${opciones.map(([v, l]) =>
                `<label class="rep-chip"><input type="checkbox" data-multi="${k}" value="${escHtml(v)}" ${elegidos.includes(v) ? 'checked' : ''}>
                 <span>${escHtml(l)}</span></label>`).join('')}</div></div>`;
    }).join('');

    document.querySelectorAll('#repFiltros [data-multi]').forEach(el => el.onchange = _leerFiltrosReporte);
    document.querySelectorAll('#repFiltros [data-f]').forEach(el => el.oninput = el.onchange = _leerFiltrosReporte);
}

function _leerFiltrosReporte() {
    const s = _seleccion;
    document.querySelectorAll('#repFiltros [data-f]').forEach(el => {
        s[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
    });
    const multis = new Set([...document.querySelectorAll('#repFiltros [data-multi]')].map(el => el.dataset.multi));
    multis.forEach(k => {
        s[k] = [...document.querySelectorAll(`#repFiltros [data-multi="${k}"]:checked`)].map(el => el.value);
        const ayuda = document.querySelector(`#repFiltros [data-multi="${k}"]`).closest('.rep-filtro').querySelector('.rep-filtro-ayuda');
        if (ayuda) ayuda.textContent = s[k].length ? `${s[k].length} elegido(s)` : 'todos';
    });
}

function _marcarTodos(k, marcar) {
    document.querySelectorAll(`#repFiltros [data-multi="${k}"]`).forEach(el => { el.checked = marcar; });
    _leerFiltrosReporte();
}

function _atajoPeriodo(cual) {
    const hoy = new Date();
    const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().substring(0, 10);
    let desde = '', hasta = '';
    if (cual === 'mes')      { desde = iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)); hasta = iso(hoy); }
    if (cual === 'anterior') { desde = iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)); hasta = iso(new Date(hoy.getFullYear(), hoy.getMonth(), 0)); }
    if (cual === '30')       { desde = iso(new Date(hoy.getTime() - 29 * 86400000)); hasta = iso(hoy); }
    _seleccion.desde = desde; _seleccion.hasta = hasta;
    document.querySelector('#repFiltros [data-f="desde"]').value = desde;
    document.querySelector('#repFiltros [data-f="hasta"]').value = hasta;
}

// Texto con los filtros aplicados (para el encabezado del reporte)
function _describirFiltros(rep, f) {
    const partes = [];
    rep.filtros.forEach(k => {
        const def = FILTROS[k];
        if (def.tipo === 'fechas') {
            const [d, h] = k === 'fechasAct' ? [f.actDesde, f.actHasta] : [f.desde, f.hasta];
            if (d || h) partes.push([def.titulo, `${d ? formatearFecha(d) : 'inicio'} al ${h ? formatearFecha(h) : 'hoy'}`]);
            else if (k === 'fechas') partes.push([def.titulo, 'todo']);
        } else if (def.tipo === 'texto') {
            if (_listaTexto(f[k]).length) partes.push(['RC', _listaTexto(f[k]).map(x => x.toUpperCase()).join(', ')]);
        } else if (def.tipo === 'check') {
            partes.push([def.titulo, f[k] ? 'Sí' : 'No']);
        } else {
            const etq = new Map(def.opciones());
            partes.push([def.titulo, f[k]?.length ? f[k].map(v => etq.get(v) || v).join(', ') : 'Todos']);
        }
    });
    return partes;
}

let _generando = false;
async function generarReporte() {
    if (_generando) return;
    _leerFiltrosReporte();
    const rep = REPORTES[_reporteSel];
    const formato = document.querySelector('input[name="repFormato"]:checked')?.value || 'pdf';
    const conDetalle = document.getElementById('repDetalle').checked;
    const estado = document.getElementById('repEstado');
    const boton = document.getElementById('repGenerar');
    const f = { ..._seleccion };
    if (rep.filtros.includes('fechasAct')) { f.desde = f.actDesde; f.hasta = f.actHasta; }
    else if (!rep.filtros.includes('fechas')) { f.desde = f.hasta = ''; }
    if (f.desde && f.hasta && f.desde > f.hasta) { estado.textContent = '⚠️ La fecha "desde" es posterior a "hasta".'; return; }

    _generando = true;
    boton.disabled = true;
    estado.textContent = '⏳ Consultando datos…';
    try {
        const datos = await rep.obtener(f, p => { estado.textContent = `⏳ Consultando datos… ${Math.round(p * 100)}%`; });
        if (!datos.filas.length) { estado.textContent = 'No hay datos con esos filtros.'; return; }
        if (formato === 'pdf' && conDetalle && datos.filas.length > 15000 &&
            !confirm(`El detalle tiene ${formatearNumero(datos.filas.length)} filas: el PDF va a ser muy grande.\n¿Generarlo igual? (en Excel es más liviano, o podés sacar solo el resumen)`)) {
            estado.textContent = '';
            return;
        }
        estado.textContent = '⏳ Armando el archivo…';
        const r = {
            ...datos, titulo: rep.titulo, conDetalle,
            filtros: _describirFiltros(rep, { ..._seleccion }),
            generado: `Generado por ${usuarioSesion()} el ${formatearFechaHora(new Date().toISOString())}`,
        };
        const nombre = `reporte_${rep.titulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}_${_hoy()}`;
        if (formato === 'pdf') await generarPDF(r, nombre); else generarExcel(r, nombre);
        estado.textContent = `✅ Listo: ${formatearNumero(datos.filas.length)} fila(s).`;
    } catch (e) {
        estado.textContent = '❌ ' + (e.message || e);
        console.error('❌ generarReporte:', e);
    } finally {
        _generando = false;
        boton.disabled = false;
    }
}

// ── Archivos ──────────────────────────────────────────────────────

function _anchos(columnas, filas) {
    return columnas.map((c, i) => ({
        wch: Math.min(50, Math.max(String(c).length, ...filas.slice(0, 500).map(f => String(f[i] ?? '').length)) + 2),
    }));
}

function generarExcel(r, nombre) {
    const wb = XLSX.utils.book_new();

    // Hoja "Resumen": título, filtros y totales por grupo
    const aoa = [[`${r.titulo} — ANDE`], [r.generado], [], ['Filtros aplicados'], ...r.filtros, []];
    aoa.push(['Total de filas', r.filas.length], []);
    (r.resumenes || []).forEach(s => { aoa.push([s.titulo], s.columnas, ...s.filas, []); });
    const wsR = XLSX.utils.aoa_to_sheet(aoa);
    wsR['!cols'] = [{ wch: 34 }, { wch: 40 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsR, 'Resumen');

    if (r.conDetalle) {
        const ws = XLSX.utils.aoa_to_sheet([r.columnas, ...r.filas]);
        ws['!cols'] = _anchos(r.columnas, r.filas);
        ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: r.filas.length, c: r.columnas.length - 1 } }) };
        XLSX.utils.book_append_sheet(wb, ws, 'Detalle');
    }
    XLSX.writeFile(wb, nombre + '.xlsx');
}

// jsPDF se carga recién la primera vez que se pide un PDF
let _jspdfListo = null;
function cargarJsPDF() {
    const cargar = src => new Promise((ok, mal) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = ok;
        s.onerror = () => mal(new Error('No se pudo cargar el generador de PDF'));
        document.head.appendChild(s);
    });
    _jspdfListo ??= cargar('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
        .then(() => cargar('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'))
        .catch(e => { _jspdfListo = null; throw e; });
    return _jspdfListo;
}

async function generarPDF(r, nombre) {
    await cargarJsPDF();
    const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const ancho = doc.internal.pageSize.getWidth();
    const M = 40, AZUL = [53, 57, 140];
    const fmtFila = numericas => (f => f.map((v, i) => numericas.has(i) && typeof v === 'number' ? formatearNumero(v) : String(v ?? '')));
    const conPie = new Set();
    const pie = () => {
        const pag = doc.internal.getNumberOfPages();
        if (conPie.has(pag)) return;
        conPie.add(pag);
        const alto = doc.internal.pageSize.getHeight();
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(140);
        doc.text(`${r.titulo} — ANDE · GC NOC · Inovasi`, M, alto - 18);
        doc.text(`Página ${doc.internal.getNumberOfPages()}`, ancho - M, alto - 18, { align: 'right' });
    };

    // Encabezado
    doc.setFillColor(...AZUL); doc.rect(0, 0, ancho, 6, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(...AZUL);
    doc.text(`Reporte: ${r.titulo}`, M, 42);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100);
    doc.text('ANDE — Gestión de equipos y consumo de SIM', M, 58);
    doc.text(r.generado, ancho - M, 58, { align: 'right' });

    // Filtros aplicados
    doc.autoTable({
        startY: 72, margin: { left: M, right: M },
        head: [['Filtros aplicados', '']],
        body: [...r.filtros, ['Total de filas', formatearNumero(r.filas.length)]],
        theme: 'plain',
        styles: { fontSize: 8.5, cellPadding: 2.5 },
        headStyles: { textColor: AZUL, fontStyle: 'bold', fontSize: 10 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 170, textColor: 60 } },
        didDrawPage: pie,
    });

    // Resúmenes, de a dos por fila
    let y = doc.lastAutoTable.finalY + 14;
    const resumenes = r.resumenes || [];
    const anchoCol = (ancho - 2 * M - 20) / 2;
    for (let i = 0; i < resumenes.length; i += 2) {
        let fin = y;
        [resumenes[i], resumenes[i + 1]].forEach((s, j) => {
            if (!s) return;
            const num = new Set(s.numericas || []);
            const cs = {}; num.forEach(k => { cs[k] = { halign: 'right' }; });
            doc.autoTable({
                startY: y, margin: { left: M + j * (anchoCol + 20) }, tableWidth: anchoCol,
                head: [s.columnas], body: s.filas.map(fmtFila(num)),
                styles: { fontSize: 8, cellPadding: 3 },
                headStyles: { fillColor: [232, 234, 246], textColor: AZUL, fontStyle: 'bold' },
                columnStyles: cs,
                didParseCell: d => {
                    if (num.has(d.column.index)) d.cell.styles.halign = 'right';
                    if (d.section === 'body' && d.row.index === s.filas.length - 1) d.cell.styles.fontStyle = 'bold';
                },
                didDrawPage: pie,
            });
            fin = Math.max(fin, doc.lastAutoTable.finalY);
        });
        y = fin + 16;
    }

    // Detalle
    if (r.conDetalle) {
        const num = new Set(r.numericas || []);
        const cs = {}; num.forEach(k => { cs[k] = { halign: 'right' }; });
        if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 40; }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...AZUL);
        doc.text('Detalle', M, y + 4);
        doc.autoTable({
            startY: y + 12, margin: { left: M, right: M, bottom: 36 },
            head: [r.columnas], body: r.filas.map(fmtFila(num)),
            styles: { fontSize: r.columnas.length > 8 ? 7 : 8, cellPadding: 3, overflow: 'linebreak' },
            headStyles: { fillColor: AZUL, textColor: 255, fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [244, 245, 251] },
            columnStyles: cs,
            didParseCell: d => { if (num.has(d.column.index)) d.cell.styles.halign = 'right'; },
            didDrawPage: pie,
        });
    }
    doc.save(nombre + '.pdf');
}
