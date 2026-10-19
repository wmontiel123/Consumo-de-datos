"""
Importa los CSV de consumo de una carpeta (y todas sus subcarpetas) a la tabla
consumo_sim de Supabase, sin insertar duplicados.

Replica la lógica del import de la app (app.js → parsearCSVConsumo /
ejecutarImportConsumo / recalcularEstadosPostImport):
  - CSV sin encabezado: numero, imei, estado_operador, consumo_mb, fecha, [observacion]
  - Telefonía detectada por nombre de archivo o carpeta (personal/claro/tigo/vox/m2m)
  - Consumos negativos (reinicio del ciclo de facturación, reportes M2M) se
    recalculan o estiman; ver corregir_negativos().
  - Después del insert recalcula estados (consumo_sim, sim_estados) y refresca
    consumo_consolidado. El estado de dispositivos_ande lo sincroniza la app sola
    al abrirse (o con el botón "Actualizar estados").

Duplicado = misma telefonía + misma línea + misma fecha_consumo, donde la línea es
el número (o el IMEI/ICCID si el número es "M2M" o está vacío). Se controla contra
la BD y también entre los propios archivos.

Uso:
    py importar_consumos.py "C:\\ruta\\carpeta"              # simulación (no escribe nada)
    py importar_consumos.py "C:\\ruta\\carpeta" --ejecutar   # inserta en la BD
"""
import argparse
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from statistics import median

import requests

SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://rnnsvvujedwcvcjyyajm.supabase.co')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJubnN2dnVqZWR3Y3Zjanl5YWptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4MjM2NjcsImV4cCI6MjA4NDM5OTY2N30.VhmUP-tal_iMwmJU_MDDAploV5sDqkzgbi9E2hyCqZc')
REST = f'{SUPABASE_URL}/rest/v1'
HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
}

BATCH_INSERT = 500
CHUNK = 100
PAGE = 1000

sesion = requests.Session()
sesion.headers.update(HEADERS)


# ── Utilidades ───────────────────────────────────────────────────

def normalizar_imei(val):
    if not val:
        return ''
    s = str(val).strip()
    if re.fullmatch(r'[\d.]+[eE][+\-]?\d+', s):
        try:
            return str(round(float(s)))
        except ValueError:
            pass
    return s


def es_m2m(numero):
    return (numero or '').strip().lower() == 'm2m'


def clave_linea(numero, imei):
    """Identifica la línea: número, salvo M2M/vacío que usan el IMEI (ICCID)."""
    n = (numero or '').strip()
    if n and not es_m2m(n):
        return 'N:' + n
    i = normalizar_imei(imei)
    return 'I:' + i if i else None


def detectar_telefonia(ruta, m2m_telefonia):
    texto = ' '.join(ruta.parts[-3:]).lower()   # archivo + carpetas padre
    if 'm2m' in texto:
        return m2m_telefonia
    for clave, tel in (('personal', 'Personal'), ('claro', 'Claro'), ('tigo', 'Tigo'), ('vox', 'Vox')):
        if clave in texto:
            return tel
    return None


def parsear_fecha(raw):
    if not raw:
        return None
    m = re.fullmatch(r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})', raw)
    if m:
        return f'{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}'
    m = re.fullmatch(r'(\d{1,2})[-/](\d{1,2})[-/](\d{4})', raw)
    if m:
        return f'{m[3]}-{int(m[2]):02d}-{int(m[1]):02d}'
    return None


def leer_texto(ruta):
    datos = ruta.read_bytes()
    for enc in ('utf-8-sig', 'cp1252', 'latin-1'):
        try:
            return datos.decode(enc)
        except UnicodeDecodeError:
            continue
    return datos.decode('latin-1', errors='replace')


def parsear_csv(ruta, telefonia):
    lineas = [l.strip() for l in leer_texto(ruta).splitlines() if l.strip()]
    if not lineas:
        return []
    sep = ',' if lineas[0].count(',') > lineas[0].count(';') else ';'
    registros = []
    for linea in lineas:
        cols = [c.strip() for c in linea.split(sep)]
        if len(cols) < 4:
            continue
        cols += [''] * (6 - len(cols))
        numero, imei_raw, estado_op, mb_raw, fecha_raw, obs = cols[:6]
        imei = normalizar_imei(imei_raw)
        if not numero and not imei:
            continue
        try:
            consumo_mb = float(mb_raw) if mb_raw != '' else None
        except ValueError:
            consumo_mb = None
        if consumo_mb is not None and consumo_mb.is_integer():
            consumo_mb = int(consumo_mb)
        estado = 'desactivado' if telefonia == 'Personal' and 'backup' in obs.lower() else 'activo'
        registros.append({
            'numero': numero or None,
            'imei': imei or None,
            'estado_operador': estado_op or None,
            'consumo_mb': consumo_mb,
            'fecha_consumo': parsear_fecha(fecha_raw),
            'observacion': obs or None,
            'telefonia': telefonia,
            'estado': estado,
        })
    return registros


# ── Acceso a Supabase (PostgREST) ────────────────────────────────

def _check(resp, que):
    if resp.status_code >= 300:
        raise RuntimeError(f'{que}: HTTP {resp.status_code} {resp.text[:300]}')
    return resp


def obtener_todos(tabla, params):
    filas, desde = [], 0
    while True:
        r = _check(sesion.get(f'{REST}/{tabla}', params=params,
                              headers={'Range': f'{desde}-{desde + PAGE - 1}'}), f'GET {tabla}')
        lote = r.json()
        filas.extend(lote)
        if len(lote) < PAGE:
            return filas
        desde += PAGE


def insertar(tabla, filas):
    for i in range(0, len(filas), BATCH_INSERT):
        _check(sesion.post(f'{REST}/{tabla}', json=filas[i:i + BATCH_INSERT],
                           headers={'Prefer': 'return=minimal'}), f'INSERT {tabla}')


def lista_in(valores):
    return 'in.(' + ','.join('"' + v.replace('"', '') + '"' for v in valores) + ')'


def actualizar_in(tabla, campo, valores, payload):
    valores = list(valores)
    for i in range(0, len(valores), CHUNK):
        _check(sesion.patch(f'{REST}/{tabla}', params={campo: lista_in(valores[i:i + CHUNK])},
                            json=payload, headers={'Prefer': 'return=minimal'}), f'UPDATE {tabla}')


# ── Duplicados ───────────────────────────────────────────────────

def claves_existentes(telefonia, fecha_min, fecha_max):
    filas = obtener_todos('consumo_sim', {
        'select': 'numero,imei,fecha_consumo',
        'telefonia': f'eq.{telefonia}',
        'and': f'(fecha_consumo.gte.{fecha_min},fecha_consumo.lte.{fecha_max})',
        'order': 'id.asc',
    })
    claves = set()
    for f in filas:
        cl = clave_linea(f.get('numero'), f.get('imei'))
        if cl:
            claves.add((telefonia, cl, f.get('fecha_consumo')))
    return claves


# ── Recalcular estados (igual que recalcularEstadosPostImport) ───

def recalcular_estados(filas, telefonia, grupo_m2m):
    """filas: todas las filas leídas de esa telefonía/grupo (nuevas y ya existentes)."""
    max_num, max_imei = {}, {}
    for r in filas:
        n = (r['numero'] or '').strip()
        i = normalizar_imei(r['imei'])
        f = r['fecha_consumo'] or ''
        info = {
            'fecha': f,
            'backup': r['telefonia'] == 'Personal' and 'backup' in (r['observacion'] or '').lower(),
            'mb': float(r['consumo_mb'] or 0),
        }
        if n and (n not in max_num or f > max_num[n]['fecha']):
            max_num[n] = info
        if i and (i not in max_imei or f > max_imei[i]['fecha']):
            max_imei[i] = info

    est = lambda inf: 'desactivado' if inf['backup'] else ('sin_consumo' if inf['mb'] == 0 else 'activo')
    estado_num = {k: est(v) for k, v in max_num.items()}
    estado_imei = {k: est(v) for k, v in max_imei.items()}

    # Líneas de la misma telefonía (y mismo tipo M2M / no M2M) que están en la BD
    # pero no en los archivos → desactivado
    params = {'select': 'numero,imei', 'telefonia': f'eq.{telefonia}', 'order': 'id.asc'}
    params['numero'] = 'eq.M2M' if grupo_m2m else 'neq.M2M'
    for r in obtener_todos('consumo_sim', params):
        n = (r.get('numero') or '').strip()
        i = normalizar_imei(r.get('imei'))
        if n and n not in estado_num:
            estado_num[n] = 'desactivado'
        if i and i not in estado_imei:
            estado_imei[i] = 'desactivado'

    for campo, mapa in (('numero', estado_num), ('imei', estado_imei)):
        for estado in ('activo', 'sin_consumo', 'desactivado'):
            claves = [k for k, e in mapa.items() if e == estado]
            if not claves:
                continue
            payload = {'estado': estado}
            if estado == 'desactivado':
                payload['estado_operador'] = 'desactivado'
            actualizar_in('consumo_sim', campo, claves, payload)

    # Historial en sim_estados (solo acepta activo/desactivado)
    fechas = [v['fecha'] for v in list(max_num.values()) + list(max_imei.values()) if v['fecha']]
    fecha_max = max(fechas) if fechas else None
    ahora = datetime.now(timezone.utc).isoformat()
    hist = []
    for num, e in estado_num.items():
        hist.append({'numero': num, 'imei': None, 'estado': 'activo' if e == 'sin_consumo' else e,
                     'fecha_consumo': fecha_max, 'usuario': 'script', 'fecha_cambio': ahora})
    for imei, e in estado_imei.items():
        hist.append({'numero': None, 'imei': imei, 'estado': 'activo' if e == 'sin_consumo' else e,
                     'fecha_consumo': fecha_max, 'usuario': 'script', 'fecha_cambio': ahora})
    # Igual que la app: si RLS bloquea sim_estados no se corta el proceso
    try:
        insertar('sim_estados', hist)
    except RuntimeError as e:
        print(f'   ⚠️  {telefonia}: no se pudo registrar sim_estados ({e})')


# ── Consumos negativos (reinicio del ciclo de facturación) ───────
# Algunos reportes (M2M de Tigo) informan la diferencia del contador acumulado del
# ciclo. Cuando el contador se reinicia, la diferencia sale negativa:
#     valor = (consumo del día desde el reinicio) − (acumulado del ciclo hasta ayer)
# Si tenemos todos los días desde el reinicio anterior se recalcula exacto:
#     consumo real = valor + suma de lo guardado desde el reinicio anterior
# Si no, se estima con la mediana de esa línea en los ±DIAS_VENTANA días.
# Otro caso es el salto del contador: un negativo pegado a un pico positivo del día
# anterior o siguiente. Ahí la suma de los dos días es correcta y se reparte entre ambos.

MARCA_REINICIO = 'reinicio de ciclo'
MARCA_SALTO = 'salto de contador'
DIAS_VENTANA = 7


def _fecha(s):
    return datetime.strptime(s, '%Y-%m-%d').date()


def historial_lineas(telefonia, campo, valores):
    filas = []
    valores = list(valores)
    for i in range(0, len(valores), 50):
        filas += obtener_todos('consumo_sim', {
            'select': 'id,numero,imei,consumo_mb,fecha_consumo,observacion',
            'telefonia': f'eq.{telefonia}',
            campo: lista_in(valores[i:i + 50]),
            'order': 'id.asc',
        })
    return filas


def corregir_negativos(telefonias, ejecutar):
    """Corrige en la BD los consumo_mb < 0. Devuelve {(tel, clave, fecha): mb_nuevo}."""
    cambios = {}
    for tel in telefonias:
        negativos = obtener_todos('consumo_sim', {
            'select': 'id,numero,imei', 'telefonia': f'eq.{tel}',
            'consumo_mb': 'lt.0', 'order': 'id.asc',
        })
        if not negativos:
            continue

        # Historial completo de las líneas afectadas
        nums = {n['numero'] for n in negativos if n['numero'] and not es_m2m(n['numero'])}
        imeis = {n['imei'] for n in negativos if n['imei'] and (not n['numero'] or es_m2m(n['numero']))}
        filas = (historial_lineas(tel, 'numero', nums) if nums else []) + \
                (historial_lineas(tel, 'imei', imeis) if imeis else [])
        historial = {}
        for f in filas:
            historial.setdefault(clave_linea(f['numero'], f['imei']), {})[f['id']] = f

        exactos = estimados = sin_dato = saltos = 0
        for cl, filas_linea in historial.items():
            orden = sorted(filas_linea.values(), key=lambda f: (f['fecha_consumo'], f['id']))
            for idx, f in enumerate(orden):
                original = f['consumo_mb']
                if original is None or original >= 0:
                    continue
                hoy = _fecha(f['fecha_consumo'])

                # Salto del contador: el negativo viene pegado a un pico positivo (día anterior
                # o siguiente) que lo compensa. La suma de los dos días es correcta → se reparte.
                normales = [float(o['consumo_mb']) for o in orden
                            if o['consumo_mb'] is not None and o['consumo_mb'] >= 0]
                tipico = median(normales) if normales else 0
                pareja = None
                for j in (idx - 1, idx + 1):
                    if 0 <= j < len(orden):
                        v = orden[j]['consumo_mb']
                        if v is not None and v > 2.5 * tipico and original + v >= 0 \
                                and MARCA_SALTO not in (orden[j]['observacion'] or ''):
                            if pareja is None or v > orden[pareja]['consumo_mb']:
                                pareja = j
                if pareja is not None:
                    o = orden[pareja]
                    total = original + float(o['consumo_mb'])
                    a, b = sorted((f, o), key=lambda x: x['fecha_consumo'])
                    for fila, mb in ((a, int(total // 2)), (b, round(total - int(total // 2)))):
                        obs = f'corregido ({MARCA_SALTO}, original {fila["consumo_mb"]:g})'
                        fila['consumo_mb'], fila['observacion'] = mb, obs
                        cambios[(tel, cl, fila['fecha_consumo'])] = mb
                        if ejecutar:
                            _check(sesion.patch(f'{REST}/consumo_sim', params={'id': f'eq.{fila["id"]}'},
                                                json={'consumo_mb': mb, 'observacion': obs},
                                                headers={'Prefer': 'return=minimal'}), 'UPDATE consumo_sim')
                    saltos += 1
                    continue

                # Exacto: hay un reinicio anterior ya corregido → sumar desde ahí
                nuevo, tipo = None, None
                ult = next((j for j in range(idx - 1, -1, -1)
                            if MARCA_REINICIO in (orden[j]['observacion'] or '')), None)
                if ult is not None:
                    acumulado = sum(float(o['consumo_mb'] or 0) for o in orden[ult:idx])
                    if original + acumulado >= 0:
                        nuevo, tipo = original + acumulado, 'recalculado'

                # Estimado: mediana de la línea alrededor de esa fecha
                if nuevo is None:
                    vecinos = [float(o['consumo_mb']) for o in orden
                               if o is not f and o['consumo_mb'] is not None and o['consumo_mb'] >= 0
                               and MARCA_REINICIO not in (o['observacion'] or '')
                               and abs((_fecha(o['fecha_consumo']) - hoy).days) <= DIAS_VENTANA]
                    if vecinos:
                        nuevo, tipo = median(vecinos), 'estimado'

                if nuevo is not None:
                    nuevo = round(nuevo)
                    obs = f'{tipo} ({MARCA_REINICIO}, original {original:g})'
                    if tipo == 'recalculado':
                        exactos += 1
                    else:
                        estimados += 1
                else:
                    obs = f'sin dato ({MARCA_REINICIO}, original {original:g})'
                    sin_dato += 1

                f['consumo_mb'], f['observacion'] = nuevo, obs   # lo usan las filas siguientes
                cambios[(tel, cl, f['fecha_consumo'])] = nuevo
                if ejecutar:
                    _check(sesion.patch(f'{REST}/consumo_sim', params={'id': f'eq.{f["id"]}'},
                                        json={'consumo_mb': nuevo, 'observacion': obs},
                                        headers={'Prefer': 'return=minimal'}), 'UPDATE consumo_sim')

        accion = 'corregidos' if ejecutar else 'a corregir'
        print(f'   {tel}: {exactos + estimados + sin_dato + saltos} negativos {accion} → '
              f'{saltos} saltos de contador (par de días repartido), '
              f'{exactos} reinicios recalculados exactos, {estimados} reinicios estimados, {sin_dato} sin dato')
    return cambios


# ── Principal ────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description='Importa CSV de consumo a Supabase sin duplicados.')
    ap.add_argument('carpeta', help='Carpeta con los CSV (se recorren todas las subcarpetas)')
    ap.add_argument('--ejecutar', action='store_true',
                    help='Inserta en la BD. Sin esta opción solo muestra lo que haría.')
    ap.add_argument('--m2m-telefonia', default='Tigo',
                    help='Telefonía a asignar a los archivos M2M (por defecto: Tigo)')
    ap.add_argument('--sin-recalcular', action='store_true',
                    help='No recalcular estados de las líneas después del insert')
    args = ap.parse_args()

    carpeta = Path(args.carpeta)
    if not carpeta.is_dir():
        sys.exit(f'❌ No existe la carpeta: {carpeta}')

    archivos = sorted(p for p in carpeta.rglob('*') if p.is_file() and p.suffix.lower() == '.csv')
    if not archivos:
        sys.exit('❌ No se encontraron archivos .csv')

    print(f'📂 {carpeta}  →  {len(archivos)} archivo(s) CSV\n')

    # 1. Leer todos los archivos
    por_tel = {}          # telefonia → filas
    omitidos = []
    for ruta in archivos:
        tel = detectar_telefonia(ruta, args.m2m_telefonia)
        rel = ruta.relative_to(carpeta)
        if not tel:
            omitidos.append(f'{rel} (no se pudo detectar la telefonía)')
            continue
        try:
            filas = parsear_csv(ruta, tel)
        except Exception as e:
            omitidos.append(f'{rel} ({e})')
            continue
        sin_fecha = sum(1 for f in filas if not f['fecha_consumo'])
        if sin_fecha:
            print(f'   ⚠️  {rel}: {sin_fecha} fila(s) sin fecha válida (se omiten)')
        filas = [f for f in filas if f['fecha_consumo']]
        if not filas:
            omitidos.append(f'{rel} (sin filas válidas)')
            continue
        por_tel.setdefault(tel, []).extend(filas)

    # 2. Filtrar duplicados (contra la BD y entre archivos)
    nuevas_por_tel = {}
    for tel, filas in sorted(por_tel.items()):
        fechas = [f['fecha_consumo'] for f in filas]
        existentes = claves_existentes(tel, min(fechas), max(fechas))
        vistas, nuevas = set(), []
        dup_bd = dup_arch = 0
        for f in filas:
            cl = (tel, clave_linea(f['numero'], f['imei']), f['fecha_consumo'])
            if cl in existentes:
                dup_bd += 1
            elif cl in vistas:
                dup_arch += 1
            else:
                vistas.add(cl)
                nuevas.append(f)
        nuevas_por_tel[tel] = nuevas
        print(f'📱 {tel:<9} {len(filas):>7} filas leídas ({min(fechas)} a {max(fechas)})  |  '
              f'{len(nuevas):>7} nuevas  |  {dup_bd:>6} ya en BD  |  {dup_arch:>5} repetidas en archivos')

    if omitidos:
        print('\n⚠️  Archivos omitidos:')
        for o in omitidos:
            print('   -', o)

    total_nuevas = sum(len(v) for v in nuevas_por_tel.values())
    print(f'\nTotal a insertar: {total_nuevas}')

    if not args.ejecutar:
        negativos = sum(1 for filas in por_tel.values() for f in filas
                        if f['consumo_mb'] is not None and f['consumo_mb'] < 0)
        if negativos:
            print(f'\n⚠️  {negativos} filas con consumo negativo en los archivos (reinicio de ciclo).')
        print('\n🔧 Negativos que ya están en la BD:')
        corregir_negativos(sorted(por_tel), ejecutar=False)
        print('\nℹ️  Simulación: no se escribió nada. Ejecutá con --ejecutar para insertar.')
        return

    # 3. Insertar
    for tel, nuevas in nuevas_por_tel.items():
        if nuevas:
            print(f'⬆️  Insertando {len(nuevas)} filas de {tel}…')
            insertar('consumo_sim', nuevas)

    # Corregir consumos negativos (reinicio de ciclo) y reflejarlo en las filas leídas
    print('\n🔧 Corrigiendo consumos negativos…')
    cambios = corregir_negativos(sorted(por_tel), ejecutar=True)
    for tel, filas in por_tel.items():
        for f in filas:
            cl = (tel, clave_linea(f['numero'], f['imei']), f['fecha_consumo'])
            if cl in cambios:
                f['consumo_mb'] = cambios[cl]

    if args.sin_recalcular:
        print('\n✅ Listo (sin recalcular estados).')
        return

    # 4. Recalcular estados por telefonía, separando M2M de las líneas con número
    print('\n🔄 Recalculando estados…')
    for tel, filas in por_tel.items():
        for grupo_m2m in (False, True):
            sub = [f for f in filas if es_m2m(f['numero']) == grupo_m2m]
            if sub:
                recalcular_estados(sub, tel, grupo_m2m)

    r = sesion.post(f'{REST}/rpc/refresh_consumo_consolidado', json={})
    print('   consumo_consolidado refrescado' if r.status_code < 300
          else f'   ⚠️  No se pudo refrescar consumo_consolidado: {r.text[:200]}')

    print(f'\n✅ Listo: {total_nuevas} registros insertados.')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
