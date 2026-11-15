"""
Step 8 (alternative to step 7): build the model table for the reports from the data the app already ships.

Step 9 (9_informes.py) needs salida/celdas_armonizadas.csv.gz: one row per cell and month. The original table comes
from 7_modelo_final.py (20 km cells), which lives in the separate Chile model project. When that table is not at hand,
this script rebuilds an equivalent one from the files in data/:

  armonizada  <- data/chile-grilla.json   harmonized activity per 0.25° cell and month (output of the same AI model)
  modis_cd    <- data/chile-YYYY.json     MODIS fire cell-days counted from the stored detections
  viirs_cd    <- data/chile-YYYY.json     VIIRS fire cell-days counted from the stored detections

"Fire cell-days" are counted as the app does: each detection goes to a 0.01° cell (~1 km) and counts once per cell and
day. Summed over Chile they reproduce the `modis` and `viirs` series of data/chile-mensual.json.

What this table does NOT have: the separate neural-network and Random-Forest values (columns `red` and `rf`), so the
reports cannot show the range between the two models. Months flagged as incomplete in chile-mensual.json are left out.

Usage (from this folder):
    python 8_tabla_desde_app.py
    python 9_informes.py

Output: salida/celdas_armonizadas.csv.gz and salida/celdas_armonizadas.meta.json (cell size and unit for step 9).
"""
import json
from collections import defaultdict
from math import cos, floor, radians
from pathlib import Path

import pandas as pd

AQUI = Path(__file__).resolve().parent
DATOS = AQUI.parent / "data"
SAL = AQUI / "salida"
CONTEO = 0.01  # degrees: cell used to count fire cell-days (same as the app and the AI model)


def main():
    grilla = json.loads((DATOS / "chile-grilla.json").read_text(encoding="utf-8"))
    mensual = json.loads((DATOS / "chile-mensual.json").read_text(encoding="utf-8"))
    lado = grilla["celda_grados"]
    incompletos = {m for m, inc in zip(mensual["meses"], mensual["incompleto"]) if inc}
    meses = [m for m in grilla["meses"] if m not in incompletos]
    validos = set(meses)

    # Harmonized activity per grid cell and month.
    armonizada = defaultdict(float)
    centro = {}
    for c in grilla["celdas"]:
        gi, gj = round(c["lat"] / lado), round(c["lon"] / lado)
        centro[(gi, gj)] = (c["lat"] + lado / 2, c["lon"] + lado / 2)
        for k, v in c["v"]:
            if grilla["meses"][k] in validos:
                armonizada[(gi, gj, grilla["meses"][k])] += v

    # Fire cell-days per sensor, counted from the stored detections.
    vistos = {"MODIS": set(), "VIIRS": set()}
    anios = sorted({int(m[:4]) for m in meses})
    for anio in anios:
        ruta = DATOS / f"chile-{anio}.json"
        if not ruta.exists():
            print(f"   {ruta.name} is missing: MODIS and VIIRS counts for {anio} are left empty.")
            continue
        for r in json.loads(ruta.read_text(encoding="utf-8"))["registros"]:
            if r["fecha"][:7] in validos:
                vistos[r["sensor"]].add((floor(r["lat"] / CONTEO), floor(r["lon"] / CONTEO), r["fecha"]))
        print(f"   {anio}: detections read")
    conteo = {"MODIS": defaultdict(int), "VIIRS": defaultdict(int)}
    por_lado = round(lado / CONTEO)
    for sensor, celdas_dia in vistos.items():
        for i, j, fecha in celdas_dia:
            clave = (i // por_lado, j // por_lado)
            centro.setdefault(clave, (clave[0] * lado + lado / 2, clave[1] * lado + lado / 2))
            conteo[sensor][(*clave, fecha[:7])] += 1

    primer_viirs = min((k[2] for k in conteo["VIIRS"]), default="9999-99")
    filas = []
    for gi, gj in sorted(centro):
        lat, lon = centro[(gi, gj)]
        area = (lado * 110.57) * (lado * 111.32 * cos(radians(lat)))
        for m in meses:
            k = (gi, gj, m)
            filas.append({"gi": gi, "gj": gj, "lat": round(lat, 4), "lon": round(lon, 4), "mes": m,
                          "modis_cd": conteo["MODIS"].get(k, 0),
                          "viirs_cd": conteo["VIIRS"].get(k, 0) if m >= primer_viirs else None,
                          "modelo": round(armonizada.get(k, 0.0), 1), "armonizada": round(armonizada.get(k, 0.0), 1),
                          "area_km2": round(area, 1)})
    SAL.mkdir(exist_ok=True)
    tabla = pd.DataFrame(filas)
    tabla.to_csv(SAL / "celdas_armonizadas.csv.gz", index=False)
    (SAL / "celdas_armonizadas.meta.json").write_text(json.dumps({
        "km": round(lado * 110.57, 1),
        "celda": f"cells of {lado}° (~{round(lado * 111)} km)",
        "unidad": "fire cell-days (~1 km cells with at least one detection in the day), VIIRS-equivalent",
        "modelo": "Combined model (average of a neural network and a Random Forest). "
                  "From 2012-02: measured VIIRS. Before: MODIS brought to the VIIRS scale. "
                  f"Table rebuilt from the app's {lado}° grid; the range between the two models is not available in this issue.",
        "productos": "FIRMS: MODIS Collection 6.1 (Terra and Aqua, 1 km) and VIIRS 375 m (S-NPP; near-real-time data "
                     "in the most recent months). Country archive.",
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    # Check against the national series the app shows.
    nac = tabla.groupby("mes")[["modis_cd", "viirs_cd", "armonizada"]].sum()
    ref = pd.DataFrame({k: mensual[k] for k in ("modis", "viirs", "armonizado")}, index=mensual["meses"]).loc[meses]
    for a, b in (("modis_cd", "modis"), ("viirs_cd", "viirs"), ("armonizada", "armonizado")):
        dif = (nac[a] - ref[b].fillna(0)).abs()
        print(f"   {a:11s} vs chile-mensual.json '{b}': largest monthly difference {dif.max():.1f} "
              f"({100 * dif.sum() / max(ref[b].fillna(0).sum(), 1):.2f}% of the total)")
    print(f"\nDone: {len(tabla):,} rows, {len(centro):,} cells, {meses[0]} to {meses[-1]}  ->  {SAL / 'celdas_armonizadas.csv.gz'}")


if __name__ == "__main__":
    main()
