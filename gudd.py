import csv
import difflib
import re
import unicodedata

import openpyxl

COLUMNA_BANCO = "ENTIDAD FINANCIERA"
HOJA_BANCOS = "Tabla bancos - No eliminar"
# Por debajo de este parecido (0 a 1) no se reemplaza y se informa como sin coincidencia
UMBRAL = 0.6

# Palabras genericas que no ayudan a distinguir un banco de otro
PALABRAS_GENERICAS = {
    "banco", "bank", "sa", "s", "a", "saeca", "sae", "eca", "e", "c",
    "ltda", "coop", "cooperativa", "mult", "multiactiva", "de", "del", "la", "y",
}


def _normalizar(texto):
    texto = unicodedata.normalize("NFKD", str(texto)).encode("ascii", "ignore").decode()
    texto = re.sub(r"[^a-z0-9 ]", " ", texto.lower())
    return " ".join(texto.split())


def _nucleo(texto_normalizado):
    palabras = [p for p in texto_normalizado.split() if p not in PALABRAS_GENERICAS]
    return " ".join(palabras) or texto_normalizado


def _puntaje(valor, descripcion):
    v, d = _normalizar(valor), _normalizar(descripcion)
    if v == d:
        return 1.0
    nv, nd = _nucleo(v), _nucleo(d)
    if nv == nd:
        return 0.99
    puntaje = max(
        difflib.SequenceMatcher(None, v, d).ratio(),
        difflib.SequenceMatcher(None, nv, nd).ratio(),
    )
    # Si todas las palabras del reporte aparecen en la descripcion (ej: "UENO" -> "ueno bank S.A.")
    if set(nv.split()) <= set(nd.split()):
        puntaje = max(puntaje, 0.9)
    return puntaje


def normalizar_bancos(rutas):
    """rutas[0] = CSV de transferencias a corregir, rutas[1] = Excel de ejemplo con la tabla de bancos."""
    ruta_csv, ruta_ejemplo = rutas[0], rutas[1]

    wb_ejemplo = openpyxl.load_workbook(ruta_ejemplo, read_only=True)
    descripciones = [
        str(fila[1]).strip()
        for fila in wb_ejemplo[HOJA_BANCOS].iter_rows(min_row=2, values_only=True)
        if fila[1] not in (None, "")
    ]
    wb_ejemplo.close()
    if not descripciones:
        return "ERROR: no se encontraron descripciones en la tabla de bancos"

    with open(ruta_csv, encoding="utf-8-sig", newline="") as f:
        filas = list(csv.reader(f))
    if not filas or COLUMNA_BANCO not in filas[0]:
        return f"ERROR: no se encontro la columna {COLUMNA_BANCO} en el CSV"
    col = filas[0].index(COLUMNA_BANCO)

    cache = {}
    reemplazos = 0
    sin_coincidencia = {}
    for nro_fila, fila in enumerate(filas[1:], start=2):
        if len(fila) <= col or fila[col].strip() == "":
            continue
        valor = fila[col].strip()
        if valor not in cache:
            mejor = max(descripciones, key=lambda d: _puntaje(valor, d))
            cache[valor] = mejor if _puntaje(valor, mejor) >= UMBRAL else None
        if cache[valor] is None:
            sin_coincidencia.setdefault(valor, []).append(f"fila {nro_fila}")
        elif fila[col] != cache[valor]:
            fila[col] = cache[valor]
            reemplazos += 1

    with open(ruta_csv, "w", encoding="utf-8", newline="") as f:
        csv.writer(f, lineterminator="\n").writerows(filas)
    detalle = "; ".join(f"{k} -> {v}" for k, v in cache.items() if v)
    resultado = f"OK: {reemplazos} celdas reemplazadas. {detalle}"
    if sin_coincidencia:
        resultado += " | SIN COINCIDENCIA: " + "; ".join(
            f"{k} ({', '.join(v)})" for k, v in sin_coincidencia.items()
        )
    return resultado


if __name__ == "__main__":
    print(normalizar_bancos([
        r"C:\Users\walter\Downloads\transferencias-30-10-2026.csv",
        r"C:\Users\walter\Downloads\EJEMPLO_PROVEEDORES-GS NO EDITAR.xlsx",
    ]))