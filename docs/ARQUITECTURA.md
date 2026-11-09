# Cómo funciona Fire Sat

Guía para entender el código: qué hace cada archivo y cómo fluye la app. Todo el código está en
`globo-incendios/tierra/`.

## Idea general

- **Sin compilación.** El navegador carga los archivos JavaScript tal como están, con `import` y `export`. Three.js se
  carga desde `vendor/`, según se indica en `tierra/index.html`.
- **Datos estáticos.** Los JSON de `data/` se generan antes con Python (`procesamiento/`). La app solo los lee.
- **Dos lienzos 3D.** `#tierra` dibuja el globo y las nubes; `#pieza` dibuja encima el mapa del país abierto.
  Comparten la cámara, para que el país despegue justo desde donde está en el planeta.
- **Trabajo pesado en segundo plano.** Los archivos `*-worker.js` corren en hilos aparte (cartografía, relieve,
  imágenes satelitales), así la animación no se congela.

## Recorrido de la app

1. `index.html` carga `arranque.js`, que carga `tierra.js` y muestra un aviso si la descarga falla.
2. `tierra.js` crea el globo: texturas, nubes, controles de cámara y el bucle de animación.
3. Al elegir un país (clic, búsqueda o `?pais=` en la URL), `abrirPais()` inicia un **vuelo**: un valor `t` que va
   de 0 a 1 y del que salen la cámara, la luz, el encuadre y el despegue del mapa. Volver atrás solo invierte `t`.
4. `pais/modo-pais.js` arma el mapa 3D con la geometría que prepara `pais/cartografia-worker.js` y, al aterrizar,
   carga el terreno, las regiones y los focos.
5. `paneles/panel-pais.js` muestra los datos del país. Al cambiar la fecha o el sensor, el mapa solo cambia qué focos
   enseña: no se vuelve a construir.
6. País, año, día y sensor se guardan en la URL (`estado-url.js`): un enlace abre la misma vista.

## Archivos

### Principal (`tierra/`)

| Archivo                    | Qué hace                                                               |
| -------------------------- | ---------------------------------------------------------------------- |
| `index.html`, `tierra.css` | Estructura y estilos de toda la interfaz                               |
| `arranque.js`              | Carga `tierra.js` y avisa si falla la descarga                         |
| `tierra.js`                | Programa principal: globo, cámara, vistas, vuelo y conexión de todo    |
| `estado-url.js`            | Lee y escribe país, fecha y sensor en la URL                           |

### `globo/`

| Archivo                      | Qué hace                                                                  |
| ---------------------------- | ------------------------------------------------------------------------- |
| `globo-shaders.js`           | Dibujo de la superficie: día y noche, océano, sombras, país marcado       |
| `paises.js`, `paises-geo.js` | Selección de países sobre el globo y buscador en español e inglés         |

### `nubes/`

| Archivo                                | Qué hace                                         |
| -------------------------------------- | ------------------------------------------------ |
| `capa-nubes.js`                        | Nubes volumétricas y su sombra sobre el globo    |
| `cloud-shader.js`, `cloud-settings.js` | Forma y parámetros de las nubes                  |
| `cloud-volume.js`                      | Ruido 3D que da forma a las nubes                |
| `nubes-interactivas.js`                | El cursor aparta las nubes                       |

### `pais/`

| Archivo                 | Qué hace                                                                     |
| ----------------------- | ---------------------------------------------------------------------------- |
| `modo-pais.js`          | Mapa 3D del país: vuelo, zoom, regiones, ciudades, etiquetas y focos          |
| `modo-pais-shaders.js`  | Dibujo del terreno, la costa, los límites, los focos y los cuadrados         |
| `pieza-geo.js`          | Matemática del mapa: proyección, triángulos y región de cada foco            |
| `cartografia-worker.js` | En segundo plano: lee la cartografía, la triangula y busca regiones          |
| `relieve-pais.js`       | Sombreado de montañas y valles a partir de datos de elevación                |
| `ficha-punto.js`        | Ficha flotante con fecha, hora y sensor de un foco                           |

### `satelite/`

| Archivo              | Qué hace                                                                  |
| -------------------- | ------------------------------------------------------------------------- |
| `teselas.js`         | Fuente de imágenes (EOxCloudless 2016) y cálculo de qué teselas pedir      |
| `capa-satelital.js`  | Imagen del país entero y de la zona visible; estado y fallos              |
| `satelite-worker.js` | En segundo plano: descarga las teselas y las une en una sola imagen       |

### `paneles/`

| Archivo                   | Qué hace                                                            |
| ------------------------- | ------------------------------------------------------------------- |
| `panel-pais.js`           | Panel lateral: resumen, sensores, calendario, rankings, interruptor |
| `calendario-historico.js` | Calendario de años × meses con la serie histórica                   |
| `panel-datos.js`          | Ventana «Datos guardados»: tabla de registros y descarga en CSV     |

### `datos/`

| Archivo         | Qué hace                                                    |
| --------------- | ----------------------------------------------------------- |
| `datos-pais.js` | Qué países tienen datos, carga de archivos, fechas y conteos |
| `datos.js`      | Filtros, resúmenes y conversión de registros a CSV          |

## Costumbres del código

- Nombres y comentarios en español. Las nubes y parte del globo, que son más antiguos, conservan nombres en inglés.
- Los comentarios explican _por qué_ se hace algo, no qué hace cada línea.
- La matemática que no dibuja nada (`pieza-geo.js`, `teselas.js`, `datos-pais.js`) va en archivos aparte, sin
  depender de la pantalla.
- Todo control funciona con teclado y mide al menos 44 px en pantallas táctiles.
- Al editar, cambia la versión `?v=` (ver el README principal).
