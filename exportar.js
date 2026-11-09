// ══════════════════════════════════════════════════════════════════
// ── EXPORTAR VISTAS A EXCEL / PDF ─────────────────────────────────
// Cada vista arma { titulo, archivo, detalle, columnas, filas } con TODAS
// las filas que cumplen los filtros (no solo la página visible).
// Usa funciones y variables globales de app.js (se carga después).
// ══════════════════════════════════════════════════════════════════

const etiquetaEstado = est => {
    const cfg = esViewer() ? ESTADO_CONFIG_VIEWER[estadoSimple(est)] : ESTADO_CONFIG_DISP[est];
    return String(cfg?.label || est || '').replace('● ', '');
};
const _txt = v => { const s = String(v ?? '').trim(); return s === '-' ? '' : s; };

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

function _periodoConsumo() {
    const desde = document.getElementById('filtroFechaDesde')?.value;
    const hasta = document.getElementById('filtroFechaHasta')?.value;
    return (desde || hasta)
        ? `Período: ${desde ? formatearFecha(desde) : 'inicio'} — ${hasta ? formatearFecha(hasta) : 'hoy'}`
        : 'Todos los períodos';
}

const EXPORTADORES = {
    async consumo() {
        if (vistaConsumo === 'equipos') {
            const filas = buildConsolidado(consumosFiltrados);
            return {
                titulo: 'Consumo por RC', archivo: 'consumo_por_RC', detalle: _periodoConsumo(),
                columnas: ['RC', 'Regional', 'SIM Principal', 'MB SIM Principal', 'SIM Respaldo', 'MB SIM Respaldo', 'Total MB'],
                numericas: [3, 5, 6],
                filas: filas.map(f => [f.rc, f.regional, _txt(f.sim1Label), f.sim1MB,
                    f.sim2Label !== '-' ? f.sim2Label : '', f.sim2Label !== '-' ? f.sim2MB : '', f.totalMB]),
            };
        }
        if (vistaConsumo === 'lineas-bd') {
            const f = filtrosLineas();
            const filas = await traerTodasLasFilas(() => _aplicarFiltrosLineasQuery(
                window.clienteSupabase.from('vista_lineas_estado').select('*'), f)
                .order('numero', { ascending: true, nullsFirst: false })
                .order('imei',   { ascending: true }));
            const det = [f.telefonia && `Telefonía: ${f.telefonia}`, f.estado && `Estado: ${f.estado}`, f.buscar && `Búsqueda: "${f.buscar}"`]
                .filter(Boolean).join(' · ') || 'Todas las líneas';
            return {
                titulo: 'Líneas', archivo: 'lineas', detalle: det,
                columnas: ['Estado', 'Número', 'ICCID', 'Telefonía', 'RC', 'Regional', 'MB Mes', 'MB Total', 'Última fecha'],
                numericas: [6, 7],
                filas: filas.map(r => [etiquetaEstado(getEstadoSIM(r)), _txt(r.numero), normalizarImei(r.imei) || '',
                    _txt(r.telefonia), _txt(r.rc), _txt(r.regional),
                    parseFloat(r.consumo_mes_mb) || 0, parseFloat(r.consumo_total_mb) || 0,
                    r.ultima_fecha ? formatearFecha(r.ultima_fecha) : '']),
            };
        }
        // Vista Consumo: detalle diario
        const detalle = (await consultarConsumosCompletos()).data;
        const columnas = ['Estado', 'RC', 'Número', 'ICCID', 'Telefonía', 'MB', 'Fecha'];
        if (!esViewer()) columnas.push('Observación');
        return {
            titulo: 'Consumo por línea', archivo: 'consumo', detalle: _periodoConsumo(),
            columnas, numericas: [5],
            filas: detalle.map(c => {
                const fila = [etiquetaEstado(estadoConsDisplay(c)), _txt(encontrarRC(c)), _txt(c.numero),
                    normalizarImei(c.imei) || '', _txt(c.telefonia), parseFloat(c.consumo_mb) || 0,
                    c.fecha_consumo ? formatearFecha(c.fecha_consumo) : ''];
                if (!esViewer()) fila.push(_txt(c.observacion));
                return fila;
            }),
        };
    },

    async dispositivos() {
        const datos = datosFiltrados.length || !todosLosDatos.length ? datosFiltrados : todosLosDatos;
        return {
            titulo: 'Dispositivos', archivo: 'dispositivos',
            detalle: datos.length === todosLosDatos.length ? 'Todos los RC' : `Filtrados: ${datos.length} de ${todosLosDatos.length} RC`,
            columnas: ['Estado', 'Regional', 'Código', 'Tipo', 'Ubicación', 'SIM 1 - Número', 'SIM 1 - ICCID',
                       'SIM 2 - Número', 'SIM 2 - ICCID', 'Fecha activación'],
            filas: datos.map(d => {
                const tipo = getTipoDevice(d);
                return [etiquetaEstado(estadoDisp(d)), _txt(d.regional), _txt(d.codigo),
                    tipo && tipo !== 'activado' ? String(TIPO_CONFIG[tipo]?.label || tipo).replace('● ', '') : '', _txt(d.ubicacion),
                    _txt(d.sim1_num), normalizarImei(d.sim1_imei) || '', _txt(d.sim2_num), normalizarImei(d.sim2_imei) || '',
                    d.fecha_activacion ? formatearFecha(d.fecha_activacion) : ''];
            }),
        };
    },

    async historial() {
        if (historialSimLista === null) await cargarHistorialSIMLista();
        const q = (document.getElementById('historialSimBuscar')?.value || '').trim();
        return {
            titulo: 'Historial de cambios de SIM', archivo: 'historial_sim',
            detalle: q ? `Búsqueda: "${q}"` : 'Todos los cambios',
            columnas: ['Fecha en campo', 'Registrado', 'Código', 'Slot', 'Número anterior', 'Número nuevo',
                       'ICCID anterior', 'ICCID nuevo', 'Usuario', 'Observación'],
            filas: filasHistorialSIM().map(h => [h.fecha_campo ? formatearFecha(h.fecha_campo) : '',
                formatearFechaHora(h.fecha_cambio), _txt(h.rc_codigo), h.sim_slot === 'sim1' ? 'SIM 1' : 'SIM 2',
                _txt(h.numero_ant), _txt(h.numero_nuevo), _txt(h.imei_ant), _txt(h.imei_nuevo),
                _txt(h.usuario), _txt(h.observacion)]),
        };
    },

    async activaciones() {
        if (activacionesLista === null) await cargarActivaciones();
        const est = e => e ? (ESTADO_HIST_LABEL[e] || e) : '';
        const q = (document.getElementById('activacionesBuscar')?.value || '').trim();
        const tipo = document.getElementById('activacionesTipo')?.value;
        return {
            titulo: 'Historial de activaciones y desactivaciones', archivo: 'activaciones',
            detalle: [tipo === 'rc' ? 'Solo RC' : tipo === 'linea' ? 'Solo líneas' : 'RC y líneas',
                      q && `Búsqueda: "${q}"`,
                      document.getElementById('activacionesOcultarSistema')?.checked && 'sin altas automáticas']
                     .filter(Boolean).join(' · '),
            columnas: ['Fecha', 'Tipo', 'RC / Línea', 'Estado anterior', 'Estado nuevo', 'Usuario', 'Motivo'],
            filas: filasActivaciones().map(h => [formatearFechaHora(h.fecha), h.tipo === 'rc' ? 'RC' : 'Línea',
                _txt(h.referencia), est(h.estado_anterior), est(h.estado_nuevo), _txt(h.usuario), _txt(h.motivo)]),
        };
    },

    async inventario() {
        if (!inventarioLineas.length) await cargarLineas();
        const estado = document.getElementById('lineasEstado')?.value;
        const q = (document.getElementById('lineasBuscar')?.value || '').trim();
        return {
            titulo: 'Inventario de líneas', archivo: 'inventario_lineas',
            detalle: [estado ? `Estado: ${ESTADO_HIST_LABEL[estado] || estado}` : 'Todos los estados', q && `Búsqueda: "${q}"`]
                     .filter(Boolean).join(' · '),
            columnas: ['Número', 'ICCID', 'Telefonía', 'Estado', 'RC', 'Slot', 'Cargada', 'Por', 'Observación'],
            filas: filasInventario().map(l => [_txt(l.numero), _txt(l.iccid), _txt(l.telefonia),
                ESTADO_HIST_LABEL[l.estado] || l.estado, _txt(l.rc_codigo),
                l.sim_slot ? (l.sim_slot === 'sim1' ? 'SIM 1' : 'SIM 2') : '',
                formatearFechaHora(l.creado_en), _txt(l.creado_por), _txt(l.observacion)]),
        };
    },
};

let _exportando = false;
async function exportarVista(vista, formato, btn) {
    if (_exportando) return;
    _exportando = true;
    const grupo = btn?.closest('.export-btns');
    grupo?.classList.add('exportando');
    try {
        const r = await EXPORTADORES[vista]();
        if (!r.filas.length) { alert('No hay datos para exportar con los filtros actuales.'); return; }
        const nombre = `${r.archivo}_ANDE_${new Date().toISOString().substring(0, 10)}`;
        if (formato === 'pdf') {
            if (r.filas.length > 15000 &&
                !confirm(`Son ${formatearNumero(r.filas.length)} filas: el PDF puede tardar y pesar mucho.\n¿Generarlo igual? (Excel es más liviano)`)) return;
            await generarPDF(r, nombre);
        } else {
            generarExcel(r, nombre);
        }
    } catch (e) {
        alert('❌ Error al exportar: ' + (e.message || e));
        console.error('❌ exportarVista:', e);
    } finally {
        _exportando = false;
        grupo?.classList.remove('exportando');
    }
}

function generarExcel(r, nombre) {
    const ws = XLSX.utils.aoa_to_sheet([r.columnas, ...r.filas]);
    ws['!cols'] = r.columnas.map((c, i) => ({
        wch: Math.min(50, Math.max(c.length, ...r.filas.slice(0, 500).map(f => String(f[i] ?? '').length)) + 2),
    }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: r.filas.length, c: r.columnas.length - 1 } }) };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, r.titulo.replace(/[\\/?*[\]:]/g, '').substring(0, 31));
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
    const numericas = new Set(r.numericas || []);
    const fmt = (v, i) => numericas.has(i) && typeof v === 'number' ? formatearNumero(v) : String(v ?? '');

    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(53, 57, 140);
    doc.text(`${r.titulo} — ANDE`, 40, 40);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
    doc.text(`${r.detalle ? r.detalle + ' · ' : ''}${formatearNumero(r.filas.length)} fila(s)`, 40, 56);
    doc.text(`Generado por ${usuarioSesion()} el ${formatearFechaHora(new Date().toISOString())}`, ancho - 40, 56, { align: 'right' });

    const columnStyles = {};
    numericas.forEach(i => { columnStyles[i] = { halign: 'right' }; });
    doc.autoTable({
        head: [r.columnas],
        body: r.filas.map(f => f.map(fmt)),
        startY: 68,
        margin: { left: 40, right: 40, bottom: 36 },
        styles: { fontSize: r.columnas.length > 8 ? 7 : 8, cellPadding: 3, overflow: 'linebreak' },
        headStyles: { fillColor: [53, 57, 140], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [244, 245, 251] },
        columnStyles,
        didDrawPage: () => {
            const alto = doc.internal.pageSize.getHeight();
            doc.setFontSize(8); doc.setTextColor(140);
            doc.text('GC NOC · Inovasi', 40, alto - 18);
            doc.text(`Página ${doc.internal.getNumberOfPages()}`, ancho - 40, alto - 18, { align: 'right' });
        },
    });
    doc.save(nombre + '.pdf');
}
