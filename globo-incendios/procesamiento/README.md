# Procesamiento de datos: harmonización MODIS + VIIRS

Estos scripts generan los datos que usa la app a partir de los CSV anuales de NASA FIRMS.

## Cómo se usa

Desde la carpeta `globo-incendios`:

```bash
pip install requests pandas numpy
python procesamiento/1_descargar.py                  # baja Chile: MODIS 2000-2025 y VIIRS 2012-2025
python procesamiento/2_armonizar.py --anuales        # harmoniza y escribe los archivos en data/
```

Para otro país: `--pais Portugal` en los dos comandos (nombre en inglés, como lo usa FIRMS).

Los CSV crudos quedan en `procesamiento/crudos/` y **no se suben a GitHub** (están en `.gitignore`).

## Archivos que genera en `data/`

| Archivo | Qué tiene | Para qué sirve en la app |
|---|---|---|
| `chile-mensual.json` | Serie mensual de 2000 a hoy: MODIS, VIIRS y la serie harmonizada, más mediana, p25, p75 y máximo de cada mes | Calendario meses × años y anomalías |
| `chile-grilla.json` | Conteos harmonizados por celda de 0,25° y por mes | Calendario de un área elegida por el usuario |
| `chile-AAAA.json` | Detecciones crudas de un año (con `--anuales`), mismo formato que `chile-2023.json` | Tabla y descarga del CSV |

### Formato de `chile-mensual.json`

Todas las listas tienen el mismo largo que `meses` y van en el mismo orden.

```json
{
  "pais": "Chile",
  "unidad": "celdas-día con fuego (~1 km), equivalentes VIIRS",
  "meses":      ["2000-11", "2000-12", "..."],
  "modis":      [123, 456, "..."],
  "viirs":      [null, null, "...", 1460],
  "armonizado": [380.2, 1410.9, "..."],
  "origen":     ["MODIS×f", "...", "VIIRS"],
  "por_mes_calendario": { "mediana": [12 valores], "p25": [], "p75": [], "maximo": [], "anios_base": [2001, 2025] },
  "metodo": { "factores_por_mes": [12 valores], "validacion_cruzada": [], "error_anual_mediano_pct": 0 }
}
```

- **Calendario**: usar `armonizado`. Fila = año, columna = mes.
- **Anomalía de un mes**: `armonizado[i] / mediana[mes - 1]`. Por ejemplo, 2,5 significa "2,5 veces lo normal para ese mes".
- `origen` sirve para mostrar en el tooltip si el valor viene de VIIRS o de MODIS reconstruido.

### Formato de `chile-grilla.json`

```json
{ "celda_grados": 0.25, "meses": ["2000-11", "..."],
  "celdas": [ { "lat": -40.25, "lon": -73.25, "v": [[0, 3.1], [5, 12.0]] } ] }
```

`lat` y `lon` son la esquina suroeste de la celda. `v` es una lista de pares `[índice en meses, valor]`, y solo trae los meses con fuego. Para un área elegida, se suman las celdas que caen dentro, mes a mes.

## Método de harmonización

1. **Filtro**: solo fuegos de vegetación (`type == 0`).
2. **Misma grilla para los dos sensores**: cada detección se asigna a una celda de 0,01° (~1 km, el tamaño de un píxel MODIS) y se cuenta una vez por celda y por día. Así VIIRS, con píxeles de 375 m, no cuenta varias veces el mismo fuego.
3. **Calibración con el traslape (2012 en adelante)**: para cada mes del calendario se calcula un factor `f = VIIRS / MODIS`.
4. **Serie única**: los años con VIIRS usan VIIRS; los años 2000-2011 usan `MODIS × f`.
5. **Validación cruzada**: se deja fuera un año, se calibra con el resto y se predice ese año. El error mediano muestra qué tan confiable es la reconstrucción.

Antes de julio de 2002 solo operaba MODIS Terra (Aqua aún no se lanzaba), así que esos meses pueden quedar subestimados.

## Archivos de ejemplo

`data/ejemplo-mensual.json` y `data/ejemplo-grilla.json` tienen **datos inventados** con el formato correcto, para desarrollar la app mientras se generan los reales. Hay que borrarlos antes de la entrega.
