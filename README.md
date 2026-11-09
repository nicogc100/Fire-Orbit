# Fire Sat

Globo 3D interactivo para explorar los incendios detectados desde el espacio por NASA FIRMS (sensores MODIS y VIIRS).
Se elige un país en el globo, su territorio despega como una pieza 3D y muestra las detecciones por día, la serie
histórica mensual, las regiones y ciudades, y un modo de **detalle satelital** con imágenes Sentinel-2 de 10 m.

La app es estática: HTML, CSS y JavaScript sin compilar, con datos preparados de antemano por scripts de Python. No
necesita servidor propio ni base de datos.

## Requisitos

- **Python 3.10 o superior**, para el servidor local.
- **Un navegador con WebGL 2**: Chrome, Edge, Firefox o Safari recientes.
- **Node.js 22 o superior**, solo para desarrollar (pruebas, formato y revisión). La app no lo necesita.

## Cómo ejecutarla

En Windows, abre `globo-incendios/Abrir Tierra.cmd`. Desde una terminal:

```bash
cd globo-incendios
python iniciar.py --tierra                # http://127.0.0.1:8000/tierra/
python iniciar.py --tierra --puerto 8001  # otro puerto
```

Mantén abierta la ventana del servidor mientras uses la app.

## Estructura

```text
.
├── globo-incendios/            La aplicación
│   ├── iniciar.py              Servidor local
│   ├── index.html              Redirige a tierra/
│   ├── datos.js                Utilidades de datos (CSV, resúmenes)
│   ├── tierra/                 Código de la app (ver docs/ARQUITECTURA.md)
│   │   ├── assets/             Texturas, fuentes, nubes y cartografía por país
│   │   └── vendor/             Librerías de terceros (Three.js, D3 Geo); no se editan
│   ├── data/                   Detecciones y series que genera procesamiento/
│   ├── procesamiento/          Scripts de Python que descargan y preparan los datos
│   ├── pruebas/                Pruebas automáticas (node --test)
│   └── herramientas/           Herramientas de desarrollo (versiones de caché)
├── docs/ARQUITECTURA.md        Cómo funciona el código, módulo por módulo
├── .github/workflows/ci.yml    Verificación automática en cada push y pull request
└── package.json                Comandos de desarrollo
```

## Desarrollo

```bash
npm install          # una vez: instala las herramientas de desarrollo
npm run check        # todo lo que revisa la integración continua
```

| Comando                   | Qué hace                                                                  |
| ------------------------- | ------------------------------------------------------------------------- |
| `npm start`               | Abre la app con el servidor local                                         |
| `npm test`                | Pruebas automáticas (geometría, teselas, fechas, integridad de los datos) |
| `npm run lint`            | Revisión estática del código con ESLint                                   |
| `npm run format`          | Da formato al código con Prettier                                         |
| `npm run versionar`       | Recalcula las versiones de caché (`?v=…`) después de editar archivos      |
| `npm run versionar:check` | Falla si alguna versión de caché quedó desactualizada                     |

**Antes de cada commit:** `npm run format`, `npm run versionar` y `npm run check`.

Los archivos se cargan con una versión en la URL (`modo-pais.js?v=a9c8a30b`) para que el navegador no use una copia
vieja. Esa versión es una huella del contenido: `npm run versionar` la actualiza en el archivo y en todos los que
dependen de él. No se edita a mano.

## Datos

Los datos de `globo-incendios/data/` se generan con los scripts de `globo-incendios/procesamiento/` a partir de los
archivos anuales de NASA FIRMS. Su
[README](globo-incendios/procesamiento/README.md) explica cada paso y el formato de los archivos.

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
