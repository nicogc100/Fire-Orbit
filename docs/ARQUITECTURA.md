# How Fire Orbit works

A guide to understanding the code: what each file does and how the app flows. All the code is in
`globo-incendios/tierra/`.

## Overview

- **No build step.** The browser loads the JavaScript files as they are, with `import` and `export`. Three.js is
  loaded from `vendor/`, as declared in `tierra/index.html`.
- **Static data.** The JSON files in `data/` are generated beforehand with Python (`procesamiento/`). The app only
  reads them.
- **Two 3D canvases.** `#tierra` draws the globe and the clouds; `#pieza` draws the open country's map on top. They
  share the camera, so the country lifts off exactly from where it sits on the planet.
- **Heavy work in the background.** The `*-worker.js` files run on separate threads (cartography, relief, satellite
  imagery), so the animation never freezes.

## How the app flows

1. `index.html` loads `arranque.js`, which loads `tierra.js` and shows a notice if the download fails.
2. `tierra.js` builds the globe: textures, clouds, camera controls, the orbiting satellites and the animation loop.
3. When a country is picked (click, search or `?pais=` in the URL), `abrirPais()` starts a **flight**: a value `t`
   that goes from 0 to 1 and drives the camera, the light, the framing and the map lift-off. Going back simply
   reverses `t`.
4. `pais/modo-pais.js` builds the 3D map with the geometry prepared by `pais/cartografia-worker.js` and, after
   landing, loads the terrain, the regions and the fires.
5. `paneles/panel-pais.js` shows the country data. Changing the date or the sensor only changes which fires the map
   shows: nothing is rebuilt.
6. Clicking a region zooms the map in and shows only its fires, and the panel switches to that region: path
   "Chile › Valparaíso", months, calendar and the "Datos" tab. "Chile" in the path goes back to the country without
   changing the year.
7. Country, year, day and sensor are stored in the URL (`estado-url.js`): a link opens the same view.
8. **Chile only:** `pais/herramientas-mapa.js` adds the map tools (original/harmonized points, towns, area query), and
   the panel adds the "Validación" tab. `armonizacion.js` opens the "Armonización" panel with the model charts.

## Files

### Main (`tierra/`)

| File                                | What it does                                                               |
| ----------------------------------- | -------------------------------------------------------------------------- |
| `index.html`, `tierra.css`          | Structure and styles of the whole interface                                |
| `tema-oscuro.css`                   | Dark theme for panels, calendars, map tools and satellite labels           |
| `armonizacion.js`, `armonizacion.css` | "Armonización" panel and "Validación" tab: hand-drawn interactive SVG charts read from `data/chile-metodo.json` |
| `arranque.js`                       | Loads `tierra.js` and warns if the download fails                          |
| `tierra.js`                         | Main program: globe, camera, views, flight, and wiring everything together |
| `estado-url.js`                     | Reads and writes country, date and sensor in the URL                       |

### `globo/`

| File                         | What it does                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `globo-shaders.js`           | Surface rendering: day and night, ocean, shadows, highlighted country         |
| `paises.js`, `paises-geo.js` | Country picking on the globe and search in Spanish and English                |
| `orbitas.js`                 | Aqua (MODIS) and NOAA-20 (VIIRS) satellites on polar orbits, with trails and labels |

### `nubes/`

| File                                   | What it does                                   |
| -------------------------------------- | ---------------------------------------------- |
| `capa-nubes.js`                        | Volumetric clouds and their shadow on the globe |
| `cloud-shader.js`, `cloud-settings.js` | Cloud shape and parameters                     |
| `cloud-volume.js`                      | 3D noise that shapes the clouds                |
| `nubes-interactivas.js`                | The cursor pushes the clouds aside             |

### `pais/`

| File                    | What it does                                                                     |
| ----------------------- | -------------------------------------------------------------------------------- |
| `modo-pais.js`          | 3D country map: flight, zoom, regions, cities, labels, fires, towns and area count (polygon in lon/lat) |
| `modo-pais-shaders.js`  | Rendering of terrain, coast, borders, fires and squares                          |
| `pieza-geo.js`          | Map math: projection, triangles and the region of each fire                      |
| `cartografia-worker.js` | In the background: reads the cartography, triangulates it and finds regions      |
| `relieve-pais.js`       | Hill shading from elevation data                                                 |
| `ficha-punto.js`        | Floating card with a fire's date, time, sensor and nearest town                  |
| `herramientas-mapa.js`  | Chile map tools (movable bar): original/harmonized points, towns, and the area tool (draw a polygon or rectangle; detections inside it and its yearly history from the harmonized grid) |

### `satelite/`

| File                 | What it does                                                                |
| -------------------- | --------------------------------------------------------------------------- |
| `teselas.js`         | Imagery source (EOxCloudless 2016) and which tiles to request               |
| `capa-satelital.js`  | Image of the whole country and of the visible area; status and failures     |
| `satelite-worker.js` | In the background: downloads the tiles and stitches them into one image     |

### `paneles/`

| File                      | What it does                                                          |
| ------------------------- | --------------------------------------------------------------------- |
| `panel-pais.js`           | Side panel: path, year, tabs, months, calendar, rankings              |
| `calendario-historico.js` | Years × months calendar with the historical series                    |
| `tabla-registros.js`      | Detections table with sorting, pages and CSV (used by both panels)    |
| `panel-datos.js`          | "Datos guardados" window: records table and CSV download              |

### `datos/`

| File            | What it does                                                                  |
| --------------- | ----------------------------------------------------------------------------- |
| `datos-pais.js` | Which countries have data, file loading, dates, counts and per-region series  |
| `datos.js`      | Filters, summaries and conversion of records to CSV                           |

## Code conventions

- Names, comments and the interface are in Spanish (the app is built for users in Chile). The clouds and parts of the
  globe, which are older, keep English names.
- Comments explain _why_ something is done, not what each line does.
- Math that draws nothing (`pieza-geo.js`, `teselas.js`, `datos-pais.js`) lives in separate files, independent of the
  screen.
- Every control works with the keyboard and is at least 44 px on touch screens.
- When editing, change the `?v=` version (see the main README).
