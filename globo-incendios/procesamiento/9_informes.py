"""
Step 9: REPORTS BY REGION (monthly and per season) built from the final model (step 7).

How a "per region" report is built with model 7:
  1. The model gives one value per 20 km cell and month (salida/celdas_armonizadas.csv.gz).
  2. Each cell is assigned to the region that contains its center (regiones_chile.geojson).
  3. The cells of the region are added up -> one monthly series per region, on the same scale (VIIRS).
  4. Each month is compared ONLY with the same month of the other years of that same region (percentile and rank).
  5. CONAF (hectares and fires per region and month) is added where it exists, without mixing units.

It does not make data up: whatever cannot be computed with what is available is shown as "not available".

Usage (from this folder, after 7_modelo_final.py):
    python 9_informes.py                       # uses salida/celdas_armonizadas.csv.gz
    python 9_informes.py --crudos crudos/Chile # also uses the FIRMS CSVs (FRP, day/night, concentration)

Files that must sit next to this script:
    regiones_chile.geojson     boundaries of the 16 regions
    conaf_region_mes.csv       CONAF by region and month (comes from the Excel files of CONAF's Centro Documental)

Output: folder web_informes/  ->  upload it to the web as is.
    informe.html               the viewer (choose region, month or season; print/PDF button)
    datos/indice.js            list of regions and periods
    datos/<region>.js          one file per region with all of its reports
Direct link to a report:  informe.html#valparaiso/mes/2024-02   or   informe.html#biobio/temporada/2022
"""
import argparse, glob, hashlib, json, os, re, unicodedata
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from matplotlib.path import Path as Poligono
from scipy.spatial import cKDTree
from scipy.stats import norm

AQUI = Path(__file__).resolve().parent
SAL = AQUI / "salida"
WEB = AQUI / "web_informes"

INICIO_VIIRS = "2012-02"          # from here on the series is measured VIIRS; before, modelled (same as step 7)
MES_INICIO_TEMPORADA = 7          # fire season: July to June (as CONAF does)
KM_CELDA = 20
UNIDAD = "fire cell-days (20 km cells with at least one detection in the day)"
TRAMOS = [(0.5, "very low"), (0.8, "low"), (1.25, "normal"), (2, "high"), (4, "very high"), (np.inf, "extreme")]
COLS = ["modis_cd", "viirs_cd", "red", "rf", "modelo", "armonizada"]


def slug(s):
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def r1(x, d=1):
    return None if x is None or (isinstance(x, float) and not np.isfinite(x)) else round(float(x), d)


def ordinal(n):
    """1 -> '1st', 2 -> '2nd', 11 -> '11th', 23 -> '23rd'."""
    if n is None or not np.isfinite(n):
        return "—"
    n = int(n)
    sufijo = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{sufijo}"


def limpio(x):
    if isinstance(x, (bool, np.bool_)):
        return bool(x)
    if isinstance(x, (int, np.integer)):
        return int(x)
    if isinstance(x, (float, np.floating)):
        return r1(x)
    return x


# ---------------------------------------------------------------- regions
def cargar_regiones():
    g = json.loads((AQUI / "regiones_chile.geojson").read_text(encoding="utf-8"))
    regs = []
    for f in sorted(g["features"], key=lambda f: f["properties"]["orden"]):
        p = f["properties"]
        regs.append({"nombre": p["nombre"], "conaf": p["conaf"],
                     "polis": [Poligono(np.array(anillo[0])) for anillo in f["geometry"]["coordinates"]]})
    return regs


def asignar_region(lat, lon, regs):
    pts = np.c_[lon, lat]
    reg = np.full(len(pts), -1)
    for k, r in enumerate(regs):
        for pol in r["polis"]:
            dentro = pol.contains_points(pts)
            reg[dentro & (reg < 0)] = k
    ok = reg >= 0                                    # cells whose center is at sea: the region of the neighboring cell
    if ok.any() and (~ok).any():
        xy = np.c_[lon * 111.32 * np.cos(np.radians(lat)), lat * 110.57]
        d, i = cKDTree(xy[ok]).query(xy[~ok])
        reg[~ok] = np.where(d <= 2 * KM_CELDA, reg[ok][i], -1)
    return reg


# ---------------------------------------------------------------- statistics
def clima(s, grupo):
    """For each value: percentile and rank within its group (same month of the year), median and quartiles."""
    g = s.groupby(grupo)
    n = g.transform("count")
    return pd.DataFrame({"n": n, "pct": (g.rank(method="average") - 0.5) / n * 100,
                         "rk": g.rank(ascending=False, method="min"),
                         "med": g.transform("median"), "q25": g.transform(lambda x: x.quantile(0.25)),
                         "q75": g.transform(lambda x: x.quantile(0.75))})


def tramo(anom):
    if anom is None or not np.isfinite(anom):
        return None
    return next(nombre for lim, nombre in TRAMOS if anom < lim)


def mann_kendall(x):
    """Mann-Kendall with variance correction for autocorrelation (Hamed and Rao, 1998) and Sen's slope."""
    x = np.asarray(x, float)
    x = x[np.isfinite(x)]
    n = len(x)
    if n < 10:
        return None
    i, j = np.triu_indices(n, 1)
    dif = x[j] - x[i]
    S = np.sign(dif).sum()
    sen = float(np.median(dif / (j - i)))
    _, cuenta = np.unique(x, return_counts=True)
    var0 = (n * (n - 1) * (2 * n + 5) - (cuenta * (cuenta - 1) * (2 * cuenta + 5)).sum()) / 18
    res = x - sen * np.arange(n)
    rg = pd.Series(res).rank().to_numpy()
    rg = rg - rg.mean()
    den = (rg ** 2).sum()
    corr = 0.0
    if den > 0:
        for k in range(1, n - 2):
            rk = (rg[:-k] * rg[k:]).sum() / den
            if abs(rk) > 1.96 / np.sqrt(n):
                corr += (n - k) * (n - k - 1) * (n - k - 2) * rk
    factor = max(1 + 2 / (n * (n - 1) * (n - 2)) * corr, 0.1)
    var = var0 * factor
    z = 0.0 if S == 0 or var <= 0 else (S - np.sign(S)) / np.sqrt(var)
    p = float(2 * (1 - norm.cdf(abs(z))))
    return {"n": n, "p": round(p, 3), "sen": r1(sen, 2), "sig": bool(p < 0.05),
            "dir": "increasing" if sen > 0 else "decreasing" if sen < 0 else "no change"}


def parecidos(s, etiqueta, k=3):
    otros = s.drop(etiqueta).dropna()
    if otros.empty or not np.isfinite(s[etiqueta]):
        return []
    cerca = (otros - s[etiqueta]).abs().sort_values().index[:k]
    return [[int(a), r1(s[a])] for a in cerca]


# ---------------------------------------------------------------- raw FIRMS CSVs (optional)
def leer_crudos(carpeta, celdas, per_viirs):
    rutas = {}
    for patron in ("modis_*.csv", "viirs*.csv"):
        for a in glob.glob(os.path.join(carpeta, "**", patron), recursive=True):
            rutas.setdefault(os.path.basename(a), a)
    if not rutas:
        print(f"   No FIRMS CSVs found in {carpeta}: the FRP blocks are left as 'not available'.")
        return None
    partes = []
    for a in sorted(rutas.values()):
        d = pd.read_csv(a, dtype={"acq_time": str, "version": str}, low_memory=False)
        d["sensor"] = "VIIRS" if "bright_ti4" in d.columns else "MODIS"
        for c in ("type", "version", "satellite", "daynight", "frp"):
            if c not in d:
                d[c] = np.nan
        partes.append(d[["latitude", "longitude", "acq_date", "frp", "type", "version", "satellite", "daynight", "sensor"]])
    d = pd.concat(partes, ignore_index=True).dropna(subset=["latitude", "longitude", "acq_date"])
    d["per"] = pd.PeriodIndex(d["acq_date"].str[:7], freq="M")
    xy = lambda la, lo: np.c_[lo * 111.32 * np.cos(np.radians(la)), la * 110.57]
    dist, i = cKDTree(xy(celdas["lat"].to_numpy(), celdas["lon"].to_numpy())).query(
        xy(d["latitude"].to_numpy(), d["longitude"].to_numpy()))
    d["reg"] = np.where(dist <= 1.5 * KM_CELDA, celdas["reg"].to_numpy()[i], -1)
    print(f"   Raw CSVs: {len(d):,} detections from {len(rutas)} files")

    def resumen(g):
        veg = g[~g["type"].isin([1, 2, 3])]
        principal = veg[veg["sensor"] == ("VIIRS" if g.name[-1] >= per_viirs and (veg["sensor"] == "VIIRS").any() else "MODIS")]
        f = principal["frp"].dropna()
        dia = principal.groupby("acq_date")["frp"].sum().sort_values(ascending=False)
        return pd.Series({
            "n_modis": int((veg["sensor"] == "MODIS").sum()), "n_viirs": int((veg["sensor"] == "VIIRS").sum()),
            "sensor_frp": principal["sensor"].iloc[0] if len(principal) else None,
            "frp_p50": f.median() if len(f) else np.nan, "frp_p90": f.quantile(0.9) if len(f) else np.nan,
            "frp_p95": f.quantile(0.95) if len(f) else np.nan, "frp_suma": f.sum() if len(f) else np.nan,
            "dias_activos": int(veg["acq_date"].nunique()),
            "pct_noche": 100 * (principal["daynight"] == "N").mean() if len(principal) else np.nan,
            "conc3": 100 * dia.iloc[:3].sum() / dia.sum() if len(dia) and dia.sum() > 0 else np.nan,
            "pct_noveg": 100 * g["type"].isin([1, 2, 3]).mean(),
            "sats": ", ".join(sorted(str(s) for s in veg["satellite"].dropna().unique())),
            "nrt": bool(g["version"].astype(str).str.contains("NRT").any() or g["type"].isna().any())})
    por_reg = d[d["reg"] >= 0].groupby(["reg", "per"]).apply(resumen)
    chile = d.assign(reg=-2).groupby(["reg", "per"]).apply(resumen)
    return pd.concat([por_reg, chile])


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--celdas", default=str(SAL / "celdas_armonizadas.csv.gz"),
                    help="Model table: one row per cell and month (default: salida/celdas_armonizadas.csv.gz)")
    ap.add_argument("--crudos", default=None, help="Folder with the FIRMS CSVs (optional)")
    args = ap.parse_args()

    regs = cargar_regiones()
    t = pd.read_csv(args.celdas)
    for c in COLS:
        if c not in t:
            t[c] = np.nan
    t["per"] = pd.PeriodIndex(t["mes"], freq="M")
    per_viirs = pd.Period(INICIO_VIIRS, "M")
    celdas = t.groupby(["gi", "gj"])[["lat", "lon"]].first().reset_index()
    celdas["reg"] = asignar_region(celdas["lat"].to_numpy(), celdas["lon"].to_numpy(), regs)
    t = t.merge(celdas[["gi", "gj", "reg"]], on=["gi", "gj"])
    meses = pd.period_range(t["per"].min(), t["per"].max(), freq="M")
    print(f"Model table: {len(t):,} rows, {len(celdas):,} cells, {meses[0]} to {meses[-1]}")
    print(f"Cells without a region (sea or outside mainland Chile): {(celdas['reg'] < 0).sum()}")

    # --- per-cell detail (block 6): own percentile and activity in new cells
    t = t.sort_values("per").reset_index(drop=True)
    t["mm"] = t["per"].dt.month
    gc = t.groupby(["gi", "gj", "mm"])["armonizada"]
    t["pct_c"] = (gc.rank(method="average") - 0.5) / gc.transform("count") * 100
    t["previo"] = gc.cumsum() - t["armonizada"].fillna(0)

    # --- CONAF
    conaf = None
    if (AQUI / "conaf_region_mes.csv").exists():
        conaf = pd.read_csv(AQUI / "conaf_region_mes.csv")
        conaf["per"] = pd.PeriodIndex(conaf["anio"].astype(str) + "-" + conaf["mes"].astype(str).str.zfill(2), freq="M")
        conaf = conaf[conaf["per"] >= meses[0]]
        print(f"CONAF: {conaf['per'].min()} to {conaf['per'].max()}")
    else:
        print("conaf_region_mes.csv is missing: the reports are written without the comparison against CONAF.")

    crudos = leer_crudos(args.crudos, celdas, per_viirs) if args.crudos else None

    areas = [{"nombre": "Chile (whole country)", "reg": -2, "conaf": None, "nota_conaf": ""}]
    for k, r in enumerate(regs):
        unidos = ["VIII", "XVI"] if r["conaf"] in ("VIII", "XVI") else [r["conaf"]]
        areas.append({"nombre": r["nombre"], "reg": k, "conaf": unidos,
                      "nota_conaf": "CONAF is shown for Ñuble + Biobío together (Ñuble was split off in 2018)." if len(unidos) > 1 else ""})

    # --- monthly series per area
    series = {}
    for a in areas:
        sub = t if a["reg"] == -2 else t[t["reg"] == a["reg"]]
        s = sub.groupby("per")[COLS].sum(min_count=1).reindex(meses)
        s[["modis_cd", "armonizada"]] = s[["modis_cd", "armonizada"]].fillna(0.0)
        series[a["nombre"]] = s
    orden = [a["nombre"] for a in areas[1:]]

    WEB.mkdir(exist_ok=True)
    (WEB / "datos").mkdir(exist_ok=True)
    mm = pd.Series(meses.month, index=meses)
    anio = pd.Series(meses.year, index=meses)
    temp = pd.Series(np.where(meses.month >= MES_INICIO_TEMPORADA, meses.year, meses.year - 1), index=meses)
    completas = [int(k) for k, n in temp.value_counts().items() if n == 12]
    pct_chile = clima(series[areas[0]["nombre"]]["armonizada"], mm)["pct"]
    pct_area = {n: clima(s["armonizada"], mm)["pct"] for n, s in series.items()}
    tot_temp = {n: s["armonizada"].groupby(temp).sum().loc[sorted(completas)] for n, s in series.items()}
    idx_temp = pd.Series(sorted(completas), index=sorted(completas))
    pct_temp = {n: clima(v, pd.Series(0, index=v.index))["pct"] for n, v in tot_temp.items()}

    indice = []
    for a in areas:
        nombre, s = a["nombre"], series[a["nombre"]]
        sub = t if a["reg"] == -2 else t[t["reg"] == a["reg"]]
        ids = celdas if a["reg"] == -2 else celdas[celdas["reg"] == a["reg"]]
        if ids.empty:
            continue
        c_arm, c_mod = clima(s["armonizada"], mm), clima(s["modis_cd"], mm)
        medido = pd.Series(meses >= per_viirs, index=meses)

        # season-to-date cumulative and its rank at the same point of the year
        pos = pd.Series((meses.month - MES_INICIO_TEMPORADA) % 12, index=meses)
        ini_ok = temp.map(lambda k: pd.Period(f"{k}-{MES_INICIO_TEMPORADA:02d}", "M") >= meses[0])
        acum = s["armonizada"].groupby(temp).cumsum().where(ini_ok)
        c_ac = clima(acum, pos)

        # CONAF for the area
        cf = None
        if conaf is not None:
            cc = conaf if a["conaf"] is None else conaf[conaf["region"].isin(a["conaf"])]
            if not cc.empty:
                cf = cc.groupby("per")[["conaf_ha", "conaf_incendios"]].sum(min_count=1)
                cf_clima = clima(cf["conaf_ha"], pd.Series(cf.index.month, index=cf.index))
                cf_temp = cf.groupby(np.where(cf.index.month >= MES_INICIO_TEMPORADA, cf.index.year, cf.index.year - 1)).agg(
                    conaf_ha=("conaf_ha", "sum"), conaf_incendios=("conaf_incendios", "sum"), n=("conaf_ha", "size"))
                cf_temp = cf_temp[cf_temp["n"] == 12]
                cf_temp_clima = clima(cf_temp["conaf_ha"], pd.Series(0, index=cf_temp.index))

        # spatial detail
        act = sub[sub["armonizada"] > 0]
        top = act.sort_values("armonizada", ascending=False).groupby("per").head(3)
        top = {p: [[r1(r.lat, 2), r1(r.lon, 2), r1(r.armonizada), r1(r.pct_c, 0)] for r in g.itertuples()]
               for p, g in top.groupby("per")}
        nuevo = (act[act["previo"] <= 0].groupby("per")["armonizada"].sum() / act.groupby("per")["armonizada"].sum() * 100)
        cr = crudos.xs(a["reg"], level=0) if crudos is not None and a["reg"] in crudos.index.get_level_values(0) else None

        mensual = {}
        for p in meses:
            v, m, y = float(s.at[p, "armonizada"]), int(p.month), int(p.year)
            mismos = s["armonizada"][mm == m]
            mismos.index = mismos.index.year
            med = float(c_arm.at[p, "med"])
            anom = v / med if med > 0 else None
            es_medido = bool(medido[p])
            rango = None
            if not es_medido and np.isfinite(s.at[p, "red"]) and np.isfinite(s.at[p, "rf"]):
                rango = [r1(min(s.at[p, "red"], s.at[p, "rf"])), r1(max(s.at[p, "red"], s.at[p, "rf"]))]
            dif_mod = abs(float(c_arm.at[p, "pct"]) - float(c_mod.at[p, "pct"]))
            crm = cr.loc[p] if cr is not None and p in cr.index else None

            # --- checks: real or artifact?
            n_med = int((medido & (mm == m)).sum())
            controles = [
                {"t": "Exposure (observation opportunities)", "e": "na",
                 "d": "Not available: FIRMS records detections, not overpasses without a detection nor cloud cover."},
                {"t": "Sensor mix", "e": "ok" if es_medido else "warn",
                 "d": ("This month is measured VIIRS. " if es_medido else "This month predates VIIRS: value modelled from MODIS. ")
                      + f"The reference has {n_med} measured months and {int(c_arm.at[p, 'n']) - n_med} modelled months, all on the VIIRS scale."},
                {"t": "Volcanoes and static sources", "e": "na", "d": "Not checked: the raw CSVs have not been read (--crudos)."}
                if crm is None else
                {"t": "Volcanoes and static sources", "e": "ok" if crm["pct_noveg"] < 5 else "warn",
                 "d": f"{crm['pct_noveg']:.0f}% of the month's raw detections are volcano, industry or offshore (type ≠ 0)."},
                {"t": "The anomaly holds with MODIS alone", "e": "ok" if dif_mod <= 20 else "warn",
                 "d": f"Unharmonized MODIS: {ordinal(round(c_mod.at[p, 'pct']))} percentile ({ordinal(c_mod.at[p, 'rk'])} of {int(c_mod.at[p, 'n'])}); "
                      f"harmonized series: {ordinal(round(c_arm.at[p, 'pct']))} percentile. "
                      + ("They agree: it does not depend on the method." if dif_mod <= 20 else "They differ by more than 20 points: read with caution.")},
            ]
            # --- reliability (fixed rule)
            motivos = []
            if med < 3:
                conf = "low"; motivos.append("the region records almost no activity in this month (median < 3): the percentile is not very informative")
            elif not es_medido and rango and v > 0 and (rango[1] - rango[0]) / v > 1:
                conf = "low"; motivos.append("the value is modelled and the two models disagree strongly with each other")
            elif not es_medido or dif_mod > 20:
                conf = "medium"
                if not es_medido: motivos.append("the value is modelled (it predates VIIRS)")
                if dif_mod > 20: motivos.append("MODIS alone does not confirm the percentile")
            else:
                conf = "high"; motivos.append("it is measured VIIRS and MODIS alone confirms it")

            inf = {"v": r1(v), "o": "V" if es_medido else "M", "rg": rango,
                   "n": int(c_arm.at[p, "n"]), "pct": r1(c_arm.at[p, "pct"], 0), "rk": int(c_arm.at[p, "rk"]),
                   "med": r1(med), "q25": r1(c_arm.at[p, "q25"]), "q75": r1(c_arm.at[p, "q75"]),
                   "an": r1(anom, 2), "tr": tramo(anom),
                   "prev": r1(mismos.get(y - 1, np.nan)), "sim": parecidos(mismos, y),
                   "ac": r1(acum[p]), "ac_rk": None if not np.isfinite(acum[p]) else int(c_ac.at[p, "rk"]),
                   "ac_n": None if not np.isfinite(acum[p]) else int(c_ac.at[p, "n"]),
                   "mo": {"v": r1(s.at[p, "modis_cd"]), "pct": r1(c_mod.at[p, "pct"], 0), "rk": int(c_mod.at[p, "rk"])},
                   "ch": r1(pct_chile[p], 0),
                   "vec": [] if a["reg"] == -2 else [[orden[j], r1(pct_area[orden[j]][p], 0)]
                                                      for j in (a["reg"] - 1, a["reg"] + 1) if 0 <= j < len(orden)],
                   "ctl": controles, "conf": conf, "conf_por": motivos,
                   "top": top.get(p, []),
                   "nuevo": (r1(nuevo.get(p, 0.0), 0) if p in top else None) if y - meses[0].year >= 5 else None}
            if cf is not None and p in cf.index and np.isfinite(cf.at[p, "conaf_ha"]):
                inf["cf"] = {"ha": r1(cf.at[p, "conaf_ha"]), "inc": r1(cf.at[p, "conaf_incendios"], 0),
                             "pct": r1(cf_clima.at[p, "pct"], 0), "rk": int(cf_clima.at[p, "rk"]), "n": int(cf_clima.at[p, "n"])}
            if crm is not None:
                inf["raw"] = {k: limpio(crm[k]) for k in crm.index}
            mensual[str(p)] = inf

        temporadas = {}
        tt, ct = tot_temp[nombre], clima(tot_temp[nombre], pd.Series(0, index=tot_temp[nombre].index))
        tm = s["modis_cd"].groupby(temp).sum().loc[sorted(completas)]
        ctm = clima(tm, pd.Series(0, index=tm.index))
        for k in sorted(completas):
            v, med = float(tt[k]), float(ct.at[k, "med"])
            dentro = s["armonizada"][temp == k]
            n_mod = int((~medido[temp == k]).sum())
            pico = dentro.idxmax()
            dif_mod = abs(float(ct.at[k, "pct"]) - float(ctm.at[k, "pct"]))
            inf = {"v": r1(v), "o": "V" if n_mod == 0 else "M" if n_mod == 12 else "X",
                   "n": int(ct.at[k, "n"]), "pct": r1(ct.at[k, "pct"], 0), "rk": int(ct.at[k, "rk"]),
                   "med": r1(med), "q25": r1(ct.at[k, "q25"]), "q75": r1(ct.at[k, "q75"]),
                   "an": r1(v / med if med > 0 else None, 2), "tr": tramo(v / med if med > 0 else None),
                   "prev": r1(tt.get(k - 1, np.nan)), "sim": parecidos(tt, k),
                   "mo": {"v": r1(tm[k]), "pct": r1(ctm.at[k, "pct"], 0), "rk": int(ctm.at[k, "rk"])},
                   "ch": r1(pct_temp[areas[0]["nombre"]][k], 0),
                   "vec": [] if a["reg"] == -2 else [[orden[j], r1(pct_temp[orden[j]][k], 0)]
                                                      for j in (a["reg"] - 1, a["reg"] + 1) if 0 <= j < len(orden)],
                   "pico": [str(pico), r1(100 * dentro.max() / v, 0) if v > 0 else None],
                   "conf": "high" if n_mod == 0 and dif_mod <= 20 else "medium" if med >= 10 else "low",
                   "conf_por": [("it is measured VIIRS" if n_mod == 0 else f"{n_mod} of 12 months are modelled"),
                                ("MODIS alone confirms it" if dif_mod <= 20 else "MODIS alone does not confirm the percentile")],
                   "ctl": [{"t": "Exposure (observation opportunities)", "e": "na",
                            "d": "Not available: FIRMS records detections, not overpasses without a detection nor cloud cover."},
                           {"t": "Sensor mix", "e": "ok" if n_mod == 0 else "warn",
                            "d": "Full season with measured VIIRS." if n_mod == 0 else f"{n_mod} of 12 months are values modelled from MODIS."},
                           {"t": "The anomaly holds with MODIS alone", "e": "ok" if dif_mod <= 20 else "warn",
                            "d": f"Unharmonized MODIS: {ordinal(round(ctm.at[k, 'pct']))} percentile; harmonized series: {ordinal(round(ct.at[k, 'pct']))} percentile."}]}
            if cf is not None and k in cf_temp.index:
                inf["cf"] = {"ha": r1(cf_temp.at[k, "conaf_ha"]), "inc": r1(cf_temp.at[k, "conaf_incendios"], 0),
                             "pct": r1(cf_temp_clima.at[k, "pct"], 0), "rk": int(cf_temp_clima.at[k, "rk"]),
                             "n": int(cf_temp_clima.at[k, "n"])}
            temporadas[str(k)] = inf

        clim12 = s["armonizada"].groupby(mm).quantile([0.25, 0.5, 0.75]).unstack()
        datos = {
            "nombre": nombre, "celdas": int(len(ids)), "area_km2": int(len(ids) * KM_CELDA ** 2),
            "hash": hashlib.sha1(",".join(f"{r.gi}-{r.gj}" for r in ids.sort_values(["gi", "gj"]).itertuples()).encode()).hexdigest()[:10],
            "nota_conaf": a["nota_conaf"],
            "conaf_hasta": None if cf is None else str(cf["conaf_ha"].last_valid_index()),
            "serie": [r1(x) for x in s["armonizada"]],
            "clima": {str(m): [r1(clim12.at[m, 0.25]), r1(clim12.at[m, 0.5]), r1(clim12.at[m, 0.75])] for m in range(1, 13)},
            "tend_mes": {str(m): mann_kendall(s["armonizada"][mm == m].to_numpy()) for m in range(1, 13)},
            "tend_temp": mann_kendall(tt.to_numpy()),
            "mensual": mensual, "temporada": temporadas}
        sl = slug(nombre.split(" (")[0])
        (WEB / "datos" / f"{sl}.js").write_text(
            f"window.DATOS=window.DATOS||{{}};window.DATOS[{json.dumps(sl)}]=" + json.dumps(datos, ensure_ascii=False, separators=(",", ":")) + ";",
            encoding="utf-8")
        indice.append({"slug": sl, "nombre": nombre})
        print(f"   {nombre:24s} {len(ids):5d} cells  ->  datos/{sl}.js")

    meta = {"generado": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "inicio_viirs": INICIO_VIIRS,
            "unidad": UNIDAD, "meses": [str(p) for p in meses], "temporadas": sorted(completas),
            "tiene_crudos": crudos is not None, "mes_inicio_temporada": MES_INICIO_TEMPORADA,
            "modelo": "Combined model (average of a neural network and a Random Forest, step 7). "
                      f"From {INICIO_VIIRS}: measured VIIRS S-NPP. Before: MODIS brought to the VIIRS scale.",
            "productos": "FIRMS: MODIS Collection 6.1 (Terra and Aqua, 1 km) and VIIRS S-NPP 375 m. Country archive."}
    (WEB / "datos" / "indice.js").write_text(
        "window.INDICE=" + json.dumps({"areas": indice, "meta": meta}, ensure_ascii=False) + ";", encoding="utf-8")
    (WEB / "informe.html").write_text(HTML, encoding="utf-8")
    print(f"\nDone: {WEB}\nOpen web_informes/informe.html  (or upload the whole folder to the web)")


HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Burning activity report · Fire Orbit</title>
<style>
:root{--navy:#071a33;--navy2:#0d2a52;--azul:#1f6feb;--cian:#38bdf8;--tinta:#0f1b2d;--gris:#5b6b82;--linea:#dbe4f0;
--fondo:#f3f7fc;--carta:#fff;--ok:#0f9d58;--warn:#d98200;--na:#8a97a8;--naranja:#f97316}
*{box-sizing:border-box}
body{margin:0;font-family:"Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;background:var(--fondo);color:var(--tinta);font-size:14.5px;line-height:1.5}
header{background:linear-gradient(120deg,var(--navy),var(--navy2) 60%,#12408a);color:#fff;padding:18px 28px 16px}
header h1{margin:0;font-size:19px;letter-spacing:.3px;font-weight:600}
header .sub{color:#a9c7f5;font-size:12.5px;margin-top:2px}
.ctrl{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;align-items:end}
.ctrl label{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:#a9c7f5;display:block;margin-bottom:3px}
.ctrl select,.ctrl button{font:inherit;padding:7px 10px;border-radius:7px;border:1px solid #2c5aa5;background:#0b2447;color:#fff}
.ctrl button{background:var(--azul);border-color:var(--azul);cursor:pointer;font-weight:600}
main{max-width:1060px;margin:0 auto;padding:20px 18px 50px}
.veredicto{background:var(--carta);border-left:6px solid var(--azul);border-radius:10px;padding:18px 22px;box-shadow:0 1px 3px rgba(7,26,51,.08)}
.veredicto .frase{font-size:19px;font-weight:600;line-height:1.35}
.veredicto .linea2{margin-top:6px;color:var(--gris)}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.chip{border-radius:999px;padding:3px 11px;font-size:12.5px;font-weight:600;background:#e7f0fd;color:#134ea8}
.chip.high{background:#e3f5ea;color:#0b6b3c}.chip.medium{background:#fff3da;color:#8a5300}.chip.low{background:#fde8e6;color:#a02a1f}
h2{font-size:12px;text-transform:uppercase;letter-spacing:1.2px;color:var(--azul);margin:26px 0 8px;font-weight:700}
h2 span{color:var(--gris);font-weight:600}
.carta{background:var(--carta);border:1px solid var(--linea);border-radius:10px;padding:14px 18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.kpi{background:var(--carta);border:1px solid var(--linea);border-radius:10px;padding:11px 14px}
.kpi .n{font-size:22px;font-weight:650;color:var(--navy2)}
.kpi .t{font-size:11.5px;color:var(--gris);text-transform:uppercase;letter-spacing:.6px}
.kpi .d{font-size:12px;color:var(--gris)}
table{border-collapse:collapse;width:100%}td,th{padding:6px 8px;border-bottom:1px solid var(--linea);text-align:left;vertical-align:top}
th{font-size:11.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--gris);font-weight:600}
td.num{text-align:right;font-variant-numeric:tabular-nums}
.ctl{display:grid;grid-template-columns:26px 1fr;gap:4px 8px;padding:7px 0;border-bottom:1px solid var(--linea)}
.ctl:last-child{border-bottom:0}.ctl b{font-weight:600}.ctl small{color:var(--gris);display:block}
.ic{width:20px;height:20px;border-radius:50%;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:2px}
.ic.ok{background:var(--ok)}.ic.warn{background:var(--warn)}.ic.na{background:var(--na)}
.aviso{background:#eef5ff;border:1px dashed #9cc0f5;border-radius:10px;padding:11px 15px;color:#27456e}
.nota{color:var(--gris);font-size:12.5px;margin-top:6px}
.dos{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:820px){.dos{grid-template-columns:1fr}}
svg text{font-family:inherit;font-size:10.5px;fill:#5b6b82}
.ley{font-size:12px;color:var(--gris);display:flex;gap:14px;flex-wrap:wrap;margin-top:4px}
.ley i{display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.no{background:var(--navy);color:#cfe0f8;border-radius:10px;padding:14px 18px}.no b{color:#fff}
footer{color:var(--gris);font-size:12px;margin-top:18px}
@media print{header .ctrl{display:none}body{background:#fff}.carta,.kpi,.veredicto{box-shadow:none;break-inside:avoid}}
</style>
</head>
<body>
<header>
  <h1>Burning activity report</h1>
  <div class="sub">Harmonized MODIS–VIIRS record · NASA FIRMS · validated against CONAF</div>
  <div class="ctrl">
    <div><label for="area">Region</label><select id="area"></select></div>
    <div><label for="tipo">Type</label><select id="tipo"><option value="mes">Monthly</option><option value="temporada">Season (Jul–Jun)</option></select></div>
    <div><label for="periodo">Period</label><select id="periodo"></select></div>
    <div><button onclick="window.print()">Print / PDF</button></div>
  </div>
</header>
<main id="main"><div class="aviso">Loading…</div></main>
<script src="datos/indice.js"></script>
<script>
const M=["January","February","March","April","May","June","July","August","September","October","November","December"];
const fmt=(x,d=0)=>x==null?"—":Number(x).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const ord=n=>{n=Math.round(n);const s=n%100>=10&&n%100<=20?"th":({1:"st",2:"nd",3:"rd"})[n%10]||"th";return fmt(n)+s;};
const $=id=>document.getElementById(id), meta=INDICE.meta;
function cargar(slug){return new Promise(ok=>{if(window.DATOS&&DATOS[slug])return ok(DATOS[slug]);
  const s=document.createElement("script");s.src="datos/"+slug+".js";s.onload=()=>ok(DATOS[slug]);document.head.appendChild(s);});}
function llenar(){
  $("area").innerHTML=INDICE.areas.map(a=>`<option value="${a.slug}">${a.nombre}</option>`).join("");
  periodos();
  const h=decodeURIComponent(location.hash.slice(1)).split("/");
  if(h.length===3){$("area").value=h[0];$("tipo").value=h[1];periodos();$("periodo").value=h[2];}
  ["area","tipo","periodo"].forEach(id=>$(id).onchange=()=>{if(id==="tipo")periodos();pintar();});
  pintar();
}
function periodos(){
  const t=$("tipo").value, l=t==="mes"?meta.meses.slice().reverse():meta.temporadas.slice().reverse();
  $("periodo").innerHTML=l.map(p=>`<option value="${p}">${t==="mes"?M[+String(p).slice(5)-1]+" "+String(p).slice(0,4):p+"–"+String(p+1).slice(2)}</option>`).join("");
}
function barras(vals,etq,sel,med,origen,alto=170){
  const W=480,H=alto,pl=38,pb=20,pt=8,max=Math.max(...vals.filter(v=>v!=null),med||0,1)*1.08,bw=(W-pl-6)/vals.length;
  const y=v=>pt+(H-pt-pb)*(1-v/max);let s=`<svg viewBox="0 0 ${W} ${H}" width="100%">`;
  [0,.5,1].forEach(f=>{const v=max/1.08*f;s+=`<line x1="${pl}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#e6edf6"/><text x="${pl-5}" y="${y(v)+3}" text-anchor="end">${fmt(v)}</text>`;});
  vals.forEach((v,i)=>{if(v==null)return;const x=pl+i*bw+1.5,c=i===sel?"#f97316":(origen&&origen[i]==="M"?"#9cc4f7":"#1f6feb");
    s+=`<rect x="${x}" y="${y(v)}" width="${Math.max(bw-3,2)}" height="${Math.max(H-pb-y(v),0)}" rx="2" fill="${c}"><title>${etq[i]}: ${fmt(v,1)}</title></rect>`;
    if((i%Math.ceil(vals.length/12)===0&&Math.abs(i-sel)>1)||i===sel)s+=`<text x="${x+bw/2-1.5}" y="${H-6}" text-anchor="middle" ${i===sel?'style="fill:#0f1b2d;font-weight:700"':''}>${etq[i]}</text>`;});
  if(med!=null)s+=`<line x1="${pl}" x2="${W}" y1="${y(med)}" y2="${y(med)}" stroke="#071a33" stroke-dasharray="4 3"/>`;
  return s+"</svg>";
}
function perfil(d,temporada,selMes){
  const ini=meta.mes_inicio_temporada, ms=[...Array(12)].map((_,i)=>(ini-1+i)%12+1);
  const vals=ms.map(m=>{const a=m>=ini?temporada:temporada+1,k=meta.meses.indexOf(a+"-"+String(m).padStart(2,"0"));return k<0?null:d.serie[k];});
  const W=480,H=170,pl=38,pb=20,pt=8,cl=ms.map(m=>d.clima[m]),max=Math.max(...vals.filter(v=>v!=null),...cl.map(c=>c[2]),1)*1.08,bw=(W-pl-6)/12;
  const y=v=>pt+(H-pt-pb)*(1-v/max);let s=`<svg viewBox="0 0 ${W} ${H}" width="100%">`;
  [0,.5,1].forEach(f=>{const v=max/1.08*f;s+=`<line x1="${pl}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#e6edf6"/><text x="${pl-5}" y="${y(v)+3}" text-anchor="end">${fmt(v)}</text>`;});
  const cx=i=>pl+i*bw+bw/2;
  s+=`<path d="M${cl.map((c,i)=>cx(i)+","+y(c[2])).join(" L")} L${cl.map((c,i)=>cx(i)+","+y(c[0])).reverse().join(" L")} Z" fill="#cfe2fb" opacity=".7"/>`;
  vals.forEach((v,i)=>{if(v==null)return;s+=`<rect x="${pl+i*bw+4}" y="${y(v)}" width="${bw-8}" height="${Math.max(H-pb-y(v),0)}" rx="2" fill="${ms[i]===selMes?"#f97316":"#1f6feb"}"><title>${M[ms[i]-1]}: ${fmt(v,1)}</title></rect>`;});
  s+=`<path d="M${cl.map((c,i)=>cx(i)+","+y(c[1])).join(" L")}" fill="none" stroke="#071a33" stroke-dasharray="4 3"/>`;
  ms.forEach((m,i)=>s+=`<text x="${cx(i)}" y="${H-6}" text-anchor="middle">${M[m-1].slice(0,3)}</text>`);
  return s+"</svg>";
}
const ICO={ok:"✓",warn:"!",na:"–"};
async function pintar(){
  const slug=$("area").value,tipo=$("tipo").value,per=$("periodo").value,d=await cargar(slug);
  location.hash=`${slug}/${tipo}/${per}`;
  const esMes=tipo==="mes",r=esMes?d.mensual[per]:d.temporada[per];
  if(!r){$("main").innerHTML='<div class="aviso">There is no report for that period.</div>';return;}
  const a=+String(per).slice(0,4),m=esMes?+per.slice(5):null,temporada=esMes?(m>=meta.mes_inicio_temporada?a:a-1):+per;
  const nomPer=esMes?`${M[m-1]} ${a}`:`${per}–${String(+per+1).slice(2)} season`;
  // grupo: what the period is compared against ("February months" / "seasons"); uno: a single one of them.
  const grupo=esMes?`${M[m-1]} months`:"seasons", uno=esMes?M[m-1]:"season";
  const a0=meta.meses[0].slice(0,4),a1=meta.meses[meta.meses.length-1].slice(0,4);
  const rankTxt=r.rk===1?`The most active ${uno} on record.`:`${ord(r.rk)} most active ${uno} on record.`;
  const origen=r.o==="V"?"Measured VIIRS":r.o==="M"?"Modelled from MODIS":"Mixed (measured + modelled)";
  let h=`<div class="veredicto"><div class="frase">${nomPer}, ${d.nombre}: burning activity at the ${ord(r.pct)} percentile of the ${r.n} ${grupo} in the harmonized record (${a0}–${a1}).</div>
  <div class="linea2">${rankTxt} ${r.an!=null?`Equivalent to ${fmt(r.an,2)} times the median (${r.tr}).`:""}</div>
  <div class="chips"><span class="chip ${r.conf}">Reliability: ${r.conf}</span><span class="chip">${origen}</span>${r.rg?`<span class="chip">Range between models: ${fmt(r.rg[0])}–${fmt(r.rg[1])}</span>`:""}</div>
  <div class="nota">Reliability is ${r.conf} because ${r.conf_por.join("; ")}.</div></div>`;

  h+=`<h2>0 · Identity and provenance</h2><div class="carta"><table>
  <tr><th>Area</th><td>${d.nombre} · ${fmt(d.celdas)} cells of 20 km · ≈ ${fmt(d.area_km2)} km² · id ${d.hash}</td></tr>
  <tr><th>Period</th><td>${nomPer} · data: ${origen}</td></tr>
  <tr><th>Products</th><td>${meta.productos}</td></tr>
  <tr><th>Method</th><td>${meta.modelo}</td></tr>
  <tr><th>Reference</th><td>Same ${esMes?"month":"season"} from ${a0} to ${a1} in the same area (${r.n} ${grupo})</td></tr>
  <tr><th>Generated</th><td>${meta.generado}${d.conaf_hasta?` · CONAF available through ${d.conaf_hasta}`:""}</td></tr></table></div>`;

  h+=`<h2>2 · Observability <span>— before any figure</span></h2><div class="aviso"><b>Exposure not available.</b> FIRMS provides detections, not the overpasses without a detection nor the cloud cover. A low value can mean little fire or little observation: this report cannot tell them apart.
  ${r.raw?`<br>What is known about the month: ${fmt(r.raw.dias_activos)} days with at least one detection · satellites with detections: ${r.raw.sats||"—"} · ${r.raw.nrt?"includes NRT (preliminary) data":"standard product"}.`:""}</div>`;

  h+=`<h2>3 · Harmonized activity</h2><div class="grid">
  <div class="kpi"><div class="t">Harmonized series</div><div class="n">${fmt(r.v,1)}</div><div class="d">${meta.unidad.split(" (")[0]}</div></div>
  <div class="kpi"><div class="t">Reference median</div><div class="n">${fmt(r.med,1)}</div><div class="d">usual range ${fmt(r.q25)}–${fmt(r.q75)}</div></div>
  <div class="kpi"><div class="t">Unharmonized MODIS</div><div class="n">${fmt(r.mo.v,1)}</div><div class="d">not comparable across eras</div></div>
  ${r.raw?`<div class="kpi"><div class="t">FRP (${r.raw.sensor_frp||"—"})</div><div class="n">${fmt(r.raw.frp_suma)} MW</div><div class="d">P50 ${fmt(r.raw.frp_p50,1)} · P90 ${fmt(r.raw.frp_p90,1)} · P95 ${fmt(r.raw.frp_p95,1)}</div></div>
  <div class="kpi"><div class="t">Raw detections</div><div class="n">${fmt(r.raw.n_viirs)} / ${fmt(r.raw.n_modis)}</div><div class="d">VIIRS / MODIS · not comparable across years</div></div>
  <div class="kpi"><div class="t">At night</div><div class="n">${fmt(r.raw.pct_noche)}%</div><div class="d">of the month's detections</div></div>`:""}
  </div><div class="nota">Unit: ${meta.unidad}. ${r.raw?"":"FRP, day/night and raw counts: not available in this issue (the FIRMS CSVs are missing)."}</div>`;

  const idxs=esMes?meta.meses.map((p,i)=>+p.slice(5)===m?i:-1).filter(i=>i>=0):null;
  const vals=esMes?idxs.map(i=>d.serie[i]):meta.temporadas.map(t=>d.temporada[t].v);
  const etq=esMes?idxs.map(i=>meta.meses[i].slice(0,4)):meta.temporadas.map(String);
  const ori=esMes?idxs.map(i=>meta.meses[i]>=meta.inicio_viirs?"V":"M"):meta.temporadas.map(t=>d.temporada[t].o==="V"?"V":"M");
  h+=`<h2>4 · Is it anomalous? Is it real? What shape did it take?</h2><div class="dos">
  <div class="carta"><b>All ${grupo} on record</b>${barras(vals,etq,etq.indexOf(String(esMes?a:per)),r.med,ori)}
  <div class="ley"><span><i style="background:#f97316"></i>this period</span><span><i style="background:#1f6feb"></i>measured VIIRS</span><span><i style="background:#9cc4f7"></i>modelled from MODIS</span><span>- - median</span></div></div>
  <div class="carta"><b>The ${temporada}–${String(temporada+1).slice(2)} season month by month</b>${perfil(d,temporada,m)}
  <div class="ley"><span><i style="background:#cfe2fb"></i>usual range (P25–P75)</span><span>- - median of the month</span></div></div></div>
  <div class="carta" style="margin-top:12px"><b>Checks: is it real or an artifact?</b>
  ${r.ctl.map(c=>`<div class="ctl"><div class="ic ${c.e}">${ICO[c.e]}</div><div><b>${c.t}</b><small>${c.d}</small></div></div>`).join("")}</div>
  <div class="nota">${esMes?(r.raw&&r.raw.conc3!=null?`Shape: ${fmt(r.raw.conc3)}% of the month's FRP occurred on the 3 most active days.`:"Temporal concentration within the month: not available without the FIRMS CSVs."):(r.pico&&r.pico[1]!=null?`Shape: ${fmt(r.pico[1])}% of the season occurred in ${M[+r.pico[0].slice(5)-1]} ${r.pico[0].slice(0,4)}.`:"")}</div>`;

  h+=`<h2>5 · Comparisons</h2><div class="carta"><table>
  <tr><th>Against</th><th>Value</th><th>Reading</th></tr>
  <tr><td>Reference median</td><td class="num">${fmt(r.med,1)}</td><td>${r.an!=null?fmt(r.an,2)+" times the median":"—"}</td></tr>
  <tr><td>${esMes?"Same month of the previous year":"Previous season"}</td><td class="num">${fmt(r.prev,1)}</td><td>${r.prev>0?fmt(r.v/r.prev,2)+" times":"—"}</td></tr>
  <tr><td>The 3 most similar on record</td><td colspan="2">${r.sim.map(s=>`${s[0]} (${fmt(s[1],1)})`).join(" · ")||"—"}</td></tr>
  ${esMes&&r.ac!=null?`<tr><td>Season-to-date cumulative</td><td class="num">${fmt(r.ac,1)}</td><td>${ord(r.ac_rk)} of ${r.ac_n} seasons at this point of the year</td></tr>`:""}
  <tr><td>Local or national?</td><td colspan="2">Whole of Chile: ${ord(r.ch)} percentile${r.vec.length?" · "+r.vec.map(v=>`${v[0]}: ${ord(v[1])} percentile`).join(" · "):""}</td></tr></table></div>`;
  h+=r.cf?`<div class="carta" style="margin-top:12px"><b>CONAF (ground record, independent of the satellite)</b><table>
  <tr><th>Area affected</th><td class="num">${fmt(r.cf.ha)} ha</td><td>${ord(r.cf.pct)} percentile · ${ord(r.cf.rk)} of ${r.cf.n}</td></tr>
  <tr><th>Fires recorded</th><td class="num">${fmt(r.cf.inc)}</td><td>a fire is an event; it is not equivalent to a detection</td></tr>
  <tr><th>Do they agree?</th><td colspan="2">Satellite: ${ord(r.pct)} percentile · CONAF: ${ord(r.cf.pct)} percentile → ${Math.abs(r.pct-r.cf.pct)<=20?"they agree":"they differ by more than 20 points"}</td></tr></table>
  <div class="nota">${d.nota_conaf}</div></div>`:`<div class="aviso" style="margin-top:12px">CONAF: no published record for this period and area${d.conaf_hasta?` (available through ${d.conaf_hasta})`:""}.</div>`;

  if(esMes){h+=`<h2>6 · Spatial detail</h2><div class="carta">${r.top.length?`<table><tr><th>Cell (lat, lon)</th><th>Value</th><th>Own percentile</th></tr>
  ${r.top.map(c=>`<tr><td>${fmt(c[0],2)}, ${fmt(c[1],2)}</td><td class="num">${fmt(c[2],1)}</td><td class="num">${fmt(c[3])}</td></tr>`).join("")}</table>`:"No activity in the month."}
  <div class="nota">${r.nuevo!=null?`${fmt(r.nuevo)}% of the activity fell in cells with no previous activity in this month of the record. `:""}A single cell carries a lot of uncertainty: it is useful as a guide, not as a figure.</div></div>`;}

  const t=esMes?d.tend_mes[m]:d.tend_temp;
  h+=`<h2>7 · Trend</h2><div class="carta">${t?(t.sig?`Significant ${t.dir} trend: ${fmt(t.sen,2)} per year (Sen's slope), p = ${fmt(t.p,3)}.`:`No significant trend is detected in the ${grupo} on record (p = ${fmt(t.p,2)}).`)+` <span class="nota">Mann-Kendall with autocorrelation correction, ${t.n} years. The series combines modelled and measured years.</span>`:"The record is too short to assess a trend."}</div>`;

  h+=`<h2>8 · What this report does not claim</h2><div class="no"><b>A detection is not a fire.</b> This report does not attribute causes, does not count fires, does not estimate burned area and does not forecast. It describes activity observed by satellite, brought to a common scale, and compares it with its own history.</div>
  <footer>Link to this report: ${location.href}</footer>`;
  $("main").innerHTML=h;
}
llenar();
</script>
</body>
</html>
"""

if __name__ == "__main__":
    main()
