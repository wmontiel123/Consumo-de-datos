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
    sessionStorage.removeItem('session');
    // Resetear estado
    rolActual = 'admin';
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
    if (chartConsumoLineas)   { chartConsumoLineas.destroy();   chartConsumoLineas = null; }
    if (chartConsumoEstados)  { chartConsumoEstados.destroy();  chartConsumoEstados = null; }
    if (chartPanelRC)  { chartPanelRC.destroy();  chartPanelRC  = null; }
    if (chartPanelSIM) { chartPanelSIM.destroy(); chartPanelSIM = null; }
    cerrarPanel();

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
        sessionStorage.setItem('session', JSON.stringify({ usuario, rol: user.rol }));
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

    // Ocultar columna Tipo y filtro Tipo (solo admin)
    document.getElementById('thTipo').style.display       = 'none';
    document.getElementById('filtroTipoGroup').style.display = 'none';

    // Actualizar labels de las tarjetas de estadísticas
    document.querySelector('.stat-activos h3').textContent    = 'Activados';
    document.querySelector('.stat-desactivados h3').textContent = 'Desactivados';
}

// Permitir Enter para hacer login + restaurar sesión si el tab sigue abierto
document.addEventListener('DOMContentLoaded', function() {
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
            if (USUARIOS[usuario] && USUARIOS[usuario].rol === rol) {
                rolActual = rol;
                document.getElementById('loginOverlay').style.display = 'none';
                document.getElementById('appPrincipal').style.display = 'block';
                aplicarRol();
                iniciarApp();
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
let chartConsumoHistorico, chartConsumoLineas, chartConsumoEstados;
let chartPanelRC  = null;
let chartPanelSIM = null;
let cambioSimActual = { codigo: null, slot: null };
let mapaLeaflet = null;
let markersLayer = null;
const COLORES = ['#35398C', '#DA527D', '#B44C80', '#904783', '#644087'];

// Consumo SIM
let todosLosConsumos     = [];
let consumosFiltrados    = [];   // datos para gráficos / consolidado (hasta 50 k filas)
let totalConsumoServidor = 0;    // total real en BD (para paginación)
let paginaConsumo        = 1;
let mapaNumAConsumo       = new Map();
let mapaImeiAConsumo      = new Map();
let mapaNumADevice        = new Map();
let mapaImeiADevice       = new Map();
let mapaNumAEstadoActual  = new Map(); // numero → estado actual (tabla sim_estados)
let mapaImeiAEstadoActual = new Map(); // imei   → estado actual (tabla sim_estados)
let telefoniaActual   = '';
let vistaConsumo      = 'lineas'; // 'lineas' | 'equipos'
let sortLineas        = { col: 'fecha', dir: 'desc' };
let sortEquipos       = { col: 'rc',    dir: 'asc'  };
let paginaEquipos     = 1;
let consolidadoActual = [];

// Trae TODOS los registros de una tabla paginando de a 1000 (límite de Supabase)
async function fetchTodos(tabla, columnas, orden, ascendente = true) {
    const LOTE = 1000;
    let desde = 0;
    let todos = [];
    while (true) {
        const { data, error } = await window.clienteSupabase
            .from(tabla)
            .select(columnas)
            .order(orden, { ascending: ascendente })
            .range(desde, desde + LOTE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        todos = todos.concat(data);
        if (data.length < LOTE) break;
        desde += LOTE;
    }
    return todos;
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

// Estado del dispositivo: viene directo de la DB (activo / sin_consumo / desactivado)
function calcularEstado(device) {
    const e = (device.estado || '').toLowerCase();
    if (e === 'desactivado') return 'desactivado';
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
        // En sincronización automática (startup / post-import) se respetan los desactivados
        // manuales: solo el botón "Actualizar Estados" puede volver a calcularlos.
        if (!forzarTodos && (dev.estado || '').toLowerCase() === 'desactivado') continue;

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

        // Cargar ambas tablas en paralelo (paginando para superar el límite de 1000)
        const [data, consumoData] = await Promise.all([
            fetchTodos('dispositivos_ande', '*', 'regional', true),
            fetchTodos('consumo_sim', 'numero,imei,observacion,estado_operador,consumo_mb,estado,fecha_consumo,telefonia', 'fecha_consumo', false)
                .catch(e => { console.warn('⚠️ No se pudo cargar consumo_sim:', e.message); return []; })
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

        // Cargar estados actuales desde sim_estados
        await cargarEstadosSIM();

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

        // Sincronizar estado de RCs según sus SIMs antes de mostrar
        await sincronizarEstadosDispositivos();

        mostrarDatos(todosLosDatos);

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
        tr.innerHTML = `
            <td>${badgeEstado(fila)}</td>
            <td><span class="badge-regional">${fila['regional'] || '-'}</span></td>
            <td>${fila['codigo'] ? `<span class="link-rc" onclick="abrirPanelRC('${fila['codigo']}')">${fila['codigo']}</span>` : '-'}</td>
            <td class="td-ubicacion">${fila['ubicacion'] || '-'}</td>
            <td>${simNumDisplay(fila['sim1_num'], i1)}</td>
            <td class="td-imei">${simImeiDisplay(fila['sim1_num'], fila['sim1_imei'])}</td>
            <td>${simNumDisplay(fila['sim2_num'], i2)}</td>
            <td class="td-imei">${simImeiDisplay(fila['sim2_num'], fila['sim2_imei'])}</td>
            <td>${formatearFecha(fila['fecha_activacion'])}</td>
            <td style="display:none">${tipoCfg ? `<span class="badge-tipo ${tipoCfg.cls}">${tipoCfg.label}</span>` : ''}</td>
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

// Estado para mostrar en el tab Consumo.
// Prioridad: tabla sim_estados (estado actual del número) →
//            registro más reciente en mapaNumAConsumo       →
//            campo estado de la propia fila (fallback legacy).
// Esto garantiza que todas las filas del mismo número muestren el mismo estado actual.
function estadoConsDisplay(consumo) {
    const num  = String(consumo.numero || '').trim();
    const imei = normalizarImei(consumo.imei);

    // 1. Fuente de verdad: sim_estados
    if (num  && mapaNumAEstadoActual.has(num))   return mapaNumAEstadoActual.get(num);
    if (imei && mapaImeiAEstadoActual.has(imei)) return mapaImeiAEstadoActual.get(imei);

    // 2. Fallback: estado del registro más reciente del número
    const latest = (num && num.toLowerCase() !== 'm2m' ? mapaNumAConsumo.get(num) : null)
                || (imei ? mapaImeiAConsumo.get(imei) : null);
    const src = latest || consumo;
    const est = (src.estado || 'activo').toLowerCase();
    if (est === 'sin_consumo' || est === 'legado' || est === 'error') return 'activo';
    return est;
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

    return { telefonia, estados, desde, hasta, numeros, imeis, num_like: num };
}

// Consulta server-side sobre consumo_sim (tabla paginada)
async function consultarConsumos(soloTabla = true) {
    const f = resolverFiltros();
    if (f === null) return { data: [], count: 0 };

    let query = window.clienteSupabase
        .from('consumo_sim')
        .select(soloTabla ? '*' : 'consumo_mb,fecha_consumo,telefonia,numero,imei,estado,observacion,estado_operador',
                { count: 'exact' });

    if (f.telefonia) query = query.eq('telefonia', f.telefonia);
    if (f.desde)     query = query.gte('fecha_consumo', f.desde);
    if (f.hasta)     query = query.lte('fecha_consumo', f.hasta);
    if (f.num_like)  query = query.or(`numero.ilike.%${f.num_like}%,imei.ilike.%${f.num_like}%`);
    if (f.estados)   query = f.estados.length > 1 ? query.in('estado', f.estados) : query.eq('estado', f.estados[0]);
    if (f.numeros !== null || f.imeis !== null) {
        const orParts = [
            ...(f.numeros || []).map(n => `numero.eq.${n}`),
            ...(f.imeis   || []).map(i => `imei.eq.${i}`),
        ];
        if (orParts.length) query = query.or(orParts.join(','));
    }

    if (soloTabla) {
        const from = (paginaConsumo - 1) * ITEMS_POR_PAGINA;
        query = query
            .order(dbColLineas(), { ascending: sortLineas.dir === 'asc' })
            .range(from, from + ITEMS_POR_PAGINA - 1);
    } else {
        query = query.order('fecha_consumo', { ascending: true }).limit(50000);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data || [], count: count || 0 };
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

async function cargarConsumos() {
    const loading = document.getElementById('loadingConsumo');
    loading.style.display = 'block';
    document.getElementById('tablaDatosConsumo').innerHTML = '';
    paginaConsumo = 1;
    paginaEquipos = 1;

    try {
        // 3 consultas en paralelo:
        // 1) página actual de la tabla
        // 2) resumen agregado para gráficos + total (via RPC, sin límite de filas)
        // 3) filas livianas para consolidado / exportar (hasta 50k)
        const [tablaRes, resumen, consolidadoRes] = await Promise.all([
            consultarConsumos(true),
            cargarResumenConsumo(),
            consultarConsumos(false),
        ]);

        loading.style.display = 'none';
        totalConsumoServidor = tablaRes.count;
        consumosFiltrados    = consolidadoRes.data;
        console.log(`✅ ${tablaRes.count} consumos en BD`);

        actualizarTotalConsumo(resumen.total_mb);
        crearGraficosConsumo(resumen);

        if (vistaConsumo === 'equipos') {
            mostrarConsolidado(consumosFiltrados);
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
            <td>${rc !== '-' ? `<span class="link-rc" onclick="abrirPanelRC('${rc}')">${rc}</span>` : '-'}</td>
            <td>${c.numero ? `${dot}<span class="link-num" onclick="abrirPanelSIM('${c.numero}')">${c.numero}</span>` : '-'}</td>
            <td class="td-imei">${normalizarImei(c.imei) || '-'}</td>
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

// Crea los 3 gráficos del tab de consumo a partir de datos pre-agregados (RPC)
function crearGraficosConsumo(resumen) {
    if (chartConsumoHistorico) chartConsumoHistorico.destroy();
    if (chartConsumoLineas)    chartConsumoLineas.destroy();
    if (chartConsumoEstados)   chartConsumoEstados.destroy();

    const historico = resumen?.historico  || [];
    const top15raw  = resumen?.top15      || [];
    const porEstDB  = resumen?.por_estado || [];

    if (!historico.length && !top15raw.length && !porEstDB.length) return;

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

    // ── 2. Top 15 líneas por MB ──────────────────────────────────────
    // clave = numero SIM; buscamos RC en el mapa de dispositivos para mostrar
    const clavesLineas  = top15raw.map(r => String(r.clave || ''));
    const labelsLineas  = top15raw.map(r => {
        const dev = mapaNumADevice.get(String(r.clave || '').trim());
        return dev ? (dev.codigo || r.clave) : (r.clave || 'Sin ID');
    });
    const valoresLineas = top15raw.map(r => parseFloat(r.total_mb || 0));
    const coloresLineas = labelsLineas.map((_, i) => COLORES[i % COLORES.length]);

    // Acción compartida al pulsar un label (barra o eje-Y)
    const _abrirLinea = (label, clave) => {
        if (!label || label === 'Sin ID') return;
        if (/[a-zA-Z_]/.test(label)) abrirPanelRC(label);
        else abrirPanelSIM(clave || label);
    };
    const _clickDblLineas = makeClickDblHandler(
        el => _abrirLinea(labelsLineas[el.index], clavesLineas[el.index]),
        el => {
            const label = labelsLineas[el.index];
            const clave = clavesLineas[el.index];
            if (!label || label === 'Sin ID') return;
            if (/[a-zA-Z_]/.test(label)) {
                document.getElementById('filtroRCConsumo').value  = label;
                document.getElementById('filtroNumConsumo').value = '';
            } else {
                document.getElementById('filtroRCConsumo').value  = '';
                document.getElementById('filtroNumConsumo').value = clave || label;
            }
            aplicarFiltrosConsumo();
        }
    );

    const ctxL = document.getElementById('chartConsumoLineas').getContext('2d');
    chartConsumoLineas = new Chart(ctxL, {
        type: 'bar',
        data: {
            labels: labelsLineas,
            datasets: [{ label: 'MB', data: valoresLineas, backgroundColor: coloresLineas, borderColor: coloresLineas, borderWidth: 2, borderRadius: 6 }]
        },
        options: {
            responsive: true, maintainAspectRatio: true, indexAxis: 'y',
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: c => formatearNumero(c.parsed.x) + ' MB' } }
            },
            scales: {
                x: { beginAtZero: true, ticks: { callback: v => formatearNumero(v) } },
                y: { ticks: { color: '#4f46e5', font: { size: 12 } } }
            },
            onClick: (event, elements, chart) => {
                if (elements.length) {
                    _clickDblLineas(event, elements);
                    return;
                }
                // Clic en etiqueta del eje-Y → abrir panel directamente
                const idx = _yAxisLabelIndex(event, chart);
                if (idx >= 0) _abrirLinea(labelsLineas[idx], clavesLineas[idx]);
            },
            onHover: (e, els, chart) => {
                if (els.length) { e.native.target.style.cursor = 'pointer'; return; }
                e.native.target.style.cursor = _yAxisLabelIndex(e, chart) >= 0 ? 'pointer' : 'default';
            }
        }
    });

    // ── 3. Estado de líneas (donut) ──────────────────────────────────
    const COLORES_ESTADO = { activo: '#16a34a', desactivado: '#dc2626', legado: '#7c3aed', error: '#ef4444' };

    // Fusionar sin_consumo → activo; filtrar según rol
    const estadoMerged = {};
    porEstDB.forEach(r => {
        const key = (r.estado === 'sin_consumo' || r.estado === 'legado') ? 'activo' : (r.estado || 'activo');
        if (esViewer() && !['activo','desactivado'].includes(key)) return;
        estadoMerged[key] = (estadoMerged[key] || 0) + parseInt(r.conteo || 0);
    });

    const cfgEstado    = esViewer() ? ESTADO_CONFIG_VIEWER : ESTADO_CONFIG_DISP;
    const estadoKeys   = Object.keys(estadoMerged);
    const estadoCounts = estadoKeys.map(k => estadoMerged[k]);
    const estadoColores = estadoKeys.map(k => COLORES_ESTADO[k] || '#6b7280');
    const estadoLabels  = estadoKeys.map(k => (cfgEstado[k]?.label || k).replace('● ', ''));

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
                document.getElementById('filtroEstadoConsumo').value = labelToEstadoKey[estadoLabels[el.index]] || '';
                aplicarFiltrosConsumo();
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
        consultarConsumos(true).then(({ data, count }) => {
            totalConsumoServidor = count;
            mostrarEnTablaConsumo(data, count);
        }).catch(e => console.error('❌', e));
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

async function aplicarFiltrosConsumo() {
    paginaConsumo = 1;
    paginaEquipos = 1;
    const loading = document.getElementById('loadingConsumo');
    loading.style.display = 'block';
    try {
        const [tablaRes, resumen, consolidadoRes] = await Promise.all([
            consultarConsumos(true),
            cargarResumenConsumo(),
            consultarConsumos(false),
        ]);
        loading.style.display = 'none';
        totalConsumoServidor = tablaRes.count;
        consumosFiltrados    = consolidadoRes.data;

        actualizarTotalConsumo(resumen.total_mb);
        crearGraficosConsumo(resumen);

        if (vistaConsumo === 'equipos') {
            mostrarConsolidado(consumosFiltrados);
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
    cargarConsumos();
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

// Ir al tab Consumo con ese número filtrado
function irAConsumoFiltrado(numero) {
    cerrarPanel();
    document.getElementById('filtroNumConsumo').value = numero;
    document.getElementById('filtroRCConsumo').value  = '';
    cambiarTab('consumo');
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
            <div class="panel-section">
                <div class="panel-section-title">Acciones</div>
                <div class="panel-actions">
                    <button class="btn-panel btn-panel-cambiar" onclick="abrirCambiarSIM('${safeCode}','sim1')">🔄 Cambiar SIM 1</button>
                    ${hasSim2 ? `<button class="btn-panel btn-panel-cambiar" onclick="abrirCambiarSIM('${safeCode}','sim2')">🔄 Cambiar SIM 2</button>` : ''}
                    <button class="btn-panel btn-panel-saldo" onclick="void 0">💳 Cargar Saldo</button>
                    <button class="btn-panel btn-panel-activar"    onclick="marcarEstadoRC('${safeCode}','activo')">🟢 Marcar Activado</button>
                    <button class="btn-panel btn-panel-desactivar" onclick="marcarEstadoRC('${safeCode}','desactivado')">🔴 Marcar Desactivado</button>
                </div>
            </div>

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
    titulo.innerHTML = `<span class="panel-titulo-link" onclick="irAConsumoFiltrado('${id}')" title="Ver en Consumo →">📱 ${id}</span>`;
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
                    .limit(100)
                : Promise.resolve({ data: [] }),
        ]);
        if (error) throw error;

        const consumoData = rows || [];
        const totalMB     = consumoData.reduce((s, c) => s + (parseFloat(c.consumo_mb) || 0), 0);
        const telefonia   = consumoData.find(c => c.telefonia)?.telefonia || null;
        const estadoRows  = histEstados || [];

        // Render del historial de estados
        const renderHistEstados = () => {
            if (!estadoRows.length) return '<div class="panel-empty">Sin historial registrado</div>';
            return `<table class="sim-hist-table">
                <thead><tr>
                    <th>Estado</th><th>Periodo</th><th>Registrado</th><th>Usuario</th>
                </tr></thead>
                <tbody>${estadoRows.map(r => {
                    const cls = r.estado === 'desactivado' ? 'badge-desactivado' : 'badge-activo';
                    const lbl = r.estado === 'desactivado' ? '● Desactivado'     : '● Activado';
                    return `<tr>
                        <td><span class="badge-estado ${cls}" style="font-size:11px;padding:2px 8px">${lbl}</span></td>
                        <td>${formatearFecha(r.fecha_consumo) || '-'}</td>
                        <td>${formatearFecha(r.fecha_cambio)  || '-'}</td>
                        <td style="color:#64748b">${r.usuario || 'sistema'}</td>
                    </tr>`;
                }).join('')}</tbody>
            </table>`;
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
                    <button class="btn-panel btn-panel-saldo" onclick="void 0">💳 Cargar Saldo</button>
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
        : `${dot}<span class="panel-sim-numero"${txtColor ? ` style="color:${txtColor}"` : ''} onclick="irAConsumoFiltrado('${num}')" title="Ver consumo →">${num}</span>`;

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

    document.getElementById('modalSimTitulo').innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
        Cambiar ${slotLabel} — ${codigo}`;

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

// ── Marcar estado del RC (activo / desactivado) ────────────────────
async function marcarEstadoRC(codigo, estado) {
    const label = estado === 'activo' ? 'Activado' : 'Desactivado';
    if (!confirm(`¿Marcar ${codigo} como ${label}?`)) return;
    try {
        const { error } = await window.clienteSupabase
            .from('dispositivos_ande')
            .update({ estado })
            .eq('codigo', codigo);
        if (error) throw error;
        const idx = todosLosDatos.findIndex(d => d.codigo === codigo);
        if (idx >= 0) todosLosDatos[idx].estado = estado;
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
// Compara la fecha más alta del lote importado contra la fecha
// anterior en la BD y actualiza consumo_sim + dispositivos_ande.
// ══════════════════════════════════════════════════════════════════
async function recalcularEstadosPostImport(filas) {
    // 1. fechaMax del lote
    const fechasImport = filas.map(r => r.fecha_consumo).filter(Boolean).sort();
    if (!fechasImport.length) return;
    const fechaMax = fechasImport[fechasImport.length - 1];

    // 2. Conjuntos de números/IMEIs presentes en fechaMax
    const rowsMax   = filas.filter(r => r.fecha_consumo === fechaMax);
    const numEnMax  = new Set(rowsMax.map(r => String(r.numero  || '').trim()).filter(Boolean));
    const imeiEnMax = new Set(rowsMax.map(r => normalizarImei(r.imei)).filter(Boolean));

    // Personal backup → quitar del conjunto "activo"
    const backupNums = new Set(
        rowsMax
            .filter(r => r.telefonia === 'Personal' &&
                         String(r.observacion || '').toLowerCase().includes('backup'))
            .map(r => String(r.numero || '').trim())
            .filter(Boolean)
    );
    backupNums.forEach(n => numEnMax.delete(n));

    // Mapa global de estado por número / IMEI
    // 'activo' > 'sin_consumo' > 'desactivado' (desactivado siempre gana, activo gana sobre sin_consumo)
    const estadoNum  = new Map(); // numero  → 'activo' | 'sin_consumo' | 'desactivado'
    const estadoImei = new Map(); // imei    → 'activo' | 'sin_consumo' | 'desactivado'
    const _setEst = (map, key, est) => {
        const prev = map.get(key);
        if (!prev)                              { map.set(key, est); return; }
        if (est === 'desactivado')              { map.set(key, est); return; }
        if (prev === 'desactivado')             return;  // desactivado no se pisa
        if (est === 'activo')                   { map.set(key, est); return; }
        // est === 'sin_consumo' y prev es 'activo' → no pisar
    };
    rowsMax.forEach(r => {
        const n   = String(r.numero || '').trim();
        const i   = normalizarImei(r.imei);
        const mb  = parseFloat(r.consumo_mb) || 0;
        const est = (n && backupNums.has(n)) ? 'desactivado'
                  : mb === 0                  ? 'sin_consumo'
                  : 'activo';
        if (n) _setEst(estadoNum,  n, est);
        if (i) _setEst(estadoImei, i, est);
    });

    // 3. fechaAnterior = fecha más alta en la BD antes de fechaMax
    const { data: prevD } = await window.clienteSupabase
        .from('consumo_sim')
        .select('fecha_consumo')
        .lt('fecha_consumo', fechaMax)
        .order('fecha_consumo', { ascending: false })
        .limit(1);
    const fechaAnterior = prevD?.[0]?.fecha_consumo || null;

    if (fechaAnterior) {
        // 4. Traer números/IMEIs de fechaAnterior (con paginación)
        let anteriorRows = [];
        let from = 0;
        const PAGE = 1000;
        while (true) {
            const { data, error } = await window.clienteSupabase
                .from('consumo_sim')
                .select('numero, imei')
                .eq('fecha_consumo', fechaAnterior)
                .range(from, from + PAGE - 1);
            if (error || !data?.length) break;
            anteriorRows = anteriorRows.concat(data);
            if (data.length < PAGE) break;
            from += PAGE;
        }

        // Números que estaban en fechaAnterior pero NO en fechaMax → desactivado
        const numDesact = [...new Set(
            anteriorRows
                .map(r => String(r.numero || '').trim())
                .filter(n => n && !numEnMax.has(n) && !backupNums.has(n))
        )];
        const imeiDesact = [...new Set(
            anteriorRows
                .map(r => normalizarImei(r.imei))
                .filter(i => i && !imeiEnMax.has(i))
        )];

        numDesact.forEach(n  => estadoNum.set(n,  'desactivado'));
        imeiDesact.forEach(i => estadoImei.set(i, 'desactivado'));
    }

    // 5. Actualizar TODAS las ocurrencias de cada número/IMEI en consumo_sim
    const byEst = (map, est) => [...map.entries()].filter(([,e]) => e === est).map(([k]) => k);
    const numActivos    = byEst(estadoNum,  'activo');
    const numSinCons    = byEst(estadoNum,  'sin_consumo');
    const numDesactAll  = byEst(estadoNum,  'desactivado');
    const imeiActivos   = byEst(estadoImei, 'activo');
    const imeiSinCons   = byEst(estadoImei, 'sin_consumo');
    const imeiDesactAll = byEst(estadoImei, 'desactivado');

    const CHUNK = 100;
    const bulkUpdate = async (campo, lista, estado) => {
        for (let i = 0; i < lista.length; i += CHUNK) {
            await window.clienteSupabase.from('consumo_sim')
                .update({ estado })
                .in(campo, lista.slice(i, i + CHUNK));
        }
    };
    await bulkUpdate('numero', numActivos,   'activo');
    await bulkUpdate('numero', numSinCons,   'sin_consumo');
    await bulkUpdate('numero', numDesactAll, 'desactivado');
    await bulkUpdate('imei',   imeiActivos,   'activo');
    await bulkUpdate('imei',   imeiSinCons,   'sin_consumo');
    await bulkUpdate('imei',   imeiDesactAll, 'desactivado');

    // 6. Registrar en sim_estados (historial; solo acepta 'activo'/'desactivado')
    //    sin_consumo se persiste como 'activo' (el SIM está habilitado, solo sin MB)
    const ahora = new Date().toISOString();
    const histInserts = [];
    for (const [num, est] of estadoNum.entries()) {
        const estHist = est === 'sin_consumo' ? 'activo' : est;
        histInserts.push({
            numero: num,
            estado: estHist,
            fecha_consumo: fechaMax,
            usuario: rolActual || 'sistema',
            fecha_cambio: ahora,
        });
        mapaNumAEstadoActual.set(num, estHist); // actualizar mapa en memoria
    }
    for (const [imei, est] of estadoImei.entries()) {
        const estHist = est === 'sin_consumo' ? 'activo' : est;
        histInserts.push({
            imei,
            estado: estHist,
            fecha_consumo: fechaMax,
            usuario: rolActual || 'sistema',
            fecha_cambio: ahora,
        });
        mapaImeiAEstadoActual.set(imei, estHist); // actualizar mapa en memoria
    }
    for (let i = 0; i < histInserts.length; i += CHUNK) {
        await window.clienteSupabase.from('sim_estados').insert(histInserts.slice(i, i + CHUNK));
    }
    console.log(`📝 sim_estados: ${histInserts.length} registros insertados`);

    // 7. Actualizar dispositivos_ande (estado RC + sim1_estado / sim2_estado)
    const { data: devices } = await window.clienteSupabase
        .from('dispositivos_ande')
        .select('codigo, tipo, estado, sim1_num, sim1_imei, sim2_num, sim2_imei, sim1_estado, sim2_estado');
    if (!devices?.length) return;

    // Estado detallado de un slot usando los mapas del lote importado (num+imei como conjunto)
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
        return 'sin_consumo';  // todos los encontrados tienen 0 MB
    };

    const grupos = new Map();
    const addGrupo = (codigo, estado, s1e, s2e) => {
        const key = `${estado}|${s1e}|${s2e}`;
        if (!grupos.has(key)) grupos.set(key, { estado, sim1_estado: s1e, sim2_estado: s2e, codigos: [] });
        grupos.get(key).codigos.push(codigo);
    };

    for (const dev of devices) {
        const s1n = String(dev.sim1_num || '').trim();
        const s1i = normalizarImei(dev.sim1_imei);
        const s2n = String(dev.sim2_num || '').trim();
        const s2i = normalizarImei(dev.sim2_imei);
        const isSatelital = (dev.tipo || '').trim().toLowerCase() === 'satelital';

        const s1e = getSimEstImport(s1n, s1i);
        const s2e = getSimEstImport(s2n, s2i);

        const rcNuevo     = rcEstadoDesdeSimEstados(s1e, s2e);
        const estadoFinal = rcNuevo ?? dev.estado ?? 'desactivado';

        if (estadoFinal !== dev.estado || s1e !== dev.sim1_estado || s2e !== dev.sim2_estado) {
            addGrupo(dev.codigo, estadoFinal, s1e, s2e);
        }
    }

    for (const [, grp] of grupos) {
        for (let i = 0; i < grp.codigos.length; i += CHUNK) {
            await window.clienteSupabase.from('dispositivos_ande')
                .update({ estado: grp.estado, sim1_estado: grp.sim1_estado, sim2_estado: grp.sim2_estado })
                .in('codigo', grp.codigos.slice(i, i + CHUNK));
        }
    }
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
            const inicio = modo === 'replace' ? 25 : 15;
            const rango  = modo === 'replace' ? 55 : 65; // sube hasta ~80%

            for (let i = 0; i < filas.length; i += BATCH) {
                const lote = filas.slice(i, i + BATCH);
                const { error } = await window.clienteSupabase
                    .from('consumo_sim')
                    .insert(lote);
                if (error) throw new Error(`Error en lote ${Math.floor(i / BATCH) + 1}: ${error.message}`);

                const pct = inicio + Math.round(((i + lote.length) / filas.length) * rango);
                setProgressConsumo(pct, `Subiendo... ${i + lote.length} / ${filas.length} registros`);
            }

            setProgressConsumo(82, 'Calculando estados de líneas...');
            await recalcularEstadosPostImport(filas);

            setProgressConsumo(100, `✅ ${filas.length} registros importados. Estados actualizados.`, '#22c55e');

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