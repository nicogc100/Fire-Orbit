# Fire Sat · aplicación

En Windows, abre **Abrir Tierra.cmd**. Necesitas Python 3 y un navegador compatible con WebGL 2.

Desde una terminal, en esta carpeta:

```bash
python iniciar.py --tierra
```

La aplicación se abre en [127.0.0.1:8000/tierra/](http://127.0.0.1:8000/tierra/). Mantén abierta la ventana del
servidor mientras la usas.

- `tierra/`: código de la app, texturas, nubes y cartografía.
- `data/`: detecciones y series de NASA FIRMS, con su procedencia.
- `procesamiento/`: scripts de Python que generan `data/`.
- `pruebas/`: pruebas automáticas.
- `herramientas/`: herramientas de desarrollo.

La guía completa (desarrollo, pruebas, estructura y licencias) está en el [README principal](../README.md), y el
funcionamiento del código en [docs/ARQUITECTURA.md](../docs/ARQUITECTURA.md).
