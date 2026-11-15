"""
Paso 1: descarga los CSV anuales de NASA FIRMS para un país.
  MODIS (Terra + Aqua), colección 6.1: 2000 en adelante
  VIIRS S-NPP 375 m: 2012 en adelante
No necesita cuenta ni MAP_KEY.

Uso (desde la carpeta globo-incendios):
    pip install requests pandas
    python procesamiento/1_descargar.py
    python procesamiento/1_descargar.py --pais Portugal --hasta 2025

Los CSV quedan en procesamiento/crudos/<País>/ (esa carpeta no se sube a GitHub).
Si un archivo ya existe, no se vuelve a descargar.
"""
import argparse
import time
from pathlib import Path

import requests

BASE = "https://firms.modaps.eosdis.nasa.gov/data/country"
PRODUCTOS = {"modis": 2000, "viirs-snpp": 2012}  # producto: primer año disponible
CARPETA = Path(__file__).resolve().parent / "crudos"


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--pais", default="Chile", help="Nombre en inglés, como lo usa FIRMS (Chile, Portugal, Argentina…)")
    p.add_argument("--hasta", type=int, default=2025, help="Último año (el archivo anual llega hasta el año anterior)")
    args = p.parse_args()

    destino_pais = CARPETA / args.pais
    destino_pais.mkdir(parents=True, exist_ok=True)
    faltantes = []

    for producto, inicio in PRODUCTOS.items():
        for anio in range(inicio, args.hasta + 1):
            nombre = f"{producto}_{anio}_{args.pais}.csv"
            destino = destino_pais / nombre
            if destino.exists() and destino.stat().st_size > 0:
                print(f"Ya existe: {nombre}")
                continue
            url = f"{BASE}/{producto}/{anio}/{nombre}"
            try:
                r = requests.get(url, timeout=180)
            except requests.RequestException as e:
                print(f"Error de conexión en {nombre}: {e}")
                faltantes.append(nombre)
                continue
            if r.status_code == 200 and r.content.startswith(b"latitude"):
                destino.write_bytes(r.content)
                print(f"OK: {nombre} ({len(r.content) / 1e6:.1f} MB)")
            else:
                print(f"No disponible ({r.status_code}): {nombre}")
                faltantes.append(nombre)
            time.sleep(1)  # pausa para no saturar el servidor

    print(f"\nListo. Archivos en {destino_pais}")
    if faltantes:
        print("Faltaron (vuelve a ejecutar el script para reintentar):")
        for f in faltantes:
            print("  -", f)


if __name__ == "__main__":
    main()
