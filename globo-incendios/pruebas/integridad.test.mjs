// Integridad de los archivos que la app pide al servidor: si falta uno o cambia su
// formato, falla aquí y no en el navegador de quien usa la app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CATALOGO } from '../tierra/datos-pais.js';
import { APP, DATA, TIERRA, leerJSON } from './ayuda.mjs';

test('catálogo: cada año declarado tiene su archivo con registros válidos', () => {
  for (const entrada of Object.values(CATALOGO)) {
    for (const anio of entrada.anios) {
      const archivo = path.join(DATA, `${entrada.prefijo}-${anio}.json`);
      assert.ok(existsSync(archivo), archivo);
    }
    for (const extra of [entrada.serie, entrada.grilla].filter(Boolean)) assert.ok(existsSync(path.join(DATA, extra)));
  }
  const { anio, registros } = leerJSON(path.join(DATA, 'portugal-2023.json'));
  assert.equal(anio, 2023);
  for (const r of registros.slice(0, 500)) {
    assert.ok(['MODIS', 'VIIRS'].includes(r.sensor));
    assert.match(r.fecha, /^2023-\d{2}-\d{2}$/);
    assert.ok(Math.abs(r.lat) <= 90 && Math.abs(r.lon) <= 180);
  }
});

test('índice mundial: cada país apunta a su serie y a su mapa de celdas', () => {
  const { paises } = leerJSON(path.join(DATA, 'mundo/indice.json'));
  assert.ok(paises.length > 100);
  for (const p of paises) {
    assert.ok(existsSync(path.join(DATA, 'mundo', p.archivo)), p.archivo);
    const base = path.join(DATA, 'mundo/celdas-pais', p.id);
    if (existsSync(`${base}.json`)) assert.ok(existsSync(`${base}.bin.gz`), `${p.id}.bin.gz`);
  }
});

test('cartografía: un archivo por país del globo', () => {
  const paises = leerJSON(path.join(TIERRA, 'assets/paises-50m.geo.json')).features;
  const disponibles = new Set(readdirSync(path.join(TIERRA, 'assets/cartografia')).map(f => f.replace('.json.gz', '')));
  const faltan = paises.map(f => String(f.id)).filter(id => !disponibles.has(id));
  assert.deepEqual(faltan, []);
});

test('cada archivo con versión (?v=) que cita el código existe', () => {
  const fuentes = [
    ...readdirSync(TIERRA)
      .filter(f => /\.(js|html|css)$/.test(f))
      .map(f => path.join(TIERRA, f)),
    path.join(APP, 'index.html'),
  ];
  for (const fuente of fuentes) {
    const texto = readFileSync(fuente, 'utf8');
    for (const [, ruta] of texto.matchAll(/['"(]\.?\/?([\w./-]+)\?v=[\w]+/g)) {
      assert.ok(existsSync(path.resolve(path.dirname(fuente), ruta)), `${path.basename(fuente)} → ${ruta}`);
    }
  }
});
