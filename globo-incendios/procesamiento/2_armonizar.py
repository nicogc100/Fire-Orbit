"""
Paso 2: harmoniza MODIS y VIIRS y genera los archivos que usa la app.

Método (resumen):
  1. Filtro: solo fuegos de vegetación (type == 0) y coordenadas válidas.
  2. Misma grilla para ambos sensores: cada detección se asigna a una celda de
     0,01° (~1 km, el tamaño de un píxel MODIS). Se cuenta una "celda-día"
     por celda y por día, aunque esa celda tenga varias detecciones ese día.
     Así VIIRS (375 m) no cuenta 5 veces el mismo fuego que MODIS ve como 1.
  3. Calibración con el traslape (años con ambos sensores, 2012 en adelante):
     para cada mes del calendario m, factor f_m = suma VIIRS / suma MODIS.
  4. Serie harmonizada en "unidades VIIRS":
       años con VIIRS  -> conteo VIIRS
       años sin VIIRS  -> conteo MODIS × f_m
  5. Validación cruzada: se deja fuera un año del traslape, se calibra con el
     resto y se predice ese año. El error indica qué tan confiable es la
     reconstrucción 2000-2011.

Uso (desde la carpeta globo-incendios, después de 1_descargar.py):
    pip install pandas numpy
    python procesamiento/2_armonizar.py
    python procesamiento/2_armonizar.py --pais Chile --anuales

Salidas en data/:
    <pais>-mensual.json   serie mensual 2000-hoy (MODIS, VIIRS, harmonizada) + medianas
    <pais>-grilla.json    conteos harmonizados por celda de 0,25° y mes (para elegir áreas)
    <pais>-AAAA.json      (con --anuales) detecciones crudas por año, mismo formato que chile-2023.json
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

AQUI = Path(__file__).resolve().parent
CRUDOS = AQUI / "crudos"
DATA = AQUI.parent / "data"

CELDA_FINA = 0.01    # ~1 km, para contar celdas-día
CELDA_GRILLA = 0.25  # ~25 km, para la selección de áreas en la app
MIN_MODIS_FACTOR = 30  # si un mes tiene menos celdas-día MODIS que esto en el traslape, se usa el factor global
ANIO_BASE_INICIO = 2003  # primer año completo con MODIS Terra + Aqua; antes los datos están incompletos


def leer_sensor(carpeta: Path, prefijo: str, sensor: str) -> tuple[pd.DataFrame, list[dict]]:
    tablas, procedencia = [], []
    for archivo in sorted(carpeta.glob(f"{prefijo}_*.csv")):
        df = pd.read_csv(archivo, dtype={"version": str, "confidence": str, "satellite": str})
        n0 = len(df)
        df = df[(df["type"] == 0)
                & df["latitude"].between(-90, 90) & df["longitude"].between(-180, 180)].copy()
        df["sensor"] = sensor
        tablas.append(df)
        procedencia.append({"archivo": archivo.name, "sensor": sensor,
                            "filas_originales": int(n0), "filas_incluidas": int(len(df))})
    if not tablas:
        return pd.DataFrame(), procedencia
    df = pd.concat(tablas, ignore_index=True)
    df["fecha"] = pd.to_datetime(df["acq_date"])
    df["mes"] = df["fecha"].dt.to_period("M")
    return df, procedencia


def celdas_dia(df: pd.DataFrame, tam: float) -> pd.DataFrame:
    """Una fila por (sensor, día, celda) con al menos una detección."""
    out = df[["sensor", "fecha", "mes", "latitude", "longitude"]].copy()
    out["ci"] = np.floor(out["latitude"] / tam).astype(int)
    out["cj"] = np.floor(out["longitude"] / tam).astype(int)
    return out.drop_duplicates(["sensor", "fecha", "ci", "cj"])


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--pais", default="Chile")
    p.add_argument("--anuales", action="store_true", help="Generar también los JSON crudos por año para la tabla y el CSV")
    args = p.parse_args()

    carpeta = CRUDOS / args.pais
    modis, proc_m = leer_sensor(carpeta, "modis", "MODIS")
    viirs, proc_v = leer_sensor(carpeta, "viirs-snpp", "VIIRS")
    if modis.empty or viirs.empty:
        raise SystemExit(f"Faltan CSV en {carpeta}. Ejecuta primero 1_descargar.py")
    DATA.mkdir(exist_ok=True)
    slug = args.pais.lower().replace(" ", "-")

    anios_m = set(modis["fecha"].dt.year.unique())
    anios_v = set(viirs["fecha"].dt.year.unique())
    traslape = sorted(anios_m & anios_v)

    # ---- 1. Conteos mensuales en celdas-día (~1 km) ----
    finas = celdas_dia(pd.concat([modis, viirs], ignore_index=True), CELDA_FINA)
    meses = pd.period_range(min(modis["mes"].min(), viirs["mes"].min()),
                            max(modis["mes"].max(), viirs["mes"].max()), freq="M")
    tabla = finas.groupby(["mes", "sensor"]).size().unstack(fill_value=0).reindex(meses, fill_value=0)
    tabla = tabla.reindex(columns=["MODIS", "VIIRS"], fill_value=0)
    det = pd.concat([modis, viirs]).groupby(["mes", "sensor"]).size().unstack(fill_value=0) \
        .reindex(meses, fill_value=0).reindex(columns=["MODIS", "VIIRS"], fill_value=0)

    # ---- 2. Factores por mes del calendario ----
    # S-NPP empieza el 20 de enero de 2012: ese mes está incompleto y no sirve para calibrar
    desde_viirs = lambda m: m.year in anios_v and not (m.year == min(anios_v) and m.month == 1)
    en_traslape = np.array([m.year in traslape and desde_viirs(m) for m in meses])
    t = tabla[en_traslape]
    factor_global = t["VIIRS"].sum() / max(t["MODIS"].sum(), 1)

    def factores(sub: pd.DataFrame) -> np.ndarray:
        fg = sub["VIIRS"].sum() / max(sub["MODIS"].sum(), 1)
        f = np.full(12, fg)
        for m in range(1, 13):
            s = sub[[x.month == m for x in sub.index]]
            if s["MODIS"].sum() >= MIN_MODIS_FACTOR:
                f[m - 1] = s["VIIRS"].sum() / s["MODIS"].sum()
        return f

    f_mes = factores(t)

    # ---- 3. Validación cruzada dejando un año fuera ----
    validacion = []
    for anio in traslape:
        entreno = t[[m.year != anio for m in t.index]]
        prueba = t[[m.year == anio for m in t.index]]
        if entreno.empty or prueba.empty:
            continue
        f = factores(entreno)
        pred = sum(prueba["MODIS"].iloc[i] * f[prueba.index[i].month - 1] for i in range(len(prueba)))
        real = prueba["VIIRS"].sum()
        validacion.append({"anio": int(anio), "viirs_real": int(real), "predicho_desde_modis": round(float(pred), 1),
                           "error_pct": round(float((pred - real) / real * 100), 1) if real else None})
    errores = [abs(v["error_pct"]) for v in validacion if v["error_pct"] is not None]
    pred_traslape = np.array([t["MODIS"].iloc[i] * f_mes[t.index[i].month - 1] for i in range(len(t))])
    r = float(np.corrcoef(pred_traslape, t["VIIRS"].to_numpy())[0, 1]) if len(t) > 2 else None

    # ---- 4. Serie harmonizada ----
    usa_viirs = np.array([desde_viirs(m) for m in meses])
    armonizado = np.where(usa_viirs, tabla["VIIRS"].to_numpy(),
                          tabla["MODIS"].to_numpy() * f_mes[[m.month - 1 for m in meses]])
    armonizado = np.round(armonizado, 1)

    # Medianas por mes del calendario: solo años completos y desde ANIO_BASE_INICIO
    # (2000-2002 tienen solo MODIS Terra o datos parciales y bajarían la "normalidad")
    serie = pd.Series(armonizado, index=meses)
    completos = [a for a in sorted({m.year for m in meses})
                 if (serie.index.year == a).sum() == 12 and a >= ANIO_BASE_INICIO]
    base = serie[[m.year in completos for m in serie.index]]
    stats = {k: [] for k in ("mediana", "p25", "p75", "maximo")}
    for m in range(1, 13):
        v = base[[x.month == m for x in base.index]].to_numpy()
        stats["mediana"].append(round(float(np.median(v)), 1))
        stats["p25"].append(round(float(np.percentile(v, 25)), 1))
        stats["p75"].append(round(float(np.percentile(v, 75)), 1))
        stats["maximo"].append(round(float(v.max()), 1))

    mensual = {
        "pais": args.pais,
        "generado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "unidad": "celdas-día con fuego (~1 km), equivalentes VIIRS",
        "meses": [str(m) for m in meses],
        "modis": tabla["MODIS"].astype(int).tolist(),
        "viirs": [int(v) if u else None for v, u in zip(tabla["VIIRS"], usa_viirs)],
        "detecciones_modis": det["MODIS"].astype(int).tolist(),
        "detecciones_viirs": det["VIIRS"].astype(int).tolist(),
        "armonizado": armonizado.tolist(),
        "origen": ["VIIRS" if u else "MODIS×f" for u in usa_viirs],
        "incompleto": [m.year < ANIO_BASE_INICIO for m in meses],
        "por_mes_calendario": {**stats, "anios_base": [int(completos[0]), int(completos[-1])] if completos else None},
        "metodo": {
            "filtro": "type == 0 (vegetación), coordenadas válidas",
            "celda_conteo_grados": CELDA_FINA,
            "anios_traslape": [int(traslape[0]), int(traslape[-1])] if traslape else None,
            "factor_global": round(float(factor_global), 3),
            "factores_por_mes": [round(float(x), 3) for x in f_mes],
            "correlacion_traslape": round(r, 3) if r is not None else None,
            "validacion_cruzada": validacion,
            "error_anual_mediano_pct": round(float(np.median(errores)), 1) if errores else None,
            "nota": (f"Los meses antes de {ANIO_BASE_INICIO} están marcados como 'incompleto': solo MODIS Terra "
                     "operaba (Aqua empezó a mediados de 2002) y los conteos salen muy bajos. "
                     f"Las medianas se calculan desde {ANIO_BASE_INICIO}."),
        },
        "procedencia": proc_m + proc_v,
    }
    (DATA / f"{slug}-mensual.json").write_text(json.dumps(mensual, ensure_ascii=False), encoding="utf-8")

    # ---- 5. Grilla 0,25° con conteos harmonizados por mes ----
    g = finas.copy()
    g["gi"] = np.floor(g["latitude"] / CELDA_GRILLA).astype(int)
    g["gj"] = np.floor(g["longitude"] / CELDA_GRILLA).astype(int)
    idx_mes = {m: i for i, m in enumerate(meses)}
    g["im"] = g["mes"].map(idx_mes)
    g["anio"] = g["fecha"].dt.year
    # Se usa VIIRS en años con VIIRS y MODIS×f en el resto, igual que la serie nacional
    con_viirs = g["mes"].map(desde_viirs)
    g = g[((g["sensor"] == "VIIRS") & con_viirs) | ((g["sensor"] == "MODIS") & ~con_viirs)]
    cnt = g.groupby(["gi", "gj", "im", "sensor"]).size().reset_index(name="n")
    cnt["valor"] = np.where(cnt["sensor"] == "MODIS",
                            cnt["n"] * f_mes[[meses[i].month - 1 for i in cnt["im"]]], cnt["n"])
    celdas = []
    for (gi, gj), sub in cnt.groupby(["gi", "gj"]):
        celdas.append({"lat": round(gi * CELDA_GRILLA, 2), "lon": round(gj * CELDA_GRILLA, 2),
                       "v": [[int(i), round(float(v), 1)] for i, v in zip(sub["im"], sub["valor"])]})
    grilla = {"pais": args.pais, "celda_grados": CELDA_GRILLA,
              "explicacion": "lat/lon = esquina suroeste de la celda; v = [índice en 'meses', conteo harmonizado]",
              "meses": [str(m) for m in meses], "celdas": celdas}
    (DATA / f"{slug}-grilla.json").write_text(json.dumps(grilla, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # ---- 6. (Opcional) JSON crudos por año, formato de chile-2023.json ----
    if args.anuales:
        todo = pd.concat([modis, viirs], ignore_index=True)
        for anio, sub in todo.groupby(todo["fecha"].dt.year):
            registros = [{
                "lat": float(x.latitude), "lon": float(x.longitude), "fecha": x.acq_date,
                "hora": str(int(x.acq_time)).zfill(4), "sensor": x.sensor, "satelite": str(x.satellite),
                "frp": float(x.frp), "periodo": x.daynight, "confianza": str(x.confidence), "version": str(x.version),
            } for x in sub.sort_values(["acq_date", "acq_time"]).itertuples()]
            (DATA / f"{slug}-{anio}.json").write_text(
                json.dumps({"pais": args.pais, "anio": int(anio), "registros": registros}, ensure_ascii=False,
                           separators=(",", ":")), encoding="utf-8")

    # ---- Resumen en pantalla ----
    print(f"País: {args.pais} | meses: {meses[0]} a {meses[-1]} | traslape: {traslape[0]}-{traslape[-1]}")
    print("Factores VIIRS/MODIS por mes:", " ".join(f"{x:.2f}" for x in f_mes))
    print(f"Correlación en el traslape: {r:.3f}" if r is not None else "Correlación: sin datos")
    if errores:
        print(f"Error anual mediano (validación cruzada): {np.median(errores):.1f} %")
    print(f"Archivos escritos en {DATA}: {slug}-mensual.json, {slug}-grilla.json" + (", y los anuales" if args.anuales else ""))


if __name__ == "__main__":
    main()
