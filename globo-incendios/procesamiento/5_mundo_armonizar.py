"""
Paso 5 (mundial): harmoniza MODIS, VIIRS Suomi NPP y VIIRS NOAA-20 para todos los países,
a partir de los resúmenes que dejó 4_mundo_descargar.py.

Unidad común: celdas-día con fuego (~1 km) en equivalente VIIRS Suomi NPP, igual que Chile.
  2000-2011  MODIS × f(país, mes)       f calibrado con el traslape MODIS/S-NPP 2012-2025
  2012-2025  VIIRS Suomi NPP
  2026 →     VIIRS NOAA-20 × g(país, mes)  g calibrado con el traslape NOAA-20/S-NPP 2019-2025
             (lo agrega 3_actualizar.py; aquí se calculan y guardan los factores g)
Si un país tiene pocos datos para un mes, se usa su factor anual; si tampoco, el del mundo.

Uso (desde la carpeta globo-incendios):
    python procesamiento/5_mundo_armonizar.py
    python procesamiento/5_mundo_armonizar.py --carpeta C:\\firms

Salidas en data/mundo/:
    indice.json                 países con datos (id del mapa, nombre, archivo, error de validación)
    paises/<id>-mensual.json    serie mensual de cada país, mismo formato que chile-mensual.json
    mundo-mensual.json          total del planeta
    celdas/<lat>_<lon>.json     grilla de 0,25° por mes, en bloques de 30° × 30° (para elegir áreas)
    factores.csv                factores por país y mes (para revisar o presentar)
"""
import argparse
import gzip
import importlib.util
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

AQUI = Path(__file__).resolve().parent
SALIDA = AQUI.parent / "data" / "mundo"
MAPA = AQUI.parent / "tierra" / "assets" / "paises-50m.geo.json"
ANIO_BASE = 2003          # medianas desde aquí (antes: solo MODIS Terra)
K_SUAVE = 200             # celdas-día "de respaldo": con pocos datos el factor se acerca al del país o del mundo
LIMITES_F = (1.0, 10.0)   # MODIS→VIIRS: VIIRS (375 m) siempre ve al menos lo que ve MODIS (1 km).
                          # Más de 10 indica fuentes que no son vegetación (antorchas de gas, volcanes).
LIMITES_G = (0.5, 1.5)    # NOAA-20→S-NPP: el mismo instrumento, el factor debe estar cerca de 1
INICIO_VIIRS = (2012, 2)  # S-NPP empieza el 20 de enero de 2012: enero de 2012 está incompleto
TRASLAPE_MODIS = (2012, 2025)
TRASLAPE_NOAA = (2019, 2025)  # NOAA-20 empieza en abril de 2018: se usan años completos
BLOQUE = 30               # tamaño de los bloques de la grilla, en grados
MAX_CELDAS = 2500         # por país: si hay más celdas de 0,25°, se agrupan en 0,5° o 1° (países grandes)
CELDA = 0.25


def cargar_resumenes(carpeta, campo):
    partes = []
    for sensor in ("modis", "viirs-snpp", "noaa20"):
        raiz = carpeta / "resumen" / sensor
        if not raiz.exists():
            continue
        for dir_anio in sorted(raiz.iterdir()):
            anio = int(dir_anio.name)
            for archivo in dir_anio.glob("*.csv"):
                df = pd.read_csv(archivo, dtype={"gi": np.int32, "gj": np.int32, "mes": np.int8})
                if df.empty:
                    continue
                df = df[["gi", "gj", "mes", campo]].rename(columns={campo: "n"})
                df["sensor"], df["anio"], df["pais"] = sensor, anio, archivo.stem
                partes.append(df)
        print(f"  {sensor}: leído")
    todo = pd.concat(partes, ignore_index=True)
    for c in ("sensor", "pais"):
        todo[c] = todo[c].astype("category")
    todo["anio"] = todo["anio"].astype(np.int16)
    todo["n"] = todo["n"].astype(np.int32)
    return todo


def factores_por_mes(num, den, global_mes, limites):
    """num/den: (12,) sumas en el traslape (VIIRS y el otro sensor). Devuelve (12,) factores y si se recortó alguno.
    Suavizado: con pocos datos, el factor del mes se acerca al anual del país, y el del país al del mundo."""
    anual_mundo = float(np.mean(global_mes))
    pais = (num.sum() + K_SUAVE * anual_mundo) / (den.sum() + K_SUAVE)
    f = (num + K_SUAVE * pais) / (den + K_SUAVE)
    recortado = bool(((f < limites[0]) | (f > limites[1])).any())
    return np.clip(f, *limites), recortado


def nombres_mapa():
    """Relaciona cada país del mapa de la app con su nombre en FIRMS."""
    spec = importlib.util.spec_from_file_location("descarga", AQUI / "4_mundo_descargar.py")
    descarga = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(descarga)
    feats = json.loads(MAPA.read_text(encoding="utf-8"))["features"]
    salida = []
    for f in feats:
        p = f["properties"]
        candidatos = [p["name"]] + descarga.EXTRA.get(p["name"], []) + [a for a in p.get("aliases", []) if len(a) > 3 and a.isascii()]
        salida.append((str(f["id"]), p["name"], p.get("spanish", p["name"]), [c.replace(" ", "_") for c in candidatos]))
    return salida


def estadisticas_mes(meses, valores, incompleto):
    s = pd.Series(valores, index=meses)
    stats = {k: [] for k in ("mediana", "p25", "p75", "maximo")}
    anios = sorted({m.year for m in meses})
    completos = [a for a in anios if a >= ANIO_BASE and sum(1 for m in meses if m.year == a) == 12]
    base = s[[m.year in completos for m in s.index]]
    for mm in range(1, 13):
        v = base[[m.month == mm for m in base.index]].to_numpy(dtype=float)
        v = v[~np.isnan(v)] if len(v) else np.array([0.0])
        if not len(v):
            v = np.array([0.0])
        stats["mediana"].append(round(float(np.median(v)), 1))
        stats["p25"].append(round(float(np.percentile(v, 25)), 1))
        stats["p75"].append(round(float(np.percentile(v, 75)), 1))
        stats["maximo"].append(round(float(v.max()), 1))
    return {**stats, "anios_base": [completos[0], completos[-1]] if completos else None}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--carpeta", type=Path, default=Path("C:/firms") if os.name == "nt" else Path.home() / "firms")
    p.add_argument("--campo", default="n", choices=["n", "n_conf"], help="n_conf: sin detecciones de confianza baja")
    p.add_argument("--bloques", action="store_true", help="Generar también la grilla mundial en bloques de 30° (pesada)")
    args = p.parse_args()

    print("Leyendo resúmenes…")
    todo = cargar_resumenes(args.carpeta, args.campo)
    print(f"  {len(todo):,} filas, {todo['pais'].nunique()} países")

    # ---- 1. Totales por país, sensor, año y mes ----
    tot = todo.groupby(["pais", "sensor", "anio", "mes"], observed=True)["n"].sum()
    paises = sorted(todo["pais"].unique())
    ultimo_anio = int(todo["anio"].max())
    meses = pd.period_range("2000-11", f"{ultimo_anio}-12", freq="M")
    serie = lambda pais, sensor: np.array([tot.get((pais, sensor, m.year, m.month), 0) for m in meses], dtype=float)

    en = lambda rango: np.array([rango[0] <= m.year <= rango[1] for m in meses])
    tm, tn = en(TRASLAPE_MODIS), en(TRASLAPE_NOAA)
    tm &= np.array([(m.year, m.month) >= INICIO_VIIRS for m in meses])  # sin enero de 2012
    mes_idx = np.array([m.month - 1 for m in meses])
    suma_mes = lambda v, mask: np.array([v[mask & (mes_idx == k)].sum() for k in range(12)])

    # Factores globales (respaldo)
    G = {s: sum(serie(pp, s) for pp in paises) for s in ("modis", "viirs-snpp", "noaa20")}
    glob_f = suma_mes(G["viirs-snpp"], tm) / np.maximum(suma_mes(G["modis"], tm), 1)
    glob_g = suma_mes(G["viirs-snpp"], tn) / np.maximum(suma_mes(G["noaa20"], tn), 1)
    print("Factores globales MODIS→VIIRS por mes:", " ".join(f"{x:.2f}" for x in glob_f))
    print("Factores globales NOAA-20→S-NPP por mes:", " ".join(f"{x:.2f}" for x in glob_g))

    # ---- 2. Serie harmonizada por país ----
    (SALIDA / "paises").mkdir(parents=True, exist_ok=True)
    usa_viirs = np.array([(m.year, m.month) >= INICIO_VIIRS for m in meses])
    incompleto = [m.year < ANIO_BASE for m in meses]
    filas_fact, por_pais, errores_todos = [], {}, []
    for pais in paises:
        M, V, N = serie(pais, "modis"), serie(pais, "viirs-snpp"), serie(pais, "noaa20")
        f, rec_f = factores_por_mes(suma_mes(V, tm), suma_mes(M, tm), glob_f, LIMITES_F)
        g, _ = factores_por_mes(suma_mes(V, tn), suma_mes(N, tn), glob_g, LIMITES_G)
        arm = np.where(usa_viirs, V, M * f[mes_idx])
        # Validación: predecir cada año 2012-2025 de VIIRS desde MODIS, calibrando sin ese año
        val = []
        for anio in range(TRASLAPE_MODIS[0], TRASLAPE_MODIS[1] + 1):
            fuera = tm & np.array([m.year != anio for m in meses])
            dentro = np.array([m.year == anio for m in meses])
            ff, _ = factores_por_mes(suma_mes(V, fuera), suma_mes(M, fuera), glob_f, LIMITES_F)
            pred, real = (M * ff[mes_idx])[dentro].sum(), V[dentro].sum()
            if real >= 100:
                val.append(round(float((pred - real) / real * 100), 1))
        err = round(float(np.median(np.abs(val))), 1) if val else None
        # Calidad de la reconstrucción 2000-2011: para mostrar en la app
        calidad = ("baja" if err is None or err > 30 or rec_f else "media" if err > 15 else "alta")
        if err is not None:
            errores_todos.append(err)
        total = float(arm[[m.year >= ANIO_BASE for m in meses]].sum())
        por_pais[pais] = arm
        filas_fact.append({"pais": pais, "total_2003_hoy": round(total), "error_pct": err, "calidad": calidad,
                           **{f"f_{k + 1}": round(float(f[k]), 3) for k in range(12)},
                           **{f"g_{k + 1}": round(float(g[k]), 3) for k in range(12)}})
        datos = {
            "pais": pais.replace("_", " "), "generado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
            "unidad": "celdas-día con fuego (~1 km), equivalentes VIIRS",
            "meses": [str(m) for m in meses],
            "modis": M.astype(int).tolist(),
            "viirs": [int(v) if u else None for v, u in zip(V, usa_viirs)],
            "noaa20": [int(v) if m.year >= 2018 else None for v, m in zip(N, meses)],
            "armonizado": np.round(arm, 1).tolist(),
            "origen": ["VIIRS" if u else "MODIS×f" for u in usa_viirs],
            "incompleto": incompleto,
            "por_mes_calendario": estadisticas_mes(meses, arm, incompleto),
            "metodo": {
                "campo": args.campo,
                "factores_por_mes": [round(float(x), 3) for x in f],
                "factores_noaa20_por_mes": [round(float(x), 3) for x in g],
                "anios_traslape": list(TRASLAPE_MODIS),
                "error_anual_mediano_pct": err,
                "calidad_reconstruccion": calidad,
                "nota": "Antes de 2003 los datos están incompletos (solo MODIS Terra). Medianas desde 2003.",
            },
        }
        por_pais[pais + "#json"] = datos

    # ---- 3. Índice: relacionar con los países del mapa de la app ----
    indice = []
    usados = set()
    for id_, nombre, spanish, candidatos in nombres_mapa():
        firms = next((c for c in candidatos if c in por_pais), None)
        if not firms or firms in usados:
            continue
        usados.add(firms)
        datos = por_pais[firms + "#json"]
        datos["pais"] = nombre
        (SALIDA / "paises" / f"{id_}-mensual.json").write_text(json.dumps(datos, ensure_ascii=False), encoding="utf-8")
        fila = next(x for x in filas_fact if x["pais"] == firms)
        indice.append({"id": id_, "nombre": nombre, "spanish": spanish, "firms": firms,
                       "archivo": f"paises/{id_}-mensual.json", "total": fila["total_2003_hoy"], "error_pct": fila["error_pct"],
                       "calidad": fila["calidad"]})
    sin_mapa = [pp for pp in paises if pp not in usados]
    indice.sort(key=lambda x: -x["total"])
    (SALIDA / "indice.json").write_text(json.dumps({"generado": datetime.now(timezone.utc).isoformat(timespec="minutes"),
                                                     "paises": indice}, ensure_ascii=False, indent=0), encoding="utf-8")
    pd.DataFrame(filas_fact).sort_values("total_2003_hoy", ascending=False).to_csv(SALIDA / "factores.csv", index=False)

    # ---- 4. Total del planeta ----
    mundo = sum(por_pais[pp] for pp in paises)
    (SALIDA / "mundo-mensual.json").write_text(json.dumps({
        "pais": "Mundo", "unidad": "celdas-día con fuego (~1 km), equivalentes VIIRS",
        "meses": [str(m) for m in meses], "armonizado": np.round(mundo, 1).tolist(),
        "origen": ["VIIRS" if u else "MODIS×f" for u in usa_viirs], "incompleto": incompleto,
        "por_mes_calendario": estadisticas_mes(meses, mundo, incompleto),
        "metodo": {"error_anual_mediano_pct": round(float(np.median(errores_todos)), 1) if errores_todos else None},
    }, ensure_ascii=False), encoding="utf-8")

    # ---- 5. Grilla harmonizada en bloques de 30° ----
    print("Armando la grilla…")
    fac = {r["pais"]: np.array([r[f"f_{k + 1}"] for k in range(12)]) for r in filas_fact}
    desde_viirs = (todo["anio"] > INICIO_VIIRS[0]) | ((todo["anio"] == INICIO_VIIRS[0]) & (todo["mes"] >= INICIO_VIIRS[1]))
    sel = todo[((todo["sensor"] == "viirs-snpp") & desde_viirs) | ((todo["sensor"] == "modis") & ~desde_viirs)].copy()
    inicio = meses[0]
    sel["im"] = (sel["anio"].astype(np.int32) - inicio.year) * 12 + sel["mes"].astype(np.int32) - inicio.month
    sel = sel[(sel["im"] >= 0) & (sel["im"] < len(meses))]
    es_modis = (sel["sensor"] == "modis").to_numpy()
    f_fila = np.ones(len(sel))
    paises_sel, meses_sel = sel["pais"].astype(str).to_numpy(), sel["mes"].to_numpy() - 1
    for pais in np.unique(paises_sel[es_modis]):
        m = es_modis & (paises_sel == pais)
        f_fila[m] = fac[pais][meses_sel[m]]
    sel["valor"] = sel["n"].to_numpy() * f_fila

    # ---- 5a. Mapa de cada país: celdas × meses, en binario comprimido ----
    # <id>.json: cabecera (tamaño de celda, esquinas suroeste, meses, escala)
    # <id>.bin.gz: Uint16 (little endian), fila = celda, columna = mes; valor real = número × escala
    destino = SALIDA / "celdas-pais"
    destino.mkdir(exist_ok=True)
    id_por_firms = {x["firms"]: x["id"] for x in indice}
    peso_mapas = 0
    for pais, sub in sel.groupby("pais", observed=True):
        id_ = id_por_firms.get(str(pais))
        if id_ is None or sub.empty:
            continue
        k = 1
        while True:
            gi, gj = np.floor_divide(sub["gi"].to_numpy(), k), np.floor_divide(sub["gj"].to_numpy(), k)
            if len(set(zip(gi.tolist(), gj.tolist()))) <= MAX_CELDAS or k >= 8:
                break
            k *= 2
        agg = pd.DataFrame({"gi": gi, "gj": gj, "im": sub["im"].to_numpy(), "v": sub["valor"].to_numpy()}) \
            .groupby(["gi", "gj", "im"])["v"].sum().reset_index()
        claves = agg[["gi", "gj"]].drop_duplicates().sort_values(["gi", "gj"]).to_numpy()
        fila = {(a, b): i for i, (a, b) in enumerate(map(tuple, claves))}
        matriz = np.zeros((len(claves), len(meses)), dtype=np.float64)
        matriz[[fila[(a, b)] for a, b in zip(agg["gi"], agg["gj"])], agg["im"].to_numpy()] = agg["v"].to_numpy()
        escala = max(1, int(np.ceil(matriz.max() / 65535)))
        u16 = np.round(matriz / escala).astype("<u2")
        tam = CELDA * k
        (destino / f"{id_}.json").write_text(json.dumps({
            "celda_grados": tam, "meses_inicio": str(meses[0]), "n_meses": len(meses), "escala": escala,
            "unidad": "celdas-día con fuego (~1 km), equivalentes VIIRS",
            "celdas": [[round(a * tam, 3), round(b * tam, 3)] for a, b in claves],
        }, separators=(",", ":")), encoding="utf-8")
        bin_gz = gzip.compress(u16.tobytes(), compresslevel=9)
        (destino / f"{id_}.bin.gz").write_bytes(bin_gz)
        peso_mapas += len(bin_gz)
    print(f"Mapas por país: {len(list(destino.glob('*.json')))} países, {peso_mapas / 1e6:.1f} MB")
    celdas = sel.groupby(["gi", "gj", "im"])["valor"].sum().reset_index() if args.bloques else sel.iloc[:0][["gi", "gj", "im", "valor"]]
    celdas["bi"] = np.floor(celdas["gi"] * CELDA / BLOQUE).astype(int)
    celdas["bj"] = np.floor(celdas["gj"] * CELDA / BLOQUE).astype(int)
    (SALIDA / "celdas").mkdir(exist_ok=True)
    bloques = []
    for (bi, bj), sub in celdas.groupby(["bi", "bj"]):
        lista = [{"lat": round(gi * CELDA, 2), "lon": round(gj * CELDA, 2),
                  "v": [[int(i), round(float(v), 1)] for i, v in zip(s2["im"], s2["valor"])]}
                 for (gi, gj), s2 in sub.groupby(["gi", "gj"])]
        nombre = f"{bi * BLOQUE}_{bj * BLOQUE}.json"
        (SALIDA / "celdas" / nombre).write_text(json.dumps(
            {"celda_grados": CELDA, "bloque": [bi * BLOQUE, bj * BLOQUE, BLOQUE], "meses": [str(m) for m in meses],
             "celdas": lista}, separators=(",", ":")), encoding="utf-8")
        bloques.append(nombre)

    # ---- Resumen ----
    tam = sum(f.stat().st_size for f in SALIDA.rglob("*") if f.is_file()) / 1e6
    print(f"\nPaíses harmonizados: {len(paises)} | con país en el mapa: {len(indice)}")
    if errores_todos:
        print(f"Error anual mediano (validación, todos los países): {np.median(errores_todos):.1f} %")
    print("Los 5 con más actividad 2003-hoy:", ", ".join(f"{x['spanish']} ({x['total']:,})" for x in indice[:5]))
    if sin_mapa:
        print(f"Sin país en el mapa ({len(sin_mapa)}): {', '.join(sin_mapa[:15])}{'…' if len(sin_mapa) > 15 else ''}")
    print(f"Bloques de grilla: {len(bloques)} | tamaño total de data/mundo: {tam:.0f} MB")


if __name__ == "__main__":
    main()
