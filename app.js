// Credenciales de acceso
const USUARIOS = {
    admin: { password: 'demo2025', rol: 'admin' },
    ande:  { password: 'ande2025', rol: 'viewer' },
};
let rolActual = 'admin';

// Helpers de rol
function esViewer() { return rolActual === 'viewer'; }

// Colapsa todos los estados no-desactivado a 'activo' (para viewer y stats)
function estadoSimple(est) {
    return est === 'desactivado' ? 'desactivado' : 'activo';
}

// Estado para el tab Dispositivos: sin_consumo → activo, error y legado se mantienen
function estadoDisp(device) {
    const est = calcularEstado(device);
    return est === 'sin_consumo' ? 'activo' : est;
}

// Config completa para admin en Dispositivos (Activado/Desactivado/Error/Legado)
const ESTADO_CONFIG_DISP = {
    activo:      { label: '● Activado',    cls: 'badge-activo' },
    desactivado: { label: '● Desactivado', cls: 'badge-desactivado' },
    error:       { label: '● Error',       cls: 'badge-error' },
    legado:      { label: '● Legado',      cls: 'badge-legado' },
};

// Config simplificada para viewer (solo 2 estados)
const ESTADO_CONFIG_VIEWER = {
    activo:      { label: '● Activado',    cls: 'badge-activo' },
    desactivado: { label: '● Desactivado', cls: 'badge-desactivado' },
};

function cerrarSesion() {
    // Resetear estado
    rolActual = 'admin';
    todosLosDatos = []; datosFiltrados = [];
    todosLosConsumos = []; consumosFiltrados = []; consolidadoActual = [];
    paginaConsumo = 1; paginaEquipos = 1;
    mapaNumAConsumo = new Map(); mapaImeiAConsumo = new Map();
    mapaNumADevice  = new Map(); mapaImeiADevice  = new Map();
    if (mapaLeaflet) { mapaLeaflet.remove(); mapaLeaflet = null; markersLayer = null; }
    if (chartBarras)          { chartBarras.destroy();          chartBarras = null; }
    if (chartLineas)          { chartLineas.destroy();          chartLineas = null; }
    if (chartTorta)           { chartTorta.destroy();           chartTorta = null; }
    if (chartConsumoHistorico){ chartConsumoHistorico.destroy();chartConsumoHistorico = null; }
    if (chartConsumoLineas)   { chartConsumoLineas.destroy();   chartConsumoLineas = null; }
    if (chartConsumoEstados)  { chartConsumoEstados.destroy();  chartConsumoEstados = null; }

    // Volver al login
    document.getElementById('appPrincipal').style.display = 'none';
    document.getElementById('loginOverlay').style.display = 'flex';
    document.getElementById('loginUsuario').value  = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginError').style.display = 'none';

    // Resetear tab activo
    document.getElementById('tabBtnConsumo').classList.add('tab-activo');
    document.getElementById('tabBtnDispositivos').classList.remove('tab-activo');
    document.getElementById('tab-consumo').style.display = 'block';
    document.getElementById('tab-dispositivos').style.display = 'none';
}

function intentarLogin() {
    const usuario  = document.getElementById('loginUsuario').value.trim();
    const password = document.getElementById('loginPassword').value;
    const error    = document.getElementById('loginError');
    const user     = USUARIOS[usuario];

    if (user && password === user.password) {
        rolActual = user.rol;
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('appPrincipal').style.display = 'block';
        aplicarRol();
        iniciarApp();
    } else {
        error.style.display = 'block';
        document.getElementById('loginPassword').value = '';
    }
}

// Aplica restricciones visuales según el rol del usuario logueado
function aplicarRol() {
    if (!esViewer()) return;

    // Filtro estado dispositivos → solo Activado / Desactivado
    document.getElementById('filtroEstado').innerHTML =
        '<option value="">Todos</option>' +
        '<option value="activo">Activado</option>' +
        '<option value="desactivado">Desactivado</option>';

    // Filtro estado consumo → solo Activado / Desactivado
    document.getElementById('filtroEstadoConsumo').innerHTML =
        '<option value="">Todos</option>' +
        '<option value="activo">Activado</option>' +
        '<option value="desactivado">Desactivado</option>';

    // Ocultar columna Observación en tabla consumo
    document.getElementById('thObservacion').style.display = 'none';

    // Actualizar labels de las tarjetas de estadísticas
    document.querySelector('.stat-activos h3').textContent    = 'Activados';
    document.querySelector('.stat-desactivados h3').textContent = 'Desactivados';
}

// Permitir Enter para hacer login
document.addEventListener('DOMContentLoaded', function() {
    ['loginUsuario', 'loginPassword'].forEach(function(id) {
        document.getElementById(id).addEventListener('keydown', function(e) {
            if (e.key === 'Enter') intentarLogin();
        });
    });
});

// Configuración de Supabase
const SUPABASE_URL = 'https://rnnsvvujedwcvcjyyajm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJubnN2dnVqZWR3Y3Zjanl5YWptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4MjM2NjcsImV4cCI6MjA4NDM5OTY2N30.VhmUP-tal_iMwmJU_MDDAploV5sDqkzgbi9E2hyCqZc';

// Variables globales
let todosLosDatos  = [];
let datosFiltrados = [];
let activosSet     = new Set();
let paginaActual   = 1;
const ITEMS_POR_PAGINA = 10;
let chartBarras, chartLineas, chartTorta;
let chartConsumoHistorico, chartConsumoLineas, chartConsumoEstados;
let mapaLeaflet = null;
let markersLayer = null;
const COLORES = ['#35398C', '#DA527D', '#B44C80', '#904783', '#644087'];

// Consumo SIM
let todosLosConsumos  = [];
let consumosFiltrados = [];
let paginaConsumo     = 1;
let mapaNumAConsumo   = new Map();
let mapaImeiAConsumo  = new Map();
let mapaNumADevice    = new Map();
let mapaImeiADevice   = new Map();
let telefoniaActual   = '';
let vistaConsumo      = 'lineas'; // 'lineas' | 'equipos'
let sortLineas        = { col: 'fecha', dir: 'desc' };
let sortEquipos       = { col: 'rc',    dir: 'asc'  };
let paginaEquipos     = 1;
let consolidadoActual = [];

// Normaliza IMEI: convierte notación científica a string entero
function normalizarImei(val) {
    if (!val) return '';
    const s = String(val).trim();
    if (/^[\d.]+[eE][+\-]?\d+$/i.test(s)) {
        const n = parseFloat(s);
        if (!isNaN(n) && isFinite(n)) return Math.round(n).toString();
    }
    return s;
}

// Calcula el estado de un dispositivo cruzando contra consumo_sim
function calcularEstado(device) {
    if (device.estado === 'desactivado') return 'desactivado';

    const sim1Num  = String(device.sim1_num  || '').trim();
    const sim1Imei = normalizarImei(device.sim1_imei);
    const sim2Num  = String(device.sim2_num  || '').trim();
    const sim2Imei = normalizarImei(device.sim2_imei);

    const es1M2M = sim1Num.toLowerCase() === 'm2m';
    const es2M2M = sim2Num.toLowerCase() === 'm2m';

    // Buscar fila de consumo correspondiente
    let consumoRow = null;
    if (es1M2M) {
        consumoRow = mapaImeiAConsumo.get(sim1Imei) || null;
    } else {
        consumoRow = mapaNumAConsumo.get(sim1Num) || mapaImeiAConsumo.get(sim1Imei) || null;
    }
    if (!consumoRow && (sim2Num || sim2Imei)) {
        consumoRow = es2M2M
            ? (mapaImeiAConsumo.get(sim2Imei) || null)
            : (mapaNumAConsumo.get(sim2Num) || mapaImeiAConsumo.get(sim2Imei) || null);
    }

    if (!consumoRow) return 'sin_consumo';

    const obs = String(consumoRow.observacion || '').trim().toLowerCase();
    if (obs.includes('backup')) return 'desactivado';

    return 'activo';
}

function togglePassword() {
    const input = document.getElementById('loginPassword');
    const icon = document.getElementById('eyeIcon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
    } else {
        input.type = 'password';
        icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    }
}

// El inicio de la app se dispara desde el login, no automáticamente

// Iniciar la aplicación
async function iniciarApp() {
    try {
        // Crear cliente de Supabase
        console.log('📡 Creando cliente Supabase...');
        const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        console.log('✅ Cliente creado');
        
        // Guardar globalmente
        window.clienteSupabase = supabase;
        
        // Cargar datos (dispositivos + mapas de consumo)
        await cargarDatos();
        // Cargar consumo (tab por defecto)
        await cargarConsumos();
        
    } catch (error) {
        console.error('❌ Error al iniciar:', error);
        document.getElementById('loading').innerHTML = `❌ Error: ${error.message}`;
    }
}

// Cargar datos de Supabase (dispositivos + consumos en paralelo)
async function cargarDatos() {
    const loading = document.getElementById('loading');

    try {
        console.log('📊 Consultando base de datos...');
        loading.textContent = 'Conectando con la base de datos...';
        loading.style.display = 'block';

        // Cargar ambas tablas en paralelo
        const [resDisp, resCons] = await Promise.all([
            window.clienteSupabase
                .from('dispositivos_ande')
                .select('*')
                .order('regional', { ascending: true }),
            window.clienteSupabase
                .from('consumo_sim')
                .select('numero,imei,observacion,estado_operador,consumo_mb,estado,fecha_consumo,telefonia')
        ]);

        if (resDisp.error) {
            loading.innerHTML = `❌ Error al cargar dispositivos:<br>${resDisp.error.message}`;
            return;
        }

        const data = resDisp.data || [];

        // Construir mapas de consumo para cruzar estado en dispositivos
        mapaNumAConsumo  = new Map();
        mapaImeiAConsumo = new Map();
        if (resCons.data) {
            resCons.data.forEach(c => {
                const num  = String(c.numero || '').trim();
                const imei = normalizarImei(c.imei);
                if (num)  mapaNumAConsumo.set(num, c);
                if (imei) mapaImeiAConsumo.set(imei, c);
            });
            console.log(`✅ ${resCons.data.length} registros en consumo_sim`);
        } else {
            console.warn('⚠️ No se pudo cargar consumo_sim:', resCons.error?.message);
        }

        // Construir mapas de dispositivos para cruzar RC en consumo
        construirMapasDevice(data);

        if (data.length === 0) {
            loading.style.display = 'none';
            document.getElementById('tablaDatos').innerHTML =
                '<tr><td colspan="9" style="text-align:center; padding: 40px;">No hay datos en la base de datos.</td></tr>';
            return;
        }

        console.log(`✅ ${data.length} dispositivos cargados`);
        loading.style.display = 'none';

        poblarFiltroRegional(data);

        todosLosDatos = data;
        datosFiltrados = data;
        mostrarDatos(data);

    } catch (error) {
        console.error('❌ Error crítico:', error);
        loading.innerHTML = `❌ Error crítico: ${error.message}`;
    }
}

// Poblar dropdown de Regional dinámicamente
function poblarFiltroRegional(datos) {
    const select = document.getElementById('filtroRegional');
    const regionales = [...new Set(datos.map(d => d['regional']).filter(Boolean))].sort();
    regionales.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r;
        opt.textContent = r;
        select.appendChild(opt);
    });
}

// Mostrar todos los datos (resetea a página 1)
function mostrarDatos(datos) {
    console.log(`📋 Mostrando ${datos.length} registros`);
    paginaActual = 1;
    mostrarEnTabla(datos);
    actualizarEstadisticas(datos);
    crearGraficos(datos);
    actualizarMapa(datos);
}

// Helpers para el badge de estado
const ESTADO_CONFIG = {
    activo:      { label: '● Activo',       cls: 'badge-activo' },
    sin_consumo: { label: '● Sin consumo',  cls: 'badge-sin-consumo' },
    desactivado: { label: '● Desactivado',  cls: 'badge-desactivado' },
    legado:      { label: '● Legado',       cls: 'badge-legado' },
    error:       { label: '● Error',        cls: 'badge-error' },
};

function badgeEstado(device) {
    const est = estadoDisp(device);
    if (esViewer()) {
        const cfg = ESTADO_CONFIG_VIEWER[estadoSimple(est)];
        return `<span class="badge-estado ${cfg.cls}">${cfg.label}</span>`;
    }
    const cfg = ESTADO_CONFIG_DISP[est] || ESTADO_CONFIG_DISP['activo'];
    return `<span class="badge-estado ${cfg.cls}">${cfg.label}</span>`;
}

// Mostrar datos en la tabla (con paginación)
function mostrarEnTabla(datos) {
    const tbody   = document.getElementById('tablaDatos');
    const infoEl  = document.getElementById('paginacion-info');
    const pagEl   = document.getElementById('paginacion');
    tbody.innerHTML = '';

    const total       = datos.length;
    const totalPaginas = Math.max(1, Math.ceil(total / ITEMS_POR_PAGINA));
    if (paginaActual > totalPaginas) paginaActual = totalPaginas;

    if (total === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding: 40px;">No se encontraron resultados con esos filtros.</td></tr>';
        infoEl.innerHTML = '';
        pagEl.innerHTML  = '';
        return;
    }

    const inicio = (paginaActual - 1) * ITEMS_POR_PAGINA;
    const fin    = Math.min(inicio + ITEMS_POR_PAGINA, total);

    datos.slice(inicio, fin).forEach(fila => {
        const estMostrar = esViewer() ? estadoSimple(estadoDisp(fila)) : estadoDisp(fila);
        const tr         = document.createElement('tr');
        if (estMostrar !== 'activo') tr.classList.add('fila-inactiva');
        tr.innerHTML = `
            <td>${badgeEstado(fila)}</td>
            <td><span class="badge-regional">${fila['regional'] || '-'}</span></td>
            <td>${fila['codigo'] || '-'}</td>
            <td class="td-ubicacion">${fila['ubicacion'] || '-'}</td>
            <td>${fila['sim1_num'] || '-'}</td>
            <td class="td-imei">${fila['sim1_imei'] || '-'}</td>
            <td>${fila['sim2_num'] || '-'}</td>
            <td class="td-imei">${fila['sim2_imei'] || '-'}</td>
            <td>${formatearFecha(fila['fecha_activacion'])}</td>
        `;
        tbody.appendChild(tr);
    });

    // Info de registros
    infoEl.innerHTML = `Mostrando <strong>${inicio + 1}–${fin}</strong> de <strong>${formatearNumero(total)}</strong> resultados`;

    // Controles de paginación
    renderPaginacion(totalPaginas);
    console.log(`✅ Página ${paginaActual}/${totalPaginas}`);
}

// Renderizar controles de paginación
function renderPaginacion(totalPaginas) {
    const cont = document.getElementById('paginacion');
    if (totalPaginas <= 1) { cont.innerHTML = ''; return; }

    const prev = paginaActual === 1;
    const next = paginaActual === totalPaginas;

    let html = '<div class="pag-controles">';
    html += `<button class="pag-btn" onclick="irPagina(${paginaActual - 1})" ${prev ? 'disabled' : ''}>← Anterior</button>`;

    paginasVisibles(paginaActual, totalPaginas).forEach(p => {
        if (p === '...') {
            html += '<span class="pag-dots">…</span>';
        } else {
            html += `<button class="pag-btn pag-num ${p === paginaActual ? 'pag-activa' : ''}" onclick="irPagina(${p})">${p}</button>`;
        }
    });

    html += `<button class="pag-btn" onclick="irPagina(${paginaActual + 1})" ${next ? 'disabled' : ''}>Siguiente →</button>`;
    html += '</div>';
    cont.innerHTML = html;
}

// Qué números de página mostrar (con elipsis)
function paginasVisibles(actual, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (actual <= 4)        return [1, 2, 3, 4, 5, '...', total];
    if (actual >= total - 3) return [1, '...', total-4, total-3, total-2, total-1, total];
    return [1, '...', actual - 1, actual, actual + 1, '...', total];
}

// Ir a una página específica
function irPagina(num) {
    const totalPaginas = Math.ceil(datosFiltrados.length / ITEMS_POR_PAGINA);
    if (num < 1 || num > totalPaginas) return;
    paginaActual = num;
    mostrarEnTabla(datosFiltrados);
    document.querySelector('.table-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Actualizar estadísticas
function actualizarEstadisticas(datos) {
    const total   = datos.length;
    // Activados = activo + sin_consumo; Desactivados = todo lo demás (desactivado, error, legado)
    const activos   = datos.filter(d => estadoDisp(d) === 'activo').length;
    const inactivos = total - activos;

    document.getElementById('totalRegistros').textContent    = formatearNumero(total);
    document.getElementById('totalActivos').textContent      = formatearNumero(activos);
    document.getElementById('totalDesactivados').textContent = formatearNumero(inactivos);
}

// Crear los 3 gráficos
function crearGraficos(datos) {
    if (chartBarras) chartBarras.destroy();
    if (chartLineas) chartLineas.destroy();
    if (chartTorta) chartTorta.destroy();

    if (datos.length === 0) return;

    // Agrupar por Regional
    const porRegional = {};
    datos.forEach(item => {
        const r = item['regional'] || 'Sin Regional';
        porRegional[r] = (porRegional[r] || 0) + 1;
    });
    const regionales = Object.keys(porRegional).sort((a, b) => porRegional[b] - porRegional[a]);
    const cantidades = regionales.map(r => porRegional[r]);
    const coloresGrafico = regionales.map((_, i) => COLORES[i % COLORES.length]);

    // Gráfico de Barras — por Regional
    const ctxBarras = document.getElementById('chartBarras').getContext('2d');
    chartBarras = new Chart(ctxBarras, {
        type: 'bar',
        data: {
            labels: regionales,
            datasets: [{
                label: 'Dispositivos',
                data: cantidades,
                backgroundColor: coloresGrafico,
                borderColor: coloresGrafico,
                borderWidth: 2,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (c) => 'Dispositivos: ' + formatearNumero(c.parsed.y) } }
            },
            scales: {
                y: { beginAtZero: true, ticks: { callback: (v) => formatearNumero(v) } }
            },
            onClick: makeDblClickHandler(el => {
                const regional = regionales[el.index];
                if (!regional) return;
                document.getElementById('filtroRegional').value = regional;
                aplicarFiltros();
            }),
            onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; }
        }
    });

    // Agrupar por fecha de activación
    const porFecha = {};
    datos.forEach(item => {
        const f = item['fecha_activacion'] ? String(item['fecha_activacion']).substring(0, 10) : null;
        if (f) porFecha[f] = (porFecha[f] || 0) + 1;
    });
    const fechasOrdenadas = Object.keys(porFecha).sort();
    const countsPorFecha = fechasOrdenadas.map(f => porFecha[f]);

    // Gráfico de Líneas — activaciones en el tiempo
    const ctxLineas = document.getElementById('chartLineas').getContext('2d');
    chartLineas = new Chart(ctxLineas, {
        type: 'line',
        data: {
            labels: fechasOrdenadas.map(f => formatearFecha(f)),
            datasets: [{
                label: 'Activaciones',
                data: countsPorFecha,
                borderColor: '#8A35AB',
                backgroundColor: 'rgba(138, 53, 171, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#DA527D',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: true },
                tooltip: { callbacks: { label: (c) => 'Activaciones: ' + formatearNumero(c.parsed.y) } }
            },
            scales: {
                y: { beginAtZero: true, ticks: { callback: (v) => formatearNumero(v) } }
            },
            onClick: makeDblClickHandler(el => {
                const fecha = fechasOrdenadas[el.index];
                if (!fecha) return;
                document.getElementById('filtroFecha').value = fecha;
                aplicarFiltros();
            }),
            onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; }
        }
    });

    // Gráfico de Torta — Activados vs Desactivados
    const totalActivos   = datos.filter(d => estadoDisp(d) === 'activo').length;
    const totalInactivos = datos.length - totalActivos;
    const estadoDonutKeys = ['activo', 'desactivado'];

    const ctxTorta = document.getElementById('chartTorta').getContext('2d');
    chartTorta = new Chart(ctxTorta, {
        type: 'doughnut',
        data: {
            labels: ['Activado', 'Desactivado'],
            datasets: [{
                data: [totalActivos, totalInactivos],
                backgroundColor: ['#16a34a', '#dc2626'],
                borderColor: '#fff',
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { position: 'bottom', labels: { padding: 15, font: { size: 12 } } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = ((context.parsed / total) * 100).toFixed(1);
                            return context.label + ': ' + formatearNumero(context.parsed) + ' (' + pct + '%)';
                        }
                    }
                }
            },
            onClick: makeDblClickHandler(el => {
                const key = estadoDonutKeys[el.index];
                if (!key) return;
                document.getElementById('filtroEstado').value = key;
                aplicarFiltros();
            }),
            onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; }
        }
    });

    console.log('✅ Gráficos creados');
}

// Aplicar filtros
function aplicarFiltros() {
    const regional = document.getElementById('filtroRegional').value;
    const codigo   = document.getElementById('filtroCodigo').value.trim().toLowerCase();
    const sim      = document.getElementById('filtroSim').value.trim();
    const fecha    = document.getElementById('filtroFecha').value;
    const estado   = document.getElementById('filtroEstado').value;

    datosFiltrados = todosLosDatos.filter(item => {
        if (regional && item['regional'] !== regional) return false;
        if (codigo   && !String(item['codigo'] || '').toLowerCase().includes(codigo)) return false;
        if (sim      && !String(item['sim1_num'] || '').includes(sim) &&
                        !String(item['sim2_num'] || '').includes(sim) &&
                        !String(item['sim1_imei'] || '').includes(sim) &&
                        !String(item['sim2_imei'] || '').includes(sim)) return false;
        if (fecha    && String(item['fecha_activacion'] || '').substring(0, 10) !== fecha) return false;
        if (estado) {
            const estReal = estadoDisp(item);
            const estComp = esViewer() ? estadoSimple(estReal) : estReal;
            if (estComp !== estado) return false;
        }
        return true;
    });

    console.log(`🔍 Filtros aplicados: ${datosFiltrados.length} resultados`);
    mostrarDatos(datosFiltrados);
}

// Limpiar filtros
function limpiarFiltros() {
    document.getElementById('filtroRegional').value = '';
    document.getElementById('filtroCodigo').value   = '';
    document.getElementById('filtroSim').value      = '';
    document.getElementById('filtroFecha').value    = '';
    document.getElementById('filtroEstado').value   = '';

    datosFiltrados = todosLosDatos;
    mostrarDatos(datosFiltrados);
    console.log('🧹 Filtros limpiados');
}

// ── IMPORTACIÓN DE EXCEL ──────────────────────────────────────────

// Mapeo de columnas del Excel → Supabase (normalizado sin tildes)
const MAPA_COLUMNAS = {
    'regional':           'regional',
    'codigo':             'codigo',
    'ubicacion':          'ubicacion',
    'sim 1 - num':        'sim1_num',
    'sim 1 num':          'sim1_num',
    'sim1 num':           'sim1_num',
    'sim 1 - imei':       'sim1_imei',
    'sim 1 imei':         'sim1_imei',
    'sim1 imei':          'sim1_imei',
    'sim 2 - num':        'sim2_num',
    'sim 2 num':          'sim2_num',
    'sim2 num':           'sim2_num',
    'sim 2 - imei':       'sim2_imei',
    'sim 2 imei':         'sim2_imei',
    'sim2 imei':          'sim2_imei',
    'fecha activacion':   'fecha_activacion',
    'fecha de activacion':'fecha_activacion',
    'fechaactivacion':    'fecha_activacion',
};

function normClave(s) {
    return s.toString().trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^\w\s\-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function abrirImport() {
    document.getElementById('importModal').style.display = 'flex';
}

function cerrarImport() {
    document.getElementById('importModal').style.display = 'none';
    document.getElementById('importStatus').style.display = 'none';
    document.getElementById('archivoExcel').value = '';
    document.getElementById('dropLabel').innerHTML = 'Arrastrá el archivo acá o <span>hacé clic para seleccionar</span>';
    document.getElementById('dropZone').classList.remove('drop-active');
    const fill = document.getElementById('progressFill');
    fill.style.width = '0%';
    fill.style.background = '';
}

function cerrarImportOverlay(e) {
    if (e.target === document.getElementById('importModal')) cerrarImport();
}

function archivoSeleccionado(e) {
    const f = e.target.files[0];
    if (f) {
        document.getElementById('dropLabel').innerHTML =
            `<strong>📄 ${f.name}</strong> &nbsp;<span style="font-size:12px;color:#888">(${(f.size/1024).toFixed(0)} KB)</span>`;
        document.getElementById('dropZone').classList.add('drop-active');
    }
}

function dragOver(e) {
    e.preventDefault();
    document.getElementById('dropZone').classList.add('drag-hover');
}

function dragLeave(e) {
    document.getElementById('dropZone').classList.remove('drag-hover');
}

function dropFile(e) {
    e.preventDefault();
    document.getElementById('dropZone').classList.remove('drag-hover');
    const f = e.dataTransfer.files[0];
    if (f && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))) {
        const dt = new DataTransfer();
        dt.items.add(f);
        const input = document.getElementById('archivoExcel');
        input.files = dt.files;
        archivoSeleccionado({ target: input });
    }
}

function setProgress(pct, texto, color) {
    const fill = document.getElementById('progressFill');
    fill.style.width = pct + '%';
    if (color) fill.style.background = color;
    document.getElementById('progressText').textContent = texto;
}

async function ejecutarImport() {
    const input = document.getElementById('archivoExcel');
    if (!input.files.length) {
        alert('Seleccioná un archivo Excel primero.');
        return;
    }

    const modo = document.querySelector('input[name="importMode"]:checked').value;
    const file = input.files[0];
    const statusEl = document.getElementById('importStatus');
    statusEl.style.display = 'block';
    document.getElementById('progressFill').style.background = '';
    setProgress(0, 'Leyendo archivo...');

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            // Parsear Excel con SheetJS
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array', cellDates: true });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

            setProgress(10, `${rows.length} filas detectadas. Mapeando columnas...`);

            // Mapear columnas
            const filas = rows.map(row => {
                const obj = {};
                for (const [key, val] of Object.entries(row)) {
                    const campo = MAPA_COLUMNAS[normClave(key)];
                    if (!campo) continue;
                    if (campo === 'fecha_activacion') {
                        if (val instanceof Date) {
                            // Fecha real → activo
                            obj[campo] = val.toISOString().substring(0, 10);
                        } else if (val) {
                            const texto = String(val).trim();
                            // Intentar parsear como fecha válida
                            const parsed = new Date(texto);
                            if (!isNaN(parsed.getTime()) && texto.match(/\d{4}/)) {
                                obj[campo] = parsed.toISOString().substring(0, 10);
                            } else {
                                // Cualquier texto no-fecha (backup, Legado, etc.) → desactivado
                                obj[campo]    = null;
                                obj['estado'] = 'desactivado';
                            }
                        } else {
                            obj[campo] = null;
                        }
                    } else {
                        obj[campo] = val !== null && val !== undefined ? String(val) : null;
                    }
                }
                if (!obj['estado']) obj['estado'] = 'activo';
                return obj;
            }).filter(f => Object.keys(f).length > 0);

            if (filas.length === 0) throw new Error('No se encontraron columnas reconocibles en el archivo.');

            setProgress(15, `${filas.length} registros válidos encontrados...`);

            // Borrar si modo reemplazar
            if (modo === 'replace') {
                setProgress(20, 'Eliminando datos anteriores...');
                const { error } = await window.clienteSupabase
                    .from('dispositivos_ande')
                    .delete()
                    .gte('id', 1);
                if (error) throw new Error('Error al limpiar tabla: ' + error.message);
            }

            // Insertar en lotes de 200
            const BATCH = 200;
            const inicio = modo === 'replace' ? 25 : 20;
            const rango  = 75;

            for (let i = 0; i < filas.length; i += BATCH) {
                const lote = filas.slice(i, i + BATCH);
                const { error } = await window.clienteSupabase
                    .from('dispositivos_ande')
                    .insert(lote);
                if (error) throw new Error(`Error en lote ${Math.floor(i/BATCH)+1}: ${error.message}`);

                const pct = inicio + Math.round(((i + lote.length) / filas.length) * rango);
                setProgress(pct, `Subiendo... ${i + lote.length} / ${filas.length} registros`);
            }

            setProgress(100, `✅ ${filas.length} registros importados correctamente.`, '#22c55e');

            // Recargar app
            setTimeout(async () => {
                cerrarImport();
                const select = document.getElementById('filtroRegional');
                while (select.options.length > 1) select.remove(1);
                await cargarDatos();
            }, 1800);

        } catch (err) {
            setProgress(100, '❌ ' + err.message, '#ef4444');
            console.error(err);
        }
    };
    reader.readAsArrayBuffer(file);
}

// ── MAPA DE PARAGUAY ────────────────────────────────────────────

// En el mapa solo 2 estados: activo → verde, desactivado/legado/error → rojo
function estadoMapa(dev) {
    const est = calcularEstado(dev);
    return (est === 'desactivado' || est === 'legado' || est === 'error')
        ? 'desactivado' : 'activo';
}

// Parsea el campo ubicacion que contiene "lat, lng" como texto
function parsearCoordenadas(ubicacion) {
    if (!ubicacion) return null;
    const m = String(ubicacion).trim().match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);
    if (!m) return null;
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (isNaN(lat) || isNaN(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return [lat, lng];
}

// ── Construcción de un marker ─────────────────────────────────────
function crearMarker(dev, coords) {
    const est   = estadoMapa(dev);
    const color = est === 'activo' ? '#16a34a' : '#dc2626';
    const label = est === 'activo' ? 'Activado'  : 'Desactivado';

    const marker = L.circleMarker(coords, {
        radius: 7, fillColor: color, color: '#fff',
        weight: 2, opacity: 1, fillOpacity: 0.88,
    });

    marker.bindPopup(`
        <div style="min-width:200px;font-family:'Segoe UI',sans-serif">
            <div style="font-size:15px;font-weight:700;color:#1A1A2E;margin-bottom:4px">${dev.codigo || '-'}</div>
            <div style="font-size:12px;color:#666;margin-bottom:8px">${dev.regional || '-'}</div>
            <hr style="margin:0 0 8px;border:none;border-top:1px solid #eee">
            <table style="width:100%;font-size:12px;border-collapse:collapse">
                <tr><td style="color:#888;padding:2px 0">SIM 1</td>
                    <td style="padding:2px 0 2px 8px">${dev.sim1_num || '-'}</td></tr>
                <tr><td style="color:#888;padding:2px 0">SIM 2</td>
                    <td style="padding:2px 0 2px 8px">${dev.sim2_num || '-'}</td></tr>
                <tr><td style="color:#888;padding:2px 0">Estado</td>
                    <td style="padding:2px 0 2px 8px;color:${color};font-weight:700">${label}</td></tr>
            </table>
        </div>
    `, { maxWidth: 250 });
    return marker;
}

// ── Renderiza todos los markers ───────────────────────────────────
function renderizarMarkers(datos) {
    if (!mapaLeaflet) return;
    markersLayer.clearLayers();
    datos.forEach(dev => {
        const coords = parsearCoordenadas(dev.ubicacion);
        if (coords) markersLayer.addLayer(crearMarker(dev, coords));
    });
}

// ── Inicializar mapa ──────────────────────────────────────────────
function iniciarMapa() {
    if (mapaLeaflet) return;
    mapaLeaflet  = L.map('mapaParaguay', { zoomControl: true }).setView([-23.4425, -58.4438], 6);
    markersLayer = L.layerGroup().addTo(mapaLeaflet);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
    }).addTo(mapaLeaflet);
}

// ── Punto de entrada principal ────────────────────────────────────
function actualizarMapa(datos) {
    iniciarMapa();
    renderizarMarkers(datos);
}

// Funciones auxiliares
function formatearNumero(num) {
    if (isNaN(num)) return '0';
    return new Intl.NumberFormat('es-PY').format(num);
}

function formatearFecha(fecha) {
    if (!fecha) return '-';
    try {
        const date = new Date(fecha + 'T00:00:00');
        return date.toLocaleDateString('es-PY', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    } catch (e) {
        return fecha;
    }
}

// ── CONSUMO SIM ──────────────────────────────────────────────────

// Detecta la telefonía según el nombre del archivo
function detectarTelefonia(filename) {
    const f = filename.toLowerCase();
    if (f.includes('personal')) return 'Personal';
    if (f.includes('claro'))    return 'Claro';
    if (f.includes('tigo'))     return 'Tigo';
    if (f.includes('vox'))      return 'Vox';
    return 'Desconocida';
}

// Construye mapas num→device e imei→device para cruzar RC
function construirMapasDevice(dispositivos) {
    mapaNumADevice  = new Map();
    mapaImeiADevice = new Map();
    dispositivos.forEach(d => {
        const s1n = String(d.sim1_num  || '').trim();
        const s1i = normalizarImei(d.sim1_imei);
        const s2n = String(d.sim2_num  || '').trim();
        const s2i = normalizarImei(d.sim2_imei);
        if (s1n && s1n.toLowerCase() !== 'm2m') mapaNumADevice.set(s1n, d);
        if (s1i) mapaImeiADevice.set(s1i, d);
        if (s2n && s2n.toLowerCase() !== 'm2m') mapaNumADevice.set(s2n, d);
        if (s2i) mapaImeiADevice.set(s2i, d);
    });
}

// Busca el código RC de un consumo en la tabla de dispositivos
function encontrarRC(consumo) {
    const num    = String(consumo.numero || '').trim();
    const imei   = normalizarImei(consumo.imei);
    const device = mapaNumADevice.get(num) || mapaImeiADevice.get(imei) || null;
    return device ? (device.codigo || '-') : '-';
}

// Estado para mostrar en el tab Consumo: sin_consumo → activo, error y legado se mantienen
function estadoConsDisplay(consumo) {
    const est = calcularEstadoConsumo(consumo);
    return est === 'sin_consumo' ? 'activo' : est;
}

// Calcula el estado de una fila de consumo
function calcularEstadoConsumo(consumo) {
    const obs      = String(consumo.observacion    || '').trim().toLowerCase();
    const estadoOp = String(consumo.estado_operador || '').trim().toLowerCase();
    if (obs.includes('backup'))      return 'desactivado';
    if (estadoOp === 'legado')       return 'legado';
    if (estadoOp.includes('error'))  return 'error';
    const mb = parseFloat(consumo.consumo_mb);
    if (!isNaN(mb) && mb === 0)      return 'sin_consumo';
    return 'activo';
}

// Badge de telefonía (coloreado por operadora)
const TELEFONIA_COLORES = {
    'Personal':    { bg: 'rgba(37,99,235,0.12)',  color: '#1d4ed8' },
    'Claro':       { bg: 'rgba(220,38,38,0.12)',   color: '#b91c1c' },
    'Tigo':        { bg: 'rgba(234,88,12,0.12)',   color: '#c2410c' },
    'Vox':         { bg: 'rgba(22,163,74,0.12)',   color: '#15803d' },
    'Desconocida': { bg: 'rgba(107,114,128,0.12)', color: '#4b5563' },
};

function badgeTelefonia(tel) {
    if (!tel) return '-';
    const cfg = TELEFONIA_COLORES[tel] || TELEFONIA_COLORES['Desconocida'];
    return `<span class="badge-estado" style="background:${cfg.bg};color:${cfg.color}">${tel}</span>`;
}

// ── TAB SWITCHING ─────────────────────────────────────────────────

function cambiarTab(tab) {
    const tabDisp = document.getElementById('tab-dispositivos');
    const tabCons = document.getElementById('tab-consumo');
    const btnDisp = document.getElementById('tabBtnDispositivos');
    const btnCons = document.getElementById('tabBtnConsumo');

    if (tab === 'dispositivos') {
        tabDisp.style.display = 'block';
        tabCons.style.display = 'none';
        btnDisp.classList.add('tab-activo');
        btnCons.classList.remove('tab-activo');
        // Leaflet necesita recalcular tamaño al hacerse visible
        if (mapaLeaflet) setTimeout(() => mapaLeaflet.invalidateSize(), 80);
    } else {
        tabDisp.style.display = 'none';
        tabCons.style.display = 'block';
        btnDisp.classList.remove('tab-activo');
        btnCons.classList.add('tab-activo');
        cargarConsumos();  // refresca al volver al tab
    }
}

// ── CARGA Y DISPLAY DE CONSUMOS ────────────────────────────────────

async function cargarConsumos() {
    const loading = document.getElementById('loadingConsumo');
    loading.style.display = 'block';
    document.getElementById('tablaDatosConsumo').innerHTML = '';

    try {
        const { data, error } = await window.clienteSupabase
            .from('consumo_sim')
            .select('*')
            .order('fecha_consumo', { ascending: false });

        loading.style.display = 'none';

        if (error) {
            document.getElementById('tablaDatosConsumo').innerHTML =
                `<tr><td colspan="8" style="text-align:center;padding:40px;color:#ef4444">❌ ${error.message}</td></tr>`;
            return;
        }

        const consumos = data || [];
        console.log(`✅ ${consumos.length} consumos cargados`);
        todosLosConsumos  = consumos;
        consumosFiltrados = consumos;
        mostrarDatosConsumo(consumos);

    } catch (e) {
        loading.style.display = 'none';
        console.error('❌', e);
    }
}

// Wrapper: resetea páginas, muestra tabla y actualiza gráficos
function mostrarDatosConsumo(datos) {
    paginaConsumo = 1;
    paginaEquipos = 1;
    actualizarTotalConsumo(datos);
    if (vistaConsumo === 'equipos') {
        mostrarConsolidado(datos);
    } else {
        mostrarEnTablaConsumo(datos);
    }
    crearGraficosConsumo(datos);
}

function actualizarTotalConsumo(datos) {
    const total = (datos || consumosFiltrados).reduce((s, c) => s + (parseFloat(c.consumo_mb) || 0), 0);
    const el = document.getElementById('totalConsumoResumen');
    if (el) el.innerHTML = `Total consumo: <strong>${formatearNumero(total)} MB</strong>`;
}

function mostrarEnTablaConsumo(datos) {
    const tbody  = document.getElementById('tablaDatosConsumo');
    const infoEl = document.getElementById('paginacion-info-consumo');
    const pagEl  = document.getElementById('paginacion-consumo');
    tbody.innerHTML = '';

    const total        = datos.length;
    const totalPaginas = Math.max(1, Math.ceil(total / ITEMS_POR_PAGINA));
    if (paginaConsumo > totalPaginas) paginaConsumo = totalPaginas;

    if (total === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px">No se encontraron resultados.</td></tr>';
        infoEl.innerHTML = '';
        pagEl.innerHTML  = '';
        return;
    }

    const sorted = sortearLineas(datos);
    updateSortIcons('tablaConsumo2', sortLineas);

    const inicio = (paginaConsumo - 1) * ITEMS_POR_PAGINA;
    const fin    = Math.min(inicio + ITEMS_POR_PAGINA, total);

    sorted.slice(inicio, fin).forEach(c => {
        const est        = estadoConsDisplay(c);
        const estMostrar = esViewer() ? estadoSimple(est) : est;
        const cfg        = esViewer()
            ? (ESTADO_CONFIG_VIEWER[estMostrar] || ESTADO_CONFIG_VIEWER['activo'])
            : (ESTADO_CONFIG_DISP[est]          || ESTADO_CONFIG_DISP['activo']);
        const rc  = encontrarRC(c);
        const mb  = (c.consumo_mb !== null && c.consumo_mb !== undefined)
            ? formatearNumero(c.consumo_mb) + ' MB'
            : '-';
        const tr  = document.createElement('tr');
        if (estMostrar !== 'activo') tr.classList.add('fila-inactiva');
        tr.innerHTML = `
            <td><span class="badge-estado ${cfg.cls}">${cfg.label}</span></td>
            <td><strong>${rc}</strong></td>
            <td>${c.numero || '-'}</td>
            <td class="td-imei">${normalizarImei(c.imei) || '-'}</td>
            <td>${badgeTelefonia(c.telefonia)}</td>
            <td>${mb}</td>
            <td>${formatearFecha(c.fecha_consumo)}</td>
            ${esViewer() ? '' : `<td>${c.observacion || '-'}</td>`}
        `;
        tbody.appendChild(tr);
    });

    infoEl.innerHTML = `Mostrando <strong>${inicio + 1}–${fin}</strong> de <strong>${formatearNumero(total)}</strong> resultados`;
    renderPaginacionConsumo(totalPaginas);
}

function renderPaginacionConsumo(totalPaginas) {
    const cont = document.getElementById('paginacion-consumo');
    if (totalPaginas <= 1) { cont.innerHTML = ''; return; }

    const prev = paginaConsumo === 1;
    const next = paginaConsumo === totalPaginas;

    let html = '<div class="pag-controles">';
    html += `<button class="pag-btn" onclick="irPaginaConsumo(${paginaConsumo - 1})" ${prev ? 'disabled' : ''}>← Anterior</button>`;

    paginasVisibles(paginaConsumo, totalPaginas).forEach(p => {
        if (p === '...') {
            html += '<span class="pag-dots">…</span>';
        } else {
            html += `<button class="pag-btn pag-num ${p === paginaConsumo ? 'pag-activa' : ''}" onclick="irPaginaConsumo(${p})">${p}</button>`;
        }
    });

    html += `<button class="pag-btn" onclick="irPaginaConsumo(${paginaConsumo + 1})" ${next ? 'disabled' : ''}>Siguiente →</button>`;
    html += '</div>';
    cont.innerHTML = html;
}

function irPaginaConsumo(num) {
    const totalPaginas = Math.ceil(consumosFiltrados.length / ITEMS_POR_PAGINA);
    if (num < 1 || num > totalPaginas) return;
    paginaConsumo = num;
    mostrarEnTablaConsumo(consumosFiltrados);
    document.querySelector('#tab-consumo .table-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Detecta doble clic en un gráfico Chart.js
function makeDblClickHandler(fn) {
    let last = 0;
    return (event, elements) => {
        const now = Date.now();
        if (now - last < 350 && elements.length) { last = 0; fn(elements[0]); }
        else last = now;
    };
}

// Crea los 3 gráficos del tab de consumo
function crearGraficosConsumo(datos) {
    if (chartConsumoHistorico) chartConsumoHistorico.destroy();
    if (chartConsumoLineas)    chartConsumoLineas.destroy();
    if (chartConsumoEstados)   chartConsumoEstados.destroy();

    if (datos.length === 0) return;

    // ── 1. Histórico: MB por día desglosado por telefonía ───────
    const TELEFONIA_CHART = {
        Personal:    { color: '#1d4ed8', bg: 'rgba(37,99,235,0.08)' },
        Claro:       { color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
        Tigo:        { color: '#c2410c', bg: 'rgba(234,88,12,0.08)' },
        Vox:         { color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
        Desconocida: { color: '#6b7280', bg: 'rgba(107,114,128,0.08)' },
    };

    // Recolectar fechas y operadoras únicas presentes en los datos
    const fechasSet = new Set();
    const telefonias = [];
    datos.forEach(c => {
        if (c.fecha_consumo) fechasSet.add(String(c.fecha_consumo).substring(0, 10));
        const tel = c.telefonia || 'Desconocida';
        if (!telefonias.includes(tel)) telefonias.push(tel);
    });
    const fechas = [...fechasSet].sort();

    // Acumular MB por [telefonía][fecha]
    const mbPorTelFecha = {};
    telefonias.forEach(tel => { mbPorTelFecha[tel] = {}; });
    datos.forEach(c => {
        const f   = c.fecha_consumo ? String(c.fecha_consumo).substring(0, 10) : null;
        const tel = c.telefonia || 'Desconocida';
        const mb  = parseFloat(c.consumo_mb) || 0;
        if (f) mbPorTelFecha[tel][f] = (mbPorTelFecha[tel][f] || 0) + mb;
    });

    const datasets = telefonias.map(tel => {
        const cfg = TELEFONIA_CHART[tel] || { color: '#8A35AB', bg: 'rgba(138,53,171,0.08)' };
        return {
            label: tel,
            data: fechas.map(f => mbPorTelFecha[tel][f] || 0),
            borderColor: cfg.color,
            backgroundColor: cfg.bg,
            borderWidth: 2.5,
            fill: false,
            tension: 0.4,
            pointBackgroundColor: cfg.color,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
        };
    });

    const ctxH = document.getElementById('chartConsumoHistorico').getContext('2d');
    chartConsumoHistorico = new Chart(ctxH, {
        type: 'line',
        data: { labels: fechas.map(f => formatearFecha(f)), datasets },
        options: {
            responsive: true, maintainAspectRatio: true,
            plugins: {
                legend: { position: 'bottom', labels: { padding: 14, font: { size: 12 } } },
                tooltip: { callbacks: { label: c => c.dataset.label + ': ' + formatearNumero(c.parsed.y) + ' MB' } }
            },
            scales: { y: { beginAtZero: true, ticks: { callback: v => formatearNumero(v) } } },
            onClick: makeDblClickHandler(el => {
                const fecha = fechas[el.index];
                if (!fecha) return;
                document.getElementById('filtroFechaDesde').value = fecha;
                document.getElementById('filtroFechaHasta').value = fecha;
                aplicarFiltrosConsumo();
            }),
            onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; }
        }
    });

    // ── 2. Top 15 líneas por MB ─────────────────────────────────
    const porLinea = {};
    datos.forEach(c => {
        const rc  = encontrarRC(c);
        const key = rc !== '-' ? rc : (c.numero || c.imei || 'Sin ID');
        const mb  = parseFloat(c.consumo_mb) || 0;
        porLinea[key] = (porLinea[key] || 0) + mb;
    });
    const top15 = Object.entries(porLinea)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);
    const labelsLineas  = top15.map(([k]) => k);
    const valoresLineas = top15.map(([, v]) => v);
    const coloresLineas = labelsLineas.map((_, i) => COLORES[i % COLORES.length]);

    const ctxL = document.getElementById('chartConsumoLineas').getContext('2d');
    chartConsumoLineas = new Chart(ctxL, {
        type: 'bar',
        data: {
            labels: labelsLineas,
            datasets: [{
                label: 'MB',
                data: valoresLineas,
                backgroundColor: coloresLineas,
                borderColor: coloresLineas,
                borderWidth: 2,
                borderRadius: 6,
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: true, indexAxis: 'y',
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: c => formatearNumero(c.parsed.x) + ' MB' } }
            },
            scales: { x: { beginAtZero: true, ticks: { callback: v => formatearNumero(v) } } },
            onClick: makeDblClickHandler(el => {
                const label = labelsLineas[el.index];
                if (!label || label === 'Sin ID') return;
                if (/[a-zA-Z_]/.test(label)) {
                    document.getElementById('filtroRCConsumo').value  = label;
                    document.getElementById('filtroNumConsumo').value = '';
                } else {
                    document.getElementById('filtroRCConsumo').value  = '';
                    document.getElementById('filtroNumConsumo').value = label;
                }
                aplicarFiltrosConsumo();
            }),
            onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; }
        }
    });

    // ── 3. Estado de líneas (donut) ──────────────────────────────
    const COLORES_ESTADO = {
        activo:      '#16a34a',
        desactivado: '#dc2626',
        legado:      '#7c3aed',
        error:       '#ef4444',
    };
    const porEstado = {};
    datos.forEach(c => {
        const est = esViewer()
            ? estadoSimple(estadoConsDisplay(c))
            : estadoConsDisplay(c);
        porEstado[est] = (porEstado[est] || 0) + 1;
    });
    const estadoKeys    = Object.keys(porEstado);
    const estadoCounts  = estadoKeys.map(e => porEstado[e]);
    const estadoColores = estadoKeys.map(e => COLORES_ESTADO[e] || '#6b7280');
    const cfgEstado     = esViewer() ? ESTADO_CONFIG_VIEWER : ESTADO_CONFIG_DISP;
    const estadoLabels  = estadoKeys.map(e =>
        (cfgEstado[e]?.label || e).replace('● ', '')
    );

    // Mapa label → key de estado para el onClick
    const labelToEstadoKey = {};
    estadoLabels.forEach((lbl, i) => { labelToEstadoKey[lbl] = estadoKeys[i]; });

    const ctxE = document.getElementById('chartConsumoEstados').getContext('2d');
    chartConsumoEstados = new Chart(ctxE, {
        type: 'doughnut',
        data: {
            labels: estadoLabels,
            datasets: [{ data: estadoCounts, backgroundColor: estadoColores, borderColor: '#fff', borderWidth: 3 }]
        },
        options: {
            responsive: true, maintainAspectRatio: true,
            plugins: {
                legend: { position: 'bottom', labels: { padding: 15, font: { size: 12 } } },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = ((ctx.parsed / total) * 100).toFixed(1);
                            return ctx.label + ': ' + formatearNumero(ctx.parsed) + ' (' + pct + '%)';
                        }
                    }
                }
            },
            onClick: makeDblClickHandler(el => {
                const lbl = estadoLabels[el.index];
                document.getElementById('filtroEstadoConsumo').value = labelToEstadoKey[lbl] || '';
                aplicarFiltrosConsumo();
            }),
            onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; }
        }
    });
}

// ── ORDENAMIENTO ──────────────────────────────────────────────────

function setSortLineas(col) {
    sortLineas.dir = sortLineas.col === col && sortLineas.dir === 'asc' ? 'desc' : 'asc';
    sortLineas.col = col;
    mostrarEnTablaConsumo(consumosFiltrados);
}

function setSortEquipos(col) {
    sortEquipos.dir = sortEquipos.col === col && sortEquipos.dir === 'asc' ? 'desc' : 'asc';
    sortEquipos.col = col;
    paginaEquipos = 1;
    mostrarConsolidado(consumosFiltrados);
}

function sortearLineas(datos) {
    const { col, dir } = sortLineas;
    const m = dir === 'asc' ? 1 : -1;
    return [...datos].sort((a, b) => {
        let va, vb;
        switch (col) {
            case 'estado':    va = estadoConsDisplay(a);          vb = estadoConsDisplay(b);          break;
            case 'rc':        va = encontrarRC(a);                vb = encontrarRC(b);                break;
            case 'numero':    va = String(a.numero    || '');     vb = String(b.numero    || '');     break;
            case 'imei':      va = normalizarImei(a.imei);        vb = normalizarImei(b.imei);        break;
            case 'telefonia': va = String(a.telefonia || '');     vb = String(b.telefonia || '');     break;
            case 'mb':        return ((parseFloat(a.consumo_mb) || 0) - (parseFloat(b.consumo_mb) || 0)) * m;
            case 'fecha':     va = String(a.fecha_consumo || ''); vb = String(b.fecha_consumo || ''); break;
            default: return 0;
        }
        return va.localeCompare(vb) * m;
    });
}

function sortearEquipos(filas) {
    const { col, dir } = sortEquipos;
    const m = dir === 'asc' ? 1 : -1;
    return [...filas].sort((a, b) => {
        switch (col) {
            case 'rc':       return a.rc.localeCompare(b.rc) * m;
            case 'regional': return a.regional.localeCompare(b.regional) * m;
            case 'sim1':     return a.sim1Label.localeCompare(b.sim1Label) * m;
            case 'sim1mb':   return (a.sim1MB   - b.sim1MB)   * m;
            case 'sim2':     return a.sim2Label.localeCompare(b.sim2Label) * m;
            case 'sim2mb':   return (a.sim2MB   - b.sim2MB)   * m;
            case 'total':    return (a.totalMB  - b.totalMB)  * m;
            default: return 0;
        }
    });
}

function updateSortIcons(tableId, sortState) {
    document.querySelectorAll(`#${tableId} thead th[data-sort]`).forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.dataset.sort === sortState.col)
            th.classList.add(sortState.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    });
}

// ── VISTA TOGGLE ──────────────────────────────────────────────────

function cambiarVista(vista) {
    vistaConsumo = vista;
    document.getElementById('btnVerLineas').classList.toggle('view-activo', vista === 'lineas');
    document.getElementById('btnVerEquipos').classList.toggle('view-activo', vista === 'equipos');

    const tablaLineas     = document.getElementById('tablaConsumo2');
    const pagLineas       = document.getElementById('paginacion-consumo');
    const tablaEquipos    = document.getElementById('tablaConsolidado');

    if (vista === 'lineas') {
        tablaLineas.style.display  = '';
        pagLineas.style.display    = '';
        tablaEquipos.style.display = 'none';
        document.getElementById('paginacion-equipos').innerHTML = '';
        paginaConsumo = 1;
        mostrarEnTablaConsumo(consumosFiltrados);
    } else {
        tablaLineas.style.display  = 'none';
        pagLineas.style.display    = 'none';
        tablaEquipos.style.display = '';
        paginaEquipos = 1;
        mostrarConsolidado(consumosFiltrados);
    }
}

// ── VISTA CONSOLIDADA POR EQUIPO ──────────────────────────────────

// Devuelve true cuando no hay filtros que requieran escanear consumo_sim
// (en ese caso podemos usar la vista materializada de la BD)
function puedeUsarVistaMat() {
    const desde     = document.getElementById('filtroFechaDesde').value;
    const hasta     = document.getElementById('filtroFechaHasta').value;
    const telefonia = document.getElementById('filtroTelefonia').value;
    const num       = document.getElementById('filtroNumConsumo').value.trim();
    const estado    = document.getElementById('filtroEstadoConsumo').value;
    return !desde && !hasta && !telefonia && !num && !estado;
}

function buildConsolidado(datos) {
    const porRC = new Map();
    datos.forEach(c => {
        const rc = encontrarRC(c);
        if (!porRC.has(rc)) porRC.set(rc, []);
        porRC.get(rc).push(c);
    });

    const filas = [];
    porRC.forEach((consumos, rc) => {
        // Buscar dispositivo asociado
        let device = null;
        for (const c of consumos) {
            const num  = String(c.numero || '').trim();
            const imei = normalizarImei(c.imei);
            device = mapaNumADevice.get(num) || mapaImeiADevice.get(imei) || null;
            if (device) break;
        }

        const sim1Num  = device ? String(device.sim1_num  || '').trim() : '';
        const sim2Num  = device ? String(device.sim2_num  || '').trim() : '';
        const sim1Imei = device ? normalizarImei(device.sim1_imei) : '';
        const sim2Imei = device ? normalizarImei(device.sim2_imei) : '';
        const sim1M2M  = sim1Num.toLowerCase() === 'm2m';
        const sim2M2M  = sim2Num.toLowerCase() === 'm2m';

        const sim1Rows = consumos.filter(c => {
            const n = String(c.numero || '').trim();
            const i = normalizarImei(c.imei);
            return sim1M2M ? i === sim1Imei : (n === sim1Num || i === sim1Imei);
        });
        const sim2Rows = consumos.filter(c => {
            const n = String(c.numero || '').trim();
            const i = normalizarImei(c.imei);
            return sim2M2M ? i === sim2Imei : (n === sim2Num || i === sim2Imei);
        });

        const sim1MB   = sim1Rows.reduce((s, c) => s + (parseFloat(c.consumo_mb) || 0), 0);
        const sim2MB   = sim2Rows.reduce((s, c) => s + (parseFloat(c.consumo_mb) || 0), 0);
        const totalMB  = consumos.reduce((s, c) => s + (parseFloat(c.consumo_mb) || 0), 0);

        filas.push({
            rc,
            regional:   device?.regional || '-',
            sim1Label:  sim1M2M ? 'M2M' : (sim1Num || (sim1Rows[0]?.numero) || '-'),
            sim1MB,
            sim2Label:  sim2M2M ? 'M2M' : (sim2Num || (sim2Rows[0]?.numero) || '-'),
            sim2MB,
            totalMB,
        });
    });

    return filas.sort((a, b) => a.rc.localeCompare(b.rc));
}

// Renderiza filas del consolidado (acepta tanto objetos de DB como del cliente)
function renderFilasConsolidado(filas) {
    const tbody = document.getElementById('tablaConsolidadoBody');
    tbody.innerHTML = '';
    filas.forEach(f => {
        const sim1Label = f.sim1_label ?? f.sim1Label ?? '-';
        const sim2Label = f.sim2_label ?? f.sim2Label ?? '-';
        const sim1MB    = f.sim1_mb    ?? f.sim1MB    ?? 0;
        const sim2MB    = f.sim2_mb    ?? f.sim2MB    ?? 0;
        const totalMB   = f.total_mb   ?? f.totalMB   ?? 0;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${f.rc}</strong></td>
            <td><span class="badge-regional">${f.regional}</span></td>
            <td>${sim1Label}</td>
            <td>${formatearNumero(sim1MB)} MB</td>
            <td>${sim2Label !== '-' ? sim2Label : '<span style="color:#bbb">—</span>'}</td>
            <td>${sim2Label !== '-' ? formatearNumero(sim2MB) + ' MB' : '<span style="color:#bbb">—</span>'}</td>
            <td><strong>${formatearNumero(totalMB)} MB</strong></td>
        `;
        tbody.appendChild(tr);
    });
}

// Punto de entrada: decide si usa vista materializada o cliente según los filtros activos
async function mostrarConsolidado(datos) {
    if (puedeUsarVistaMat()) {
        await mostrarConsolidadoDB();
    } else {
        mostrarConsolidadoCliente(datos);
    }
}

// ── Via vista materializada (BD) ──────────────────────────────────────
async function mostrarConsolidadoDB() {
    const tbody  = document.getElementById('tablaConsolidadoBody');
    const infoEl = document.getElementById('paginacion-info-consumo');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:#35398C">⏳ Cargando...</td></tr>';

    const rc = document.getElementById('filtroRCConsumo').value.trim();

    // Mapeo columna JS → nombre en la vista
    const colMap = {
        rc: 'rc', regional: 'regional',
        sim1: 'sim1_label', sim1mb: 'sim1_mb',
        sim2: 'sim2_label', sim2mb: 'sim2_mb',
        total: 'total_mb',
    };
    const dbCol = colMap[sortEquipos.col] || 'rc';

    let query = window.clienteSupabase
        .from('consumo_consolidado')
        .select('*', { count: 'exact' })
        .order(dbCol, { ascending: sortEquipos.dir === 'asc' });

    if (rc) query = query.ilike('rc', `%${rc}%`);

    const from = (paginaEquipos - 1) * ITEMS_POR_PAGINA;
    query = query.range(from, from + ITEMS_POR_PAGINA - 1);

    const { data, error, count } = await query;

    if (error || !data) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:#ef4444">❌ ${error?.message || 'Error al consultar vista'}</td></tr>`;
        infoEl.innerHTML = '';
        document.getElementById('paginacion-equipos').innerHTML = '';
        return;
    }

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px">No se encontraron resultados.</td></tr>';
        infoEl.innerHTML = '';
        document.getElementById('paginacion-equipos').innerHTML = '';
        return;
    }

    renderFilasConsolidado(data);
    updateSortIcons('tablaConsolidado', sortEquipos);

    const fin = Math.min(from + ITEMS_POR_PAGINA, count);
    infoEl.innerHTML = `Mostrando <strong>${from + 1}–${fin}</strong> de <strong>${formatearNumero(count)}</strong> equipos <span style="color:#aaa;font-size:12px">(vista DB)</span>`;
    renderPaginacionEquipos(Math.ceil(count / ITEMS_POR_PAGINA));
}

// ── Via cliente (cuando hay filtros de fecha / telefonia / num) ───────
function mostrarConsolidadoCliente(datos) {
    const tbody  = document.getElementById('tablaConsolidadoBody');
    const infoEl = document.getElementById('paginacion-info-consumo');
    tbody.innerHTML = '';

    consolidadoActual = sortearEquipos(buildConsolidado(datos));
    updateSortIcons('tablaConsolidado', sortEquipos);

    const total        = consolidadoActual.length;
    const totalPaginas = Math.max(1, Math.ceil(total / ITEMS_POR_PAGINA));
    if (paginaEquipos > totalPaginas) paginaEquipos = totalPaginas;

    if (total === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px">No se encontraron resultados.</td></tr>';
        infoEl.innerHTML = '';
        document.getElementById('paginacion-equipos').innerHTML = '';
        return;
    }

    const inicio = (paginaEquipos - 1) * ITEMS_POR_PAGINA;
    const fin    = Math.min(inicio + ITEMS_POR_PAGINA, total);

    renderFilasConsolidado(consolidadoActual.slice(inicio, fin));
    infoEl.innerHTML = `Mostrando <strong>${inicio + 1}–${fin}</strong> de <strong>${formatearNumero(total)}</strong> equipos · <strong>${formatearNumero(datos.length)}</strong> líneas`;
    renderPaginacionEquipos(totalPaginas);
}

function renderPaginacionEquipos(totalPaginas) {
    const cont = document.getElementById('paginacion-equipos');
    if (totalPaginas <= 1) { cont.innerHTML = ''; return; }

    const prev = paginaEquipos === 1;
    const next = paginaEquipos === totalPaginas;

    let html = '<div class="pag-controles">';
    html += `<button class="pag-btn" onclick="irPaginaEquipos(${paginaEquipos - 1})" ${prev ? 'disabled' : ''}>← Anterior</button>`;
    paginasVisibles(paginaEquipos, totalPaginas).forEach(p => {
        if (p === '...') {
            html += '<span class="pag-dots">…</span>';
        } else {
            html += `<button class="pag-btn pag-num ${p === paginaEquipos ? 'pag-activa' : ''}" onclick="irPaginaEquipos(${p})">${p}</button>`;
        }
    });
    html += `<button class="pag-btn" onclick="irPaginaEquipos(${paginaEquipos + 1})" ${next ? 'disabled' : ''}>Siguiente →</button>`;
    html += '</div>';
    cont.innerHTML = html;
}

function irPaginaEquipos(num) {
    if (num < 1) return;
    paginaEquipos = num;
    mostrarConsolidado(consumosFiltrados);
    document.querySelector('#tab-consumo .table-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── EXPORTAR ──────────────────────────────────────────────────────

function exportarConsumo() {
    const wb = XLSX.utils.book_new();

    if (vistaConsumo === 'equipos') {
        const filas = buildConsolidado(consumosFiltrados);
        const rows  = filas.map(f => ({
            'RC':              f.rc,
            'Regional':        f.regional,
            'SIM Principal':   f.sim1Label,
            'MB SIM Principal': f.sim1MB,
            'SIM Respaldo':    f.sim2Label !== '-' ? f.sim2Label : '',
            'MB SIM Respaldo': f.sim2Label !== '-' ? f.sim2MB    : '',
            'Total MB':        f.totalMB,
        }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Por Equipo');
    } else {
        const rows = consumosFiltrados.map(c => {
            const est = estadoConsDisplay(c);
            const cfg = esViewer() ? ESTADO_CONFIG_VIEWER[estadoSimple(est)] : ESTADO_CONFIG_DISP[est];
            const row = {
                'Estado':    (cfg?.label || est).replace('● ', ''),
                'RC':        encontrarRC(c),
                'Número':    c.numero    || '',
                'IMEI':      normalizarImei(c.imei) || '',
                'Telefonía': c.telefonia || '',
                'MB':        parseFloat(c.consumo_mb) || 0,
                'Fecha':     c.fecha_consumo || '',
            };
            if (!esViewer()) row['Observación'] = c.observacion || '';
            return row;
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Por Línea');
    }

    const fecha = new Date().toISOString().substring(0, 10);
    XLSX.writeFile(wb, `consumo_ANDE_${fecha}.xlsx`);
}

// ── IMPRIMIR ──────────────────────────────────────────────────────

function imprimirReporte() {
    const desde = document.getElementById('filtroFechaDesde').value;
    const hasta = document.getElementById('filtroFechaHasta').value;
    const titulo = vistaConsumo === 'equipos' ? 'Reporte de Consumo por Equipo' : 'Reporte de Consumo por Línea';
    const periodo = (desde || hasta)
        ? `Período: ${desde ? formatearFecha(desde) : 'inicio'} — ${hasta ? formatearFecha(hasta) : 'hoy'}`
        : 'Todos los períodos';

    document.getElementById('printTitulo').textContent  = titulo;
    document.getElementById('printPeriodo').textContent = periodo;
    document.getElementById('printFecha').textContent   = new Date().toLocaleDateString('es-PY');
    window.print();
}

// ── FILTROS CONSUMO ────────────────────────────────────────────────

function aplicarFiltrosConsumo() {
    const telefonia = document.getElementById('filtroTelefonia').value;
    const estado    = document.getElementById('filtroEstadoConsumo').value;
    const rc        = document.getElementById('filtroRCConsumo').value.trim().toLowerCase();
    const num       = document.getElementById('filtroNumConsumo').value.trim();
    const desde     = document.getElementById('filtroFechaDesde').value;
    const hasta     = document.getElementById('filtroFechaHasta').value;

    consumosFiltrados = todosLosConsumos.filter(c => {
        if (telefonia && c.telefonia !== telefonia) return false;
        if (estado) {
            const estReal = estadoConsDisplay(c);
            const estComp = esViewer() ? estadoSimple(estReal) : estReal;
            if (estComp !== estado) return false;
        }
        if (rc  && !encontrarRC(c).toLowerCase().includes(rc)) return false;
        if (num && !String(c.numero || '').includes(num) && !normalizarImei(c.imei).includes(num)) return false;
        const f = String(c.fecha_consumo || '').substring(0, 10);
        if (desde && f < desde) return false;
        if (hasta && f > hasta) return false;
        return true;
    });

    mostrarDatosConsumo(consumosFiltrados);
}

function limpiarFiltrosConsumo() {
    document.getElementById('filtroTelefonia').value     = '';
    document.getElementById('filtroEstadoConsumo').value = '';
    document.getElementById('filtroRCConsumo').value     = '';
    document.getElementById('filtroNumConsumo').value    = '';
    document.getElementById('filtroFechaDesde').value    = '';
    document.getElementById('filtroFechaHasta').value    = '';
    consumosFiltrados = todosLosConsumos;
    mostrarDatosConsumo(consumosFiltrados);
}

// ── IMPORTACIÓN CSV CONSUMO ────────────────────────────────────────

function abrirImportConsumo() {
    document.getElementById('importConsumoModal').style.display = 'flex';
}

function cerrarImportConsumo() {
    document.getElementById('importConsumoModal').style.display = 'none';
    document.getElementById('importConsumoStatus').style.display = 'none';
    document.getElementById('archivoCSV').value = '';
    document.getElementById('dropLabelConsumo').innerHTML =
        'Arrastrá el archivo acá o <span>hacé clic para seleccionar</span>';
    document.getElementById('dropZoneConsumo').classList.remove('drop-active');
    document.getElementById('telefoniaDetectada').style.display = 'none';
    const fill = document.getElementById('progressFillConsumo');
    fill.style.width = '0%';
    fill.style.background = '';
    telefoniaActual = '';
}

function cerrarImportConsumoOverlay(e) {
    if (e.target === document.getElementById('importConsumoModal')) cerrarImportConsumo();
}

function archivoCSVSeleccionado(e) {
    const f = e.target.files[0];
    if (!f) return;
    document.getElementById('dropLabelConsumo').innerHTML =
        `<strong>📄 ${f.name}</strong> &nbsp;<span style="font-size:12px;color:#888">(${(f.size/1024).toFixed(0)} KB)</span>`;
    document.getElementById('dropZoneConsumo').classList.add('drop-active');

    telefoniaActual = detectarTelefonia(f.name);
    const det = document.getElementById('telefoniaDetectada');
    document.getElementById('telefoniaLabel').textContent = telefoniaActual;
    det.style.display = 'flex';
}

function dragOverConsumo(e) {
    e.preventDefault();
    document.getElementById('dropZoneConsumo').classList.add('drag-hover');
}

function dragLeaveConsumo(e) {
    document.getElementById('dropZoneConsumo').classList.remove('drag-hover');
}

function dropFileConsumo(e) {
    e.preventDefault();
    document.getElementById('dropZoneConsumo').classList.remove('drag-hover');
    const f = e.dataTransfer.files[0];
    if (f) {
        const dt = new DataTransfer();
        dt.items.add(f);
        const input = document.getElementById('archivoCSV');
        input.files = dt.files;
        archivoCSVSeleccionado({ target: input });
    }
}

function setProgressConsumo(pct, texto, color) {
    const fill = document.getElementById('progressFillConsumo');
    fill.style.width = pct + '%';
    if (color) fill.style.background = color;
    document.getElementById('progressTextConsumo').textContent = texto;
}

// Parsear CSV semicolon-separated: numero;imei;estado_operador;consumo_mb;fecha(DD/MM/YYYY);observacion
function parsearCSVConsumo(texto, telefonia) {
    const lineas = texto
        .replace(/^﻿/, '')  // quitar BOM si existe
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);

    const registros = [];

    for (const linea of lineas) {
        const cols = linea.split(';');
        if (cols.length < 4) continue;

        const numero   = (cols[0] || '').trim();
        const imei     = normalizarImei((cols[1] || '').trim());
        const estadoOp = (cols[2] || '').trim();
        const mbRaw    = (cols[3] || '').trim();
        const fechaRaw = (cols[4] || '').trim();
        const obs      = (cols[5] || '').trim();

        if (!numero && !imei) continue;

        const consumo_mb = mbRaw !== '' ? parseFloat(mbRaw) : null;

        // Parsear fecha DD/MM/YYYY → YYYY-MM-DD
        let fecha_consumo = null;
        if (fechaRaw) {
            const parts = fechaRaw.split('/');
            if (parts.length === 3) {
                fecha_consumo = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
        }

        // Calcular estado
        const obsLower = obs.toLowerCase();
        const statOp   = estadoOp.toLowerCase();
        let estado = 'activo';
        if (obsLower.includes('backup'))    estado = 'desactivado';
        else if (statOp === 'legado')       estado = 'legado';
        else if (statOp.includes('error'))  estado = 'error';
        else if (consumo_mb === 0)          estado = 'sin_consumo';

        registros.push({
            numero:          numero    || null,
            imei:            imei      || null,
            estado_operador: estadoOp  || null,
            consumo_mb,
            fecha_consumo,
            observacion:     obs       || null,
            telefonia,
            estado,
        });
    }
    return registros;
}

async function ejecutarImportConsumo() {
    const input = document.getElementById('archivoCSV');
    if (!input.files.length) {
        alert('Seleccioná un archivo CSV primero.');
        return;
    }
    if (!telefoniaActual || telefoniaActual === 'Desconocida') {
        if (!confirm('No se detectó la telefonía en el nombre del archivo.\n¿Querés importar igual? Se guardará como "Desconocida".')) return;
    }

    const modo    = document.querySelector('input[name="importConsumoMode"]:checked').value;
    const file    = input.files[0];
    const statusEl = document.getElementById('importConsumoStatus');
    statusEl.style.display = 'block';
    document.getElementById('progressFillConsumo').style.background = '';
    setProgressConsumo(0, 'Leyendo archivo...');

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            setProgressConsumo(10, 'Parseando CSV...');
            const filas = parsearCSVConsumo(e.target.result, telefoniaActual);

            if (filas.length === 0) throw new Error('No se encontraron filas válidas en el archivo.');
            setProgressConsumo(15, `${filas.length} registros detectados...`);

            if (modo === 'replace') {
                setProgressConsumo(20, 'Eliminando consumos anteriores...');
                const { error } = await window.clienteSupabase
                    .from('consumo_sim')
                    .delete()
                    .gte('id', 1);
                if (error) throw new Error('Error al limpiar tabla: ' + error.message);
            }

            const BATCH  = 200;
            const inicio = modo === 'replace' ? 25 : 20;
            const rango  = 75;

            for (let i = 0; i < filas.length; i += BATCH) {
                const lote = filas.slice(i, i + BATCH);
                const { error } = await window.clienteSupabase
                    .from('consumo_sim')
                    .insert(lote);
                if (error) throw new Error(`Error en lote ${Math.floor(i / BATCH) + 1}: ${error.message}`);

                const pct = inicio + Math.round(((i + lote.length) / filas.length) * rango);
                setProgressConsumo(pct, `Subiendo... ${i + lote.length} / ${filas.length} registros`);
            }

            setProgressConsumo(100, `✅ ${filas.length} registros importados correctamente.`, '#22c55e');

            // Recargar ambas pestañas para reflejar cambios
            setTimeout(async () => {
                cerrarImportConsumo();
                // Refrescar vista materializada en la BD
                await window.clienteSupabase.rpc('refresh_consumo_consolidado').catch(() => {});
                await cargarDatos();      // actualiza mapas + tab dispositivos
                cargarConsumos();         // recarga tab consumo
            }, 1800);

        } catch (err) {
            setProgressConsumo(100, '❌ ' + err.message, '#ef4444');
            console.error(err);
        }
    };
    reader.readAsText(file, 'UTF-8');
}