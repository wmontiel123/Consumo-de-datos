// Configuración de Supabase
const SUPABASE_URL = 'https://rnnsvvujedwcvcjyyajm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJubnN2dnVqZWR3Y3Zjanl5YWptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4MjM2NjcsImV4cCI6MjA4NDM5OTY2N30.VhmUP-tal_iMwmJU_MDDAploV5sDqkzgbi9E2hyCqZc';

// Variables globales
let todosLosDatos = [];
let datosFiltrados = [];
let chartBarras, chartLineas, chartTorta;
const COLORES = ['#35398C', '#DA527D', '#B44C80', '#904783', '#644087'];

// Esperar a que se cargue todo
window.addEventListener('load', function() {
    console.log('🚀 Iniciando aplicación...');
    
    // Verificar que Supabase esté cargado
    if (typeof window.supabase === 'undefined') {
        document.getElementById('loading').innerHTML = '❌ Error: La librería de Supabase no se cargó correctamente.<br>Recarga la página.';
        console.error('Supabase no está definido');
        return;
    }
    
    console.log('✅ Supabase cargado correctamente');
    iniciarApp();
});

// Iniciar la aplicación
async function iniciarApp() {
    try {
        // Crear cliente de Supabase
        console.log('📡 Creando cliente Supabase...');
        const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        console.log('✅ Cliente creado');
        
        // Guardar globalmente
        window.clienteSupabase = supabase;
        
        // Cargar datos
        await cargarDatos();
        
    } catch (error) {
        console.error('❌ Error al iniciar:', error);
        document.getElementById('loading').innerHTML = `❌ Error: ${error.message}`;
    }
}

// Cargar datos de Supabase
async function cargarDatos() {
    const loading = document.getElementById('loading');
    
    try {
        console.log('📊 Consultando base de datos...');
        loading.textContent = 'Conectando con la base de datos...';
        loading.style.display = 'block';
        
        const { data, error } = await window.clienteSupabase
            .from('consumo_datos')
            .select('*')
            .order('Fecha de consumo', { ascending: false });
        
        console.log('Respuesta de Supabase:', { data, error });
        
        if (error) {
            console.error('❌ Error de Supabase:', error);
            loading.innerHTML = `
                ❌ Error al cargar datos de Supabase:<br><br>
                <strong>Código:</strong> ${error.code}<br>
                <strong>Mensaje:</strong> ${error.message}<br><br>
                ${error.code === 'PGRST116' ? '⚠️ La tabla "consumo_datos" no existe o el nombre está mal escrito.' : ''}
                ${error.message.includes('permission') || error.code === '42501' ? 
                    '⚠️ <strong>Problema de permisos:</strong><br>Ve a Supabase Dashboard → Authentication → Policies<br>y crea una política de lectura pública para la tabla "consumo_datos".' : ''}
            `;
            return;
        }
        
        if (!data || data.length === 0) {
            console.warn('⚠️ No hay datos en la tabla');
            loading.style.display = 'none';
            document.getElementById('tablaDatos').innerHTML = 
                '<tr><td colspan="4" style="text-align:center; padding: 40px;">No hay datos en la base de datos.<br>Ve a Supabase → Table Editor para agregar datos.</td></tr>';
            return;
        }
        
        console.log(`✅ ${data.length} registros cargados exitosamente`);
        loading.style.display = 'none';
        
        // Guardar y mostrar datos
        todosLosDatos = data;
        datosFiltrados = data;
        mostrarDatos(data);
        
    } catch (error) {
        console.error('❌ Error crítico:', error);
        loading.innerHTML = `❌ Error crítico: ${error.message}<br><br>Abre la consola (F12) para más detalles.`;
    }
}

// Mostrar todos los datos
function mostrarDatos(datos) {
    console.log(`📋 Mostrando ${datos.length} registros`);
    mostrarEnTabla(datos);
    actualizarEstadisticas(datos);
    crearGraficos(datos);
}

// Mostrar datos en la tabla
function mostrarEnTabla(datos) {
    const tbody = document.getElementById('tablaDatos');
    tbody.innerHTML = '';
    
    if (datos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 40px;">No se encontraron resultados con esos filtros.</td></tr>';
        return;
    }
    
    datos.forEach(fila => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${fila['Número'] || '-'}</td>
            <td>${formatearNumero(fila['Consumo (KB)'])} KB</td>
            <td>${formatearFecha(fila['Fecha de consumo'])}</td>
            <td>${formatearFecha(fila['Fecha de consulta'])}</td>
        `;
        tbody.appendChild(tr);
    });
    
    console.log('✅ Tabla actualizada');
}

// Actualizar estadísticas
function actualizarEstadisticas(datos) {
    const total = datos.length;
    const consumoTotal = datos.reduce((sum, item) => sum + (parseFloat(item['Consumo (KB)']) || 0), 0);
    const consumoPromedio = total > 0 ? consumoTotal / total : 0;
    
    document.getElementById('totalRegistros').textContent = formatearNumero(total);
    document.getElementById('consumoTotal').textContent = formatearNumero(consumoTotal) + ' KB';
    document.getElementById('consumoPromedio').textContent = formatearNumero(consumoPromedio.toFixed(2)) + ' KB';
}

// Crear los 3 gráficos
function crearGraficos(datos) {
    if (datos.length === 0) {
        if (chartBarras) chartBarras.destroy();
        if (chartLineas) chartLineas.destroy();
        if (chartTorta) chartTorta.destroy();
        return;
    }
    
    // Datos agrupados por número
    const datosPorNumero = {};
    datos.forEach(item => {
        const numero = item['Número'] || 'Sin número';
        const consumo = parseFloat(item['Consumo (KB)']) || 0;
        datosPorNumero[numero] = (datosPorNumero[numero] || 0) + consumo;
    });
    
    const numeros = Object.keys(datosPorNumero);
    const consumos = Object.values(datosPorNumero);
    const coloresGrafico = numeros.map((_, i) => COLORES[i % COLORES.length]);
    
    // Gráfico de Barras
    if (chartBarras) chartBarras.destroy();
    const ctxBarras = document.getElementById('chartBarras').getContext('2d');
    chartBarras = new Chart(ctxBarras, {
        type: 'bar',
        data: {
            labels: numeros,
            datasets: [{
                label: 'Consumo Total (KB)',
                data: consumos,
                backgroundColor: coloresGrafico,
                borderColor: coloresGrafico,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => 'Consumo: ' + formatearNumero(context.parsed.y) + ' KB'
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: (value) => formatearNumero(value) + ' KB'
                    }
                }
            }
        }
    });
    
    // Datos agrupados por fecha
    const datosPorFecha = {};
    datos.forEach(item => {
        const fecha = item['Fecha de consumo'] || 'Sin fecha';
        const consumo = parseFloat(item['Consumo (KB)']) || 0;
        datosPorFecha[fecha] = (datosPorFecha[fecha] || 0) + consumo;
    });
    
    const fechasOrdenadas = Object.keys(datosPorFecha).sort();
    const consumosPorFecha = fechasOrdenadas.map(f => datosPorFecha[f]);
    
    // Gráfico de Líneas
    if (chartLineas) chartLineas.destroy();
    const ctxLineas = document.getElementById('chartLineas').getContext('2d');
    chartLineas = new Chart(ctxLineas, {
        type: 'line',
        data: {
            labels: fechasOrdenadas.map(f => formatearFecha(f)),
            datasets: [{
                label: 'Consumo por Fecha (KB)',
                data: consumosPorFecha,
                borderColor: '#35398C',
                backgroundColor: 'rgba(53, 57, 140, 0.1)',
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
                tooltip: {
                    callbacks: {
                        label: (context) => 'Consumo: ' + formatearNumero(context.parsed.y) + ' KB'
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: (value) => formatearNumero(value) + ' KB'
                    }
                }
            }
        }
    });
    
    // Gráfico de Torta
    if (chartTorta) chartTorta.destroy();
    const ctxTorta = document.getElementById('chartTorta').getContext('2d');
    chartTorta = new Chart(ctxTorta, {
        type: 'pie',
        data: {
            labels: numeros,
            datasets: [{
                data: consumos,
                backgroundColor: coloresGrafico,
                borderColor: '#fff',
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 15,
                        font: { size: 12 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1);
                            return label + ': ' + formatearNumero(value) + ' KB (' + percentage + '%)';
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
    const numero = document.getElementById('filtroNumero').value.trim().toLowerCase();
    const fechaConsumo = document.getElementById('filtroFechaConsumo').value;
    const fechaConsulta = document.getElementById('filtroFechaConsulta').value;
    
    datosFiltrados = todosLosDatos.filter(item => {
        let cumple = true;
        
        if (numero && !String(item['Número']).toLowerCase().includes(numero)) {
            cumple = false;
        }
        
        if (fechaConsumo && item['Fecha de consumo'] !== fechaConsumo) {
            cumple = false;
        }
        
        if (fechaConsulta && item['Fecha de consulta'] !== fechaConsulta) {
            cumple = false;
        }
        
        return cumple;
    });
    
    console.log(`🔍 Filtros aplicados: ${datosFiltrados.length} resultados`);
    mostrarDatos(datosFiltrados);
}

// Limpiar filtros
function limpiarFiltros() {
    document.getElementById('filtroNumero').value = '';
    document.getElementById('filtroFechaConsumo').value = '';
    document.getElementById('filtroFechaConsulta').value = '';
    
    datosFiltrados = todosLosDatos;
    mostrarDatos(datosFiltrados);
    console.log('🧹 Filtros limpiados');
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