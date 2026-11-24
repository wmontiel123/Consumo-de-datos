"""
Respaldo diario de los datos de la base (Supabase) fuera de Supabase.

Guarda cada tabla en <destino>/<AAAA-MM-DD>/<tabla>.jsonl.gz (una fila JSON por línea)
y un manifiesto.json con la cantidad de filas de cada una. Las tablas se descubren solas
(las que se agreguen más adelante también se respaldan); las vistas se saltean porque se
recalculan desde las tablas.

Usuarios: se respaldan en usuarios_app (usuario, rol, contraseña cifrada con bcrypt). La cuenta
interna de Supabase Auth no hace falta: la Edge Function "login" la vuelve a crear sola en el
primer ingreso si no existe. Por eso esta carpeta es sensible: no compartirla.
No respalda la estructura (tablas, funciones, políticas), que está en scripts/*.sql.

Conservación: los últimos DIAS_DIARIOS respaldos diarios y el primero de cada mes durante
MESES_MENSUALES meses.

Uso:
    py respaldo_base.py                      # respalda en la carpeta por defecto
    py respaldo_base.py --destino "D:\\Respaldos"
Carpeta por defecto: variable RESPALDO_DESTINO, o "<OneDrive>\\Respaldos Gestion ANDE",
o <repo>\\respaldos\\base. Usa SUPABASE_SERVICE_KEY, igual que el cargador de reportes.

Restaurar una tabla:  py restaurar_respaldo.py <carpeta del día> <tabla>   (ver ese script)
"""
import argparse
import gzip
import json
import os
import shutil
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import importar_consumos as ic   # noqa: E402  (sesión, REST, paginado y control de errores)

DIAS_DIARIOS = 14
MESES_MENSUALES = 12
PAGINA = 1000
# Vistas y vistas materializadas: se reconstruyen desde las tablas, no hace falta guardarlas
VISTAS = {'consumo_consolidado', 'consumo_ultimo', 'lineas_estado_mv', 'lineas_mes_mv', 'vista_lineas_estado'}
# Datos temporales sin valor para restaurar (enlaces de un solo uso, intentos de login)
EXCLUIR = {'tokens_cuenta', 'tokens_reseteo', 'intentos_login'}


def destino_por_defecto() -> Path:
    if os.environ.get('RESPALDO_DESTINO'):
        return Path(os.environ['RESPALDO_DESTINO'])
    if os.environ.get('OneDrive'):
        return Path(os.environ['OneDrive']) / 'Respaldos Gestion ANDE'
    return Path(__file__).resolve().parent.parent / 'respaldos' / 'base'


def tablas() -> dict:
    """{tabla: columna para ordenar} según la descripción OpenAPI de la API."""
    spec = ic._check(ic.sesion.get(f'{ic.REST}/', headers={'Accept': 'application/openapi+json'}, timeout=120),
                     'GET OpenAPI').json()
    res = {}
    for nombre, d in spec.get('definitions', {}).items():
        if nombre in VISTAS or nombre in EXCLUIR:
            continue
        props = d.get('properties', {})
        pk = [c for c, v in props.items() if '<pk/>' in (v.get('description') or '')]
        if not pk:
            continue          # sin clave primaria: es una vista
        res[nombre] = 'id' if 'id' in pk else pk[0]
    return dict(sorted(res.items()))


def contar(tabla: str) -> int:
    r = ic._check(ic.sesion.head(f'{ic.REST}/{tabla}', params={'select': '*', 'limit': 1},
                                 headers={'Prefer': 'count=exact'}, timeout=120), f'HEAD {tabla}')
    return int(r.headers.get('content-range', '*/0').split('/')[-1])


def filas(tabla: str, orden: str):
    """Recorre toda la tabla en páginas de PAGINA filas."""
    if orden == 'id':
        ultimo = None
        while True:
            params = {'select': '*', 'order': 'id.asc', 'limit': PAGINA}
            if ultimo is not None:
                params['id'] = f'gt.{ultimo}'
            lote = ic._check(ic.sesion.get(f'{ic.REST}/{tabla}', params=params, timeout=120), f'GET {tabla}').json()
            yield from lote
            if len(lote) < PAGINA:
                return
            ultimo = lote[-1]['id']
    else:
        desde = 0
        while True:
            lote = ic._check(ic.sesion.get(f'{ic.REST}/{tabla}', params={'select': '*', 'order': f'{orden}.asc'},
                                           headers={'Range-Unit': 'items', 'Range': f'{desde}-{desde + PAGINA - 1}'},
                                           timeout=120), f'GET {tabla}').json()
            yield from lote
            if len(lote) < PAGINA:
                return
            desde += PAGINA


def limpiar(destino: Path):
    """Borra los respaldos viejos: quedan los últimos DIAS_DIARIOS y el primero de cada mes
    de los últimos MESES_MENSUALES meses."""
    dias = sorted(p for p in destino.iterdir() if p.is_dir() and len(p.name) == 10 and p.name[4] == '-')
    conservar = {p.name for p in dias[-DIAS_DIARIOS:]}
    primeros = {}
    for p in dias:
        primeros.setdefault(p.name[:7], p.name)          # primer respaldo de cada mes
    conservar |= {primeros[m] for m in sorted(primeros)[-MESES_MENSUALES:]}
    for p in dias:
        if p.name not in conservar:
            shutil.rmtree(p, ignore_errors=True)
            print(f'   borrado respaldo viejo {p.name}')


def main():
    ap = argparse.ArgumentParser(description='Respaldo diario de los datos de la base.')
    ap.add_argument('--destino', help='Carpeta donde guardar los respaldos')
    args = ap.parse_args()
    destino = Path(args.destino) if args.destino else destino_por_defecto()
    destino.mkdir(parents=True, exist_ok=True)

    hoy = date.today()
    final = destino / hoy.isoformat()
    tmp = destino / f'.{hoy.isoformat()}.parcial'
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir()

    inicio = datetime.now()
    print(f'💾 Respaldo de la base → {final}')
    manifiesto = {'fecha': inicio.isoformat(timespec='seconds'), 'origen': ic.SUPABASE_URL, 'tablas': {}}
    for tabla, orden in tablas().items():
        esperadas = contar(tabla)
        n = 0
        with gzip.open(tmp / f'{tabla}.jsonl.gz', 'wt', encoding='utf-8') as f:
            for fila in filas(tabla, orden):
                f.write(json.dumps(fila, ensure_ascii=False, separators=(',', ':')) + '\n')
                n += 1
        # La tabla puede recibir filas mientras se copia; menos de las contadas al empezar es un error
        if n < esperadas:
            raise RuntimeError(f'{tabla}: se copiaron {n} filas de {esperadas}')
        manifiesto['tablas'][tabla] = {'filas': n, 'orden': orden}
        print(f'   {tabla:<24} {n:>8} filas')
    manifiesto['segundos'] = round((datetime.now() - inicio).total_seconds())
    (tmp / 'manifiesto.json').write_text(json.dumps(manifiesto, ensure_ascii=False, indent=1), encoding='utf-8')

    # Recién con todo copiado reemplaza el respaldo del día (si ya había uno)
    if final.exists():
        shutil.rmtree(final)
    tmp.rename(final)
    tam = sum(p.stat().st_size for p in final.iterdir()) / 1024 / 1024
    print(f'✅ Listo: {len(manifiesto["tablas"])} tablas, {tam:.1f} MB, {manifiesto["segundos"]} s')
    limpiar(destino)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
