// Utilidades compartidas por las pruebas: rutas del proyecto y lectura de datos.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TIERRA = path.join(APP, 'tierra');
export const DATA = path.join(APP, 'data');

export const leerJSON = archivo => JSON.parse(readFileSync(archivo, 'utf8'));
export const leerJSONgz = archivo => JSON.parse(gunzipSync(readFileSync(archivo)).toString('utf8'));

// Triangulación con la misma implementación que usa la app (Three.js).
const { ShapeUtils, Vector2 } = await import('../tierra/vendor/three.core.js');
const aVectores = puntos => puntos.map(p => new Vector2(p.x, p.y));
export const triangular = (contorno, huecos) => ShapeUtils.triangulateShape(aVectores(contorno), huecos.map(aVectores));
