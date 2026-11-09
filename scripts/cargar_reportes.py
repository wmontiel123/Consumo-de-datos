"""
Carga automática de reportes de consumo (para el Programador de tareas de Windows).

Recorre CARPETA_REPORTES, que tiene una subcarpeta por operadora:

    <CARPETA_REPORTES>\\claro\\     *.csv
    <CARPETA_REPORTES>\\m2m\\       *.csv   (se cargan como Tigo)
    <CARPETA_REPORTES>\\personal\\  *.csv
    <CARPETA_REPORTES>\\tigo\\      *.csv

y sube a la base solo lo que falta, sin reemplazar nada:
  · Los archivos ya cargados se recuerdan en cargar_reportes_estado.json (ruta,
    tamaño y fecha de modificación): no se vuelven a leer. Si un archivo cambia,
    se vuelve a procesar.
  · Igual que importar_consumos.py, una fila que ya está en la base (misma
    telefonía + línea + fecha) no se vuelve a insertar ni se modifica.
  · Si la carga falla, los archivos no se marcan como cargados y se reintentan
    en la próxima ejecución.

Configuración: las variables de abajo, o un archivo cargar_reportes.ini junto al
script / ejecutable (así se cambia la carpeta sin volver a generar el .exe):

    [general]
    carpeta_reportes = D:\\Reportes\\Consumo
    m2m_telefonia    = Tigo
    corregir_negativos = no

La clave de la base: clave.dat (cifrada con DPAPI por el instalador), o la variable
de entorno SUPABASE_SERVICE_KEY. Nunca se guarda en texto plano.

Uso:
    py cargar_reportes.py              # carga lo nuevo
    py cargar_reportes.py --simular    # muestra lo que haría, sin escribir
    py cargar_reportes.py --reprocesar # vuelve a leer todos los archivos (los duplicados igual se descartan)
    py cargar_reportes.py --probar     # verifica configuración, clave y conexión

Código de salida: 0 = OK (o nada nuevo), 1 = error, 2 = ya había otra carga en curso.
"""
import argparse
import configparser
import json
import os
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

# ── Configuración ────────────────────────────────────────────────
# carpeta con las subcarpetas claro / m2m / personal / tigo (equipo del bot, usuario Automation360)
CARPETA_REPORTES   = r'C:\Users\Automation360\Documents\ANDE\Consumo de SIMCARDs'
SUBCARPETAS        = ('claro', 'm2m', 'personal', 'tigo')
EXTENSIONES        = ('.csv',)
M2M_TELEFONIA      = 'Tigo'                   # los reportes M2M son de Tigo
CORREGIR_NEGATIVOS = False                    # True: recalcula los negativos por reinicio de ciclo
MINUTOS_ESPERA     = 2                        # no tomar archivos modificados hace menos de esto (se están copiando)
DIAS_LOG           = 60                       # se borran los logs más viejos que esto

# Carpeta del script, o del .exe si está empaquetado con PyInstaller
BASE = Path(sys.executable).parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parent
ARCHIVO_INI    = BASE / 'cargar_reportes.ini'
ARCHIVO_ESTADO = BASE / 'cargar_reportes_estado.json'
CARPETA_LOGS   = BASE / 'logs'
ARCHIVO_LOCK   = BASE / 'cargar_reportes.lock'


# ── Log: todo lo que se imprime va a pantalla y a logs\cargar_AAAA-MM-DD.log ──
class Tee:
    def __init__(self, *salidas):
        self.salidas = [s for s in salidas if s]

    def write(self, texto):
        for s in self.salidas:
            try:
                s.write(texto)
                s.flush()
            except Exception:
                pass

    def flush(self):
        for s in self.salidas:
            try:
                s.flush()
            except Exception:
                pass


def iniciar_log():
    CARPETA_LOGS.mkdir(exist_ok=True)
    limite = time.time() - DIAS_LOG * 86400
    for viejo in CARPETA_LOGS.glob('cargar_*.log'):
        if viejo.stat().st_mtime < limite:
            viejo.unlink(missing_ok=True)
    archivo = open(CARPETA_LOGS / f'cargar_{datetime.now():%Y-%m-%d}.log', 'a', encoding='utf-8')
    consola = sys.stdout
    if consola is not None:
        try:
            consola.reconfigure(encoding='utf-8')
        except Exception:
            pass
    sys.stdout = Tee(consola, archivo)
    sys.stderr = Tee(sys.stderr, archivo)
    print(f'\n{"═" * 70}\n🕒 {datetime.now():%Y-%m-%d %H:%M:%S}  ·  carga de reportes')


# ── Una sola carga a la vez ──────────────────────────────────────
def tomar_lock():
    """Lock del sistema operativo: se libera solo si el proceso termina o se corta."""
    import msvcrt
    f = open(ARCHIVO_LOCK, 'a+')
    try:
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        f.close()
        return None
    return f


def leer_config():
    cfg = {'carpeta': CARPETA_REPORTES, 'm2m': M2M_TELEFONIA, 'negativos': CORREGIR_NEGATIVOS}
    if ARCHIVO_INI.exists():
        ini = configparser.ConfigParser()
        ini.read(ARCHIVO_INI, encoding='utf-8-sig')   # -sig: el Bloc de notas suele agregar BOM
        g = ini['general'] if 'general' in ini else {}
        cfg['carpeta'] = g.get('carpeta_reportes', cfg['carpeta']).strip().strip('"')
        cfg['m2m'] = g.get('m2m_telefonia', cfg['m2m']).strip()
        cfg['negativos'] = str(g.get('corregir_negativos', cfg['negativos'])).strip().lower() in ('si', 'sí', 'yes', 'true', '1')
        print(f'⚙️  Configuración leída de {ARCHIVO_INI.name}')
    return cfg


# ── Clave de Supabase ────────────────────────────────────────────
# El instalador la guarda cifrada con DPAPI de Windows en clave.dat (solo la puede
# descifrar el mismo usuario, o el mismo equipo en el modo "sin sesión iniciada").
ENTROPIA_DPAPI = b'CargaReportesANDE'


def descifrar_dpapi(datos):
    import ctypes
    from ctypes import wintypes

    class BLOB(ctypes.Structure):
        _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_char))]

    def blob(b):
        buf = ctypes.create_string_buffer(b, len(b))
        return BLOB(len(b), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), buf

    entrada, _b1 = blob(datos)
    entropia, _b2 = blob(ENTROPIA_DPAPI)
    salida = BLOB()
    if not ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(entrada), None, ctypes.byref(entropia),
                                                     None, None, 0, ctypes.byref(salida)):
        raise OSError(f'CryptUnprotectData falló (error {ctypes.GetLastError()})')
    try:
        return ctypes.string_at(salida.pbData, salida.cbData).decode('utf-8')
    finally:
        ctypes.windll.kernel32.LocalFree(salida.pbData)


def cargar_clave():
    """Deja la clave en SUPABASE_SERVICE_KEY. Orden: clave.dat (instalador) →
    variable de entorno → registro del usuario (setx). Devuelve de dónde salió."""
    archivo = BASE / 'clave.dat'
    if archivo.exists():
        try:
            os.environ['SUPABASE_SERVICE_KEY'] = descifrar_dpapi(archivo.read_bytes()).strip()
            return 'clave.dat (cifrada)'
        except Exception as e:
            print(f'⚠️  No se pudo descifrar clave.dat ({e}). ¿Se instaló con otro usuario de Windows?')
    if os.environ.get('SUPABASE_SERVICE_KEY', '').strip():
        return 'variable de entorno'
    # Una tarea programada sin sesión iniciada puede no heredar las variables del usuario
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as k:
            os.environ['SUPABASE_SERVICE_KEY'] = winreg.QueryValueEx(k, 'SUPABASE_SERVICE_KEY')[0]
            return 'registro del usuario'
    except OSError:
        return None


def huella(ruta):
    st = ruta.stat()
    return {'tamano': st.st_size, 'modificado': st.st_mtime_ns}


def leer_estado():
    if ARCHIVO_ESTADO.exists():
        try:
            return json.loads(ARCHIVO_ESTADO.read_text(encoding='utf-8'))
        except Exception as e:
            print(f'⚠️  No se pudo leer {ARCHIVO_ESTADO.name} ({e}); se revisan todos los archivos.')
    return {'archivos': {}}


def guardar_estado(estado):
    tmp = ARCHIVO_ESTADO.with_suffix('.tmp')
    tmp.write_text(json.dumps(estado, ensure_ascii=False, indent=1), encoding='utf-8')
    tmp.replace(ARCHIVO_ESTADO)   # reemplazo atómico: nunca queda un estado a medio escribir


def archivos_pendientes(carpeta, estado, reprocesar):
    """Archivos nuevos o modificados de las subcarpetas de operadoras."""
    pendientes, copiandose = [], 0
    limite = time.time() - MINUTOS_ESPERA * 60
    for sub in SUBCARPETAS:
        dir_sub = carpeta / sub
        if not dir_sub.is_dir():
            print(f'⚠️  No existe la subcarpeta {dir_sub}')
            continue
        for ruta in sorted(dir_sub.rglob('*')):
            if not ruta.is_file() or ruta.suffix.lower() not in EXTENSIONES:
                continue
            if ruta.stat().st_mtime > limite:
                copiandose += 1
                continue
            clave = str(ruta.relative_to(carpeta))
            if reprocesar or estado['archivos'].get(clave, {}).get('huella') != huella(ruta):
                pendientes.append(ruta)
    if copiandose:
        print(f'⏳ {copiandose} archivo(s) modificado(s) hace menos de {MINUTOS_ESPERA} min: '
              'se toman en la próxima ejecución.')
    return pendientes


def main():
    ap = argparse.ArgumentParser(description='Carga a la base los reportes nuevos de cada operadora.')
    ap.add_argument('--simular', action='store_true', help='Muestra lo que haría, sin escribir en la base')
    ap.add_argument('--reprocesar', action='store_true',
                    help='Vuelve a leer todos los archivos (las filas que ya están en la base se descartan igual)')
    ap.add_argument('--probar', action='store_true',
                    help='Solo verifica la configuración, la clave y la conexión a la base (no lee archivos)')
    args = ap.parse_args()
    if not getattr(sys, 'frozen', False) and str(BASE) not in sys.path:
        sys.path.insert(0, str(BASE))      # importar_consumos.py está en la misma carpeta

    iniciar_log()
    lock = tomar_lock()
    if not lock:
        print('⏸️  Ya hay otra carga en curso. Se sale sin hacer nada.')
        return 2

    try:
        cfg = leer_config()
        carpeta = Path(cfg['carpeta'])
        if not carpeta.is_dir():
            print(f'❌ No existe la carpeta de reportes: {carpeta}\n'
                  f'   Revisá CARPETA_REPORTES o {ARCHIVO_INI.name}.')
            return 1
        origen = cargar_clave()
        if not origen:
            print('❌ No se encontró la clave de Supabase (service_role).\n'
                  '   Volvé a correr el instalador, o cargala con:  setx SUPABASE_SERVICE_KEY "<clave>"')
            return 1
        print(f'🔑 Clave de Supabase: {origen}')

        if args.probar:
            import requests
            from importar_consumos import REST, sesion   # usa la clave recién cargada
            r = sesion.get(f'{REST}/consumo_sim', params={'select': 'id', 'limit': 1}, timeout=30)
            if r.status_code != 200:
                print(f'❌ La base rechazó la conexión: HTTP {r.status_code} {r.text[:200]}')
                return 1
            subs = [s for s in SUBCARPETAS if (carpeta / s).is_dir()]
            print(f'✅ Prueba OK: conexión a la base correcta; subcarpetas encontradas: {", ".join(subs) or "ninguna"}')
            return 0

        estado = leer_estado()
        pendientes = archivos_pendientes(carpeta, estado, args.reprocesar)
        print(f'📂 {carpeta}  →  {len(pendientes)} archivo(s) nuevo(s) o modificado(s)')
        if not pendientes:
            print('✅ Nada nuevo para cargar.')
            return 0
        for r in pendientes:
            print('   ·', r.relative_to(carpeta))
        print()

        import importar_consumos as imp   # se importa acá: necesita la clave ya verificada
        resumen = imp.importar(pendientes, carpeta, ejecutar=not args.simular,
                               m2m_telefonia=cfg['m2m'], recalcular=True,
                               corregir_neg=cfg['negativos'],
                               solo_recalcular_si_es_lo_mas_nuevo=True)

        if args.simular:
            print('\nℹ️  Simulación: no se marcó ningún archivo como cargado.')
            return 0

        # Recién ahora, con todo insertado, se marcan los archivos como cargados.
        # Los que no se pudieron leer no se marcan: se reintentan la próxima vez.
        # (los vacíos sí se marcan, para no avisar de ellos en cada ejecución)
        omitidos = {o.split(' (')[0] for o in resumen['omitidos'] if 'sin filas válidas' not in o}
        ahora = datetime.now().isoformat(timespec='seconds')
        for ruta in pendientes:
            clave = str(ruta.relative_to(carpeta))
            if clave in omitidos:
                continue
            estado['archivos'][clave] = {'huella': huella(ruta), 'cargado': ahora}
        estado['ultima_carga'] = {'fecha': ahora, 'insertadas': resumen['insertadas'],
                                  'archivos': len(pendientes) - len(omitidos)}
        guardar_estado(estado)
        return 0

    except Exception:
        print('❌ Error en la carga (los archivos no se marcaron como cargados; se reintentan la próxima vez):')
        traceback.print_exc()
        return 1
    finally:
        lock.close()


if __name__ == '__main__':
    sys.exit(main())
