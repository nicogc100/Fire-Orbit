# Data processing: MODIS + VIIRS harmonization

These scripts generate the data used by the app from the yearly NASA FIRMS CSV files.

> **Chile uses an AI model.** Chile's monthly series (`chile-mensual.json`), its grid (`chile-grilla.json`) and the
> model summary (`chile-metodo.json`) are produced by a separate project: detection physics + neural network +
> Random Forest, validated with CONAF records. **Do not run `2_armonizar.py` for Chile**: it would overwrite them with
> the simple method described below. The other countries still use the simple method, and the AI method can be
> replicated for them with the same FIRMS files.

## How to use

From the `globo-incendios` folder:

```bash
pip install -r procesamiento/requirements.txt
python procesamiento/1_descargar.py                  # downloads Chile: MODIS 2000-2025 and VIIRS 2012-2025
python procesamiento/2_armonizar.py --anuales        # harmonizes and writes the files to data/ (simple method)
python procesamiento/3_actualizar.py --key MAP_KEY   # adds the current year's months from the API
```

Step 3 needs a free FIRMS MAP_KEY (https://firms.modaps.eosdis.nasa.gov/api/map_key/). Each person should use their
own key and **never commit it to GitHub or paste it into the app code**. Step 3 can be rerun whenever you want to
update: it replaces the current year's months without duplicating them. It adds the `actualizado_hasta` (date) field
to `chile-mensual.json` and flags the current month with `incompleto: true`.

For another country: `--pais <Country>` in both commands (English name, as FIRMS uses it). Scripts
`4_mundo_descargar.py` and `5_mundo_armonizar.py` build the monthly series for every country in the world index.

The raw CSV files are stored in `procesamiento/crudos/` and **are not uploaded to GitHub** (they are in `.gitignore`).

## Files generated in `data/`

| File                 | Contents                                                                                                 | Used in the app for                         |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `chile-mensual.json` | Monthly series from 2003 to today: MODIS, VIIRS and the harmonized series, plus median, p25, p75 and maximum of each month | Months × years calendar and anomalies       |
| `chile-grilla.json`  | Harmonized counts per 0.25° cell and per month                                                           | Region calendars and harmonized map points  |
| `chile-YYYY.json`    | Raw detections for one year (with `--anuales`), same format as `chile-2023.json`                          | Table and CSV download                      |
| `chile-metodo.json`  | AI model results: annual series, detection curve, overpass times, errors, CONAF validation (not from these scripts) | "Armonización" panel and "Validación" tab   |
| `chile-poblaciones.json` | Chile towns (one per commune) with INE Census 2024 population (not from these scripts)               | Towns layer, nearest town, area tool        |

### `chile-mensual.json` format

Every list has the same length as `meses` and is in the same order.

```json
{
  "pais": "Chile",
  "unidad": "celdas-día con fuego (~1 km), equivalentes VIIRS",
  "meses":      ["2003-01", "2003-02", "..."],
  "modis":      [123, 456, "..."],
  "viirs":      [null, null, "...", 1460],
  "armonizado": [380.2, 1410.9, "..."],
  "origen":     ["reconstruido con IA (red neuronal + Random Forest)", "...", "VIIRS"],
  "incompleto": [false, "...", true],
  "por_mes_calendario": { "mediana": [12 values], "p25": [], "p75": [], "maximo": [], "anios_base": [2003, 2025] },
  "metodo": { "modelo_ia": true, "error_anual_mediano_pct": 3.5 }
}
```

The unit `celdas-día con fuego` means "fire cell-days": ~1 km cells with fire, counted once per day.

- **Calendar**: use `armonizado`. Row = year, column = month.
- **Monthly anomaly**: `armonizado[i] / mediana[month - 1]`. For example, 2.5 means "2.5 times the normal for that
  month".
- `origen` is used in the tooltip to show whether the value comes from VIIRS or from reconstructed MODIS.
- `incompleto` is `true` for months with partial data (for example, the current month).

### `chile-grilla.json` format

```json
{ "celda_grados": 0.25, "meses": ["2003-01", "..."],
  "celdas": [ { "lat": -40.25, "lon": -73.25, "v": [[0, 3.1], [5, 12.0]] } ] }
```

`lat` and `lon` are the southwest corner of the cell. `v` is a list of `[index in meses, value]` pairs and only
includes months with fire. For a selected area, add up the cells that fall inside it, month by month.

## Regional reports (`9_informes.py`)

`9_informes.py` writes a burning-activity report for every region of Chile and for the whole country, one per month
and one per fire season (July to June). The script, its messages and the report itself are in English.

```bash
cd globo-incendios/procesamiento
pip install -r requirements.txt
python 9_informes.py                        # uses salida/celdas_armonizadas.csv.gz
python 9_informes.py --crudos crudos/Chile  # also reads the FIRMS CSVs (FRP, day/night, concentration)
python 9_informes.py --celdas path/to/celdas_armonizadas.csv.gz
```

| Input                           | What it is                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `salida/celdas_armonizadas.csv.gz` | Output of the AI model (step 7 of the separate Chile project): one row per 20 km cell and month. **Not in this repository.** |
| `regiones_chile.geojson`        | Boundaries of the 16 regions; each cell goes to the region that contains its center     |
| `conaf_region_mes.csv`          | CONAF area burned (ha) and number of fires by region and month, 2001–2024               |
| `fuentes-conaf/`                | The two CONAF Excel files (monthly damage and monthly occurrence) the CSV was built from |

Output: `web_informes/` (`informe.html` plus `datos/*.js`), a static viewer that can be uploaded as is. Choose region,
type (monthly or season) and period; the address keeps the choice, for example `informe.html#biobio/temporada/2022`.

Each report states: the percentile and rank of the period against the same month (or season) of the other years of
the same region, the reliability of that figure and why, what is not observable, the harmonized activity against its
median, checks on whether an anomaly is real or an artifact (sensor mix, static sources, MODIS alone), comparisons
(previous year, most similar years, neighboring regions, CONAF), the most active cells, the trend (Mann-Kendall with
autocorrelation correction and Sen's slope) and what the report does not claim. Whatever cannot be computed with the
available data is shown as "not available" rather than estimated.

## Simple harmonization method (used by the other countries)

1. **Filter**: vegetation fires only (`type == 0`).
2. **Same grid for both sensors**: each detection is assigned to a 0.01° cell (~1 km, the size of a MODIS pixel) and
   counted once per cell and per day. This way VIIRS, with 375 m pixels, does not count the same fire several times.
3. **Calibration with the overlap (2012 onward)**: for each calendar month a factor `f = VIIRS / MODIS` is computed.
4. **Single series**: years with VIIRS use VIIRS; years before 2012 use `MODIS × f`.
5. **Cross-validation**: one year is left out, the factors are calibrated with the rest, and that year is predicted.
   The median error shows how reliable the reconstruction is.

Before 2003 the data is incomplete: only MODIS Terra was operating (Aqua started in mid-2002) and the counts are far
too low, so Chile's series starts in 2003.

## AI method (Chile)

In short: an equal-area 20 km grid of Chile; for each cell and month, the model learns from the 2012–2025 overlap how
many fires VIIRS would have seen given what MODIS saw (Aqua and Terra counts, day/night, fire radiative power, pixel
size, brightness, confidence, real overpass time, and a physical 1/P weight from the Aqua detection curve). A neural
network ensemble and a Random Forest are averaged. Blind tests: median annual error ±3.5 % when predicting years left
out, and much lower error than the simple factor in the 2022–2025 orbital-drift years. Validation with CONAF: the fake
jump in 2012 disappears and the 2003–2010 series follows CONAF's yearly fire counts best (correlation 0.80).
