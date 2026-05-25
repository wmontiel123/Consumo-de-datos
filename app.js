// Credenciales de acceso (demo)
const USUARIO_VALIDO = 'admin';
const PASSWORD_VALIDO = 'demo2025';

function intentarLogin() {
    const usuario = document.getElementById('loginUsuario').value.trim();
    const password = document.getElementById('loginPassword').value;
    const error = document.getElementById('loginError');

    if (usuario === USUARIO_VALIDO && password === PASSWORD_VALIDO) {
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('appPrincipal').style.display = 'block';
        iniciarApp();
    } else {
        error.style.display = 'block';
        document.getElementById('loginPassword').value = '';
    }
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
    const est = calcularEstado(device);
    const cfg = ESTADO_CONFIG[est] || ESTADO_CONFIG['sin_consumo'];
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
        const est = calcularEstado(fila);
        const tr  = document.createElement('tr');
        if (est !== 'activo') tr.classList.add('fila-inactiva');
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
    const total = datos.length;
    const activos = datos.filter(d => calcularEstado(d) === 'activo').length;
    const inactivos = total - activos;

    document.getElementById('totalRegistros').textContent  = formatearNumero(total);
    document.getElementById('totalActivos').textContent    = formatearNumero(activos);
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
            }
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
            }
        }
    });

    // Gráfico de Torta — distribución por Regional
    const ctxTorta = document.getElementById('chartTorta').getContext('2d');
    chartTorta = new Chart(ctxTorta, {
        type: 'pie',
        data: {
            labels: regionales,
            datasets: [{
                data: cantidades,
                backgroundColor: coloresGrafico,
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
            }
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
        if (estado   && calcularEstado(item) !== estado) return false;
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

// Wrapper: resetea página, muestra tabla y actualiza gráficos
function mostrarDatosConsumo(datos) {
    paginaConsumo = 1;
    mostrarEnTablaConsumo(datos);
    crearGraficosConsumo(datos);
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

    const inicio = (paginaConsumo - 1) * ITEMS_POR_PAGINA;
    const fin    = Math.min(inicio + ITEMS_POR_PAGINA, total);

    datos.slice(inicio, fin).forEach(c => {
        const est = calcularEstadoConsumo(c);
        const cfg = ESTADO_CONFIG[est] || ESTADO_CONFIG['sin_consumo'];
        const rc  = encontrarRC(c);
        const mb  = (c.consumo_mb !== null && c.consumo_mb !== undefined)
            ? formatearNumero(c.consumo_mb) + ' MB'
            : '-';
        const tr  = document.createElement('tr');
        if (est !== 'activo') tr.classList.add('fila-inactiva');
        tr.innerHTML = `
            <td><span class="badge-estado ${cfg.cls}">${cfg.label}</span></td>
            <td><strong>${rc}</strong></td>
            <td>${c.numero || '-'}</td>
            <td class="td-imei">${normalizarImei(c.imei) || '-'}</td>
            <td>${badgeTelefonia(c.telefonia)}</td>
            <td>${mb}</td>
            <td>${formatearFecha(c.fecha_consumo)}</td>
            <td>${c.observacion || '-'}</td>
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
        data: {
            labels: fechas.map(f => formatearFecha(f)),
            datasets,
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { position: 'bottom', labels: { padding: 14, font: { size: 12 } } },
                tooltip: {
                    callbacks: {
                        label: c => c.dataset.label + ': ' + formatearNumero(c.parsed.y) + ' MB'
                    }
                }
            },
            scales: {
                y: { beginAtZero: true, ticks: { callback: v => formatearNumero(v) } }
            }
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
            responsive: true,
            maintainAspectRatio: true,
            indexAxis: 'y',
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: c => formatearNumero(c.parsed.x) + ' MB' } }
            },
            scales: {
                x: { beginAtZero: true, ticks: { callback: v => formatearNumero(v) } }
            }
        }
    });

    // ── 3. Estado de líneas (donut) ──────────────────────────────
    const COLORES_ESTADO = {
        activo:      '#16a34a',
        sin_consumo: '#ea580c',
        desactivado: '#dc2626',
        legado:      '#7c3aed',
        error:       '#ef4444',
    };
    const porEstado = {};
    datos.forEach(c => {
        const est = calcularEstadoConsumo(c);
        porEstado[est] = (porEstado[est] || 0) + 1;
    });
    const estadoKeys   = Object.keys(porEstado);
    const estadoCounts = estadoKeys.map(e => porEstado[e]);
    const estadoColores = estadoKeys.map(e => COLORES_ESTADO[e] || '#6b7280');
    const estadoLabels  = estadoKeys.map(e =>
        (ESTADO_CONFIG[e]?.label || e).replace('● ', '')
    );

    const ctxE = document.getElementById('chartConsumoEstados').getContext('2d');
    chartConsumoEstados = new Chart(ctxE, {
        type: 'doughnut',
        data: {
            labels: estadoLabels,
            datasets: [{
                data: estadoCounts,
                backgroundColor: estadoColores,
                borderColor: '#fff',
                borderWidth: 3,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
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
            }
        }
    });
}

// ── FILTROS CONSUMO ────────────────────────────────────────────────

function aplicarFiltrosConsumo() {
    const telefonia = document.getElementById('filtroTelefonia').value;
    const estado    = document.getElementById('filtroEstadoConsumo').value;
    const num       = document.getElementById('filtroNumConsumo').value.trim();
    const fecha     = document.getElementById('filtroFechaConsumo').value;

    consumosFiltrados = todosLosConsumos.filter(c => {
        if (telefonia && c.telefonia !== telefonia) return false;
        if (estado    && calcularEstadoConsumo(c) !== estado) return false;
        if (num && !String(c.numero || '').includes(num) && !normalizarImei(c.imei).includes(num)) return false;
        if (fecha && String(c.fecha_consumo || '').substring(0, 10) !== fecha) return false;
        return true;
    });

    mostrarDatosConsumo(consumosFiltrados);
}

function limpiarFiltrosConsumo() {
    document.getElementById('filtroTelefonia').value     = '';
    document.getElementById('filtroEstadoConsumo').value = '';
    document.getElementById('filtroNumConsumo').value    = '';
    document.getElementById('filtroFechaConsumo').value  = '';
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