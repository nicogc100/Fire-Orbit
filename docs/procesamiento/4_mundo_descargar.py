"""
Paso 4 (mundial): descarga los CSV anuales de NASA FIRMS de TODOS los países y los
resume en una grilla, año por año, borrando el CSV crudo después de resumirlo.

Así el disco nunca guarda todo el crudo del mundo (serían más de 50 GB): solo los
resúmenes, que pesan poco. Se puede cortar y volver a ejecutar: continúa donde quedó.

Sensores:
  modis          MODIS (Terra + Aqua), 2000 en adelante
  viirs-snpp     VIIRS Suomi NPP, 2012 en adelante (dejó de operar el 2 nov 2026)
  noaa20         VIIRS NOAA-20, 2018 en adelante (el reemplazo de Suomi NPP)

Qué guarda por cada país, sensor y año (en <carpeta>/resumen/<sensor>/<año>/<país>.csv):
  gi, gj  celda de 0,25° (lat = gi*0.25, lon = gj*0.25, esquina suroeste)
  mes     1 a 12
  n       celdas-día con fuego de vegetación (~1 km), igual que en 2_armonizar.py
  n_conf  lo mismo, pero sin detecciones de confianza baja (para comparar después)

Uso (en Windows, desde la carpeta globo-incendios):
    python procesamiento/4_mundo_descargar.py --prueba        # 1 minuto: comprueba que todo funcione
    python procesamiento/4_mundo_descargar.py                 # todo el mundo (varias horas)

Opciones:
    --carpeta C:\\firms     dónde trabajar (NO usar una carpeta de OneDrive)
    --hilos 4              descargas en paralelo
    --desde 2000 --hasta 2025
"""
import argparse
import io
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import quote

import numpy as np
import pandas as pd
import requests

BASE = "https://firms.modaps.eosdis.nasa.gov"
CELDA_FINA = 0.01
CELDA_GRILLA = 0.25
# Nombre de cada sensor en las URL de FIRMS. Para NOAA-20 no hay un nombre documentado,
# así que se prueban varios con un país y año que seguro tienen datos.
PRODUCTOS = {
    "modis": (2000, ["modis"]),
    "viirs-snpp": (2012, ["viirs-snpp"]),
    "noaa20": (2018, ["viirs-noaa20", "viirs-noaa-20", "noaa-20-viirs", "viirs-jpss1", "viirs-j1"]),
}

sesion = requests.Session()
sesion.headers["User-Agent"] = "atlas-del-fuego (NASA Space Apps)"
candado = threading.Lock()


def get(url, intentos=4, timeout=300):
    for i in range(intentos):
        try:
            r = sesion.get(url, timeout=timeout)
            if r.status_code in (200, 404):
                return r
        except requests.RequestException:
            pass
        time.sleep(5 * (i + 1))
    return None


def es_csv(r):
    return r is not None and r.status_code == 200 and r.content[:8].lower().startswith(b"latitude")


# ---------- lista de países ----------
MAPA = Path(__file__).resolve().parent.parent / "tierra" / "assets" / "paises-50m.geo.json"
# Nombres alternativos para países cuyo nombre en el mapa no coincide con el de FIRMS
EXTRA = {
    "United States of America": ["United States", "USA"],
    "Russian Federation": ["Russia"],
    "Democratic Republic of the Congo": ["Democratic Republic of Congo", "Congo DRC", "Congo, The Democratic Republic of the", "DR Congo"],
    "Congo": ["Republic of the Congo", "Republic of Congo", "Congo, Republic of the"],
    "Ivory Coast": ["Cote d'Ivoire", "Côte d'Ivoire", "Cote dIvoire"],
    "Czechia": ["Czech Republic"], "Türkiye": ["Turkey"], "Eswatini": ["Swaziland"],
    "North Macedonia": ["Macedonia"], "Myanmar": ["Burma"], "Timor-Leste": ["East Timor"],
    "Vietnam": ["Viet Nam"], "Laos": ["Lao PDR", "Lao People's Democratic Republic"],
    "South Korea": ["Korea, Republic of", "Republic of Korea"], "North Korea": ["Korea, Democratic People's Republic of"],
    "Tanzania": ["United Republic of Tanzania", "Tanzania, United Republic of"],
    "Iran": ["Iran, Islamic Republic of"], "Syria": ["Syrian Arab Republic"], "Bolivia": ["Bolivia, Plurinational State of"],
    "Venezuela": ["Venezuela, Bolivarian Republic of"], "Moldova": ["Moldova, Republic of"],
    "Central African Republic": ["Central African Rep."], "Cape Verde": ["Cabo Verde"],
    "Gambia": ["The Gambia", "Gambia, The"], "Bahamas": ["The Bahamas"],
    "Brunei": ["Brunei Darussalam"], "Palestine": ["Palestinian Territory", "West Bank"],
    "São Tomé and Príncipe": ["Sao Tome and Principe"], "Falkland Islands": ["Falkland Islands (Malvinas)"],
}


def nombres_desde_api(carpeta):
    r = get(f"{BASE}/api/countries/", timeout=120)
    if r is None:
        return set()
    (carpeta / "debug_api_countries.txt").write_bytes(r.content[:20000])
    if r.status_code != 200:
        return set()
    for sep in (";", ",", "\t"):
        try:
            tabla = pd.read_csv(io.StringIO(r.text), sep=sep)
        except Exception:
            continue
        cols = [c for c in tabla.columns if "name" in c.strip().lower()]
        if cols and len(tabla) > 50:
            return {str(n).strip().replace(" ", "_") for n in tabla[cols[0]].dropna()}
    return set()


def nombres_desde_mapa(carpeta, hilos):
    """Plan B: prueba los nombres (y alias en inglés) del mapa de la app hasta encontrar el de FIRMS."""
    import json
    paises = json.loads(MAPA.read_text(encoding="utf-8"))["features"]

    def buscar(props):
        candidatos = ([props["name"]] + EXTRA.get(props["name"], [])
                      + [a for a in props.get("aliases", []) if len(a) > 3 and a.isascii()])
        vistos = []
        for c in candidatos:
            c = c.replace(" ", "_")
            if c in vistos:
                continue
            vistos.append(c)
            for anio in (2020, 2015, 2023):
                r = get(f"{BASE}/data/country/modis/{anio}/{quote(f'modis_{anio}_{c}.csv')}", intentos=2, timeout=120)
                if es_csv(r):
                    return c
        return None

    print(f"Buscando el nombre de cada país en FIRMS ({len(paises)} países del mapa, tarda unos minutos)...")
    encontrados = set()
    with ThreadPoolExecutor(max_workers=hilos) as pool:
        for i, nombre in enumerate(pool.map(buscar, [f["properties"] for f in paises]), 1):
            if nombre:
                encontrados.add(nombre)
            if i % 40 == 0:
                print(f"  {i}/{len(paises)} revisados, {len(encontrados)} encontrados")
    return encontrados


def lista_paises(carpeta, hilos):
    """Nombres de país tal como FIRMS los usa en los archivos anuales."""
    guardada = carpeta / "paises.txt"
    if guardada.exists():
        return [l for l in guardada.read_text(encoding="utf-8").splitlines() if l.strip()]
    nombres = nombres_desde_api(carpeta)
    origen = "API de países de FIRMS"
    if len(nombres) < 50:
        r = get(f"{BASE}/country/", timeout=120)
        if r is not None and r.status_code == 200:
            (carpeta / "debug_pagina_country.html").write_bytes(r.content[:200000])
            nombres = {m.group(1) for m in re.finditer(
                r"data/country/[^/\"']+/\d{4}/[^_\"']+_\d{4}_([^\"'/]+?)\.csv", r.text)}
            origen = "página de resúmenes por país"
    if len(nombres) < 50:
        nombres = nombres_desde_mapa(carpeta, hilos)
        origen = "nombres del mapa de la app"
    if len(nombres) < 50:
        sys.exit("No se pudo obtener la lista de países de FIRMS. Avísale a Claude con una captura.")
    print(f"Lista de países: {len(nombres)} (desde {origen})")
    nombres = sorted(nombres)
    guardada.write_text("\n".join(nombres), encoding="utf-8")
    return nombres


def detectar_producto(clave, carpeta):
    """Encuentra el nombre que FIRMS usa en la URL para un sensor (prueba con Chile 2023)."""
    marca = carpeta / f"producto_{clave}.txt"
    if marca.exists():
        return marca.read_text().strip() or None
    for nombre in PRODUCTOS[clave][1]:
        r = get(f"{BASE}/data/country/{nombre}/2023/{nombre}_2023_Chile.csv")
        if es_csv(r):
            marca.write_text(nombre)
            return nombre
    marca.write_text("")
    return None


# ---------- resumen de un archivo ----------
def baja_confianza(df):
    c = df["confidence"].astype(str).str.strip().str.lower()
    num = pd.to_numeric(c, errors="coerce")
    return (c == "l") | (num < 30)


def resumir(df):
    df = df[df["type"] == 0] if "type" in df.columns else df
    if df.empty:
        return pd.DataFrame(columns=["gi", "gj", "mes", "n", "n_conf"])
    lat, lon = df["latitude"].to_numpy(), df["longitude"].to_numpy()
    base = pd.DataFrame({
        "fecha": df["acq_date"].to_numpy(),
        "ci": np.floor(lat / CELDA_FINA).astype(np.int32),
        "cj": np.floor(lon / CELDA_FINA).astype(np.int32),
        "baja": baja_confianza(df).to_numpy() if "confidence" in df.columns else False,
    })
    # Una celda-día cuenta en n_conf si tuvo al menos una detección que no es de confianza baja
    dia = base.groupby(["fecha", "ci", "cj"], sort=False)["baja"].min().reset_index()
    dia["mes"] = pd.to_datetime(dia["fecha"]).dt.month.astype(np.int8)
    dia["gi"] = np.floor(dia["ci"] * CELDA_FINA / CELDA_GRILLA + 1e-9).astype(np.int32)
    dia["gj"] = np.floor(dia["cj"] * CELDA_FINA / CELDA_GRILLA + 1e-9).astype(np.int32)
    dia["conf"] = ~dia["baja"]
    out = dia.groupby(["gi", "gj", "mes"]).agg(n=("conf", "size"), n_conf=("conf", "sum")).reset_index()
    out["n_conf"] = out["n_conf"].astype(int)
    return out


def tarea(carpeta, clave, producto, anio, pais, conservar):
    destino = carpeta / "resumen" / clave / str(anio) / f"{pais}.csv"
    if destino.exists():
        return "ya", 0
    nombre = f"{producto}_{anio}_{pais}.csv"
    r = get(f"{BASE}/data/country/{producto}/{anio}/{quote(nombre)}")
    destino.parent.mkdir(parents=True, exist_ok=True)
    if r is None:
        return "error", 0  # sin marca: se reintenta en la próxima ejecución
    if not es_csv(r):
        destino.write_text("gi,gj,mes,n,n_conf\n")  # el país no tuvo detecciones ese año
        return "sin datos", 0
    if conservar:
        crudo = carpeta / "crudos" / clave / nombre
        crudo.parent.mkdir(parents=True, exist_ok=True)
        crudo.write_bytes(r.content)
    columnas = ["latitude", "longitude", "acq_date", "confidence", "type"]
    df = pd.read_csv(io.BytesIO(r.content), usecols=lambda c: c in columnas, dtype={"confidence": str})
    filas = len(df)
    resumir(df).to_csv(destino, index=False)
    return "ok", filas


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    defecto = Path("C:/firms") if os.name == "nt" else Path.home() / "firms"
    p.add_argument("--carpeta", type=Path, default=defecto)
    p.add_argument("--desde", type=int, default=2000)
    p.add_argument("--hasta", type=int, default=2025)
    p.add_argument("--hilos", type=int, default=4)
    p.add_argument("--sensores", default="modis,viirs-snpp,noaa20")
    p.add_argument("--paises", help="Solo estos países, separados por coma (nombres de FIRMS)")
    p.add_argument("--prueba", action="store_true", help="Prueba rápida: 3 países, año 2023")
    p.add_argument("--conservar", action="store_true", help="No borrar los CSV crudos (ocupa mucho espacio)")
    args = p.parse_args()

    if "onedrive" in str(args.carpeta.resolve()).lower():
        sys.exit("La carpeta está dentro de OneDrive: elige otra, por ejemplo --carpeta C:\\firms")
    args.carpeta.mkdir(parents=True, exist_ok=True)
    print(f"Carpeta de trabajo: {args.carpeta}")

    productos = {}
    for clave in args.sensores.split(","):
        nombre = detectar_producto(clave, args.carpeta)
        print(f"Sensor {clave}: {'nombre en FIRMS = ' + nombre if nombre else 'NO ENCONTRADO en los archivos anuales (se omite)'}")
        if nombre:
            productos[clave] = nombre

    if args.prueba:
        paises, anios = ["Chile", "Brazil", "United_States"], [2023]
    else:
        paises = args.paises.split(",") if args.paises else lista_paises(args.carpeta, args.hilos)
        anios = list(range(args.desde, args.hasta + 1))
    print(f"Países: {len(paises)} | años: {anios[0]}-{anios[-1]}")

    tareas = [(clave, prod, anio, pais) for clave, prod in productos.items()
              for anio in anios if anio >= PRODUCTOS[clave][0] for pais in paises]
    total, hechas, filas_total, t0 = len(tareas), 0, 0, time.time()
    errores = []
    with ThreadPoolExecutor(max_workers=args.hilos) as pool:
        futuros = {pool.submit(tarea, args.carpeta, *t, args.conservar): t for t in tareas}
        for f in as_completed(futuros):
            clave, _, anio, pais = futuros[f]
            hechas += 1
            try:
                estado, filas = f.result()
            except Exception as e:
                estado, filas = f"error: {e}", 0
            filas_total += filas
            if estado.startswith("error"):
                errores.append(f"{clave} {anio} {pais}: {estado}")
            if estado == "ok" or estado.startswith("error") or hechas % 50 == 0:
                minutos = (time.time() - t0) / 60
                print(f"[{hechas}/{total}] {clave} {anio} {pais}: {estado}"
                      + (f" ({filas:,} detecciones)" if filas else "") + f" | {minutos:.0f} min")

    print(f"\nListo: {hechas} tareas, {filas_total:,} detecciones resumidas.")
    if errores:
        (args.carpeta / "errores.txt").write_text("\n".join(errores), encoding="utf-8")
        print(f"{len(errores)} fallaron (vuelve a ejecutar el mismo comando para reintentarlas). Lista en errores.txt")
    if args.prueba:
        print("\nPrueba terminada. Mándale a Claude una captura de esta pantalla.")


if __name__ == "__main__":
    main()
