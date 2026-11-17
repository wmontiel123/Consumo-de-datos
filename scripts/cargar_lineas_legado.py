"""Carga en lineas_legado las SIM (número / ICCID) de los RC de tipo Legado.

Uso:
    py cargar_lineas_legado.py              → solo muestra lo que haría
    py cargar_lineas_legado.py --ejecutar   → inserta las que faltan

- Telefonía: la del último consumo de ese número / ICCID; si no hay, por el prefijo del ICCID.
- Quedan como 'asignada' a su RC y slot.
- No toca las que ya están en lineas ni en lineas_legado (las lista aparte).
Requiere SUPABASE_SERVICE_KEY (variable de entorno de usuario).
"""
import os, re, sys, winreg
from collections import Counter

if not os.environ.get('SUPABASE_SERVICE_KEY'):
    k = winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment')
    os.environ['SUPABASE_SERVICE_KEY'] = winreg.QueryValueEx(k, 'SUPABASE_SERVICE_KEY')[0]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importar_consumos as ic

PREFIJOS = [('8959502', 'Claro'), ('8959505', 'Personal'), ('8959504', 'Tigo'), ('8959512', 'Tigo')]


def iccid_limpio(v):
    s = str(v or '').strip()
    if re.fullmatch(r'[\d.]+[eE][+-]?\d+', s):
        s = str(round(float(s)))
    return re.sub(r'\D', '', s)


def numero_limpio(v):
    s = str(v or '').strip()
    return s if s.isdigit() else ''   # 'M2M', 'SATELITAL', etc. no son números


def main():
    ejecutar = '--ejecutar' in sys.argv
    devs = ic.obtener_todos('dispositivos_ande', {
        'select': 'codigo,tipo,sim1_num,sim1_imei,sim2_num,sim2_imei', 'order': 'codigo.asc'})
    legado = [d for d in devs if (d['tipo'] or '').strip().lower() == 'legado']

    existentes = {}
    for tabla in ('lineas', 'lineas_legado'):
        for l in ic.obtener_todos(tabla, {'select': 'numero,iccid', 'order': 'id.asc'}):
            if numero_limpio(l['numero']): existentes['n:' + numero_limpio(l['numero'])] = tabla
            if l['iccid']: existentes['i:' + iccid_limpio(l['iccid'])] = tabla

    tel_num, tel_icc = {}, {}
    filas_mv, desde = [], 0
    while True:   # lineas_estado_mv: una fila por línea con su telefonía (no tiene id)
        r = ic._check(ic.sesion.get(f'{ic.REST}/lineas_estado_mv', params={
            'select': 'numero,imei,telefonia', 'order': 'linea_key.asc', 'offset': desde, 'limit': 1000}),
            'GET lineas_estado_mv').json()
        filas_mv += r; desde += 1000
        if len(r) < 1000: break
    for c in filas_mv:
        if not c['telefonia']: continue
        if numero_limpio(c['numero']): tel_num[numero_limpio(c['numero'])] = c['telefonia']
        if c['imei']: tel_icc[iccid_limpio(c['imei'])] = c['telefonia']

    nuevas, ya, vistos = [], Counter(), set()
    for d in legado:
        for slot in ('sim1', 'sim2'):
            n, i = numero_limpio(d[slot + '_num']), iccid_limpio(d[slot + '_imei'])
            if not n and not i: continue
            claves = ([f'n:{n}'] if n else []) + ([f'i:{i}'] if i else [])
            donde = next((existentes[c] for c in claves if c in existentes), None)
            if donde:
                ya[donde] += 1
                if donde == 'lineas': print(f'  ya en el inventario de líneas: {d["codigo"]} {slot} {n or i}')
                continue
            if any(c in vistos for c in claves):
                ya['repetida en otro RC'] += 1
                print(f'  repetida en otro RC: {d["codigo"]} {slot} {n or i}')
                continue
            vistos.update(claves)
            tel = tel_num.get(n) or tel_icc.get(i) or next((t for p, t in PREFIJOS if i.startswith(p)), None)
            nuevas.append({'numero': n or None, 'iccid': i or None, 'telefonia': tel, 'estado': 'asignada',
                           'rc_codigo': d['codigo'], 'sim_slot': slot, 'creado_por': 'carga legado'})

    print(f'RC legado: {len(legado)}')
    print(f'Líneas nuevas para lineas_legado: {len(nuevas)}  ·  ya cargadas: {dict(ya)}')
    print('Por telefonía:', dict(Counter(x['telefonia'] or 'sin dato' for x in nuevas)))
    print('Solo ICCID (M2M):', sum(1 for x in nuevas if not x['numero']))

    if not ejecutar:
        print('\nSolo vista previa. Para insertar: --ejecutar')
        return
    for k in range(0, len(nuevas), 500):
        r = ic.sesion.post(f'{ic.REST}/lineas_legado', json=nuevas[k:k + 500], headers={'Prefer': 'return=minimal'})
        ic._check(r, 'INSERT lineas_legado')
    print('Insertadas:', len(nuevas))


if __name__ == '__main__':
    main()
