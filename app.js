// Rol del usuario autenticado.
let rolActual = 'viewer';

// Guard para evitar que callbacks async actualicen la UI después del logout.
let _sesionActiva = false;

// Helpers de rol
function esViewer() { return rolActual === 'viewer'; }

// Colapsa todos los estados no-desactivado a 'activo' (para viewer y stats)
function estadoSimple(est) {
    return est === 'desactivado' ? 'desactivado' : 'activo';
}

// Estado para el tab Dispositivos: viene directo del campo estado de la DB.
function estadoDisp(device) {
    return calcularEstado(device);
}

// Config completa para admin en Dispositivos
const ESTADO_CONFIG_DISP = {
    activo:      { label: '● Activado',    cls: 'badge-activo' },
    sin_consumo: { label: '● Sin Consumo', cls: 'badge-sin-consumo-rc' },
    desactivado: { label: '● Desactivado', cls: 'badge-desactivado' },
};

// Tipos derivados de fecha_activacion en el import
const TIPOS_VALIDOS = ['activado', 'legado', 'satelital'];
const TIPO_CONFIG = {
    activado:  { label: 'Activado',  cls: 'badge-tipo-activado'  },
    legado:    { label: 'Legado',    cls: 'badge-tipo-legado'    },
    satelital: { label: 'Satelital', cls: 'badge-tipo-satelital' },
    error:     { label: 'Error',     cls: 'badge-tipo-error'     },
};
// Si tipo está vacío (fecha real) → 'activado'; si es legado/satelital → tal cual; otro texto → 'error'
function getTipoDevice(device) {
    const t = (device.tipo || '').trim().toLowerCase();
    if (!t) return 'activado';
    return TIPOS_VALIDOS.includes(t) ? t : 'error';
}

// Config simplificada para viewer (solo 2 estados)
const ESTADO_CONFIG_VIEWER = {
    activo:      { label: '● Activado',    cls: 'badge-activo' },
    desactivado: { label: '● Desactivado', cls: 'badge-desactivado' },
};

// ── Estados detallados por slot SIM ──────────────────────────────
// Almacenados en sim1_estado / sim2_estado de dispositivos_ande.
const SIM_EST_COLOR = {
    activo:      '#16a34a', // verde   (tiene registros, activo y con consumo > 0)
    inactivo:    '#dc2626', // rojo    (tiene registros pero desactivado)
    nulo:        '#dc2626', // rojo    (slot vacío, sin número ni IMEI)
    no_asignado: '#f97316', // naranja (tiene num/IMEI pero sin registros en consumo)
    sin_consumo: '#f97316', // naranja (tiene registros activos pero consumo_mb = 0)
};
const SIM_EST_LABEL = {
    activo:      'Activo',
    inactivo:    'Inactivo',
    nulo:        'Nulo',
    no_asignado: 'No asignado',
    sin_consumo: 'Sin Consumo',
};

// Estado detallado (5 estados) de un slot SIM (num+imei como conjunto).
// Reglas: slot vacío → nulo; ninguno encontrado → no_asignado;
//         cualquiera desactivado → inactivo; todos con 0 MB → sin_consumo; else → activo.
function calcularSimEstadoDetallado(num, imei) {
    const n   = String(num  || '').trim();
    const i   = normalizarImei(imei);
    const m2m = n.toLowerCase() === 'm2m';
    if ((!n || m2m) && !i) return 'nulo';
    const cNum  = (!m2m && n) ? mapaNumAConsumo.get(n)  : null;
    const cImei = i            ? mapaImeiAConsumo.get(i) : null;
    if (!cNum && !cImei) return 'no_asignado';
    const eN = cNum  ? estadoConsDisplay(cNum)  : null;
    const eI = cImei ? estadoConsDisplay(cImei) : null;
    if (eN === 'desactivado' || eI === 'desactivado') return 'inactivo';
    // sin_consumo: encontrado pero ninguno tiene consumo_mb > 0
    const mbN = cNum  ? (parseFloat(cNum.consumo_mb)  || 0) : null;
    const mbI = cImei ? (parseFloat(cImei.consumo_mb) || 0) : null;
    if ((mbN === null || mbN === 0) && (mbI === null || mbI === 0)) return 'sin_consumo';
    return 'activo';
}

// Reglas RC desde estados de slots:
// activo          → activo
// 2 rojos         → desactivado
// 2 naranjas      → sin_consumo (RC naranja)
// 1 rojo+1 naranja→ sin_consumo (RC naranja)
// resto           → null (sin cambio forzado)
function rcEstadoDesdeSimEstados(s1e, s2e) {
    if (s1e === 'activo' || s2e === 'activo') return 'activo';
    const isRojo    = e => e === 'inactivo' || e === 'nulo';
    const isNaranja = e => e === 'no_asignado' || e === 'sin_consumo';
    if ([s1e, s2e].filter(isRojo).length >= 2)                             return 'desactivado';
    if ([s1e, s2e].filter(isNaranja).length >= 2)                          return 'sin_consumo';
    if ([s1e, s2e].some(isRojo) && [s1e, s2e].some(isNaranja))            return 'sin_consumo';
    return null;
}

function cerrarSesion() {
    _sesionActiva = false;
    sessionStorage.removeItem('session');
    // Resetear estado
    rolActual = 'viewer';
    todosLosDatos = []; datosFiltrados = [];
    todosLosConsumos = []; consumosFiltrados = []; consolidadoActual = [];
    paginaConsumo = 1; paginaEquipos = 1;
    mapaNumAConsumo = new Map(); mapaImeiAConsumo = new Map();
    mapaNumADevice  = new Map(); mapaImeiADevice  = new Map();
    mapaNumAEstadoActual = new Map(); mapaImeiAEstadoActual = new Map();
    if (mapaLeaflet) { mapaLeaflet.remove(); mapaLeaflet = null; markersLayer = null; }
    if (chartBarras)          { chartBarras.destroy();          chartBarras = null; }
    if (chartLineas)          { chartLineas.destroy();          chartLineas = null; }
    if (chartTorta)           { chartTorta.destroy();           chartTorta = null; }
    if (chartConsumoHistorico){ chartConsumoHistorico.destroy();chartConsumoHistorico = null; }
    if (chartConsumoLineas)    { chartConsumoLineas.destroy();    chartConsumoLineas    = null; }
    if (chartConsumoTelefonia) { chartConsumoTelefonia.destroy(); chartConsumoTelefonia = null; }
    if (chartLineasEstado)     { chartLineasEstado.destroy();     chartLineasEstado     = null; }
    if (chartLineasTelefonia)  { chartLineasTelefonia.destroy();  chartLineasTelefonia  = null; }
    if (chartLineasTop10)      { chartLineasTop10.destroy();      chartLineasTop10      = null; }
    if (chartEquipoHistorico) { chartEquipoHistorico.destroy(); chartEquipoHistorico = null; }
    if (chartEquipoTop5)      { chartEquipoTop5.destroy();      chartEquipoTop5 = null; }
    if (chartEquipoRegional)  { chartEquipoRegional.destroy();  chartEquipoRegional = null; }
    if (chartPanelRC)  { chartPanelRC.destroy();  chartPanelRC  = null; }
    if (chartPanelSIM) { chartPanelSIM.destroy(); chartPanelSIM = null; }
    cerrarPanel();

    // Volver al login
    document.getElementById('appPrincipal').style.display = 'none';
    document.getElementById('loginOverlay').style.display = 'flex';
    document.getElementById('loginUsuario').value  = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginError').style.display = 'none';

    // Resetear tab activo y sub-vista a Consumo
    document.getElementById('tabBtnConsumo').classList.add('tab-activo');
    document.getElementById('tabBtnDispositivos').classList.remove('tab-activo');
    document.getElementById('tab-consumo').style.display = 'block';
    document.getElementById('tab-dispositivos').style.display = 'none';
    vistaConsumo = 'lineas';
    document.getElementById('btnVerLineas')?.classList.add('view-activo');
    document.getElementById('btnVerLineasBD')?.classList.remove('view-activo');
    document.getElementById('btnVerEquipos')?.classList.remove('view-activo');
}

async function intentarLogin() {
    const usuario  = document.getElementById('loginUsuario').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorEl  = document.getElementById('loginError');
    const btn      = document.getElementById('loginBtn');

    if (!usuario || !password) { errorEl.style.display = 'block'; return; }

    btn.disabled    = true;
    btn.textContent = 'Ingresando…';
    errorEl.style.display = 'none';

    // Guardia: el cliente debe estar listo
    if (!window.clienteSupabase) {
        btn.disabled = false; btn.textContent = 'Ingresar';
        errorEl.textContent = 'Error: cliente no inicializado. Recargá la página.';
        errorEl.style.display = 'block';
        return;
    }

    // Verificación server-side: la contraseña NUNCA sale del servidor
    const { data: rol, error } = await window.clienteSupabase.rpc('verificar_login', {
        p_usuario:  usuario,
        p_password: password,
    });

    btn.disabled    = false;
    btn.textContent = 'Ingresar';

    console.log('[login] rol:', rol, '| error:', error?.message, error?.code);

    if (error || !rol) {
        const SVG_ERR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
        errorEl.innerHTML = SVG_ERR + ' ' + (error ? `Error: ${error.message}` : 'Usuario o contraseña incorrectos.');
        errorEl.style.display = 'block';
        document.getElementById('loginPassword').value = '';
        return;
    }

    _activarSesion(usuario, rol);
}

// Activa la UI y guarda la sesión en sessionStorage (se borra al cerrar la pestaña)
function _activarSesion(usuario, rol) {
    _sesionActiva = true;
    rolActual = rol;
    sessionStorage.setItem('session', JSON.stringify({ usuario, rol }));
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('appPrincipal').style.display = 'block';
    document.getElementById('loginError').style.display   = 'none';
    aplicarRol();
    iniciarApp();
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

    // Ocultar columna Observación (TH) en tabla consumo (TDs se omiten en renderizado)
    document.getElementById('thObservacion').style.display = 'none';

    // Ocultar filtro Observación en Consumo
    document.getElementById('filtroObservacionGroup').style.display = 'none';

    // Ocultar filtro Tipo (solo admin lo ve)
    document.getElementById('filtroTipoGroup').style.display = 'none';

    // Ocultar botones de importación (solo admin puede importar datos)
    document.getElementById('btnImportDispositivos').style.display = 'none';
    document.getElementById('btnImportConsumo').style.display      = 'none';

    // Ocultar botón "Actualizar Estados" (escribe en BD)
    document.getElementById('btnActualizarEstados').style.display  = 'none';

    // Actualizar labels de las tarjetas de estadísticas
    document.querySelector('.stat-activos h3').textContent      = 'Activados';
    document.querySelector('.stat-desactivados h3').textContent = 'Desactivados';
}

// Inicializar Supabase + restaurar sesión de la pestaña actual
document.addEventListener('DOMContentLoaded', function() {

    // Crear cliente Supabase antes del login (necesario para el RPC de verificación)
    window.clienteSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // Permitir Enter en los campos del login
    ['loginUsuario', 'loginPassword'].forEach(function(id) {
        document.getElementById(id).addEventListener('keydown', function(e) {
            if (e.key === 'Enter') intentarLogin();
        });
    });

    // Restaurar sesión desde sessionStorage (persiste en F5, se borra al cerrar la pestaña)
    try {
        const saved = sessionStorage.getItem('session');
        if (saved) {
            const { usuario, rol } = JSON.parse(saved);
            if (usuario && ['admin', 'viewer'].includes(rol)) {
                _activarSesion(usuario, rol);
            } else {
                sessionStorage.removeItem('session');
            }
        }
    } catch (_) {
        sessionStorage.removeItem('session');
    }
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
let chartConsumoHistorico, chartConsumoLineas, chartConsumoTelefonia;
let chartLineasEstado = null, chartLineasTelefonia = null, chartLineasTop10 = null;
let chartEquipoHistorico = null;
let chartEquipoTop5      = null;   // pseudo-instancia (HTML nativo)
let chartEquipoRegional  = null;
let chartPanelRC  = null;
let chartPanelSIM = null;
let cambioSimActual = { codigo: null, slot: null };
let archivosCSVPendientes = [];   // archivos CSV seleccionados para importar
let mapaLeaflet = null;
let markersLayer = null;
const COLORES = ['#35398C', '#DA527D', '#B44C80', '#904783', '#644087'];

// Consumo SIM
let todosLosConsumos     = [];
let consumosFiltrados    = [];   // datos para gráficos / consolidado (hasta 50 k filas)
let totalConsumoServidor = 0;    // total real en BD (para paginación)
let paginaConsumo        = 1;
let _consumosTimestamp   = 0;    // timestamp del último fetch completo (para caché)
const CONSUMOS_TTL_MS    = 3 * 60 * 1000; // 3 minutos
let mapaNumAConsumo       = new Map();
let mapaImeiAConsumo      = new Map();
let mapaNumADevice        = new Map();
let mapaImeiADevice       = new Map();
let mapaNumAEstadoActual  = new Map(); // numero → estado actual (tabla sim_estados)
let mapaImeiAEstadoActual = new Map(); // imei   → estado actual (tabla sim_estados)
let telefoniaActual   = '';
let vistaConsumo      = 'lineas';    // 'lineas-bd' | 'equipos' | 'lineas'
let sortLineas        = { col: 'fecha', dir: 'desc' };
let sortEquipos       = { col: 'rc',    dir: 'asc'  };
let paginaEquipos     = 1;
let paginaLineasBD    = 1;
let totalLineasBD     = 0;
let consolidadoActual = [];

// Trae TODOS los registros paginando de a 1000 con hasta 5 páginas en paralelo
async function fetchTodos(tabla, columnas, orden, ascendente = true) {
    const LOTE        = 1000;
    const CONCURRENCIA = 5;

    // 1. Obtener total (head request, sin datos)
    const { count, error: cErr } = await window.clienteSupabase
        .from(tabla).select('*', { count: 'exact', head: true });
    if (cErr) throw cErr;
    if (!count) return [];

    const totalPaginas = Math.ceil(count / LOTE);
    const resultado    = new Array(totalPaginas);

    // 2. Fetch en batches de CONCURRENCIA páginas a la vez
    for (let batch = 0; batch < totalPaginas; batch += CONCURRENCIA) {
        const tamBatch = Math.min(CONCURRENCIA, totalPaginas - batch);
        const paginas  = await Promise.all(
            Array.from({ length: tamBatch }, (_, j) => {
                const p = batch + j;
                return window.clienteSupabase
                    .from(tabla).select(columnas)
                    .order(orden, { ascending: ascendente })
                    .range(p * LOTE, (p + 1) * LOTE - 1);
            })
        );
        paginas.forEach((r, j) => {
            if (r.error) throw r.error;
            resultado[batch + j] = r.data || [];
        });
    }
    return resultado.flat();
}

// Parsea texto de fecha en varios formatos → 'YYYY-MM-DD' o null si no es fecha
// Soporta: DD/MM/YYYY · DD-MM-YYYY · YYYY-MM-DD · MM/DD/YYYY (fallback) y variantes con punto
function parsearFechaTexto(texto) {
    // DD/MM/YYYY o DD-MM-YYYY o DD.MM.YYYY  (formato más común en Paraguay/Argentina)
    const dmy = texto.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if (dmy) {
        const [, d, m, y] = dmy;
        if (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31)
            return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
    // YYYY/MM/DD o YYYY-MM-DD o YYYY.MM.DD
    const ymd = texto.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
    if (ymd) {
        const [, y, m, d] = ymd;
        if (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31)
            return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
    return null;
}

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

// Estado del dispositivo: viene directo de la DB (activo / sin_consumo / desactivado / desactivado_manual)
function calcularEstado(device) {
    const e = (device.estado || '').toLowerCase();
    if (e === 'desactivado' || e === 'desactivado_manual') return 'desactivado';
    if (e === 'sin_consumo') return 'sin_consumo';
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

// Iniciar la aplicación (el cliente Supabase ya existe desde DOMContentLoaded)
async function iniciarApp() {
    try {
        await cargarDatos();
        await cargarConsumos();
    } catch (error) {
        console.error('❌ Error al iniciar:', error);
        document.getElementById('loading').innerHTML = `❌ Error: ${error.message}`;
    }
}

// Sincroniza estado de dispositivos_ande según el estado de sus SIMs en consumo_sim.
// forzarTodos=false (por defecto): respeta los 'desactivado' manuales (no los sobreescribe).
// forzarTodos=true  (botón "Actualizar Estados"): recalcula todos sin excepción.
async function sincronizarEstadosDispositivos(forzarTodos = false) {
    if (!todosLosDatos.length) return;
    if (mapaNumAConsumo.size === 0 && mapaImeiAConsumo.size === 0) return;

    // Agrupa los dispositivos que cambian por combinación de (estado, sim1_estado, sim2_estado)
    // para hacer actualizaciones bulk en lugar de una por dispositivo.
    const grupos = new Map(); // key → { estado, sim1_estado, sim2_estado, codigos[] }
    const addGrupo = (codigo, estado, s1e, s2e) => {
        const key = `${estado}|${s1e}|${s2e}`;
        if (!grupos.has(key)) grupos.set(key, { estado, sim1_estado: s1e, sim2_estado: s2e, codigos: [] });
        grupos.get(key).codigos.push(codigo);
    };

    for (const dev of todosLosDatos) {
        const estadoDev = (dev.estado || '').toLowerCase();
        // desactivado_manual: NUNCA se recalcula automáticamente ni con el botón.
        // Solo se sale de ese estado con "Marcar Activado" desde el panel RC.
        if (estadoDev === 'desactivado_manual') continue;
        // desactivado normal: solo el botón "Actualizar Estados" puede recalcularlo.
        if (!forzarTodos && estadoDev === 'desactivado') continue;

        const s1n = String(dev.sim1_num  || '').trim();
        const s1i = normalizarImei(dev.sim1_imei);
        const s2n = String(dev.sim2_num  || '').trim();
        const s2i = normalizarImei(dev.sim2_imei);

        const s1e = calcularSimEstadoDetallado(s1n, s1i);
        const s2e = calcularSimEstadoDetallado(s2n, s2i);

        const rcNuevo     = rcEstadoDesdeSimEstados(s1e, s2e);
        const estadoFinal = rcNuevo ?? dev.estado ?? 'desactivado';

        // Solo actualizar si algo cambió
        if (estadoFinal !== dev.estado || s1e !== dev.sim1_estado || s2e !== dev.sim2_estado) {
            addGrupo(dev.codigo, estadoFinal, s1e, s2e);
        }
    }

    if (!grupos.size) return;

    const CHUNK = 100;
    const ops   = [];
    for (const [, grp] of grupos) {
        for (let i = 0; i < grp.codigos.length; i += CHUNK) {
            ops.push(window.clienteSupabase.from('dispositivos_ande')
                .update({ estado: grp.estado, sim1_estado: grp.sim1_estado, sim2_estado: grp.sim2_estado })
                .in('codigo', grp.codigos.slice(i, i + CHUNK)));
        }
    }
    await Promise.all(ops);

    // Actualizar cache local
    for (const [, grp] of grupos) {
        grp.codigos.forEach(c => {
            const d = todosLosDatos.find(x => x.codigo === c);
            if (d) { d.estado = grp.estado; d.sim1_estado = grp.sim1_estado; d.sim2_estado = grp.sim2_estado; }
        });
    }

    const total = [...grupos.values()].reduce((s, g) => s + g.codigos.length, 0);
    console.log(`🔄 Sync estados: ${total} dispositivos actualizados`);
}

// Cargar datos de Supabase (dispositivos + consumos en paralelo)
async function cargarDatos() {
    const loading = document.getElementById('loading');

    try {
        console.log('📊 Consultando base de datos...');
        loading.textContent = 'Conectando con la base de datos...';
        loading.style.display = 'block';

        // 3 fetches en paralelo: dispositivos + consumo + estados SIM
        const [data, consumoData] = await Promise.all([
            fetchTodos('dispositivos_ande', '*', 'regional', true),
            fetchTodos('consumo_sim', 'numero,imei,observacion,estado_operador,consumo_mb,estado,fecha_consumo,telefonia', 'fecha_consumo', false)
                .catch(e => { console.warn('⚠️ No se pudo cargar consumo_sim:', e.message); return []; }),
            cargarEstadosSIM()   // no depende de los otros — va en paralelo
        ]);

        // Construir mapas de consumo (datos vienen DESC → primer aparición = más reciente)
        mapaNumAConsumo  = new Map();
        mapaImeiAConsumo = new Map();
        consumoData.forEach(c => {
            const num  = String(c.numero || '').trim();
            const imei = normalizarImei(c.imei);
            if (num  && !mapaNumAConsumo.has(num))   mapaNumAConsumo.set(num, c);
            if (imei && !mapaImeiAConsumo.has(imei)) mapaImeiAConsumo.set(imei, c);
        });
        console.log(`✅ ${consumoData.length} registros en consumo_sim`);

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

        todosLosDatos  = data;
        datosFiltrados = data;

        // Mostrar tabla inmediatamente sin esperar la sincronización de estados
        mostrarDatos(todosLosDatos);

        // Sincronizar estado de RCs en background (escribe a BD, no bloquea la UI)
        sincronizarEstadosDispositivos()
            .then(() => { if (_sesionActiva && todosLosDatos.length) mostrarDatos(todosLosDatos); })
            .catch(e => console.warn('⚠️ sincronizar estados:', e));

    } catch (error) {
        console.error('❌ Error crítico:', error);
        loading.innerHTML = `❌ Error crítico: ${error.message}`;
    }
}

// Cargar estados actuales desde sim_estados (fuente de verdad por número/IMEI)
async function cargarEstadosSIM() {
    try {
        const { data } = await window.clienteSupabase
            .from('sim_estados')
            .select('numero,imei,estado,fecha_cambio')
            .order('fecha_cambio', { ascending: false });
        mapaNumAEstadoActual.clear();
        mapaImeiAEstadoActual.clear();
        (data || []).forEach(r => {
            if (r.numero && !mapaNumAEstadoActual.has(r.numero))
                mapaNumAEstadoActual.set(r.numero, r.estado);
            if (r.imei && !mapaImeiAEstadoActual.has(r.imei))
                mapaImeiAEstadoActual.set(r.imei, r.estado);
        });
        console.log(`✅ sim_estados: ${mapaNumAEstadoActual.size} números, ${mapaImeiAEstadoActual.size} IMEIs`);
    } catch (e) {
        console.warn('⚠️ No se pudo cargar sim_estados:', e.message);
    }
}

// Poblar dropdown de Regional dinámicamente
function poblarFiltroRegional(datos) {
    const regionales = [...new Set(datos.map(d => d['regional']).filter(Boolean))].sort();

    const selectDisp = document.getElementById('filtroRegional');
    const selectRC   = document.getElementById('filtroRCRegional');

    regionales.forEach(r => {
        [selectDisp, selectRC].forEach(sel => {
            if (!sel) return;
            const opt = document.createElement('option');
            opt.value = r;
            opt.textContent = r;
            sel.appendChild(opt);
        });
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

// Estado de un slot SIM (num+imei como conjunto).
// null = slot vacío; 'activo' = verde; 'desactivado' = rojo;
// 'no_asignado' = naranja; 'sin_consumo' = naranja.
function simEstado(num, imei) {
    let n = String(num || '').trim();
    if (n === '-') n = '';  // '-' es equivalente a vacío
    const i   = normalizarImei(imei);
    const m2m = n.toLowerCase() === 'm2m';
    if (!n && !i)  return null;  // slot vacío
    if (m2m && !i) return null;  // M2M sin IMEI
    const cNum  = (!m2m && n) ? mapaNumAConsumo.get(n)  : null;
    const cImei = i            ? mapaImeiAConsumo.get(i) : null;
    if (!cNum && !cImei) return 'no_asignado';  // configurado pero sin registros
    const eN = cNum  ? estadoConsDisplay(cNum)  : null;
    const eI = cImei ? estadoConsDisplay(cImei) : null;
    if (eN === 'desactivado' || eI === 'desactivado') return 'desactivado';
    // sin_consumo: encontrado pero ninguno tiene consumo_mb > 0
    const mbN = cNum  ? (parseFloat(cNum.consumo_mb)  || 0) : null;
    const mbI = cImei ? (parseFloat(cImei.consumo_mb) || 0) : null;
    if ((mbN === null || mbN === 0) && (mbI === null || mbI === 0)) return 'sin_consumo';
    return 'activo';
}

function _simDotColor(est) {
    if (est === 'desactivado') return '#dc2626';
    if (est === 'no_asignado' || est === 'sin_consumo') return '#f97316';
    return '#16a34a';
}
function _simTextStyle(est) {
    if (est === 'desactivado') return 'color:#dc2626;';
    if (est === 'no_asignado' || est === 'sin_consumo') return 'color:#f97316;';
    return '';
}

// Punto de color (●) para una SIM
function simDot(num, imei) {
    const est = simEstado(num, imei);
    if (est === null) return '';
    return `<span style="color:${_simDotColor(est)};font-size:9px;margin-right:3px;vertical-align:middle">●</span>`;
}

// Punto + número coloreado (y clicable) para la columna Num
function simNumDisplay(num, imei) {
    const n    = String(num || '').trim();
    const i    = normalizarImei(imei);
    const est  = simEstado(n, i);
    const m2m  = n.toLowerCase() === 'm2m';
    const label = n || '-';
    if (est === null) return label;

    const dotClr = _simDotColor(est);
    const dot    = `<span style="color:${dotClr};font-size:9px;margin-right:3px;vertical-align:middle">●</span>`;
    const clrSty = _simTextStyle(est);

    if (!m2m && n) {
        return `${dot}<span class="link-num" style="${clrSty}" onclick="abrirPanelSIM('${n}')">${label}</span>`;
    } else if (m2m && i) {
        return `${dot}<span class="link-num" style="${clrSty}" onclick="abrirPanelSIM('m2m','${i}')">${label}</span>`;
    }
    return `${dot}<span style="${clrSty || 'color:inherit'}">${label}</span>`;
}

// Punto + IMEI coloreado (y clicable) para la columna IMEI
function simImeiDisplay(num, imei) {
    const i = normalizarImei(imei);
    if (!i) return '-';
    const est    = simEstado(num, imei);
    const dotClr = est ? _simDotColor(est) : null;
    const clrSty = est ? _simTextStyle(est) : '';
    const dot    = dotClr ? `<span style="color:${dotClr};font-size:9px;margin-right:3px;vertical-align:middle">●</span>` : '';
    return `${dot}<span class="link-num" style="${clrSty}" onclick="abrirPanelSIM('','${i}')">${i}</span>`;
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
        if (estMostrar === 'desactivado')  tr.classList.add('fila-inactiva');
        if (estMostrar === 'sin_consumo')  tr.classList.add('fila-sin-consumo');
        const tipoDisp = getTipoDevice(fila);
        const tipoCfg  = tipoDisp ? TIPO_CONFIG[tipoDisp] : null;
        const i1 = normalizarImei(fila['sim1_imei']);
        const i2 = normalizarImei(fila['sim2_imei']);
        const tipoBadge = (tipoCfg && tipoDisp !== 'activado')
            ? ` <span class="badge-tipo ${tipoCfg.cls}">${tipoCfg.label}</span>`
            : '';
        tr.innerHTML = `
            <td>${badgeEstado(fila)}</td>
            <td><span class="badge-regional">${fila['regional'] || '-'}</span></td>
            <td>${fila['codigo'] ? `<span class="link-rc" onclick="abrirPanelRC('${fila['codigo']}')">${fila['codigo']}</span>${tipoBadge}` : '-'}</td>
            <td class="td-ubicacion">${fila['ubicacion'] || '-'}</td>
            <td>${simNumDisplay(fila['sim1_num'], i1)}</td>
            <td class="td-imei">${simImeiDisplay(fila['sim1_num'], fila['sim1_imei'])}</td>
            <td>${simNumDisplay(fila['sim2_num'], i2)}</td>
            <td class="td-imei">${simImeiDisplay(fila['sim2_num'], fila['sim2_imei'])}</td>
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

// Actualizar estadísticas (un solo pase para no llamar estadoDisp N×3)
function actualizarEstadisticas(datos) {
    let activos = 0, sinConsumo = 0, inactivos = 0;
    datos.forEach(d => {
        const e = estadoDisp(d);
        if      (e === 'activo')      activos++;
        else if (e === 'sin_consumo') sinConsumo++;
        else if (e === 'desactivado') inactivos++;
    });
    document.getElementById('totalRegistros').textContent    = formatearNumero(datos.length);
    document.getElementById('totalActivos').textContent      = formatearNumero(activos);
    document.getElementById('totalDesactivados').textContent = formatearNumero(inactivos);
    const elSC = document.getElementById('totalSinConsumo');
    if (elSC) elSC.textContent = formatearNumero(sinConsumo);
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
            maintainAspectRatio: false,
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
            maintainAspectRatio: false,
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

    // Gráfico de Torta — Activados / Sin Consumo / Desactivados (un pase)
    let totalActivos = 0, totalSinCons = 0, totalInactivos = 0;
    datos.forEach(d => {
        const e = estadoDisp(d);
        if      (e === 'activo')      totalActivos++;
        else if (e === 'sin_consumo') totalSinCons++;
        else if (e === 'desactivado') totalInactivos++;
    });
    const estadoDonutKeys = ['activo', 'sin_consumo', 'desactivado'];

    const ctxTorta = document.getElementById('chartTorta').getContext('2d');
    chartTorta = new Chart(ctxTorta, {
        type: 'doughnut',
        data: {
            labels: ['Activado', 'Sin Consumo', 'Desactivado'],
            datasets: [{
                data: [totalActivos, totalSinCons, totalInactivos],
                backgroundColor: ['#16a34a', '#f97316', '#dc2626'],
                borderColor: '#fff',
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
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
    const tipo     = !esViewer() ? document.getElementById('filtroTipo').value : '';

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
        if (tipo && getTipoDevice(item) !== tipo) return false;
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
    if (!esViewer()) document.getElementById('filtroTipo').value = '';

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
                            // SheetJS entregó un objeto Date → fecha real
                            obj[campo] = val.toISOString().substring(0, 10);
                        } else if (val) {
                            const texto  = String(val).trim();
                            const fechaISO = parsearFechaTexto(texto);
                            if (fechaISO) {
                                // Es una fecha → activo, tipo null (se infiere 'activado')
                                obj[campo] = fechaISO;
                            } else {
                                // Texto no-fecha: es el tipo del dispositivo → activo + guardar tipo
                                obj[campo] = null;
                                obj['estado'] = 'activo';
                                obj['tipo']   = texto;
                            }
                        } else {
                            // Celda vacía → desactivado
                            obj[campo] = null;
                            obj['estado'] = 'desactivado';
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

// Función unificada de estado SIM — única fuente de verdad para los tres tabs.
// Prioridad:
//   1. Regla fija: Personal + "backup" en observacion → siempre desactivado
//   2. sim_estados (tabla de estados actuales, fuente de verdad por número/IMEI)
//   3. estado_operador (campo del CSV del operador)
//   4. campo estado calculado por la app (fallback legacy)
function getEstadoSIM(row) {
    // 1. Backup siempre desactivado
    if ((row.telefonia || '').toLowerCase() === 'personal' &&
        String(row.observacion || '').toLowerCase().includes('backup')) return 'desactivado';

    const num  = String(row.numero || '').trim();
    const imei = normalizarImei(row.imei);

    // 2. sim_estados (fuente de verdad)
    if (num && num.toLowerCase() !== 'm2m' && mapaNumAEstadoActual.has(num))
        return mapaNumAEstadoActual.get(num);
    if (imei && mapaImeiAEstadoActual.has(imei)) return mapaImeiAEstadoActual.get(imei);

    // 3. estado_operador (CSV del operador)
    const opLow = (row.estado_operador || '').trim().toLowerCase();
    if (opLow.includes('desactiv') || opLow === 'baja') return 'desactivado';
    if (opLow === 'legado')           return 'legado';
    if (opLow.includes('satelit'))    return 'satelital';

    // 4. campo estado de la app (fallback — colapsa estados internos a activo)
    const est = (row.estado || '').trim().toLowerCase();
    if (est === 'desactivado') return 'desactivado';
    return 'activo';
}

// Estado para mostrar en el tab Consumo. Delega a getEstadoSIM y agrega
// un fallback al registro más reciente en mapaNumAConsumo para datos legacy.
function estadoConsDisplay(consumo) {
    const base = getEstadoSIM(consumo);
    if (base !== 'activo') return base;

    // Fallback legacy: el registro más reciente del número puede tener un estado
    // distinto al de la fila histórica (p.ej. el registro fue re-importado después).
    const num  = String(consumo.numero || '').trim();
    const imei = normalizarImei(consumo.imei);
    const latest = (num && num.toLowerCase() !== 'm2m' ? mapaNumAConsumo.get(num) : null)
                || (imei ? mapaImeiAConsumo.get(imei) : null);
    if (latest && latest !== consumo) {
        const latEst = (latest.estado || '').trim().toLowerCase();
        if (latEst === 'desactivado') return 'desactivado';
    }
    return 'activo';
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
        cargarConsumos();  // usa caché si datos frescos (< 3 min)
    }
}

// ── CARGA Y DISPLAY DE CONSUMOS ────────────────────────────────────

// Columna de ordenamiento en BD según el estado del sort
function dbColLineas() {
    const map = {
        estado: 'estado', numero: 'numero', imei: 'imei',
        telefonia: 'telefonia', mb: 'consumo_mb', fecha: 'fecha_consumo',
        rc: 'numero', // RC es derivado — número como proxy
    };
    return map[sortLineas.col] || 'fecha_consumo';
}

// Lee los filtros activos y resuelve el RC a números/IMEIs reales.
// Devuelve null si el filtro RC no coincide con ningún dispositivo (resultado vacío garantizado).
function resolverFiltros() {
    const telefonia = document.getElementById('filtroTelefonia').value || null;
    const estadoUI  = document.getElementById('filtroEstadoConsumo').value;
    const rc        = document.getElementById('filtroRCConsumo').value.trim().toLowerCase();
    const num       = document.getElementById('filtroNumConsumo').value.trim() || null;
    const desde     = document.getElementById('filtroFechaDesde').value || null;
    const hasta     = document.getElementById('filtroFechaHasta').value || null;
    const obs       = document.getElementById('filtroObservacion').value.trim() || null;
    // 'activo' en la UI engloba todos los estados no-desactivado (incluye legacy: sin_consumo, legado, error)
    let estados = null;
    if (estadoUI) {
        estados = estadoUI === 'activo' ? ['activo', 'sin_consumo', 'legado', 'error'] : ['desactivado'];
    }

    // Filtro RC → resolver a sim numbers/IMEIs del dispositivo
    let numeros = null, imeis = null;
    if (rc) {
        const devs = todosLosDatos.filter(d => d.codigo && d.codigo.toLowerCase().includes(rc));
        if (devs.length === 0) return null; // sin coincidencia → resultado vacío

        const nums = new Set(), ims = new Set();
        devs.forEach(d => {
            if (d.sim1_num  && d.sim1_num.toLowerCase()  !== 'm2m') nums.add(d.sim1_num.trim());
            if (d.sim2_num  && d.sim2_num.toLowerCase()  !== 'm2m') nums.add(d.sim2_num.trim());
            if (d.sim1_imei) ims.add(normalizarImei(d.sim1_imei));
            if (d.sim2_imei) ims.add(normalizarImei(d.sim2_imei));
        });
        numeros = [...nums].filter(Boolean);
        imeis   = [...ims].filter(Boolean);
        if (numeros.length === 0 && imeis.length === 0) return null;
    }

    return { telefonia, estados, desde, hasta, numeros, imeis, num_like: num, obs_like: obs };
}

// Aplica los filtros activos a una query de consumo_sim
function _aplicarFiltrosConsumoQuery(query, f) {
    if (f.telefonia) query = query.eq('telefonia', f.telefonia);
    if (f.desde)     query = query.gte('fecha_consumo', f.desde);
    if (f.hasta)     query = query.lte('fecha_consumo', f.hasta);
    if (f.num_like)  query = query.or(`numero.ilike.%${f.num_like}%,imei.ilike.%${f.num_like}%`);
    if (f.obs_like)  query = query.ilike('observacion', `%${f.obs_like}%`);
    if (f.estados)   query = f.estados.length > 1 ? query.in('estado', f.estados) : query.eq('estado', f.estados[0]);
    if (f.numeros !== null || f.imeis !== null) {
        const parts = [
            ...(f.numeros || []).map(n => `numero.eq.${n}`),
            ...(f.imeis   || []).map(i => `imei.eq.${i}`),
        ];
        if (parts.length) query = query.or(parts.join(','));
    }
    return query;
}

// Consulta server-side sobre consumo_sim
async function consultarConsumos(soloTabla = true) {
    const f = resolverFiltros();
    if (f === null) return { data: [], count: 0 };

    const COLS_CONSOLIDADO = 'consumo_mb,fecha_consumo,telefonia,numero,imei,estado,observacion,estado_operador';

    if (soloTabla) {
        // Página actual de la tabla (una sola request paginada)
        const from  = (paginaConsumo - 1) * ITEMS_POR_PAGINA;
        let query   = window.clienteSupabase.from('consumo_sim').select('*', { count: 'exact' });
        query       = _aplicarFiltrosConsumoQuery(query, f);
        query       = query.order(dbColLineas(), { ascending: sortLineas.dir === 'asc' })
                           .range(from, from + ITEMS_POR_PAGINA - 1);
        const { data, error, count } = await query;
        if (error) throw error;
        return { data: data || [], count: count || 0 };
    }

    // Consolidado: paginar en paralelo para traer TODAS las filas
    // (igual que fetchTodos — evita el cap de 1000 de PostgREST)
    const LOTE = 1000, CONC = 5;

    // 1. Count
    let cntQ = window.clienteSupabase.from('consumo_sim').select('*', { count: 'exact', head: true });
    cntQ     = _aplicarFiltrosConsumoQuery(cntQ, f);
    const { count, error: cErr } = await cntQ;
    if (cErr) throw cErr;
    if (!count) return { data: [], count: 0 };

    // 2. Fetch paralelo en batches
    const totalPags = Math.ceil(count / LOTE);
    const resultado = new Array(totalPags);

    for (let b = 0; b < totalPags; b += CONC) {
        const tam = Math.min(CONC, totalPags - b);
        const res = await Promise.all(
            Array.from({ length: tam }, (_, j) => {
                const p = b + j;
                let q = window.clienteSupabase.from('consumo_sim').select(COLS_CONSOLIDADO);
                q     = _aplicarFiltrosConsumoQuery(q, f);
                return q.order('fecha_consumo', { ascending: true })
                        .range(p * LOTE, (p + 1) * LOTE - 1);
            })
        );
        res.forEach((r, j) => {
            if (r.error) throw r.error;
            resultado[b + j] = r.data || [];
        });
    }
    return { data: resultado.flat(), count };
}

// Llama a la función SQL consumo_resumen para obtener total + gráficos agregados
async function cargarResumenConsumo() {
    const f = resolverFiltros();
    if (f === null) return { total_mb: 0, historico: [], top15: [], por_estado: [] };

    const { data, error } = await window.clienteSupabase.rpc('consumo_resumen', {
        p_telefonia: f.telefonia,
        p_estados:   f.estados,
        p_desde:     f.desde,
        p_hasta:     f.hasta,
        p_numeros:   f.numeros,
        p_imeis:     f.imeis,
        p_num_like:  f.num_like,
    });
    if (error) throw error;
    return data || { total_mb: 0, historico: [], top15: [], por_estado: [] };
}

async function cargarConsumos(force = false) {
    // ── Caché: si los datos son frescos y ya hay algo cargado, evitar re-fetch ──
    const ahora    = Date.now();
    const esFresco = !force && (ahora - _consumosTimestamp < CONSUMOS_TTL_MS) && consumosFiltrados.length > 0;

    if (esFresco) {
        document.getElementById('loadingConsumo').style.display = 'none';
        if      (vistaConsumo === 'equipos')   mostrarConsolidado(consumosFiltrados);
        else if (vistaConsumo === 'lineas-bd') cargarLineasBD();
        else {
            // Para Consumo (lineas), siempre re-paginar (datos paginados, livianos)
            consultarConsumos(true).then(({ data, count }) => {
                if (!_sesionActiva) return;
                totalConsumoServidor = count;
                mostrarEnTablaConsumo(data, count);
            }).catch(e => console.error('❌', e));
        }
        return;
    }

    _consumosTimestamp = ahora;
    const loading = document.getElementById('loadingConsumo');
    loading.style.display = 'block';
    document.getElementById('tablaDatosConsumo').innerHTML = '';
    paginaConsumo = 1;
    paginaEquipos = 1;

    // Consolidado pesado (todas las filas) solo si se necesita para RC o Consumo
    const necesitaConsolidado = vistaConsumo !== 'lineas-bd';

    try {
        const [tablaRes, resumen, consolidadoRes] = await Promise.all([
            consultarConsumos(true),
            cargarResumenConsumo(),
            necesitaConsolidado
                ? consultarConsumos(false)
                : Promise.resolve({ data: consumosFiltrados, count: 0 }),
        ]);

        if (!_sesionActiva) return;
        loading.style.display = 'none';
        totalConsumoServidor = tablaRes.count;
        if (necesitaConsolidado) consumosFiltrados = consolidadoRes.data;
        console.log(`✅ ${tablaRes.count} consumos en BD`);

        actualizarTotalConsumo(resumen.total_mb);
        crearGraficosConsumo(resumen, consumosFiltrados);

        if (vistaConsumo === 'equipos') {
            mostrarConsolidado(consumosFiltrados);
        } else if (vistaConsumo === 'lineas-bd') {
            paginaLineasBD = 1;
            cargarLineasBD();
        } else {
            mostrarEnTablaConsumo(tablaRes.data, tablaRes.count);
        }

    } catch (e) {
        loading.style.display = 'none';
        document.getElementById('tablaDatosConsumo').innerHTML =
            `<tr><td colspan="8" style="text-align:center;padding:40px;color:#ef4444">❌ ${e.message}</td></tr>`;
        console.error('❌', e);
    }
}

function actualizarTotalConsumo(total_mb) {
    const total = parseFloat(total_mb || 0);
    const el = document.getElementById('totalConsumoResumen');
    if (el) el.innerHTML = `Total consumo: <strong>${formatearNumero(total)} MB</strong>`;
}

// filas → página ya traída del servidor; totalServidor → count real en BD
function mostrarEnTablaConsumo(filas, totalServidor) {
    const tbody  = document.getElementById('tablaDatosConsumo');
    const infoEl = document.getElementById('paginacion-info-consumo');
    const pagEl  = document.getElementById('paginacion-consumo');
    tbody.innerHTML = '';

    const total        = totalServidor ?? filas.length;
    const totalPaginas = Math.max(1, Math.ceil(total / ITEMS_POR_PAGINA));

    if (total === 0 || filas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px">No se encontraron resultados.</td></tr>';
        infoEl.innerHTML = '';
        pagEl.innerHTML  = '';
        return;
    }

    updateSortIcons('tablaConsumo2', sortLineas);

    const inicio = (paginaConsumo - 1) * ITEMS_POR_PAGINA;

    filas.forEach(c => {
        const est        = estadoConsDisplay(c);
        const estMostrar = esViewer() ? estadoSimple(est) : est;
        const cfg        = esViewer()
            ? (ESTADO_CONFIG_VIEWER[estMostrar] || ESTADO_CONFIG_VIEWER['activo'])
            : (ESTADO_CONFIG_DISP[est]          || ESTADO_CONFIG_DISP['activo']);
        const rc  = encontrarRC(c);
        const mb  = (c.consumo_mb !== null && c.consumo_mb !== undefined)
            ? formatearNumero(c.consumo_mb) + ' MB'
            : '-';
        const dotColor = est === 'desactivado' ? '#dc2626' : '#16a34a';
        const dot = `<span style="color:${dotColor};font-size:10px;margin-right:4px;vertical-align:middle">●</span>`;
        const tr  = document.createElement('tr');
        if (estMostrar !== 'activo') tr.classList.add('fila-inactiva');
        tr.innerHTML = `
            <td><span class="badge-estado ${cfg.cls}">${cfg.label}</span></td>
            <td>${c.numero ? `${dot}<span class="link-num" onclick="abrirPanelSIM('${c.numero}')">${c.numero}</span>` : '-'}</td>
            <td class="td-imei">${normalizarImei(c.imei) || '-'}</td>
            <td>${rc !== '-' ? `<span class="link-rc" onclick="abrirPanelRC('${rc}')">${rc}</span>` : '-'}</td>
            <td>${badgeTelefonia(c.telefonia)}</td>
            <td>${mb}</td>
            <td>${formatearFecha(c.fecha_consumo)}</td>
            ${esViewer() ? '' : `<td>${c.observacion || '-'}</td>`}
        `;
        tbody.appendChild(tr);
    });

    const fin = inicio + filas.length;
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

async function irPaginaConsumo(num) {
    if (num < 1) return;
    paginaConsumo = num;
    try {
        const { data, count } = await consultarConsumos(true);
        totalConsumoServidor = count;
        mostrarEnTablaConsumo(data, count);
    } catch (e) { console.error('❌', e); }
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

// Dado un evento de Chart.js sobre un gráfico horizontal de barras,
// devuelve el índice del tick de eje-Y más cercano si el clic cayó
// en el área de etiquetas (izquierda del área de trazado). Retorna -1 si no.
function _yAxisLabelIndex(event, chart) {
    if (!chart?.chartArea || event.x >= chart.chartArea.left) return -1;
    const yScale = chart.scales?.y;
    if (!yScale) return -1;
    let closest = -1, minDist = Infinity;
    for (let i = 0; i < yScale.ticks.length; i++) {
        const d = Math.abs(event.y - yScale.getPixelForTick(i));
        if (d < minDist) { minDist = d; closest = i; }
    }
    return minDist <= 14 ? closest : -1;
}

// Un clic = singleFn, doble clic = doubleFn
function makeClickDblHandler(singleFn, doubleFn) {
    let last = 0, timer = null;
    return (event, elements) => {
        if (!elements.length) return;
        const now = Date.now();
        if (now - last < 350) {
            clearTimeout(timer);
            last = 0;
            doubleFn(elements[0]);
        } else {
            last = now;
            clearTimeout(timer);
            timer = setTimeout(() => singleFn(elements[0]), 370);
        }
    };
}

// Crea los 3 gráficos de la vista "Consumo" (histórico, top5 y MB por telefonía)
function crearGraficosConsumo(resumen, datos) {
    if (chartConsumoHistorico)  chartConsumoHistorico.destroy();
    if (chartConsumoLineas)     chartConsumoLineas.destroy();
    if (chartConsumoTelefonia)  chartConsumoTelefonia.destroy();

    const historico  = resumen?.historico  || [];
    const top15raw   = resumen?.top15      || [];
    const datosDount = datos || consumosFiltrados;   // usado por crearGraficosEquipo

    if (!historico.length && !top15raw.length && !datosDount.length) return;

    const TELEFONIA_CHART = {
        Personal:    { color: '#1d4ed8', bg: 'rgba(37,99,235,0.08)' },
        Claro:       { color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
        Tigo:        { color: '#c2410c', bg: 'rgba(234,88,12,0.08)' },
        Vox:         { color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
        Desconocida: { color: '#6b7280', bg: 'rgba(107,114,128,0.08)' },
    };

    // ── 1. Histórico: MB por día desglosado por telefonía ───────────
    const fechasSet = new Set();
    const telefonias = [];
    historico.forEach(r => {
        if (r.fecha) fechasSet.add(r.fecha);
        const tel = r.telefonia || 'Desconocida';
        if (!telefonias.includes(tel)) telefonias.push(tel);
    });
    const fechas = [...fechasSet].sort();

    const mbPorTelFecha = {};
    telefonias.forEach(t => { mbPorTelFecha[t] = {}; });
    historico.forEach(r => {
        const tel = r.telefonia || 'Desconocida';
        mbPorTelFecha[tel][r.fecha] = (mbPorTelFecha[tel][r.fecha] || 0) + parseFloat(r.total_mb || 0);
    });

    const datasets = telefonias.map(tel => {
        const cfg = TELEFONIA_CHART[tel] || { color: '#8A35AB', bg: 'rgba(138,53,171,0.08)' };
        return {
            label: tel,
            data: fechas.map(f => mbPorTelFecha[tel][f] || 0),
            borderColor: cfg.color, backgroundColor: cfg.bg,
            borderWidth: 2.5, fill: false, tension: 0.4,
            pointBackgroundColor: cfg.color, pointBorderColor: '#fff',
            pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6,
        };
    });

    // Línea de Total (suma de todas las telefonías por fecha)
    if (telefonias.length > 1) {
        const totalPorFecha = fechas.map(f =>
            telefonias.reduce((sum, tel) => sum + (mbPorTelFecha[tel][f] || 0), 0)
        );
        datasets.push({
            label: 'Total',
            data: totalPorFecha,
            borderColor: '#1e293b',
            backgroundColor: 'rgba(30,41,59,0.05)',
            borderWidth: 3,
            borderDash: [6, 3],
            fill: false,
            tension: 0.4,
            pointBackgroundColor: '#1e293b',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            order: -1,
        });
    }

    const ctxH = document.getElementById('chartConsumoHistorico').getContext('2d');
    chartConsumoHistorico = new Chart(ctxH, {
        type: 'line',
        data: { labels: fechas.map(f => formatearFecha(f)), datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
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

    // ── 2. Top 5 líneas por MB ───────────────────────────────────────
    // clave = numero SIM; buscamos RC en el mapa de dispositivos para mostrar
    const top5raw = top15raw.slice(0, 5);
    const clavesLineas  = top5raw.map(r => String(r.clave || ''));
    const labelsLineas  = top5raw.map(r => {
        const dev = mapaNumADevice.get(String(r.clave || '').trim());
        return dev ? (dev.codigo || r.clave) : (r.clave || 'Sin ID');
    });
    const valoresLineas = top5raw.map(r => parseFloat(r.total_mb || 0));
    const coloresLineas = labelsLineas.map((_, i) => COLORES[i % COLORES.length]);

    // Acción compartida al pulsar un label (barra o eje-Y)
    const _esRC = label => label && label !== 'Sin ID' && /[a-zA-Z_]/.test(label);

    // Click simple: abre panel RC o SIM según el label
    const _abrirLinea = (label, clave) => {
        if (!label || label === 'Sin ID') return;
        if (_esRC(label)) abrirPanelRC(label);
        else abrirPanelSIM(clave || label);
    };

    // Doble click: si es RC → ir a dispositivos y filtrar; si es SIM → filtrar en consumo
    const _filtrarLinea = (label, clave) => {
        if (!label || label === 'Sin ID') return;
        if (_esRC(label)) {
            irADispositivosFiltrado(label);
        } else {
            document.getElementById('filtroRCConsumo').value  = '';
            document.getElementById('filtroNumConsumo').value = clave || label;
            aplicarFiltrosConsumo();
        }
    };

    // ── Barras 3D (HTML nativo — labels completamente clicables) ─────
    const maxMB = Math.max(...valoresLineas, 1);

    const _lighten = (hex, f) => {
        const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        return `rgb(${Math.min(255,Math.round(r+f*(255-r)))},${Math.min(255,Math.round(g+f*(255-g)))},${Math.min(255,Math.round(b+f*(255-b)))})`;
    };
    const _darken = (hex, f) => {
        const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        return `rgb(${Math.round(r*f)},${Math.round(g*f)},${Math.round(b*f)})`;
    };

    const rowsHtml = labelsLineas.map((label, i) => {
        const mb   = valoresLineas[i];
        const pct  = Math.max((mb / maxMB * 100), 1).toFixed(1);
        const col  = coloresLineas[i];
        const top  = _lighten(col, 0.38);
        const side = _darken(col, 0.52);
        const grad = `linear-gradient(180deg,${_lighten(col,0.20)},${col})`;
        return `<div class="bar3d-row" data-idx="${i}" title="Click: panel · Doble click: ir a Dispositivos">
            <div class="bar3d-label">${label}</div>
            <div class="bar3d-track">
                <div class="bar3d-outer" style="width:${pct}%">
                    <div class="bar3d-front" style="background:${grad}"></div>
                    <div class="bar3d-top"   style="background:${top}"></div>
                    <div class="bar3d-side"  style="background:${side}"></div>
                </div>
                <span class="bar3d-value">${formatearNumero(mb)} MB</span>
            </div>
        </div>`;
    }).join('');

    const lineasCont = document.getElementById('chartConsumoLineas');
    lineasCont.innerHTML = `<div class="bars3d-wrap">${rowsHtml}</div>`;

    // Click simple → panel RC/SIM | Doble click → ir a Dispositivos/filtrar consumo
    let _b3Timer = null, _b3Last = { idx: -1, t: 0 };
    lineasCont.querySelectorAll('.bar3d-row').forEach(row => {
        row.addEventListener('click', () => {
            const idx = Number(row.dataset.idx);
            const now = Date.now();
            if (_b3Last.idx === idx && now - _b3Last.t < 350) {
                clearTimeout(_b3Timer);
                _b3Last = { idx: -1, t: 0 };
                _filtrarLinea(labelsLineas[idx], clavesLineas[idx]);
            } else {
                _b3Last = { idx, t: now };
                clearTimeout(_b3Timer);
                _b3Timer = setTimeout(() => {
                    _b3Last = { idx: -1, t: 0 };
                    _abrirLinea(labelsLineas[idx], clavesLineas[idx]);
                }, 370);
            }
        });
    });

    // Pseudo-instancia para que los .destroy() existentes no fallen
    chartConsumoLineas = {
        destroy() { const el = document.getElementById('chartConsumoLineas'); if (el) el.innerHTML = ''; }
    };

    // ── 3. MB por Telefonía (doughnut) ───────────────────────────────
    const TEL_COLORS = { Personal: '#1d4ed8', Claro: '#dc2626' };
    const mbPorTel = {};
    (datosDount || []).forEach(r => {
        const t = (r.telefonia || 'Sin dato').trim() || 'Sin dato';
        mbPorTel[t] = (mbPorTel[t] || 0) + (parseFloat(r.consumo_mb) || 0);
    });
    const telKeys    = Object.keys(mbPorTel);
    const telVals    = telKeys.map(k => mbPorTel[k]);
    const telColores = telKeys.map(k => TEL_COLORS[k] || '#6b7280');
    const totalMBTel = telVals.reduce((a, b) => a + b, 0);

    const centerMBTelPlugin = {
        id: 'centerMBTel',
        afterDraw(chart) {
            const { ctx, chartArea } = chart;
            if (!chartArea) return;
            const cx = chartArea.left + chartArea.width  / 2;
            const cy = chartArea.top  + chartArea.height / 2;
            ctx.save();
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font      = `bold ${Math.min(20, chartArea.width * 0.12)}px Arial`;
            ctx.fillStyle = '#1A1A2E';
            ctx.fillText(formatearNumero(Math.round(totalMBTel)) + ' MB', cx, cy - 9);
            ctx.font      = `${Math.min(10, chartArea.width * 0.06)}px Arial`;
            ctx.fillStyle = '#888';
            ctx.fillText('consumo total', cx, cy + 11);
            ctx.restore();
        }
    };

    if (telKeys.length) {
        const ctxT = document.getElementById('chartConsumoTelefonia').getContext('2d');
        chartConsumoTelefonia = new Chart(ctxT, {
            type: 'doughnut',
            plugins: [centerMBTelPlugin],
            data: {
                labels: telKeys,
                datasets: [{ data: telVals, backgroundColor: telColores, borderColor: '#fff', borderWidth: 3 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: { position: 'bottom', labels: { padding: 15, font: { size: 12 } } },
                    tooltip: {
                        callbacks: {
                            label(ctx) {
                                const pct = ((ctx.parsed / totalMBTel) * 100).toFixed(1);
                                return ctx.label + ': ' + formatearNumero(Math.round(ctx.parsed)) + ' MB (' + pct + '%)';
                            }
                        }
                    }
                },
                onClick: makeDblClickHandler(el => {
                    document.getElementById('filtroTelefonia').value = telKeys[el.index] || '';
                    aplicarFiltrosConsumo();
                }),
                onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; }
            }
        });
    }

    // Construir también los gráficos de la vista RC
    crearGraficosEquipo(datosDount);
}

// ── GRÁFICOS VISTA POR EQUIPO ─────────────────────────────────────

function crearGraficosEquipo(datos) {
    // Destruir instancias anteriores
    if (chartEquipoHistorico) { chartEquipoHistorico.destroy(); chartEquipoHistorico = null; }
    if (chartEquipoTop5)      { chartEquipoTop5.destroy();      chartEquipoTop5 = null; }
    if (chartEquipoRegional)  { chartEquipoRegional.destroy();  chartEquipoRegional = null; }

    if (!datos || !datos.length) return;

    // ── Helpers de color 3D ──────────────────────────────────────
    const _eq_lighten = (hex, f) => {
        const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        return `rgb(${Math.min(255,Math.round(r+f*(255-r)))},${Math.min(255,Math.round(g+f*(255-g)))},${Math.min(255,Math.round(b+f*(255-b)))})`;
    };
    const _eq_darken = (hex, f) => {
        const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        return `rgb(${Math.round(r*f)},${Math.round(g*f)},${Math.round(b*f)})`;
    };

    // ── Agrupar por RC ───────────────────────────────────────────
    const porRC    = new Map();  // rc → { totalMB, byFecha: {} }
    const fechasSet = new Set();

    datos.forEach(c => {
        const num  = String(c.numero || '').trim();
        const imei = normalizarImei(c.imei);
        const dev  = mapaNumADevice.get(num) || mapaImeiADevice.get(imei) || null;
        const rc   = dev ? (dev.codigo || '-') : '-';
        if (!porRC.has(rc)) porRC.set(rc, { totalMB: 0, byFecha: {}, regional: dev?.regional || '-' });
        const entry = porRC.get(rc);
        const mb = parseFloat(c.consumo_mb) || 0;
        entry.totalMB += mb;
        if (c.fecha_consumo) {
            fechasSet.add(c.fecha_consumo);
            entry.byFecha[c.fecha_consumo] = (entry.byFecha[c.fecha_consumo] || 0) + mb;
        }
    });

    const fechas = [...fechasSet].sort();

    // Top 5 RCs por totalMB
    const top5rc = [...porRC.entries()]
        .filter(([rc]) => rc !== '-')
        .sort((a, b) => b[1].totalMB - a[1].totalMB)
        .slice(0, 5);

    // ── 1. Histórico top 5 equipos ───────────────────────────────
    const datasetsH = top5rc.map(([rc, info], idx) => {
        const color = COLORES[idx % COLORES.length];
        return {
            label: rc,
            data: fechas.map(f => info.byFecha[f] || 0),
            borderColor: color, backgroundColor: color + '14',
            borderWidth: 2.5, fill: false, tension: 0.4,
            pointBackgroundColor: color, pointBorderColor: '#fff',
            pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6,
        };
    });

    const ctxH = document.getElementById('chartEquipoHistorico').getContext('2d');
    chartEquipoHistorico = new Chart(ctxH, {
        type: 'line',
        data: { labels: fechas.map(f => formatearFecha(f)), datasets: datasetsH },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { padding: 12, font: { size: 12 } } },
                tooltip: { callbacks: { label: c => c.dataset.label + ': ' + formatearNumero(c.parsed.y) + ' MB' } }
            },
            scales: { y: { beginAtZero: true, ticks: { callback: v => formatearNumero(v) } } },
            onClick: makeDblClickHandler(el => {
                const rc = top5rc[el.datasetIndex]?.[0];
                if (rc && rc !== '-') abrirPanelRC(rc);
            }),
            onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; }
        }
    });

    // ── 2. Top 5 equipos — barras 3D ─────────────────────────────
    const labelsTop5  = top5rc.map(([rc]) => rc);
    const valoresTop5 = top5rc.map(([, info]) => info.totalMB);
    const maxMBEq     = Math.max(...valoresTop5, 1);

    const rowsHtmlEq = labelsTop5.map((label, i) => {
        const mb   = valoresTop5[i];
        const pct  = Math.max((mb / maxMBEq * 100), 1).toFixed(1);
        const col  = COLORES[i % COLORES.length];
        const top  = _eq_lighten(col, 0.38);
        const side = _eq_darken(col, 0.52);
        const grad = `linear-gradient(180deg,${_eq_lighten(col,0.20)},${col})`;
        return `<div class="bar3d-row" data-idx="${i}" title="Click: abrir panel RC · Doble click: filtrar">
            <div class="bar3d-label">${label}</div>
            <div class="bar3d-track">
                <div class="bar3d-outer" style="width:${pct}%">
                    <div class="bar3d-front" style="background:${grad}"></div>
                    <div class="bar3d-top"   style="background:${top}"></div>
                    <div class="bar3d-side"  style="background:${side}"></div>
                </div>
                <span class="bar3d-value">${formatearNumero(mb)} MB</span>
            </div>
        </div>`;
    }).join('');

    const eqTop5El = document.getElementById('chartEquipoTop5');
    eqTop5El.innerHTML = `<div class="bars3d-wrap">${rowsHtmlEq}</div>`;

    let _eqTimer = null, _eqLast = { idx: -1, t: 0 };
    eqTop5El.querySelectorAll('.bar3d-row').forEach(row => {
        row.addEventListener('click', () => {
            const idx = Number(row.dataset.idx);
            const now = Date.now();
            if (_eqLast.idx === idx && now - _eqLast.t < 350) {
                clearTimeout(_eqTimer);
                _eqLast = { idx: -1, t: 0 };
                // Doble click → filtrar en RC por ese código
                const rcEl = document.getElementById('filtroRCBuscar');
                if (rcEl) rcEl.value = labelsTop5[idx] || '';
                aplicarFiltroRC();
            } else {
                _eqLast = { idx, t: now };
                clearTimeout(_eqTimer);
                _eqTimer = setTimeout(() => {
                    _eqLast = { idx: -1, t: 0 };
                    if (labelsTop5[idx] && labelsTop5[idx] !== '-') abrirPanelRC(labelsTop5[idx]);
                }, 370);
            }
        });
    });

    chartEquipoTop5 = { destroy() { const el = document.getElementById('chartEquipoTop5'); if (el) el.innerHTML = ''; } };

    // ── 3. Consumo por Regional (donut) ──────────────────────────
    const porRegional = new Map();
    datos.forEach(c => {
        const num  = String(c.numero || '').trim();
        const imei = normalizarImei(c.imei);
        const dev  = mapaNumADevice.get(num) || mapaImeiADevice.get(imei) || null;
        const reg  = dev?.regional || 'Sin Regional';
        const mb   = parseFloat(c.consumo_mb) || 0;
        porRegional.set(reg, (porRegional.get(reg) || 0) + mb);
    });

    const regKeys   = [...porRegional.keys()].sort();
    const regVals   = regKeys.map(k => porRegional.get(k));
    const regColors = regKeys.map((_, i) => COLORES[i % COLORES.length]);
    const totalMBRegional = regVals.reduce((s, v) => s + v, 0);

    const centerMBPlugin = {
        id: 'centerMB',
        afterDraw(chart) {
            const { ctx, chartArea } = chart;
            if (!chartArea) return;
            const cx = chartArea.left + chartArea.width  / 2;
            const cy = chartArea.top  + chartArea.height / 2;
            ctx.save();
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.font         = `bold ${Math.min(18, chartArea.width * 0.11)}px Arial`;
            ctx.fillStyle    = '#1A1A2E';
            ctx.fillText(formatearNumero(totalMBRegional), cx, cy - 9);
            ctx.font      = `${Math.min(11, chartArea.width * 0.065)}px Arial`;
            ctx.fillStyle = '#888';
            ctx.fillText('MB total', cx, cy + 11);
            ctx.restore();
        }
    };

    const ctxR = document.getElementById('chartEquipoRegional').getContext('2d');
    chartEquipoRegional = new Chart(ctxR, {
        type: 'doughnut',
        plugins: [centerMBPlugin],
        data: {
            labels: regKeys,
            datasets: [{ data: regVals, backgroundColor: regColors, borderColor: '#fff', borderWidth: 3 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: { position: 'bottom', labels: { padding: 10, font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct   = total ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
                            return ctx.label + ': ' + formatearNumero(ctx.parsed) + ' MB (' + pct + '%)';
                        }
                    }
                }
            },
            onClick: makeDblClickHandler(el => {
                const regional = regKeys[el.index];
                if (!regional || regional === 'Sin Regional') return;
                document.getElementById('filtroRegional').value = regional;
                cambiarTab('dispositivos');
                aplicarFiltros();
            }),
            onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; }
        }
    });
}

// ── ORDENAMIENTO ──────────────────────────────────────────────────

async function setSortLineas(col) {
    sortLineas.dir = sortLineas.col === col && sortLineas.dir === 'asc' ? 'desc' : 'asc';
    sortLineas.col = col;
    paginaConsumo = 1;
    try {
        const { data, count } = await consultarConsumos(true);
        totalConsumoServidor = count;
        mostrarEnTablaConsumo(data, count);
    } catch (e) { console.error('❌', e); }
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
    document.getElementById('btnVerLineasBD').classList.toggle('view-activo', vista === 'lineas-bd');
    document.getElementById('btnVerEquipos').classList.toggle('view-activo',  vista === 'equipos');
    document.getElementById('btnVerLineas').classList.toggle('view-activo',   vista === 'lineas');

    // Ocultar todas las tablas y sus paginaciones
    document.getElementById('tablaConsumo2').style.display          = 'none';
    document.getElementById('paginacion-consumo').style.display     = 'none';
    document.getElementById('tablaConsolidado').style.display       = 'none';
    document.getElementById('paginacion-equipos').innerHTML         = '';
    document.getElementById('tablaLineasBD').style.display          = 'none';
    document.getElementById('paginacion-lineas-bd').style.display   = 'none';

    // Filtros: cada pestaña muestra solo sus propios filtros
    document.getElementById('filtroLineasBar').style.display = vista === 'lineas-bd' ? '' : 'none';
    document.getElementById('filtroRCBar').style.display     = vista === 'equipos'   ? '' : 'none';
    document.getElementById('filtrosConsumo').style.display  = vista === 'lineas'    ? '' : 'none';

    // Totales: cada pestaña muestra su propio resumen
    document.getElementById('totalConsumoResumen').style.display = vista === 'lineas'    ? '' : 'none';
    document.getElementById('totalLineasResumen').style.display  = vista === 'lineas-bd' ? '' : 'none';

    // Gráficos: cada vista tiene su bloque
    document.getElementById('chartsLineasBD').style.display = vista === 'lineas-bd' ? '' : 'none';
    document.getElementById('chartsEquipos').style.display  = vista === 'equipos'   ? '' : 'none';
    document.getElementById('chartsLineas').style.display   = vista === 'lineas'    ? '' : 'none';

    if (vista === 'lineas-bd') {
        document.getElementById('tablaLineasBD').style.display        = '';
        document.getElementById('paginacion-lineas-bd').style.display = '';
        paginaLineasBD = 1;
        cargarLineasBD();

    } else if (vista === 'equipos') {
        document.getElementById('tablaConsolidado').style.display = '';
        paginaEquipos = 1;
        mostrarConsolidado(consumosFiltrados);

    } else if (vista === 'lineas') {
        document.getElementById('tablaConsumo2').style.display      = '';
        document.getElementById('paginacion-consumo').style.display = '';
        paginaConsumo = 1;
        consultarConsumos(true).then(({ data, count }) => {
            totalConsumoServidor = count;
            mostrarEnTablaConsumo(data, count);
        }).catch(e => console.error('❌', e));
    }
}

// ── VISTA LÍNEAS (vista_lineas_estado) ────────────────────────────

// Agrega los mismos filtros de filtrosLineas() a una query ya iniciada
// Usa estado_operador (columna expuesta por vista_lineas_estado).
// El import sincroniza estado_operador='desactivado' al marcar líneas de baja.
function _aplicarFiltrosLineasQuery(q, f) {
    if (f.telefonia) q = q.eq('telefonia', f.telefonia);
    if (f.buscar) q = q.or(`numero.ilike.%${f.buscar}%,imei.ilike.%${f.buscar}%,rc.ilike.%${f.buscar}%,observacion.ilike.%${f.buscar}%`);
    if (f.estado === 'activo') {
        // NULL se trata como activo; excluir desactiv* y baja
        q = q.or('estado_operador.is.null,and(estado_operador.not.ilike.*desactiv*,estado_operador.neq.baja)');
    }
    if (f.estado === 'desactivado') {
        // Líneas marcadas como desactivado (estado_operador sincronizado por el import)
        q = q.or('estado_operador.ilike.*desactiv*,estado_operador.eq.baja');
    }
    return q;
}

// Consulta los totales de MB para el label de la pestaña Líneas
async function consultarTotalesLineasBD() {
    const f = filtrosLineas();
    let q = window.clienteSupabase
        .from('vista_lineas_estado')
        .select('mes:consumo_mes_mb.sum(),total:consumo_total_mb.sum()');
    q = _aplicarFiltrosLineasQuery(q, f);
    const { data, error } = await q;
    if (error) { console.warn('⚠️ totales líneas:', error.message); return null; }
    return data?.[0] ?? null;
}

function actualizarTotalesLineas(totales) {
    const el = document.getElementById('totalLineasResumen');
    if (!el) return;
    if (!totales) { el.innerHTML = ''; return; }
    const mes   = parseFloat(totales.mes)   || 0;
    const total = parseFloat(totales.total) || 0;
    el.innerHTML = `MB Mes: <strong>${formatearNumero(mes)} MB</strong> &nbsp;|&nbsp; MB Total: <strong>${formatearNumero(total)} MB</strong>`;
}

// Lee los filtros del buscador dedicado de la vista Líneas
function filtrosLineas() {
    return {
        telefonia: document.getElementById('filtroLineasTelefonia')?.value || null,
        buscar:    document.getElementById('filtroLineasBuscar')?.value.trim() || null,
        estado:    document.getElementById('filtroLineasEstado')?.value || null,
    };
}

// Llama a lineas_charts RPC → devuelve { por_estado, por_telefonia, top10 }
async function consultarLineasCharts() {
    const f = filtrosLineas();
    const { data, error } = await window.clienteSupabase.rpc('lineas_charts', {
        p_telefonia: f.telefonia || null,
        p_buscar:    f.buscar    || null,
        p_rc_like:   null,
        p_estado:    f.estado    || null,
    });
    if (error) { console.error('❌ lineas_charts RPC:', error); throw error; }
    return data || {};
}

async function consultarLineasBD() {
    const f = filtrosLineas();
    let q = window.clienteSupabase
        .from('vista_lineas_estado')
        .select('*', { count: 'exact' });
    q = _aplicarFiltrosLineasQuery(q, f);
    const from = (paginaLineasBD - 1) * ITEMS_POR_PAGINA;
    q = q.order('numero', { ascending: true, nullsFirst: false })
         .range(from, from + ITEMS_POR_PAGINA - 1);
    const { data, error, count } = await q;
    if (error) throw error;
    return { data: data || [], count: count || 0 };
}

async function cargarLineasBD() {
    const tbody  = document.getElementById('tablaLineasBDBody');
    const infoEl = document.getElementById('paginacion-info-consumo');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:#35398C">⏳ Cargando...</td></tr>';
    infoEl.innerHTML = '';
    try {
        const [{ data, count }, chartsData, totales] = await Promise.all([
            consultarLineasBD(),
            consultarLineasCharts().catch(e => { console.error('❌ lineas_charts:', e); return {}; }),
            consultarTotalesLineasBD().catch(() => null),
        ]);
        if (!_sesionActiva) return;
        totalLineasBD = count;
        mostrarLineasBD(data, count);
        crearGraficosLineasBD(chartsData, count);
        actualizarTotalesLineas(totales);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:#ef4444">❌ ${e.message}</td></tr>`;
        console.error('❌ cargarLineasBD:', e);
    }
}

function crearGraficosLineasBD(cd, totalCount) {
    if (chartLineasEstado)    { chartLineasEstado.destroy();    chartLineasEstado    = null; }
    if (chartLineasTelefonia) { chartLineasTelefonia.destroy(); chartLineasTelefonia = null; }
    if (chartLineasTop10)     { chartLineasTop10.destroy();     chartLineasTop10     = null; }

    const porEstado   = cd?.por_estado   || [];
    const porTelefon  = cd?.por_telefonia || [];
    const top10       = cd?.top10         || [];

    // ── 1. Estado de Líneas (donut) ──────────────────────────────
    const estadoMap = {};
    porEstado.forEach(r => { estadoMap[r.estado] = Number(r.total || 0); });
    const totalLineas  = Object.values(estadoMap).reduce((a,b)=>a+b, 0);
    const estKeys      = Object.keys(estadoMap);
    const EST_COLORES  = { activo: '#16a34a', desactivado: '#dc2626' };
    const EST_LABELS   = { activo: 'Activado', desactivado: 'Desactivado' };

    // totalCount viene de cargarLineasBD → coincide exactamente con el label de la tabla
    const centerTotal = totalCount != null ? totalCount : totalLineas;

    if (estKeys.length) {
        const centerPlugin = {
            id: 'clCenter',
            afterDraw(chart) {
                const { ctx, chartArea } = chart;
                if (!chartArea) return;
                const cx = chartArea.left + chartArea.width  / 2;
                const cy = chartArea.top  + chartArea.height / 2;
                ctx.save();
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.font      = `bold ${Math.min(22, chartArea.width * 0.13)}px Arial`;
                ctx.fillStyle = '#1A1A2E';
                ctx.fillText(formatearNumero(centerTotal), cx, cy - 9);
                ctx.font      = `${Math.min(11, chartArea.width * 0.065)}px Arial`;
                ctx.fillStyle = '#888';
                ctx.fillText('líneas únicas', cx, cy + 11);
                ctx.restore();
            }
        };
        chartLineasEstado = new Chart(
            document.getElementById('chartLineasEstado').getContext('2d'), {
            type: 'doughnut',
            plugins: [centerPlugin],
            data: {
                labels: estKeys.map(k => EST_LABELS[k] || k),
                datasets: [{ data: estKeys.map(k => estadoMap[k]),
                             backgroundColor: estKeys.map(k => EST_COLORES[k] || '#6b7280'),
                             borderColor: '#fff', borderWidth: 3 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '65%',
                plugins: {
                    legend: { position: 'bottom', labels: { padding: 15, font: { size: 12 } } },
                    tooltip: { callbacks: { label(ctx) {
                        const pct = ((ctx.parsed / totalLineas)*100).toFixed(1);
                        return ctx.label + ': ' + formatearNumero(ctx.parsed) + ' (' + pct + '%)';
                    }}}
                },
                onClick: makeDblClickHandler(el => {
                    document.getElementById('filtroLineasEstado').value = estKeys[el.index] || '';
                    aplicarFiltrosLineas();
                }),
                onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; }
            }
        });
    }

    // ── 2. Líneas por Telefonía (barras horizontales) ─────────────
    const TEL_COLORS = { Personal: '#1d4ed8', Claro: '#dc2626' };
    if (porTelefon.length) {
        const tLabels = porTelefon.map(r => r.telefonia);
        const tVals   = porTelefon.map(r => Number(r.total));
        const tColors = tLabels.map(k => TEL_COLORS[k] || '#6b7280');
        chartLineasTelefonia = new Chart(
            document.getElementById('chartLineasTelefonia').getContext('2d'), {
            type: 'bar',
            data: {
                labels: tLabels,
                datasets: [{ label: 'Líneas', data: tVals,
                             backgroundColor: tColors.map(c => c + 'cc'),
                             borderColor: tColors, borderWidth: 2,
                             borderRadius: 6 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label(ctx) { return ' ' + formatearNumero(ctx.parsed.x) + ' líneas'; } } }
                },
                scales: {
                    x: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' },
                         ticks: { callback: v => formatearNumero(v) } },
                    y: { grid: { display: false } }
                },
                onClick: makeDblClickHandler(el => {
                    document.getElementById('filtroLineasTelefonia').value = tLabels[el.index] || '';
                    aplicarFiltrosLineas();
                }),
                onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; }
            }
        });
    }

    // ── 3. Top 10 consumo total (barras horizontales) ─────────────
    if (top10.length) {
        const t10Labels = top10.map(r => r.linea || '-');
        const t10Vals   = top10.map(r => parseFloat(r.consumo_total_mb) || 0);
        const GRAD_BASE = ['#35398C','#DA527D','#B44C80','#904783','#644087',
                           '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6'];
        chartLineasTop10 = new Chart(
            document.getElementById('chartLineasTop10').getContext('2d'), {
            type: 'bar',
            data: {
                labels: t10Labels,
                datasets: [{ label: 'MB total', data: t10Vals,
                             backgroundColor: t10Labels.map((_, i) => GRAD_BASE[i % GRAD_BASE.length] + 'cc'),
                             borderColor:     t10Labels.map((_, i) => GRAD_BASE[i % GRAD_BASE.length]),
                             borderWidth: 2, borderRadius: 6 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label(ctx) { return ' ' + formatearNumero(Math.round(ctx.parsed.x)) + ' MB'; } } }
                },
                scales: {
                    x: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' },
                         ticks: { callback: v => formatearNumero(v) + ' MB' } },
                    y: { grid: { display: false },
                         ticks: { font: { size: 11 },
                                  callback(v) { const l = t10Labels[v]; return l && l.length > 14 ? l.slice(0,14)+'…' : l; } } }
                },
                onClick: makeDblClickHandler(el => {
                    document.getElementById('filtroLineasBuscar').value = t10Labels[el.index] || '';
                    aplicarFiltrosLineas();
                }),
                onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; }
            }
        });
    }
}

function mostrarLineasBD(filas, totalServidor) {
    const tbody  = document.getElementById('tablaLineasBDBody');
    const infoEl = document.getElementById('paginacion-info-consumo');
    const pagEl  = document.getElementById('paginacion-lineas-bd');
    tbody.innerHTML = '';

    const total        = totalServidor ?? filas.length;
    const totalPaginas = Math.max(1, Math.ceil(total / ITEMS_POR_PAGINA));
    const from         = (paginaLineasBD - 1) * ITEMS_POR_PAGINA;

    if (total === 0 || filas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px">No se encontraron líneas.</td></tr>';
        infoEl.innerHTML = '';
        pagEl.innerHTML  = '';
        return;
    }

    const fin = from + filas.length;
    infoEl.innerHTML = `Mostrando <strong>${from + 1}–${fin}</strong> de <strong>${formatearNumero(total)}</strong> líneas`;

    filas.forEach(row => {
        // Estado unificado — misma lógica que Consumo y panel de RC
        const est = getEstadoSIM(row);

        const cfgEst = esViewer()
            ? (ESTADO_CONFIG_VIEWER[estadoSimple(est)] || ESTADO_CONFIG_VIEWER.activo)
            : (ESTADO_CONFIG_DISP[est] || ESTADO_CONFIG_DISP.activo);

        const dotColor = est === 'desactivado' ? '#dc2626' : '#16a34a';

        // Número — navega a pestaña Consumo filtrado por ese número
        const numCell = row.numero
            ? `<span style="color:${dotColor};font-size:10px;margin-right:4px">●</span><span class="link-num" onclick="irAConsumoFiltrado('${row.numero}')" title="Ver consumo →">${row.numero}</span>`
            : '-';

        // IMEI — navega a pestaña Consumo filtrado por ese IMEI
        const imei = row.imei || '';
        const imeiCell = imei
            ? `<span class="link-num" onclick="irAConsumoFiltrado('${imei}')" title="Ver consumo →">${imei.length > 12 ? imei.slice(0,12)+'…' : imei}</span>`
            : '-';

        // RC — link a panel RC
        const rcCell = row.rc
            ? `<span class="link-rc" onclick="abrirPanelRC('${row.rc}')">${row.rc}</span>`
            : '-';

        const tr = document.createElement('tr');
        if (est === 'desactivado') tr.classList.add('fila-inactiva');

        tr.innerHTML = `
            <td><span class="badge-estado ${cfgEst.cls}">${cfgEst.label}</span></td>
            <td>${numCell}</td>
            <td class="td-imei">${imeiCell}</td>
            <td>${badgeTelefonia(row.telefonia)}</td>
            <td>${rcCell}</td>
            <td style="text-align:right">${formatearNumero(parseFloat(row.consumo_mes_mb) || 0)} MB</td>
            <td style="text-align:right">${formatearNumero(parseFloat(row.consumo_total_mb) || 0)} MB</td>
        `;
        tbody.appendChild(tr);
    });

    renderPaginacionLineasBD(totalPaginas);
}

function renderPaginacionLineasBD(totalPaginas) {
    const cont = document.getElementById('paginacion-lineas-bd');
    if (totalPaginas <= 1) { cont.innerHTML = ''; return; }

    const prev = paginaLineasBD === 1;
    const next = paginaLineasBD === totalPaginas;
    let html = '<div class="pag-controles">';
    html += `<button class="pag-btn" onclick="irPaginaLineasBD(${paginaLineasBD - 1})" ${prev ? 'disabled' : ''}>← Anterior</button>`;
    paginasVisibles(paginaLineasBD, totalPaginas).forEach(p => {
        if (p === '...') html += '<span class="pag-dots">…</span>';
        else html += `<button class="pag-btn pag-num ${p === paginaLineasBD ? 'pag-activa' : ''}" onclick="irPaginaLineasBD(${p})">${p}</button>`;
    });
    html += `<button class="pag-btn" onclick="irPaginaLineasBD(${paginaLineasBD + 1})" ${next ? 'disabled' : ''}>Siguiente →</button>`;
    html += '</div>';
    cont.innerHTML = html;
}

async function irPaginaLineasBD(num) {
    if (num < 1) return;
    paginaLineasBD = num;
    await cargarLineasBD();
    document.querySelector('#tab-consumo .table-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function aplicarFiltrosLineas() {
    paginaLineasBD = 1;
    await cargarLineasBD();
}

function limpiarFiltrosLineas() {
    const b = document.getElementById('filtroLineasBuscar');
    const t = document.getElementById('filtroLineasTelefonia');
    const e = document.getElementById('filtroLineasEstado');
    if (b) b.value = '';
    if (t) t.value = '';
    if (e) e.value = '';
    aplicarFiltrosLineas();
}

let _lineasDebTimer = null;
function debounceFiltrosLineas() {
    clearTimeout(_lineasDebTimer);
    _lineasDebTimer = setTimeout(aplicarFiltrosLineas, 400);
}

// ── FILTROS VISTA RC ──────────────────────────────────────────────

async function aplicarFiltroRC() {
    paginaEquipos = 1;
    await mostrarConsolidado(consumosFiltrados);

    // Actualizar charts con data filtrada por RC/Regional
    const rcText   = document.getElementById('filtroRCBuscar')?.value.trim().toLowerCase()  || '';
    const regional = document.getElementById('filtroRCRegional')?.value.trim() || '';
    let datos = consumosFiltrados;
    if (rcText || regional) {
        datos = consumosFiltrados.filter(c => {
            const rc  = encontrarRC(c);
            const num = String(c.numero || '').trim();
            const imi = normalizarImei(c.imei);
            const dev = mapaNumADevice.get(num) || mapaImeiADevice.get(imi) || null;
            const reg = dev?.regional || '';
            return (!rcText   || rc.toLowerCase().includes(rcText))
                && (!regional || reg === regional);
        });
    }
    crearGraficosEquipo(datos);
}

function limpiarFiltroRC() {
    const b = document.getElementById('filtroRCBuscar');
    const r = document.getElementById('filtroRCRegional');
    if (b) b.value = '';
    if (r) r.value = '';
    paginaEquipos = 1;
    mostrarConsolidado(consumosFiltrados);
    crearGraficosEquipo(consumosFiltrados);
}

let _rcDebTimer = null;
function debounceRC() {
    clearTimeout(_rcDebTimer);
    _rcDebTimer = setTimeout(aplicarFiltroRC, 400);
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
            <td>${f.rc && f.rc !== '-' ? `<span class="link-rc" onclick="abrirPanelRC('${f.rc}')">${f.rc}</span>` : `<strong>${f.rc}</strong>`}</td>
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

    const rc       = document.getElementById('filtroRCBuscar')?.value.trim()    || '';
    const regional = document.getElementById('filtroRCRegional')?.value.trim() || '';

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

    if (rc)       query = query.ilike('rc', `%${rc}%`);
    if (regional) query = query.eq('regional', regional);

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

    const fin = from + data.length;
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
    const titulo = vistaConsumo === 'equipos' ? 'Reporte de Consumo por Equipo'
                 : vistaConsumo === 'lineas-bd' ? 'Reporte de Líneas Activas'
                 : 'Reporte de Consumo por Línea';
    const periodo = (desde || hasta)
        ? `Período: ${desde ? formatearFecha(desde) : 'inicio'} — ${hasta ? formatearFecha(hasta) : 'hoy'}`
        : 'Todos los períodos';

    document.getElementById('printTitulo').textContent  = titulo;
    document.getElementById('printPeriodo').textContent = periodo;
    document.getElementById('printFecha').textContent   = new Date().toLocaleDateString('es-PY');
    window.print();
}

// ── FILTROS CONSUMO ────────────────────────────────────────────────

async function aplicarFiltrosConsumo() {
    _consumosTimestamp = 0; // invalidar caché al aplicar filtros
    paginaConsumo  = 1;
    paginaEquipos  = 1;
    paginaLineasBD = 1;
    const loading = document.getElementById('loadingConsumo');
    loading.style.display = 'block';

    const necesitaConsolidado = vistaConsumo !== 'lineas-bd';
    try {
        const [tablaRes, resumen, consolidadoRes] = await Promise.all([
            consultarConsumos(true),
            cargarResumenConsumo(),
            necesitaConsolidado
                ? consultarConsumos(false)
                : Promise.resolve({ data: consumosFiltrados, count: 0 }),
        ]);
        loading.style.display = 'none';
        totalConsumoServidor = tablaRes.count;
        if (necesitaConsolidado) consumosFiltrados = consolidadoRes.data;

        actualizarTotalConsumo(resumen.total_mb);
        crearGraficosConsumo(resumen, consumosFiltrados);

        if (vistaConsumo === 'equipos') {
            mostrarConsolidado(consumosFiltrados);
        } else if (vistaConsumo === 'lineas-bd') {
            paginaLineasBD = 1;
            cargarLineasBD();
        } else {
            mostrarEnTablaConsumo(tablaRes.data, tablaRes.count);
        }
    } catch (e) {
        loading.style.display = 'none';
        console.error('❌', e);
    }
}

function limpiarFiltrosConsumo() {
    document.getElementById('filtroTelefonia').value     = '';
    document.getElementById('filtroEstadoConsumo').value = '';
    document.getElementById('filtroRCConsumo').value     = '';
    document.getElementById('filtroNumConsumo').value    = '';
    document.getElementById('filtroFechaDesde').value    = '';
    document.getElementById('filtroFechaHasta').value    = '';
    document.getElementById('filtroObservacion').value   = '';
    _consumosTimestamp = 0; // invalidar caché
    cargarConsumos(true);
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
        'Arrastrá uno o varios archivos acá o <span>hacé clic para seleccionar</span>';
    document.getElementById('dropZoneConsumo').classList.remove('drop-active');
    document.getElementById('telefoniaDetectada').style.display = 'none';
    document.getElementById('fileListConsumo').style.display = 'none';
    document.getElementById('fileListConsumo').innerHTML = '';
    const fill = document.getElementById('progressFillConsumo');
    fill.style.width = '0%';
    fill.style.background = '';
    telefoniaActual = '';
    archivosCSVPendientes = [];
}

function cerrarImportConsumoOverlay(e) {
    if (e.target === document.getElementById('importConsumoModal')) cerrarImportConsumo();
}

// Renderiza la lista de archivos seleccionados
function actualizarListaArchivos() {
    const lista = document.getElementById('fileListConsumo');
    const dropZone = document.getElementById('dropZoneConsumo');
    const dropLabel = document.getElementById('dropLabelConsumo');

    if (!archivosCSVPendientes.length) {
        lista.style.display = 'none';
        lista.innerHTML = '';
        dropZone.classList.remove('drop-active');
        dropLabel.innerHTML = 'Arrastrá uno o varios archivos acá o <span>hacé clic para seleccionar</span>';
        document.getElementById('telefoniaDetectada').style.display = 'none';
        return;
    }

    lista.style.display = 'flex';
    lista.innerHTML = archivosCSVPendientes.map((f, i) => {
        const tel = detectarTelefonia(f.name);
        return `<div class="file-item" id="file-item-${i}">
            <span class="file-item-name" title="${f.name}">${f.name}</span>
            <span class="file-item-tel">${tel}</span>
            <span class="file-item-size">${(f.size / 1024).toFixed(0)} KB</span>
            <span class="file-item-status" id="file-status-${i}"></span>
            <button class="file-item-remove" onclick="removerArchivoCSV(${i})" title="Quitar">✕</button>
        </div>`;
    }).join('');

    const n = archivosCSVPendientes.length;
    dropZone.classList.add('drop-active');
    dropLabel.innerHTML = n === 1
        ? `<strong>📄 ${archivosCSVPendientes[0].name}</strong>`
        : `<strong>📦 ${n} archivos seleccionados</strong>`;

    // Telefonía solo si hay 1 archivo
    if (n === 1) {
        telefoniaActual = detectarTelefonia(archivosCSVPendientes[0].name);
        document.getElementById('telefoniaLabel').textContent = telefoniaActual;
        document.getElementById('telefoniaDetectada').style.display = 'flex';
    } else {
        telefoniaActual = '';
        document.getElementById('telefoniaDetectada').style.display = 'none';
    }
}

// Elimina un archivo de la lista pendiente
function removerArchivoCSV(idx) {
    archivosCSVPendientes.splice(idx, 1);
    document.getElementById('archivoCSV').value = '';
    actualizarListaArchivos();
}

function archivoCSVSeleccionado(e) {
    const nuevos = Array.from(e.target.files);
    if (!nuevos.length) return;
    // Agregar sin duplicados por nombre
    nuevos.forEach(f => {
        if (!archivosCSVPendientes.find(x => x.name === f.name)) archivosCSVPendientes.push(f);
    });
    actualizarListaArchivos();
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
    const files = Array.from(e.dataTransfer.files)
        .filter(f => /\.(csv|txt)$/i.test(f.name));
    if (!files.length) return;
    files.forEach(f => {
        if (!archivosCSVPendientes.find(x => x.name === f.name)) archivosCSVPendientes.push(f);
    });
    actualizarListaArchivos();
}

function setProgressConsumo(pct, texto, color) {
    const fill = document.getElementById('progressFillConsumo');
    fill.style.width = pct + '%';
    if (color) fill.style.background = color;
    document.getElementById('progressTextConsumo').textContent = texto;
}

// Parsear CSV (separador auto-detectado: ',' o ';'): numero,imei,estado_operador,consumo_mb,fecha(DD/MM/YYYY),observacion
function parsearCSVConsumo(texto, telefonia) {
    const lineas = texto
        .replace(/^﻿/, '')  // quitar BOM si existe
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);

    // Auto-detectar separador desde la primera línea
    const sep = lineas.length && lineas[0].split(',').length > lineas[0].split(';').length ? ',' : ';';

    const registros = [];

    for (const linea of lineas) {
        const cols = linea.split(sep);
        if (cols.length < 4) continue;

        const numero   = (cols[0] || '').trim();
        const imei     = normalizarImei((cols[1] || '').trim());
        const estadoOp = (cols[2] || '').trim();
        const mbRaw    = (cols[3] || '').trim();
        const fechaRaw = (cols[4] || '').trim();
        const obs      = (cols[5] || '').trim();

        if (!numero && !imei) continue;

        const _mbParsed = parseFloat(mbRaw);
        const consumo_mb = (mbRaw !== '' && !isNaN(_mbParsed)) ? _mbParsed : null;

        // Parsear fecha → YYYY-MM-DD
        // Soporta: DD/MM/YYYY · DD-MM-YYYY · YYYY-MM-DD · YYYY/MM/DD
        let fecha_consumo = null;
        if (fechaRaw) {
            // Ya está en formato ISO: YYYY-MM-DD o YYYY/MM/DD
            const iso = fechaRaw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
            if (iso) {
                fecha_consumo = `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
            } else {
                // Formato DD/MM/YYYY o DD-MM-YYYY
                const dmy = fechaRaw.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
                if (dmy) {
                    fecha_consumo = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
                }
            }
        }

        // Estado inicial: activo por defecto
        // Personal con observacion "backup" → desactivado (el resto se recalcula post-import)
        const obsLower = obs.toLowerCase();
        const estado = (telefonia === 'Personal' && obsLower.includes('backup'))
            ? 'desactivado'
            : 'activo';

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

// ══════════════════════════════════════════════════════════════════
// ── PANEL DE DETALLE RC / SIM ─────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

function cerrarPanel() {
    document.getElementById('panelOverlay').style.display = 'none';
    if (chartPanelRC)  { chartPanelRC.destroy();  chartPanelRC  = null; }
    if (chartPanelSIM) { chartPanelSIM.destroy(); chartPanelSIM = null; }
}

function cerrarPanelOverlay(e) {
    if (e.target === document.getElementById('panelOverlay')) cerrarPanel();
}

// Ir al tab Dispositivos con ese RC filtrado
function irADispositivosFiltrado(codigo) {
    cerrarPanel();
    // Limpiar filtros y poner solo el código buscado
    document.getElementById('filtroRegional').value = '';
    document.getElementById('filtroCodigo').value   = codigo;
    document.getElementById('filtroSim').value      = '';
    document.getElementById('filtroFecha').value    = '';
    document.getElementById('filtroEstado').value   = '';
    if (!esViewer()) document.getElementById('filtroTipo').value = '';
    // Asegurar que datosFiltrados esté inicializado
    if (!datosFiltrados.length && todosLosDatos.length) datosFiltrados = todosLosDatos;
    cambiarTab('dispositivos');
    aplicarFiltros();
}

// ── Navegación entre pestañas ─────────────────────────────────────
// Muestra el tab Consumo sin relanzar cargarConsumos(); luego cambiarVista se encarga.
function _mostrarTabConsumo() {
    const tDisp = document.getElementById('tab-dispositivos');
    const tCons = document.getElementById('tab-consumo');
    if (tCons && tCons.style.display === 'none') {
        if (tDisp) tDisp.style.display = 'none';
        tCons.style.display = 'block';
        document.getElementById('tabBtnDispositivos')?.classList.remove('tab-activo');
        document.getElementById('tabBtnConsumo')?.classList.add('tab-activo');
    }
}

// Desde panel (o cualquier tab) → va a Líneas (lineas-bd) filtrado por número/IMEI/texto
function irALineasFiltrado(buscar) {
    cerrarPanel();
    const el = document.getElementById('filtroLineasBuscar');
    const t  = document.getElementById('filtroLineasTelefonia');
    const e  = document.getElementById('filtroLineasEstado');
    if (el) el.value = String(buscar || '');
    if (t)  t.value  = '';
    if (e)  e.value  = '';
    _mostrarTabConsumo();
    cambiarVista('lineas-bd');
}

// Desde Líneas tab → va a Consumo (lineas) filtrado por ese número/IMEI
function irAConsumoFiltrado(buscar) {
    cerrarPanel();
    const numEl = document.getElementById('filtroNumConsumo');
    const rcEl  = document.getElementById('filtroRCConsumo');
    if (numEl) numEl.value = String(buscar || '');
    if (rcEl)  rcEl.value  = '';
    _mostrarTabConsumo();
    cambiarVista('lineas');
}

// ── Panel RC ───────────────────────────────────────────────────────
async function abrirPanelRC(codigo) {
    if (!codigo || codigo === '-') return;
    const device = todosLosDatos.find(d => d.codigo === codigo);

    const overlay = document.getElementById('panelOverlay');
    const titulo  = document.getElementById('panelTitulo');
    const cuerpo  = document.getElementById('panelCuerpo');

    titulo.textContent = '📡 ' + codigo;
    cuerpo.innerHTML   = '<div class="panel-loading">⏳ Cargando...</div>';
    overlay.style.display = 'flex';

    if (chartPanelRC)  { chartPanelRC.destroy();  chartPanelRC  = null; }
    if (chartPanelSIM) { chartPanelSIM.destroy(); chartPanelSIM = null; }

    try {
        const sim1n = device ? String(device.sim1_num  || '').trim() : '';
        const sim1i = device ? normalizarImei(device.sim1_imei)      : '';
        const sim2n = device ? String(device.sim2_num  || '').trim() : '';
        const sim2i = device ? normalizarImei(device.sim2_imei)      : '';

        const orParts = [
            ...([sim1n, sim2n].filter(n => n && n.toLowerCase() !== 'm2m').map(n => `numero.eq.${n}`)),
            ...([sim1i, sim2i].filter(Boolean).map(i => `imei.eq.${i}`)),
        ];

        const [consumoRes, historialRes] = await Promise.all([
            orParts.length > 0
                ? window.clienteSupabase.from('consumo_sim')
                    .select('numero,imei,consumo_mb,fecha_consumo,telefonia,estado,estado_operador,observacion')
                    .or(orParts.join(','))
                    .order('fecha_consumo', { ascending: false })
                    .limit(500)
                : Promise.resolve({ data: [], error: null }),
            window.clienteSupabase.from('historial_sim')
                .select('*')
                .eq('rc_codigo', codigo)
                .order('fecha_cambio', { ascending: false })
                .limit(20),
        ]);

        const consumoData   = consumoRes.data   || [];
        const historialData = historialRes.error ? [] : (historialRes.data || []);

        const calcSimMB = (n, i) => consumoData
            .filter(c => {
                const cn = String(c.numero || '').trim();
                const ci = normalizarImei(c.imei);
                return (n && cn === n) || (i && ci === i);
            })
            .reduce((s, c) => s + (parseFloat(c.consumo_mb) || 0), 0);

        const sim1MB = calcSimMB(sim1n, sim1i);
        const sim2MB = calcSimMB(sim2n, sim2i);

        // Estado efectivo directo desde la DB (igual que en la tabla)
        const estEfectivo = device?.estado === 'desactivado' ? 'desactivado' : 'activo';

        // Badge del header: solo para legado / satelital / error (no para activado normal)
        const safeCode   = codigo.replace(/'/g, "\\'");
        const tipoDevice = device ? getTipoDevice(device) : null;
        const HEADER_TIPO_BADGES = {
            legado:    '<span class="panel-header-badge badge-legado-h">LEGADO</span>',
            satelital: '<span class="panel-header-badge badge-satelital-h">SATELITAL</span>',
            error:     '<span class="panel-header-badge" style="background:rgba(239,68,68,.35);color:#fca5a5;border:1px solid rgba(239,68,68,.5);padding:3px 10px;border-radius:8px;font-size:11px;font-weight:700;letter-spacing:.5px">ERROR</span>',
        };
        titulo.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span class="panel-titulo-link" onclick="irADispositivosFiltrado('${safeCode}')" title="Ver en Dispositivos">📡 ${codigo}</span>
                ${HEADER_TIPO_BADGES[tipoDevice] || ''}
            </div>`;

        // Badge de estado en el cuerpo del panel (solo activo / desactivado)
        const cfgEst  = ESTADO_CONFIG_DISP[estEfectivo] || ESTADO_CONFIG_DISP['activo'];
        const estLabel = `<span class="badge-estado ${cfgEst.cls}">${cfgEst.label}</span>`;

        const hasSim1 = !!(sim1n || sim1i);
        const hasSim2 = !!(sim2n || sim2i);

        // Estado detallado (5 estados) de un slot (num+imei como conjunto)
        const getSimEst = (num, imei) => {
            const n   = String(num  || '').trim();
            const i   = normalizarImei(imei);
            const m2m = n.toLowerCase() === 'm2m';
            if ((!n || m2m) && !i) return 'nulo';

            const latestRow = (rows) => {
                if (!rows.length) return null;
                return rows.reduce((a, b) => (a.fecha_consumo || '') >= (b.fecha_consumo || '') ? a : b);
            };

            const rowsN = (!m2m && n)
                ? consumoData.filter(c => String(c.numero || '').trim() === n)
                : [];
            const rowsI = i
                ? consumoData.filter(c => normalizarImei(c.imei) === i)
                : [];

            if (!rowsN.length && !rowsI.length) return 'no_asignado';

            const rN = latestRow(rowsN);
            const rI = latestRow(rowsI);
            const eN = rN ? estadoConsDisplay(rN) : null;
            const eI = rI ? estadoConsDisplay(rI) : null;
            if (eN === 'desactivado' || eI === 'desactivado') return 'inactivo';
            // sin_consumo: encontrado pero ninguno tiene consumo_mb > 0
            const mbN = rN ? (parseFloat(rN.consumo_mb) || 0) : null;
            const mbI = rI ? (parseFloat(rI.consumo_mb) || 0) : null;
            if ((mbN === null || mbN === 0) && (mbI === null || mbI === 0)) return 'sin_consumo';
            return 'activo';
        };
        const sim1Est = getSimEst(sim1n, sim1i);
        const sim2Est = getSimEst(sim2n, sim2i);

        // Mostrar tarjeta SIM siempre (nulo=rojo slot vacío, no_asignado=naranja sin registros)
        const sim1Card = renderPanelSimCard(sim1n, sim1i, sim1MB, 'sim1', sim1Est);
        const sim2Card = renderPanelSimCard(sim2n, sim2i, sim2MB, 'sim2', sim2Est);

        cuerpo.innerHTML = `
            ${device ? `
            <div class="panel-section">
                <div class="panel-section-title">Equipo</div>
                <div class="panel-info-grid">
                    <div class="panel-info-item">
                        <div class="panel-info-label">Regional</div>
                        <div class="panel-info-value">${device.regional || '-'}</div>
                    </div>
                    <div class="panel-info-item">
                        <div class="panel-info-label">Estado</div>
                        <div class="panel-info-value">${estLabel}</div>
                    </div>
                </div>
                ${device.ubicacion ? `<div class="panel-info-full"><div class="panel-info-label">Ubicación</div><div class="panel-info-value" style="font-size:13px">${device.ubicacion}</div></div>` : ''}
                ${device.fecha_activacion ? `<div class="panel-info-full"><div class="panel-info-label">Fecha de Activación</div><div class="panel-info-value">${formatearFecha(device.fecha_activacion)}</div></div>` : ''}
            </div>` : ''}

            <div class="panel-section">
                <div class="panel-section-title">SIM Cards</div>
                ${sim1Card}
                ${sim2Card}
            </div>

            <div class="panel-section">
                <div class="panel-section-title">Consumo Histórico</div>
                <div class="panel-chart-wrap">
                    <canvas id="chartPanelRCCanvas"></canvas>
                </div>
            </div>

            <div class="panel-section">
                <div class="panel-section-title">Historial de Cambios SIM</div>
                ${renderHistorialSIM(historialData)}
            </div>

            <div class="panel-section">
                <div class="panel-section-title">Acciones</div>
                <div class="panel-actions">
                ${esViewer() ? `
                    <button class="btn-panel btn-panel-desactivar" onclick="solicitarDesactivacionRC('${safeCode}')">🔴 Solicitar Desactivación</button>
                    <button class="btn-panel btn-panel-cambiar"    onclick="abrirCambiarSIM('${safeCode}','sim1')">🔄 Solicitar Cambio SIM 1</button>
                    ${hasSim2 ? `<button class="btn-panel btn-panel-cambiar" onclick="abrirCambiarSIM('${safeCode}','sim2')">🔄 Solicitar Cambio SIM 2</button>` : ''}
                ` : `
                    <button class="btn-panel btn-panel-activar"    onclick="marcarEstadoRC('${safeCode}','activo')">🟢 Marcar Activado</button>
                    <button class="btn-panel btn-panel-desactivar" onclick="marcarEstadoRC('${safeCode}','desactivado')">🔴 Marcar Desactivado</button>
                    <button class="btn-panel btn-panel-cambiar"    onclick="abrirCambiarSIM('${safeCode}','sim1')">🔄 Solicitar Cambio SIM 1</button>
                    ${hasSim2 ? `<button class="btn-panel btn-panel-cambiar" onclick="abrirCambiarSIM('${safeCode}','sim2')">🔄 Solicitar Cambio SIM 2</button>` : ''}
                `}
                </div>
            </div>
        `;

        crearChartPanelRC(consumoData, sim1n, sim1i, sim2n, sim2i);

    } catch (e) {
        console.error(e);
        cuerpo.innerHTML += `<div style="color:#ef4444;padding:12px;font-size:13px">⚠️ ${e.message}</div>`;
    }
}

// ── Panel SIM ──────────────────────────────────────────────────────
async function abrirPanelSIM(numero, imei = null) {
    const n = String(numero || '').trim();
    const i = imei ? normalizarImei(imei) : '';
    const m2m = n.toLowerCase() === 'm2m';
    if (!n && !i) return;

    const overlay = document.getElementById('panelOverlay');
    const titulo  = document.getElementById('panelTitulo');
    const cuerpo  = document.getElementById('panelCuerpo');

    // Identificador legible: número real > IMEI
    const id = (!m2m && n) ? n : i;
    titulo.innerHTML = `<span class="panel-titulo-link" onclick="irALineasFiltrado('${id}')" title="Ver en Líneas →">📱 ${id}</span>`;
    cuerpo.innerHTML   = '<div class="panel-loading">⏳ Cargando...</div>';
    overlay.style.display = 'flex';

    if (chartPanelRC)  { chartPanelRC.destroy();  chartPanelRC  = null; }
    if (chartPanelSIM) { chartPanelSIM.destroy(); chartPanelSIM = null; }

    try {
        // Buscar dispositivo asociado: primero por número, luego por IMEI
        const device = (!m2m && n ? mapaNumADevice.get(n) : null)
                    || (i ? mapaImeiADevice.get(i) : null)
                    || null;

        // Queries en paralelo: consumo histórico + historial de estados
        const histFilter = [
            ...(!m2m && n ? [`numero.eq.${n}`] : []),
            ...(i          ? [`imei.eq.${i}`]  : []),
        ].join(',');

        let q = window.clienteSupabase.from('consumo_sim')
            .select('numero,imei,consumo_mb,fecha_consumo,telefonia')
            .order('fecha_consumo', { ascending: true })
            .limit(500);
        if (!m2m && n) q = q.eq('numero', n);
        else if (i)    q = q.eq('imei', i);

        const [{ data: rows, error }, { data: histEstados }] = await Promise.all([
            q,
            histFilter
                ? window.clienteSupabase.from('sim_estados')
                    .select('estado,fecha_cambio,fecha_consumo,usuario')
                    .or(histFilter)
                    .order('fecha_cambio', { ascending: false })
                    .limit(10)
                : Promise.resolve({ data: [] }),
        ]);
        if (error) throw error;

        const consumoData = rows || [];
        const totalMB     = consumoData.reduce((s, c) => s + (parseFloat(c.consumo_mb) || 0), 0);
        const telefonia   = consumoData.find(c => c.telefonia)?.telefonia || null;
        const estadoRows  = histEstados || [];

        // Render del historial de estados (compacto, últimos 10)
        const renderHistEstados = () => {
            if (!estadoRows.length) return '<div class="panel-empty" style="font-size:12px;color:#94a3b8;padding:6px 0">Sin historial registrado</div>';
            return `<div style="overflow-x:auto">
                <table class="sim-hist-table" style="font-size:11px;width:100%">
                    <thead><tr>
                        <th>Estado</th><th>Período</th><th>Registrado</th>
                    </tr></thead>
                    <tbody>${estadoRows.map(r => {
                        const cls = r.estado === 'desactivado' ? 'badge-desactivado' : 'badge-activo';
                        const lbl = r.estado === 'desactivado' ? '● Desactivado'     : '● Activado';
                        return `<tr>
                            <td><span class="badge-estado ${cls}" style="font-size:10px;padding:1px 6px">${lbl}</span></td>
                            <td>${formatearFecha(r.fecha_consumo) || '-'}</td>
                            <td style="color:#64748b">${formatearFecha(r.fecha_cambio) || '-'}</td>
                        </tr>`;
                    }).join('')}</tbody>
                </table>
            </div>`;
        };

        cuerpo.innerHTML = `
            <div class="panel-section">
                <div class="panel-section-title">Información SIM</div>
                <div class="panel-info-grid">
                    <div class="panel-info-item">
                        <div class="panel-info-label">RC Asociado</div>
                        <div class="panel-info-value">
                            ${device ? `<span class="link-rc" onclick="abrirPanelRC('${device.codigo.replace(/'/g,"\\'")}')">📡 ${device.codigo}</span>` : '<span style="color:#bbb">No encontrado</span>'}
                        </div>
                    </div>
                    <div class="panel-info-item">
                        <div class="panel-info-label">Telefonía</div>
                        <div class="panel-info-value">${badgeTelefonia(telefonia)}</div>
                    </div>
                </div>
                <div class="panel-info-full" style="margin-top:8px">
                    <div class="panel-info-label">Total Consumo Registrado</div>
                    <div class="panel-info-value" style="color:#16a34a;font-size:18px">${formatearNumero(totalMB)} MB</div>
                </div>
                ${device?.regional ? `<div class="panel-info-full"><div class="panel-info-label">Regional</div><div class="panel-info-value">${device.regional}</div></div>` : ''}
            </div>

            <div class="panel-section">
                <div class="panel-section-title">Consumo Histórico</div>
                <div class="panel-chart-wrap">
                    <canvas id="chartPanelSIMCanvas"></canvas>
                </div>
            </div>

            <div class="panel-section">
                <div class="panel-section-title">Historial de Estados</div>
                ${renderHistEstados()}
            </div>

            <div class="panel-section">
                <div class="panel-section-title">Acciones</div>
                <div class="panel-actions">
                    <button class="btn-panel btn-panel-saldo" onclick="solicitarCargaSaldo('${id}')">💳 Solicitar Saldo</button>
                    <button class="btn-panel btn-panel-cambiar" onclick="irALineasFiltrado('${id}')">📋 Ver en Líneas</button>
                    <button class="btn-panel btn-panel-cambiar" onclick="irAConsumoFiltrado('${id}')">📊 Ver en Consumo</button>
                </div>
            </div>
        `;

        crearChartPanelSIM(consumoData);

    } catch (e) {
        cuerpo.innerHTML = `<div class="panel-loading" style="color:#ef4444">❌ ${e.message}</div>`;
        console.error(e);
    }
}

// ── Tarjeta SIM dentro del panel RC ───────────────────────────────
// estado: 'activo' | 'inactivo' | 'nulo' | 'no_asignado'
function renderPanelSimCard(num, imei, totalMB, slot, estado) {
    const isM2M    = !num || num.toLowerCase() === 'm2m';
    const slotLabel = slot === 'sim1' ? 'SIM Principal' : 'SIM Respaldo';

    const dotColor = SIM_EST_COLOR[estado] || '#9ca3af';
    const isNaranja = estado === 'no_asignado' || estado === 'sin_consumo';
    const txtColor  = (estado === 'inactivo' || estado === 'nulo') ? '#dc2626'
                    : isNaranja                                     ? '#f97316'
                    : '';
    const estLabel = SIM_EST_LABEL[estado] || '';

    const dot = `<span style="color:${dotColor};font-size:11px;margin-right:5px;vertical-align:middle">●</span>`;

    // Slot vacío → tarjeta con dot rojo "Nulo"
    if (estado === 'nulo') {
        return `
        <div class="panel-sim-card panel-sim-card-vacio">
            <div class="panel-sim-header">
                <span class="panel-sim-label">${slotLabel}</span>
                <span class="panel-sim-est" style="color:${dotColor}">${dot}${estLabel}</span>
            </div>
        </div>`;
    }

    const numDisplay = isM2M
        ? `${dot}<span style="color:${txtColor||'#aaa'};font-style:italic;font-size:13px">M2M</span>`
        : `${dot}<span class="panel-sim-numero"${txtColor ? ` style="color:${txtColor}"` : ''} onclick="irALineasFiltrado('${num}')" title="Ver en Líneas →">${num}</span>`;

    return `
        <div class="panel-sim-card">
            <div class="panel-sim-header">
                <span class="panel-sim-label">${slotLabel}</span>
                <span class="panel-sim-est" style="color:${dotColor}">${estLabel}</span>
                <span class="panel-sim-mb">${formatearNumero(totalMB)} MB</span>
            </div>
            ${numDisplay}
            ${imei ? `<div class="panel-sim-imei">IMEI: ${imei}</div>` : ''}
        </div>`;
}

// ── Tabla historial SIM ────────────────────────────────────────────
function renderHistorialSIM(historial) {
    if (!historial.length) return '<div class="panel-empty">Sin cambios registrados</div>';
    const filas = historial.map(h => `
        <tr>
            <td>${formatearFecha(h.fecha_cambio?.substring(0, 10))}</td>
            <td>${h.sim_slot === 'sim1' ? 'SIM 1' : 'SIM 2'}</td>
            <td style="font-size:11px;color:#666">${h.numero_ant || '-'} → <strong>${h.numero_nuevo || '-'}</strong></td>
            <td>${h.usuario || '-'}</td>
        </tr>`).join('');
    return `
        <table class="panel-historial">
            <thead><tr><th>Fecha</th><th>Slot</th><th>Anterior → Nuevo</th><th>Usuario</th></tr></thead>
            <tbody>${filas}</tbody>
        </table>`;
}

// ── Mini gráfico del panel RC ──────────────────────────────────────
function crearChartPanelRC(consumoData, sim1n, sim1i, sim2n, sim2i) {
    if (chartPanelRC) { chartPanelRC.destroy(); chartPanelRC = null; }
    const canvas = document.getElementById('chartPanelRCCanvas');
    if (!canvas || !consumoData.length) return;

    const sim1Data = {}, sim2Data = {};
    const fechasSet = new Set();

    consumoData.forEach(c => {
        const f  = c.fecha_consumo?.substring(0, 10);
        if (!f) return;
        fechasSet.add(f);
        const cn = String(c.numero || '').trim();
        const ci = normalizarImei(c.imei);
        const mb = parseFloat(c.consumo_mb) || 0;
        if ((sim1n && cn === sim1n) || (sim1i && ci === sim1i)) sim1Data[f] = (sim1Data[f] || 0) + mb;
        if ((sim2n && cn === sim2n) || (sim2i && ci === sim2i)) sim2Data[f] = (sim2Data[f] || 0) + mb;
    });

    const fechas   = [...fechasSet].sort();
    const datasets = [];

    if (Object.keys(sim1Data).length) {
        datasets.push({
            label: sim1n && sim1n.toLowerCase() !== 'm2m' ? sim1n : 'SIM 1',
            data: fechas.map(f => sim1Data[f] || 0),
            borderColor: '#35398C', backgroundColor: 'rgba(53,57,140,0.08)',
            borderWidth: 2, fill: true, tension: 0.4, pointRadius: 3,
        });
    }
    if (Object.keys(sim2Data).length) {
        datasets.push({
            label: sim2n && sim2n.toLowerCase() !== 'm2m' ? sim2n : 'SIM 2',
            data: fechas.map(f => sim2Data[f] || 0),
            borderColor: '#DA527D', backgroundColor: 'rgba(218,82,125,0.08)',
            borderWidth: 2, fill: true, tension: 0.4, pointRadius: 3,
        });
    }
    if (!datasets.length) return;

    chartPanelRC = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels: fechas.map(f => formatearFecha(f)), datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { padding: 8, font: { size: 10 } } },
                tooltip: { callbacks: { label: c => c.dataset.label + ': ' + formatearNumero(c.parsed.y) + ' MB' } }
            },
            scales: {
                x: { ticks: { font: { size: 9 }, maxRotation: 45, maxTicksLimit: 8 } },
                y: { beginAtZero: true, ticks: { font: { size: 9 }, callback: v => formatearNumero(v) } }
            },
        }
    });
}

// ── Mini gráfico del panel SIM ─────────────────────────────────────
function crearChartPanelSIM(rows) {
    if (chartPanelSIM) { chartPanelSIM.destroy(); chartPanelSIM = null; }
    const canvas = document.getElementById('chartPanelSIMCanvas');
    if (!canvas || !rows.length) return;

    const byDate = {};
    rows.forEach(c => {
        const f = c.fecha_consumo?.substring(0, 10);
        if (!f) return;
        byDate[f] = (byDate[f] || 0) + (parseFloat(c.consumo_mb) || 0);
    });
    const fechas = Object.keys(byDate).sort();

    chartPanelSIM = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: fechas.map(f => formatearFecha(f)),
            datasets: [{
                label: 'MB',
                data: fechas.map(f => byDate[f]),
                borderColor: '#8A35AB', backgroundColor: 'rgba(138,53,171,0.08)',
                borderWidth: 2, fill: true, tension: 0.4, pointRadius: 3,
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: c => formatearNumero(c.parsed.y) + ' MB' } }
            },
            scales: {
                x: { ticks: { font: { size: 9 }, maxRotation: 45, maxTicksLimit: 8 } },
                y: { beginAtZero: true, ticks: { font: { size: 9 }, callback: v => formatearNumero(v) } }
            },
        }
    });
}

// ── Modal cambiar SIM ──────────────────────────────────────────────
function abrirCambiarSIM(codigo, slot) {
    cambioSimActual = { codigo, slot };
    const device    = todosLosDatos.find(d => d.codigo === codigo);
    const slotLabel = slot === 'sim1' ? 'SIM Principal' : 'SIM Respaldo';
    const accion    = esViewer() ? 'Solicitar Cambio' : 'Cambiar';

    document.getElementById('modalSimTitulo').innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
        ${accion} ${slotLabel} — ${codigo}`;

    // Adaptar etiqueta del botón de confirmación
    const lbl = document.getElementById('simCambioBtnLabel');
    if (lbl) lbl.textContent = esViewer() ? 'Enviar Solicitud' : 'Confirmar Cambio';

    const numAct  = device ? (slot === 'sim1' ? device.sim1_num  : device.sim2_num)  || '' : '';
    const imeiAct = device ? normalizarImei(slot === 'sim1' ? device.sim1_imei : device.sim2_imei) : '';

    document.getElementById('simNuevoNumero').value = '';
    document.getElementById('simNuevoImei').value   = '';
    document.getElementById('simObservacion').value = '';
    document.getElementById('simNuevoNumero').placeholder = numAct  || 'Nuevo número';
    document.getElementById('simNuevoImei').placeholder   = imeiAct || 'Nuevo IMEI';

    const st = document.getElementById('simCambioStatus');
    st.style.display = 'none';
    st.textContent   = '';

    document.getElementById('modalCambioSIM').style.display = 'flex';
}

function cerrarModalSim() {
    document.getElementById('modalCambioSIM').style.display = 'none';
    cambioSimActual = { codigo: null, slot: null };
}

function cerrarModalSimOverlay(e) {
    if (e.target === document.getElementById('modalCambioSIM')) cerrarModalSim();
}

async function ejecutarCambioSIM() {
    const { codigo, slot } = cambioSimActual;
    if (!codigo) return;

    const device   = todosLosDatos.find(d => d.codigo === codigo);
    const numNuevo  = document.getElementById('simNuevoNumero').value.trim() || null;
    const imeiNuevo = document.getElementById('simNuevoImei').value.trim()   || null;
    const obs       = document.getElementById('simObservacion').value.trim() || null;

    if (!numNuevo && !imeiNuevo) { alert('Ingresá al menos el nuevo número o IMEI.'); return; }

    const st = document.getElementById('simCambioStatus');
    st.style.display = 'block';
    st.style.color   = '#35398C';
    st.style.background = '#f0f2f8';

    // ── Perfil viewer: genera solicitud en lugar de escribir directamente ──
    if (esViewer()) {
        st.textContent = '⏳ Enviando solicitud...';
        try {
            const device = todosLosDatos.find(d => d.codigo === codigo);
            await enviarSolicitud('cambio_sim', {
                codigo,
                slot,
                num_actual:  device ? (slot === 'sim1' ? device.sim1_num  : device.sim2_num)  : null,
                imei_actual: device ? (slot === 'sim1' ? device.sim1_imei : device.sim2_imei) : null,
                num_nuevo:   numNuevo,
                imei_nuevo:  imeiNuevo,
                observacion: obs,
            });
            st.style.color = '#16a34a'; st.style.background = '#f0fdf4';
            st.textContent = '✅ Solicitud enviada correctamente.';
            setTimeout(() => cerrarModalSim(), 1800);
        } catch(e) {
            st.style.color = '#ef4444'; st.style.background = '#fff5f5';
            st.textContent = '❌ ' + e.message;
        }
        return;
    }

    // ── Admin: escritura directa ───────────────────────────────────────────
    st.textContent   = '⏳ Guardando cambio...';

    try {
        // 1. Registrar en historial_sim
        const { error: hErr } = await window.clienteSupabase.from('historial_sim').insert({
            rc_codigo:    codigo,
            sim_slot:     slot,
            numero_ant:   device ? (slot === 'sim1' ? device.sim1_num  : device.sim2_num)  : null,
            imei_ant:     device ? (slot === 'sim1' ? device.sim1_imei : device.sim2_imei) : null,
            numero_nuevo: numNuevo,
            imei_nuevo:   imeiNuevo,
            usuario:      rolActual,
            observacion:  obs,
        });
        if (hErr) throw hErr;

        // 2. Actualizar dispositivos_ande
        const upd = {};
        if (slot === 'sim1') {
            if (numNuevo)  upd.sim1_num  = numNuevo;
            if (imeiNuevo) upd.sim1_imei = imeiNuevo;
        } else {
            if (numNuevo)  upd.sim2_num  = numNuevo;
            if (imeiNuevo) upd.sim2_imei = imeiNuevo;
        }
        const { error: uErr } = await window.clienteSupabase.from('dispositivos_ande').update(upd).eq('codigo', codigo);
        if (uErr) throw uErr;

        // 3. Actualizar datos locales
        const idx = todosLosDatos.findIndex(d => d.codigo === codigo);
        if (idx >= 0) Object.assign(todosLosDatos[idx], upd);
        construirMapasDevice(todosLosDatos);

        st.style.color      = '#16a34a';
        st.style.background = '#f0fdf4';
        st.textContent      = '✅ Cambio guardado correctamente.';

        setTimeout(() => {
            cerrarModalSim();
            abrirPanelRC(codigo);   // recarga el panel con datos actualizados
        }, 1200);

    } catch (e) {
        st.style.color      = '#ef4444';
        st.style.background = '#fff5f5';
        st.textContent      = '❌ ' + e.message;
        console.error(e);
    }
}

// ── Solicitudes (perfil viewer → genera solicitud en BD) ───────────

// Escribe una fila en la tabla solicitudes con el usuario actual
async function enviarSolicitud(tipo, datos) {
    const s = JSON.parse(sessionStorage.getItem('session') || '{}');
    const { error } = await window.clienteSupabase.from('solicitudes').insert({
        tipo,
        datos,
        usuario: s.usuario || 'desconocido',
    });
    if (error) throw error;
}

// Solicita la desactivación de un RC (viewer)
async function solicitarDesactivacionRC(codigo) {
    if (!confirm(`¿Solicitar la desactivación de ${codigo}?\n\nSe enviará una solicitud al administrador.`)) return;
    const btns = document.querySelectorAll('#panelCuerpo .btn-panel');
    btns.forEach(b => { b.disabled = true; });
    try {
        await enviarSolicitud('desactivar_rc', { codigo });
        const actDiv = document.querySelector('#panelCuerpo .panel-actions');
        if (actDiv) actDiv.innerHTML =
            '<div style="color:#16a34a;font-size:13px;text-align:center;padding:10px;background:#f0fdf4;border-radius:8px">✅ Solicitud de desactivación enviada correctamente.</div>';
    } catch(e) {
        btns.forEach(b => { b.disabled = false; });
        alert('Error al enviar la solicitud: ' + e.message);
    }
}

// Abre el modal de carga de saldo (viewer y admin)
function solicitarCargaSaldo(numero) {
    document.getElementById('saldoNumero').value = numero || '';
    document.getElementById('saldoMonto').value  = '';
    document.getElementById('saldoObs').value    = '';
    const st = document.getElementById('saldoStatus');
    st.style.display = 'none'; st.textContent = '';
    document.getElementById('modalSaldo').style.display = 'flex';
}

function cerrarModalSaldo() {
    document.getElementById('modalSaldo').style.display = 'none';
}

function cerrarModalSaldoOverlay(e) {
    if (e.target === document.getElementById('modalSaldo')) cerrarModalSaldo();
}

async function ejecutarSolicitudSaldo() {
    const numero = document.getElementById('saldoNumero').value.trim();
    const monto  = parseFloat(document.getElementById('saldoMonto').value) || null;
    const obs    = document.getElementById('saldoObs').value.trim() || null;
    if (!monto || monto <= 0) { alert('Ingresá un monto válido.'); return; }

    const st = document.getElementById('saldoStatus');
    st.style.display = 'block';
    st.style.color   = '#35398C'; st.style.background = '#f0f2f8';
    st.textContent   = '⏳ Enviando solicitud...';

    try {
        await enviarSolicitud('carga_saldo', { numero, monto, observacion: obs });
        st.style.color = '#16a34a'; st.style.background = '#f0fdf4';
        st.textContent = '✅ Solicitud enviada correctamente.';
        setTimeout(() => cerrarModalSaldo(), 1800);
    } catch(e) {
        st.style.color = '#ef4444'; st.style.background = '#fff5f5';
        st.textContent = '❌ ' + e.message;
    }
}

// ── Marcar estado del RC (activo / desactivado) ────────────────────
async function marcarEstadoRC(codigo, estado) {
    const label = estado === 'activo' ? 'Activado' : 'Desactivado';
    if (!confirm(`¿Marcar ${codigo} como ${label}?`)) return;
    try {
        let estadoFinal = estado;
        let sim1_estado = undefined;
        let sim2_estado = undefined;

        if (estado === 'desactivado') {
            // Guardar como desactivado_manual para protegerlo del sync automático
            estadoFinal = 'desactivado_manual';

        } else if (estado === 'activo') {
            // Al activar: recalcular el estado real desde las SIMs
            const dev = todosLosDatos.find(d => d.codigo === codigo);
            if (dev) {
                const s1n = String(dev.sim1_num  || '').trim();
                const s1i = normalizarImei(dev.sim1_imei);
                const s2n = String(dev.sim2_num  || '').trim();
                const s2i = normalizarImei(dev.sim2_imei);
                sim1_estado = calcularSimEstadoDetallado(s1n, s1i);
                sim2_estado = calcularSimEstadoDetallado(s2n, s2i);
                estadoFinal = rcEstadoDesdeSimEstados(sim1_estado, sim2_estado) ?? 'activo';
            }
        }

        const update = { estado: estadoFinal };
        if (sim1_estado !== undefined) update.sim1_estado = sim1_estado;
        if (sim2_estado !== undefined) update.sim2_estado = sim2_estado;

        const { data: filaActualizada, error } = await window.clienteSupabase
            .from('dispositivos_ande')
            .update(update)
            .eq('codigo', codigo)
            .select();
        if (error) throw error;
        if (!filaActualizada || filaActualizada.length === 0) {
            throw new Error(
                `La BD no actualizó ningún registro.\n\n` +
                `Posibles causas:\n` +
                `• RLS (Row Level Security) bloqueando UPDATE en dispositivos_ande\n` +
                `• El código "${codigo}" no existe en la tabla`
            );
        }

        const idx = todosLosDatos.findIndex(d => d.codigo === codigo);
        if (idx >= 0) Object.assign(todosLosDatos[idx], filaActualizada[0]);

        alert(`✅ ${codigo} marcado como ${label}.`);
        cerrarPanel();
        mostrarDatos(datosFiltrados);
    } catch (e) {
        alert('❌ Error: ' + e.message);
        console.error(e);
    }
}

// ── Actualizar estados desde consumo ──────────────────────────────
// Recalcula el estado de todos los RCs según sus SIMs en consumo_sim
// y persiste los cambios en la BD. Se llama desde el botón "Actualizar".
async function actualizarEstados() {
    const btn = document.getElementById('btnActualizarEstados');
    const original = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Actualizando…'; }
    try {
        // 1. Recalcular y guardar en BD (respeta desactivados manuales)
        await sincronizarEstadosDispositivos(false);
        // 2. Recargar desde BD para mostrar exactamente lo que quedó guardado
        const freshData = await fetchTodos('dispositivos_ande', '*', 'regional', true);
        todosLosDatos = freshData;
        construirMapasDevice(freshData);
        // 3. Re-aplicar filtros y renderizar desde datos frescos
        aplicarFiltros();
    } catch (e) {
        alert('❌ Error al actualizar: ' + e.message);
        console.error(e);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = original; }
    }
}

// ══════════════════════════════════════════════════════════════════
// ── Recalcular estados post-import ───────────────────────────────
// Lógica por número:
//   • Para cada número del archivo, toma el registro con fecha más alta.
//   • Si ese registro es Personal + observacion "backup" → desactivado.
//   • Si consumo_mb = 0 → sin_consumo; sino → activo.
// Números de la misma telefonía que existen en la BD pero NO en el
// archivo → desactivado (líneas que se dieron de baja).
// ══════════════════════════════════════════════════════════════════
async function recalcularEstadosPostImport(filas) {
    if (!filas.length) return;

    const telefonia = filas.find(r => r.telefonia)?.telefonia || null;

    // 1. Por cada número/IMEI: encontrar el registro con la fecha más alta
    const maxPorNum  = new Map(); // numero → { fecha, isBackup, mb }
    const maxPorImei = new Map(); // imei   → { fecha, isBackup, mb }

    filas.forEach(r => {
        const n   = String(r.numero || '').trim();
        const i   = normalizarImei(r.imei);
        const f   = r.fecha_consumo || '';
        const bk  = r.telefonia === 'Personal' &&
                    String(r.observacion || '').toLowerCase().includes('backup');
        const mb  = parseFloat(r.consumo_mb) || 0;

        const update = (map, key) => {
            const prev = map.get(key);
            if (!prev || f > prev.fecha) map.set(key, { fecha: f, isBackup: bk, mb });
        };
        if (n) update(maxPorNum,  n);
        if (i) update(maxPorImei, i);
    });

    // 2. Determinar estado para cada número/IMEI del archivo
    const estadoNum  = new Map();
    const estadoImei = new Map();

    for (const [n, info] of maxPorNum)
        estadoNum.set(n,  info.isBackup ? 'desactivado' : info.mb === 0 ? 'sin_consumo' : 'activo');
    for (const [i, info] of maxPorImei)
        estadoImei.set(i, info.isBackup ? 'desactivado' : info.mb === 0 ? 'sin_consumo' : 'activo');

    // 3. Números de la misma telefonía en la BD que NO están en el archivo → desactivado
    if (telefonia && telefonia !== 'Desconocida') {
        const PAGE = 1000;
        let from = 0;
        while (true) {
            const { data, error } = await window.clienteSupabase
                .from('consumo_sim')
                .select('numero,imei')
                .eq('telefonia', telefonia)
                .range(from, from + PAGE - 1);
            if (error || !data?.length) break;
            data.forEach(r => {
                const n = String(r.numero || '').trim();
                const i = normalizarImei(r.imei);
                if (n && !estadoNum.has(n))  estadoNum.set(n,  'desactivado');
                if (i && !estadoImei.has(i)) estadoImei.set(i, 'desactivado');
            });
            if (data.length < PAGE) break;
            from += PAGE;
        }
    }

    // 4. Actualizar consumo_sim en bulk
    const CHUNK = 100;
    const byEst = (map, est) => [...map.entries()].filter(([,e]) => e === est).map(([k]) => k);
    const bulkUpdate = async (campo, lista, estado) => {
        // Al desactivar: sincronizar también estado_operador para que la vista lo refleje
        const payload = estado === 'desactivado'
            ? { estado, estado_operador: 'desactivado' }
            : { estado };
        for (let i = 0; i < lista.length; i += CHUNK)
            await window.clienteSupabase.from('consumo_sim')
                .update(payload).in(campo, lista.slice(i, i + CHUNK));
    };
    await Promise.all([
        bulkUpdate('numero', byEst(estadoNum,  'activo'),      'activo'),
        bulkUpdate('numero', byEst(estadoNum,  'sin_consumo'), 'sin_consumo'),
        bulkUpdate('numero', byEst(estadoNum,  'desactivado'), 'desactivado'),
        bulkUpdate('imei',   byEst(estadoImei, 'activo'),      'activo'),
        bulkUpdate('imei',   byEst(estadoImei, 'sin_consumo'), 'sin_consumo'),
        bulkUpdate('imei',   byEst(estadoImei, 'desactivado'), 'desactivado'),
    ]);

    // 5. Registrar en sim_estados (solo acepta 'activo'/'desactivado')
    const fechaMax = [...maxPorNum.values(), ...maxPorImei.values()]
        .map(v => v.fecha).filter(Boolean).sort().slice(-1)[0] || null;
    const ahora = new Date().toISOString();
    const histInserts = [];

    for (const [num, est] of estadoNum) {
        const estHist = est === 'sin_consumo' ? 'activo' : est;
        histInserts.push({ numero: num, estado: estHist, fecha_consumo: fechaMax,
                           usuario: rolActual || 'sistema', fecha_cambio: ahora });
        mapaNumAEstadoActual.set(num, estHist);
    }
    for (const [imei, est] of estadoImei) {
        const estHist = est === 'sin_consumo' ? 'activo' : est;
        histInserts.push({ imei, estado: estHist, fecha_consumo: fechaMax,
                           usuario: rolActual || 'sistema', fecha_cambio: ahora });
        mapaImeiAEstadoActual.set(imei, estHist);
    }
    for (let i = 0; i < histInserts.length; i += CHUNK)
        await window.clienteSupabase.from('sim_estados').insert(histInserts.slice(i, i + CHUNK));
    console.log(`📝 sim_estados: ${histInserts.length} registros`);

    // 6. Actualizar dispositivos_ande (respeta desactivado_manual)
    const { data: devices } = await window.clienteSupabase
        .from('dispositivos_ande')
        .select('codigo, tipo, estado, sim1_num, sim1_imei, sim2_num, sim2_imei, sim1_estado, sim2_estado');
    if (!devices?.length) return;

    const getSimEstImport = (num, imei) => {
        const n   = String(num || '').trim();
        const i   = normalizarImei(imei);
        const m2m = n.toLowerCase() === 'm2m';
        if ((!n || m2m) && !i) return 'nulo';
        const eN = (!m2m && n && estadoNum.has(n))  ? estadoNum.get(n)  : null;
        const eI = (i && estadoImei.has(i))          ? estadoImei.get(i) : null;
        if (!eN && !eI) return 'no_asignado';
        if (eN === 'desactivado' || eI === 'desactivado') return 'inactivo';
        if (eN === 'activo'      || eI === 'activo')      return 'activo';
        return 'sin_consumo';
    };

    const grupos = new Map();
    for (const dev of devices) {
        if ((dev.estado || '').toLowerCase() === 'desactivado_manual') continue;
        const s1n = String(dev.sim1_num || '').trim();
        const s1i = normalizarImei(dev.sim1_imei);
        const s2n = String(dev.sim2_num || '').trim();
        const s2i = normalizarImei(dev.sim2_imei);
        const s1e = getSimEstImport(s1n, s1i);
        const s2e = getSimEstImport(s2n, s2i);
        const rcNuevo     = rcEstadoDesdeSimEstados(s1e, s2e);
        const estadoFinal = rcNuevo ?? dev.estado ?? 'desactivado';
        if (estadoFinal !== dev.estado || s1e !== dev.sim1_estado || s2e !== dev.sim2_estado) {
            const key = `${estadoFinal}|${s1e}|${s2e}`;
            if (!grupos.has(key)) grupos.set(key, { estado: estadoFinal, sim1_estado: s1e, sim2_estado: s2e, codigos: [] });
            grupos.get(key).codigos.push(dev.codigo);
        }
    }
    for (const [, grp] of grupos)
        for (let i = 0; i < grp.codigos.length; i += CHUNK)
            await window.clienteSupabase.from('dispositivos_ande')
                .update({ estado: grp.estado, sim1_estado: grp.sim1_estado, sim2_estado: grp.sim2_estado })
                .in('codigo', grp.codigos.slice(i, i + CHUNK));
}

async function ejecutarImportConsumo() {
    if (!archivosCSVPendientes.length) {
        alert('Seleccioná al menos un archivo CSV primero.');
        return;
    }

    const modo     = document.querySelector('input[name="importConsumoMode"]:checked').value;
    const statusEl = document.getElementById('importConsumoStatus');
    statusEl.style.display = 'block';
    document.getElementById('progressFillConsumo').style.background = '';

    const total = archivosCSVPendientes.length;

    // Si modo reemplazar, limpiar tabla antes de cualquier archivo
    if (modo === 'replace') {
        setProgressConsumo(3, 'Eliminando consumos anteriores...');
        const { error } = await window.clienteSupabase.from('consumo_sim').delete().gte('id', 1);
        if (error) {
            setProgressConsumo(100, '❌ Error al limpiar: ' + error.message, '#ef4444');
            return;
        }
    }

    const todasLasFilas = [];   // para recalcular estados al final
    const BATCH = 200;

    for (let fi = 0; fi < total; fi++) {
        const file   = archivosCSVPendientes[fi];
        const tel    = detectarTelefonia(file.name);
        const chip   = document.getElementById(`file-status-${fi}`);

        if (chip) { chip.textContent = '⏳'; chip.className = 'file-item-status file-status-running'; }
        setProgressConsumo(
            5 + Math.round((fi / total) * 75),
            `Procesando ${fi + 1}/${total}: ${file.name}…`
        );

        try {
            // Leer texto del archivo
            const texto = await new Promise((res, rej) => {
                const r = new FileReader();
                r.onload = e => res(e.target.result);
                r.onerror = () => rej(new Error('Error al leer el archivo'));
                r.readAsText(file, 'UTF-8');
            });

            const filas = parsearCSVConsumo(texto, tel);
            if (!filas.length) throw new Error('Sin filas válidas');

            for (let i = 0; i < filas.length; i += BATCH) {
                const lote = filas.slice(i, i + BATCH);
                const { error } = await window.clienteSupabase.from('consumo_sim').insert(lote);
                if (error) throw new Error(`Lote ${Math.floor(i / BATCH) + 1}: ${error.message}`);

                const basePct  = 5 + Math.round((fi / total) * 75);
                const filePct  = Math.round(((i + lote.length) / filas.length) * (75 / total));
                setProgressConsumo(
                    Math.min(basePct + filePct, 78),
                    `${fi + 1}/${total} · subiendo ${i + lote.length}/${filas.length} filas…`
                );
            }

            todasLasFilas.push(...filas);
            if (chip) { chip.textContent = '✅'; chip.className = 'file-item-status file-status-done'; }

        } catch (err) {
            if (chip) { chip.textContent = '❌'; chip.className = 'file-item-status file-status-error'; }
            console.error(`❌ ${file.name}:`, err);
            // Continúa con los demás archivos
        }
    }

    if (!todasLasFilas.length) {
        setProgressConsumo(100, '❌ No se importó ningún registro válido.', '#ef4444');
        return;
    }

    setProgressConsumo(82, 'Calculando estados de líneas…');

    // Recalcular por telefonía para no mezclar grupos
    const porTel = {};
    todasLasFilas.forEach(r => {
        const t = r.telefonia || 'Desconocida';
        if (!porTel[t]) porTel[t] = [];
        porTel[t].push(r);
    });
    for (const filasT of Object.values(porTel)) {
        await recalcularEstadosPostImport(filasT);
    }

    setProgressConsumo(
        100,
        `✅ ${todasLasFilas.length} registros de ${total} archivo(s). Estados actualizados.`,
        '#22c55e'
    );

    // Limpiar filtros activos y actualizar vistas con todos los datos recién importados
    ['filtroTelefonia','filtroEstadoConsumo','filtroRCConsumo',
     'filtroNumConsumo','filtroFechaDesde','filtroFechaHasta','filtroObservacion',
     'filtroRCBuscar','filtroRCRegional']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

    _consumosTimestamp = 0; // invalidar caché post-import
    cargarEstadosSIM()
        .then(() => cargarConsumos(true))
        .then(() => window.clienteSupabase.rpc('refresh_consumo_consolidado').catch(() => {}))
        .then(() => cargarDatos())
        .catch(e => console.error('❌ post-import refresh:', e));

    // Cerrar modal después de mostrar el éxito
    setTimeout(cerrarImportConsumo, 2000);
}