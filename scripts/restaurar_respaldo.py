"""
Restaura tablas desde un respaldo hecho con respaldo_base.py.

Por defecto solo SIMULA: compara el respaldo con la base y dice cuántas filas faltan.
Con --ejecutar vuelve a cargar las filas del respaldo (las que ya existen con la misma
clave se sobrescriben con la versión del respaldo; no borra filas que estén solo en la base).

Uso:
    py restaurar_respaldo.py "<carpeta del día>" lineas                 # simulación
    py restaurar_respaldo.py "<carpeta del día>" lineas --ejecutar
    py restaurar_respaldo.py "<carpeta del día>" --todas --ejecutar     # todas las tablas
"""
import argparse
import gzip
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import importar_consumos as ic   # noqa: E402

LOTE = 500


def leer(arch: Path):
    with gzip.open(arch, 'rt', encoding='utf-8') as f:
        for linea in f:
            if linea.strip():
                yield json.loads(linea)


def restaurar(carpeta: Path, tabla: str, orden: str, ejecutar: bool):
    arch = carpeta / f'{tabla}.jsonl.gz'
    if not arch.exists():
        print(f'❌ {tabla}: no está en el respaldo'); return
    filas = list(leer(arch))
    claves_bd = {str(f[orden]) for f in ic.obtener_todos(tabla, {'select': orden, 'order': f'{orden}.asc'})} \
        if orden == 'id' else None
    faltan = sum(1 for f in filas if claves_bd is not None and str(f[orden]) not in claves_bd)
    print(f'📦 {tabla}: {len(filas)} filas en el respaldo' + (f', {faltan} no están en la base' if claves_bd is not None else ''))
    if not ejecutar:
        return
    # Upsert por la clave primaria: conserva los mismos id que en el respaldo
    for i in range(0, len(filas), LOTE):
        ic._check(ic.sesion.post(f'{ic.REST}/{tabla}', params={'on_conflict': orden}, json=filas[i:i + LOTE],
                                 headers={'Prefer': 'resolution=merge-duplicates,return=minimal'}, timeout=300),
                  f'POST {tabla}')
    print(f'   ✅ {tabla}: {len(filas)} filas cargadas')


def main():
    ap = argparse.ArgumentParser(description='Restaura tablas desde un respaldo.')
    ap.add_argument('carpeta', help='Carpeta del respaldo (ej. ...\\Respaldos Gestion ANDE\\2026-11-23)')
    ap.add_argument('tablas', nargs='*', help='Tablas a restaurar')
    ap.add_argument('--todas', action='store_true', help='Restaurar todas las tablas del respaldo')
    ap.add_argument('--ejecutar', action='store_true', help='Cargar de verdad (sin esto solo simula)')
    args = ap.parse_args()
    carpeta = Path(args.carpeta)
    man = json.loads((carpeta / 'manifiesto.json').read_text(encoding='utf-8'))
    print(f'Respaldo del {man["fecha"]} ({man["origen"]})')
    elegidas = list(man['tablas']) if args.todas else args.tablas
    if not elegidas:
        sys.exit('Indicá las tablas o --todas. Tablas del respaldo: ' + ', '.join(man['tablas']))
    for t in elegidas:
        if t not in man['tablas']:
            print(f'❌ {t}: no está en el respaldo'); continue
        restaurar(carpeta, t, man['tablas'][t]['orden'], args.ejecutar)
    if not args.ejecutar:
        print('\nℹ️  Simulación: no se cargó nada. Agregá --ejecutar para restaurar.')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
