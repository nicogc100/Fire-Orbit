# Fire Sat · application

On Windows, open **Abrir Tierra.cmd**. You need Python 3 and a browser that supports WebGL 2.

From a terminal, in this folder:

```bash
python iniciar.py --tierra
```

The application opens at [127.0.0.1:8000/tierra/](http://127.0.0.1:8000/tierra/). Keep the server window open while
you use it.

- `tierra/`: app code, textures, clouds and cartography.
- `data/`: NASA FIRMS detections and series with their provenance, AI model results for Chile (`chile-metodo.json`)
  and Chile towns (`chile-poblaciones.json`).
- `procesamiento/`: Python scripts that generate `data/`.

The full guide (structure, how to edit, and licenses) is in the [main README](../README.md), and how the code works is
in [docs/ARQUITECTURA.md](../docs/ARQUITECTURA.md).
