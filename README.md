# FIRE ORBIT

Globo 3D interactivo para explorar los incendios detectados desde el espacio por NASA FIRMS (sensores MODIS y VIIRS).
Se elige un país en el globo, su territorio despega como una pieza 3D y muestra las detecciones por día, la serie
histórica mensual, las regiones y ciudades, y un modo de **detalle satelital** con imágenes Sentinel-2 de 10 m.
Al elegir una región, el panel muestra sus propias cifras: calendario, meses comparados con su historia y registros
descargables.

La app es estática: HTML, CSS y JavaScript, con datos preparados de antemano por scripts de Python. No necesita
servidor propio ni base de datos.

## Cómo abrirla

Necesitas **Python 3** y un navegador con **WebGL 2** (Chrome, Edge, Firefox o Safari recientes).

En Windows, abre `globo-incendios/Abrir Tierra.cmd`. Desde una terminal:

```bash
cd globo-incendios
python iniciar.py --tierra                # http://127.0.0.1:8000/tierra/
python iniciar.py --tierra --puerto 8001  # otro puerto
```

Mantén abierta la ventana del servidor mientras uses la app.

## Carpetas

```text
globo-incendios/
├── Abrir Tierra.cmd       Abre la app en Windows
├── iniciar.py             Servidor local
├── index.html             Redirige a tierra/
├── tierra/                La app
│   ├── index.html         Página
│   ├── tierra.css         Estilos
│   ├── arranque.js        Carga tierra.js
│   ├── tierra.js          Programa principal: globo, cámara y vuelo hacia un país
│   ├── estado-url.js      País, fecha y sensor guardados en la URL
│   ├── globo/             Superficie del globo y selección de países
│   ├── nubes/             Nubes volumétricas
│   ├── pais/              Mapa 3D del país: regiones, ciudades, relieve y focos
│   ├── satelite/          Detalle satelital (imágenes Sentinel-2)
│   ├── paneles/           Panel del país, calendario y tabla de registros
│   ├── datos/             Carga de datos, fechas y conteos
│   ├── assets/            Texturas, fuentes, nubes y cartografía por país
│   └── vendor/            Librerías de otros (Three.js, D3 Geo): no se editan
├── data/                  Detecciones y series de NASA FIRMS
└── procesamiento/         Scripts de Python que generan data/
docs/ARQUITECTURA.md       Cómo funciona el código, archivo por archivo
```

## Al editar el código

Los archivos se cargan con una versión al final, por ejemplo `modo-pais.js?v=20261109d`, para que el navegador no use
una copia vieja guardada. Cuando cambies algo, busca `v=20261109d` en toda la carpeta `tierra/` y reemplázalo por la
fecha del día (por ejemplo `v=20261215`; si ya usaste esa fecha, agrega una letra: `v=20261215b`). Todos los archivos
usan la misma versión, así que es un solo reemplazo.

## Datos

Los datos de `globo-incendios/data/` se generan con los scripts de `globo-incendios/procesamiento/` a partir de los
archivos anuales de NASA FIRMS. Su [README](globo-incendios/procesamiento/README.md) explica cada paso y el formato de
los archivos.

```bash
pip install -r globo-incendios/procesamiento/requirements.txt
```

## Fuentes y licencias

| Contenido                   | Fuente                                                              | Licencia                  |
| --------------------------- | ------------------------------------------------------------------- | ------------------------- |
| Detecciones de incendios    | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) (MODIS y VIIRS) | Datos abiertos de la NASA |
| Detalle satelital           | [EOxCloudless 2016](https://cloudless.eox.at) de EOX IT Services    | CC BY 4.0                 |
| Texturas de la Tierra       | Solar System Scope / INOVE                                          | CC BY 4.0                 |
| Relieve submarino           | NASA Blue Marble                                                    | Dominio público           |
| Relieve regional            | Mapzen Terrain Tiles                                                | Varias, con atribución    |
| Países, regiones y ciudades | Natural Earth                                                       | Dominio público           |
| Nombres de países           | mledoze/countries                                                   | ODbL                      |
| Gráficos y geografía        | Three.js, D3 Geo                                                    | MIT, ISC                  |
| Tipografías                 | Inter Tight, Archivo                                                | SIL OFL                   |

El detalle de cada fuente está en los archivos `procedencia*.json` de `globo-incendios/tierra/assets/` y
`globo-incendios/data/`, y las licencias de terceros en `globo-incendios/tierra/vendor/`.
