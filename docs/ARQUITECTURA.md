# Arquitectura de Fire Sat

Guía para entender el código: qué hace cada módulo, cómo fluye la app y qué convenciones sigue. Todo el código de la
app está en `globo-incendios/tierra/`.

## Idea general

- **Sin compilación.** El navegador carga los módulos ES (`import`/`export`) tal como están en el disco. Three.js se
  resuelve con un _import map_ en `tierra/index.html`.
- **Datos estáticos.** Los JSON de `data/` se generan antes con Python (`procesamiento/`). La app solo los lee con
  `fetch`; no hay API propia.
- **Dos lienzos WebGL.** `#tierra` dibuja el globo y las nubes; `#pieza` dibuja encima el mapa 3D del país abierto.
  Comparten la cámara, para que el país despegue justo desde donde está en el planeta.
- **Workers para el trabajo pesado.** La cartografía, el relieve y las imágenes satelitales se procesan en hilos
  aparte (`*-worker.js`), así la animación no se congela.

## Flujo de la app

1. `index.html` carga `arranque.js`, que importa `tierra.js` y muestra un aviso si la descarga falla.
2. `tierra.js` (`main()`) crea la escena del globo: texturas, nubes, controles de cámara y el bucle de animación.
3. Al elegir un país (clic, búsqueda o `?pais=` en la URL), `abrirPais()` inicia un **vuelo**: un valor `t` de 0 a 1
   del que salen la cámara, la luz, el encuadre lateral y el despegue de la pieza. Volver atrás solo invierte `t`.
4. `ModoPais` (`modo-pais.js`) arma la pieza 3D con la geometría del worker de cartografía y, al aterrizar, carga el
   terreno, las regiones y los focos.
5. `PanelPais` (`panel-pais.js`) muestra los datos del país. Sus filtros (fecha, sensor, reproducción) llegan a
   `ModoPais` como uniformes de los shaders, así que filtrar no reconstruye la geometría.
6. El estado visible (país, año, día y sensor) se guarda en la URL (`estado-url.js`), y así un enlace abre la misma
   vista.

## Módulos

### Arranque y escena del globo

| Archivo                      | Responsabilidad                                                               |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `index.html`, `tierra.css`   | Estructura y estilos de toda la interfaz                                      |
| `arranque.js`                | Carga `tierra.js` y muestra un error claro si falla la descarga               |
| `tierra.js`                  | Orquesta todo: globo, cámara, vistas, vuelo hacia un país y conexiones        |
| `globo-shaders.js`           | Shaders de la superficie: día y noche, océano, sombras de nubes, país marcado |
| `estado-url.js`              | Lee y escribe el estado en la URL                                             |
| `paises.js`, `paises-geo.js` | Selección de países sobre el globo y buscador bilingüe                        |

### Nubes

| Archivo                                | Responsabilidad                                       |
| -------------------------------------- | ----------------------------------------------------- |
| `capa-nubes.js`                        | Pase de nubes volumétricas y su sombra sobre el globo |
| `cloud-shader.js`, `cloud-settings.js` | Campo de densidad compartido y parámetros de la capa  |
| `cloud-volume.js`                      | Textura de ruido 3D que da forma a las nubes          |
| `nubes-interactivas.js`                | El cursor aparta las nubes (`HandFlow`)               |

### Mapa del país

| Archivo                 | Responsabilidad                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `modo-pais.js`          | Pieza 3D: vuelo, zoom, regiones, ciudades, etiquetas, focos y detalle satelital         |
| `modo-pais-shaders.js`  | Shaders de la pieza: terreno, costa y límites, focos y cuadrados                        |
| `pieza-geo.js`          | Matemática pura: proyección, triangulación, regiones de cada foco (sin Three.js ni DOM) |
| `cartografia-worker.js` | Worker: descomprime la cartografía, triangula y busca regiones y ciudades               |
| `relieve-pais.js`       | Sombreado de elevación a partir de Mapzen Terrain Tiles (lo usa el worker)              |
| `ficha-punto.js`        | Ficha flotante de un foco o de una zona                                                 |

### Detalle satelital

| Archivo              | Responsabilidad                                                                     |
| -------------------- | ----------------------------------------------------------------------------------- |
| `teselas.js`         | Fuente (EOxCloudless 2016) y matemática de teselas Web Mercator (sin DOM)           |
| `capa-satelital.js`  | Texturas «gruesa» (país) y «fina» (zona visible), estado y manejo de fallos         |
| `satelite-worker.js` | Worker: descarga teselas con prioridad al centro, las compone y descarta las vacías |

`ModoPais.limitesVisibles()` calcula qué parte del país se ve y qué nivel de tesela pide su escala. El shader mezcla
las dos texturas sobre el mapa base: donde falta una tesela, sigue viéndose el mapa base.

### Paneles y datos

| Archivo                   | Responsabilidad                                                            |
| ------------------------- | -------------------------------------------------------------------------- |
| `panel-pais.js`           | Panel lateral: resumen, sensores, calendario diario, rankings, interruptor |
| `calendario-historico.js` | Calendario de años × meses con anomalías de la serie harmonizada           |
| `panel-datos.js`          | Ventana «Datos guardados»: tabla de registros y descarga en CSV            |
| `datos-pais.js`           | Catálogo, carga de datos, fechas y conteos (sin DOM)                       |
| `../datos.js`             | Utilidades de registros: filtros, resumen y CSV                            |

## Convenciones

- **Idioma:** nombres y comentarios en español. El código más antiguo de las nubes y del globo conserva nombres en
  inglés (`CloudLayer`, `changeView`); el código nuevo se escribe en español.
- **Comentarios:** explican _por qué_ se hace algo, no qué hace la línea.
- **Módulos puros aparte.** La lógica que no necesita DOM ni WebGL (`pieza-geo.js`, `teselas.js`, `datos-pais.js`) va
  en su propio módulo para poder probarla con `node --test`.
- **Versiones de caché:** cada import local lleva `?v=<huella>`. No se editan a mano: `npm run versionar`.
- **Formato y estilo:** Prettier y ESLint (`npm run format`, `npm run lint`). La configuración está en la raíz.
- **Accesibilidad:** todo control funciona con teclado, tiene nombre accesible y mide al menos 44 px en pantallas
  táctiles.

## Pruebas

`npm test` ejecuta `globo-incendios/pruebas/`:

| Archivo               | Qué comprueba                                                          |
| --------------------- | ---------------------------------------------------------------------- |
| `pieza-geo.test.mjs`  | Proyección, triangulación y regiones con la cartografía real de Chile  |
| `teselas.test.mjs`    | Niveles, rangos y antimeridiano de las teselas satelitales             |
| `datos.test.mjs`      | Fechas, conteos, escala del calendario, tabla y CSV                    |
| `integridad.test.mjs` | Que existan todos los datos, la cartografía y los archivos versionados |

La parte visual (WebGL) se revisa abriendo la app. El modo `?revision` fija la cámara y detiene el giro, así dos
capturas de la misma vista salen idénticas y se pueden comparar.
