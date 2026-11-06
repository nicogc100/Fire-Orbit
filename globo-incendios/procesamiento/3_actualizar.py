"""
Paso 3: agrega los meses del año en curso (2026) usando la API de NASA FIRMS.

Los archivos anuales por país llegan solo hasta el año pasado. Este script pide
los datos recientes de VIIRS S-NPP a la API (necesita una MAP_KEY gratis) y los
agrega a chile-mensual.json, chile-grilla.json y chile-2026.json.

- Usa VIIRS S-NPP, igual que la serie harmonizada desde 2012 (no hace falta factor).
- Usa la versión definitiva (SP) donde ya existe y la de tiempo casi real (NRT) en
  los días más recientes.
- La API trabaja con rectángulos, así que se filtran los puntos que caen dentro
  del polígono de Chile (para no contar incendios de Argentina).
- Los datos NRT no traen el campo "type" (vegetación / industria / volcán), así que
  se descartan las celdas que en el histórico 2012-2025 fueron industria, volcán o
  mar adentro.

Uso (desde la carpeta globo-incendios, después de los pasos 1 y 2):
    python procesamiento/3_actualizar.py --key TU_MAP_KEY
La MAP_KEY se pide gratis en https://firms.modaps.eosdis.nasa.gov/api/map_key/
"""
import argparse
import io
import json
import time
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import requests

AQUI = Path(__file__).resolve().parent
CRUDOS = AQUI / "crudos"
DATA = AQUI.parent / "data"
PAISES = AQUI.parent / "tierra" / "assets" / "paises-50m.geo.json"
API = "https://firms.modaps.eosdis.nasa.gov/api"

CAJA_CHILE = "-76,-56.5,-66,-17"  # oeste,sur,este,norte (Chile continental)
CELDA_FINA = 0.01
CELDA_GRILLA = 0.25
DIAS_POR_CONSULTA = 5


# ---------- utilidades ----------
def punto_en_poligono(lon, lat, anillo):
    """Ray casting vectorizado: True para los puntos dentro del anillo."""
    x, y = np.asarray(lon), np.asarray(lat)
    dentro = np.zeros(len(x), dtype=bool)
    xs, ys = anillo[:, 0], anillo[:, 1]
    j = len(anillo) - 1
    for i in range(len(anillo)):
        cruza = ((ys[i] > y) != (ys[j] > y)) & (x < (xs[j] - xs[i]) * (y - ys[i]) / (ys[j] - ys[i] + 1e-12) + xs[i])
        dentro ^= cruza
        j = i
    return dentro


def dentro_de_pais(df, nombre):
    paises = json.loads(PAISES.read_text(encoding="utf-8"))
    feat = next(f for f in paises["features"] if f["properties"]["name"] == nombre)
    geom = feat["geometry"]
    poligonos = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    mascara = np.zeros(len(df), dtype=bool)
    for poligono in poligonos:
        exterior = punto_en_poligono(df["longitude"], df["latitude"], np.array(poligono[0]))
        for hueco in poligono[1:]:
            exterior &= ~punto_en_poligono(df["longitude"], df["latitude"], np.array(hueco))
        mascara |= exterior
    return mascara


def celdas_no_vegetacion(pais):
    """Celdas de ~1 km que en el histórico VIIRS fueron industria, volcán o mar adentro."""
    celdas = set()
    for archivo in sorted((CRUDOS / pais).glob("viirs-snpp_*.csv")):
        df = pd.read_csv(archivo, usecols=["latitude", "longitude", "type"])
        df = df[df["type"] != 0]
        celdas.update(zip(np.floor(df["latitude"] / CELDA_FINA).astype(int),
                          np.floor(df["longitude"] / CELDA_FINA).astype(int)))
    return celdas


def fecha_maxima_sp(key):
    try:
        r = requests.get(f"{API}/data_availability/csv/{key}/VIIRS_SNPP_SP", timeout=60)
        tabla = pd.read_csv(io.StringIO(r.text))
        return pd.to_datetime(tabla["max_date"].iloc[0]).date()
    except Exception:
        return None


def pedir(key, fuente, inicio, dias):
    """inicio=None pide los últimos 'dias' días hasta hoy (la forma que FIRMS recomienda para lo más reciente)."""
    url = f"{API}/area/csv/{key}/{fuente}/{CAJA_CHILE}/{dias}" + (f"/{inicio.isoformat()}" if inicio else "")
    for intento in range(3):
        try:
            r = requests.get(url, timeout=180)
            if r.status_code == 200 and r.text.startswith("latitude"):
                return pd.read_csv(io.StringIO(r.text), dtype={"version": str, "confidence": str, "satellite": str})
            if "Invalid" in r.text:
                raise SystemExit(f"La API respondió: {r.text.strip()[:200]}. Revisa tu MAP_KEY.")
        except requests.RequestException:
            pass
        time.sleep(3 * (intento + 1))
    print(f"  No se pudo descargar {fuente} desde {inicio}")
    return pd.DataFrame()


def corregir_version_anterior(mensual, inicio_base=2003):
    """Marca 2000-2002 como incompletos y recalcula las medianas desde 2003."""
    mensual["incompleto"] = [int(m[:4]) < inicio_base for m in mensual["meses"]]
    stats = {k: [] for k in ("mediana", "p25", "p75", "maximo")}
    for mm in range(1, 13):
        v = np.array([a for m, a in zip(mensual["meses"], mensual["armonizado"])
                      if int(m[5:]) == mm and int(m[:4]) >= inicio_base and a is not None])
        stats["mediana"].append(round(float(np.median(v)), 1))
        stats["p25"].append(round(float(np.percentile(v, 25)), 1))
        stats["p75"].append(round(float(np.percentile(v, 75)), 1))
        stats["maximo"].append(round(float(v.max()), 1))
    ultimo = max(int(m[:4]) for m in mensual["meses"])
    mensual["por_mes_calendario"] = {**stats, "anios_base": [inicio_base, ultimo]}


# ---------- principal ----------
def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--key", required=True, help="Tu MAP_KEY de FIRMS")
    p.add_argument("--pais", default="Chile")
    p.add_argument("--anio", type=int, default=date.today().year)
    args = p.parse_args()
    slug = args.pais.lower().replace(" ", "-")

    ruta_mensual = DATA / f"{slug}-mensual.json"
    ruta_grilla = DATA / f"{slug}-grilla.json"
    mensual = json.loads(ruta_mensual.read_text(encoding="utf-8"))
    if "incompleto" not in mensual:
        print("Aviso: chile-mensual.json es de la versión anterior; se corrige (incompletos y medianas desde 2003).")
        corregir_version_anterior(mensual)
    grilla = json.loads(ruta_grilla.read_text(encoding="utf-8"))

    # 1. Descargar por tramos de 5 días
    inicio, hoy = date(args.anio, 1, 1), date.today()
    max_sp = fecha_maxima_sp(args.key)
    print(f"Datos definitivos (SP) disponibles hasta: {max_sp or 'desconocido'}; después se usa NRT")
    cache = CRUDOS / args.pais / f"viirs-api_{args.anio}.csv"
    if cache.exists() and date.fromtimestamp(cache.stat().st_mtime) == hoy:
        print(f"Usando lo descargado hoy: {cache.name} (bórralo para descargar de nuevo)")
        df = pd.read_csv(cache, dtype={"version": str, "confidence": str, "satellite": str})
    else:
        partes, d = [], inicio
        while d <= hoy:
            dias = min(DIAS_POR_CONSULTA, (hoy - d).days + 1)
            fin = d + timedelta(days=dias - 1)
            fuente = "VIIRS_SNPP_SP" if max_sp and fin <= max_sp else "VIIRS_SNPP_NRT"
            # el último tramo (el que llega a hoy) se pide sin fecha: "los últimos N días"
            df = pedir(args.key, fuente, None if fin == hoy else d, dias)
            if not df.empty:
                df["fuente"] = fuente
                partes.append(df)
            print(f"  {d} ({dias} días, {fuente}): {len(df)} detecciones")
            d += timedelta(days=dias)
            time.sleep(1)
        if not partes:
            raise SystemExit("No llegaron datos. Revisa la MAP_KEY y la conexión.")
        df = pd.concat(partes, ignore_index=True)
        cache.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(cache, index=False)
    df = df.drop_duplicates(["latitude", "longitude", "acq_date", "acq_time"])
    df = df[pd.to_datetime(df["acq_date"]).dt.year == args.anio]

    # 2. Filtrar: dentro del país y solo vegetación
    n0 = len(df)
    df = df[dentro_de_pais(df, args.pais)]
    n_pais = len(df)
    if "type" in df.columns:
        df = df[df["type"].fillna(0) == 0]
    malas = celdas_no_vegetacion(args.pais)
    ci = np.floor(df["latitude"] / CELDA_FINA).astype(int)
    cj = np.floor(df["longitude"] / CELDA_FINA).astype(int)
    df = df[[c not in malas for c in zip(ci, cj)]].copy()
    print(f"Detecciones: {n0} en el rectángulo, {n_pais} dentro de {args.pais}, {len(df)} de vegetación")

    df["fecha"] = pd.to_datetime(df["acq_date"])
    df["mes"] = df["fecha"].dt.to_period("M")
    df["ci"] = np.floor(df["latitude"] / CELDA_FINA).astype(int)
    df["cj"] = np.floor(df["longitude"] / CELDA_FINA).astype(int)
    finas = df.drop_duplicates(["fecha", "ci", "cj"])

    # 3. Agregar los meses nuevos a chile-mensual.json (reemplaza los del año si ya estaban)
    meses_nuevos = [str(m) for m in pd.period_range(f"{args.anio}-01", hoy.strftime("%Y-%m"), freq="M")]
    conservar = [i for i, m in enumerate(mensual["meses"]) if not m.startswith(str(args.anio))]
    listas = ["meses", "modis", "viirs", "detecciones_modis", "detecciones_viirs", "armonizado", "origen", "incompleto"]
    for campo in listas:
        mensual[campo] = [mensual[campo][i] for i in conservar]
    cuenta = finas.groupby(finas["mes"].astype(str)).size()
    detec = df.groupby(df["mes"].astype(str)).size()
    nrt_por_mes = df.groupby(df["mes"].astype(str))["fuente"].apply(lambda s: (s == "VIIRS_SNPP_NRT").any())
    for m in meses_nuevos:
        v = int(cuenta.get(m, 0))
        mensual["meses"].append(m)
        mensual["modis"].append(None)
        mensual["viirs"].append(v)
        mensual["detecciones_modis"].append(None)
        mensual["detecciones_viirs"].append(int(detec.get(m, 0)))
        mensual["armonizado"].append(float(v))
        mensual["origen"].append("VIIRS NRT" if bool(nrt_por_mes.get(m, False)) else "VIIRS")
        mensual["incompleto"].append(m == hoy.strftime("%Y-%m"))  # el mes en curso aún no termina
    mensual["actualizado_hasta"] = hoy.isoformat()
    mensual["metodo"]["nota_anio_en_curso"] = (
        f"{args.anio}: VIIRS S-NPP desde la API de FIRMS (SP donde existe, NRT en los días recientes), "
        f"filtrado al polígono de {args.pais}. NRT no trae 'type': se excluyen las celdas que en 2012-2025 "
        "fueron industria, volcán o mar adentro. El mes en curso va marcado como incompleto.")
    ruta_mensual.write_text(json.dumps(mensual, ensure_ascii=False), encoding="utf-8")

    # 4. Grilla: rehacer los índices de mes y agregar el año nuevo
    idx_viejo = {m: i for i, m in enumerate(grilla["meses"])}
    idx_nuevo = {m: i for i, m in enumerate(mensual["meses"])}
    por_celda = {}
    for c in grilla["celdas"]:
        # se descartan los meses del año que se está actualizando (así se puede correr varias veces)
        v = [[idx_nuevo[grilla["meses"][i]], x] for i, x in c["v"]
             if grilla["meses"][i] in idx_nuevo and not grilla["meses"][i].startswith(str(args.anio))]
        por_celda[(c["lat"], c["lon"])] = v
    finas = finas.assign(gi=np.floor(finas["latitude"] / CELDA_GRILLA).astype(int),
                         gj=np.floor(finas["longitude"] / CELDA_GRILLA).astype(int))
    for (gi, gj, mes), n in finas.groupby(["gi", "gj", finas["mes"].astype(str)]).size().items():
        clave = (round(gi * CELDA_GRILLA, 2), round(gj * CELDA_GRILLA, 2))
        por_celda.setdefault(clave, []).append([idx_nuevo[mes], float(n)])
    grilla["meses"] = mensual["meses"]
    grilla["celdas"] = [{"lat": la, "lon": lo, "v": sorted(v)} for (la, lo), v in sorted(por_celda.items()) if v]
    ruta_grilla.write_text(json.dumps(grilla, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # 5. Detecciones crudas del año, mismo formato que chile-2023.json
    registros = [{
        "lat": float(x.latitude), "lon": float(x.longitude), "fecha": x.acq_date,
        "hora": str(int(x.acq_time)).zfill(4), "sensor": "VIIRS", "satelite": str(x.satellite),
        "frp": float(x.frp), "periodo": x.daynight, "confianza": str(x.confidence), "version": str(x.version),
    } for x in df.sort_values(["acq_date", "acq_time"]).itertuples()]
    (DATA / f"{slug}-{args.anio}.json").write_text(
        json.dumps({"pais": args.pais, "anio": args.anio, "registros": registros}, ensure_ascii=False,
                   separators=(",", ":")), encoding="utf-8")

    # Resumen
    med = mensual["por_mes_calendario"]["mediana"]
    print(f"\n{args.anio} agregado. Comparación con la mediana histórica:")
    for m in meses_nuevos:
        v = cuenta.get(m, 0)
        normal = med[int(m[5:]) - 1]
        extra = " (mes en curso, incompleto)" if m == hoy.strftime("%Y-%m") else ""
        print(f"  {m}: {v:>6}  normal {normal:>7.0f}  -> {v / normal if normal else 0:4.1f} veces lo normal{extra}")
    print(f"Archivos actualizados: {slug}-mensual.json, {slug}-grilla.json, {slug}-{args.anio}.json")


if __name__ == "__main__":
    main()
