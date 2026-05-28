from pathlib import Path
import pandas as pd
import numpy as np
import random
from datetime import datetime, timedelta

# Archivo original
input_path = Path(r"C:\Users\walte\Downloads\ConsumoClaro 2026-05-21 (1).csv")

# Leer archivo
df = pd.read_csv(input_path, sep=";", header=None)

# Limpiar columnas vacías extra si existen
df = df.dropna(axis=1, how="all")

# Convertir fecha base
base_date = datetime.strptime(str(df.iloc[0, 4]), "%d/%m/%Y")

# Carpeta de salida
output_folder = Path(r"C:\Users\walte\Downloads\ClaroGenerados")
output_folder.mkdir(exist_ok=True)

# Generar 10 archivos
for i in range(1, 11):

    current_date = base_date + timedelta(days=i)

    temp_df = df.copy()

    # Eliminar hasta 10 filas aleatorias
    rows_to_remove = random.randint(0, 10)

    if rows_to_remove > 0:
        drop_idx = random.sample(
            list(temp_df.index),
            rows_to_remove
        )

        temp_df = temp_df.drop(drop_idx)

    # Generar consumo random
    original_consumption = pd.to_numeric(
        temp_df[3],
        errors="coerce"
    ).fillna(0)

    # Variación aleatoria
    random_variation = np.random.randint(
        -15,
        16,
        size=len(temp_df)
    )

    new_consumption = (
        original_consumption + random_variation
    ).clip(lower=0)

    temp_df[3] = new_consumption.astype(int)

    # Actualizar fecha
    temp_df[4] = current_date.strftime("%d/%m/%Y")

    # Nombre del archivo
    output_file = output_folder / (
        f"ConsumoClaro_{current_date.strftime('%Y-%m-%d')}.csv"
    )

    # Guardar archivo
    temp_df.to_csv(
        output_file,
        sep=";",
        header=False,
        index=False
    )

    print(f"Archivo generado: {output_file}")

print("\nSe generaron los 10 archivos correctamente.")