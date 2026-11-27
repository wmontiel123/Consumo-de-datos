"""
Sube (o actualiza) el manual de administrador a la tabla "manuales" de Supabase.

El manual NO se publica en el sitio: el archivo docs/manual-admin.html está en
.gitignore y solo existe en esta PC y en la base, donde RLS lo deja leer solo a
los administradores (ver scripts/manuales.sql).

Uso:
    py scripts/subir_manual_admin.py
    py scripts/subir_manual_admin.py --archivo otra/ruta/manual.html

Usa la clave de servicio de la variable SUPABASE_SERVICE_KEY (igual que el cargador).
"""
import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SUPABASE_URL = 'https://rnnsvvujedwcvcjyyajm.supabase.co'
RAIZ = Path(__file__).resolve().parent.parent


def clave_servicio():
    clave = os.environ.get('SUPABASE_SERVICE_KEY')
    if not clave and sys.platform == 'win32':
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as k:
                clave = winreg.QueryValueEx(k, 'SUPABASE_SERVICE_KEY')[0]
        except OSError:
            pass
    if not clave:
        sys.exit('Falta la variable de entorno SUPABASE_SERVICE_KEY.')
    return clave


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--archivo', default=str(RAIZ / 'docs' / 'manual-admin.html'))
    args = ap.parse_args()

    html = Path(args.archivo).read_text(encoding='utf-8')
    clave = clave_servicio()
    cuerpo = json.dumps({
        'id': 'admin',
        'contenido': html,
        'actualizado_en': datetime.now(timezone.utc).isoformat(),
    }).encode('utf-8')
    req = urllib.request.Request(
        f'{SUPABASE_URL}/rest/v1/manuales?on_conflict=id', data=cuerpo, method='POST',
        headers={
            'apikey': clave, 'Authorization': f'Bearer {clave}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal',
        })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            print(f'Manual de administrador subido ({len(html):,} caracteres, HTTP {r.status}).')
    except urllib.error.HTTPError as e:
        sys.exit(f'Error HTTP {e.code}: {e.read().decode("utf-8", "replace")}')


if __name__ == '__main__':
    main()
