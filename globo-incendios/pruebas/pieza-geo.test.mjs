// Geometría de la pieza 3D de un país (tierra/pieza-geo.js), con la cartografía real de Chile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  aVector,
  construirGeometria,
  construirPuntos,
  desproyectar,
  fueraDePieza,
  indicesRegion,
  nombreCorto,
  proyectar,
} from '../tierra/pieza-geo.js';
import { geoContains } from '../tierra/vendor/d3-geo.js';
import { TIERRA, leerJSONgz, triangular } from './ayuda.mjs';

const detalle = leerJSONgz(path.join(TIERRA, 'assets/cartografia/152.json.gz'));
const chile = construirGeometria(null, triangular, detalle);

test('aVector: puntos de la esfera unitaria', () => {
  for (const [lon, lat] of [
    [0, 0],
    [-70, -33],
    [179, 60],
  ]) {
    assert.ok(Math.abs(Math.hypot(...aVector(lon, lat)) - 1) < 1e-12);
  }
});

test('proyectar y desproyectar son inversas', () => {
  for (const [lon, lat] of [
    [-71.62, -33.04],
    [-70.3, -18.48],
    [-68.6, -54.8],
  ]) {
    const [x, y] = proyectar(chile.marco, lon, lat);
    const [lon2, lat2] = desproyectar(chile.marco, x, y);
    assert.ok(Math.abs(lon2 - lon) < 1e-9 && Math.abs(lat2 - lat) < 1e-9, `${lon},${lat}`);
  }
});

test('la triangulación cubre la superficie del país', () => {
  assert.ok(chile.esfera.length > 0 && chile.esfera.length === chile.plano.length);
  assert.ok(Math.abs(chile.areaCubierta / chile.areaEsperada - 1) < 0.01);
});

test('regiones con nombre, límites y caja geográfica coherentes', () => {
  assert.equal(chile.etiquetas.length, 16);
  const valpo = chile.etiquetas.find(e => e.nombreCompleto === 'Valparaíso');
  assert.ok(valpo);
  const [w, s, e, n] = valpo.limites;
  assert.ok(w < -71.6 && e > -71.6 && s < -33 && n > -33);
  const { oeste, ancho, sur, norte } = chile.caja;
  assert.ok(oeste < -75 && oeste + ancho > -67 && sur < -55 && norte > -18);
});

test('islas lejanas (Isla de Pascua) quedan fuera de la pieza', () => {
  assert.ok(fueraDePieza(chile.marco, -109.35, -27.12));
  assert.ok(!fueraDePieza(chile.marco, -71.62, -33.04));
});

test('construirPuntos: omite islas lejanas y conserva el registro original', () => {
  const registros = [
    { lon: -71.62, lat: -33.04, frp: 10, sensor: 'VIIRS' },
    { lon: -109.35, lat: -27.12, frp: 5, sensor: 'MODIS' },
  ];
  const p = construirPuntos(chile, registros, new Int16Array([3, 4]));
  assert.equal(p.omitidos, 1);
  assert.deepEqual(p.origen, [0]);
  assert.equal(p.sensor[0], 1);
});

test('indicesRegion: cada foco cae en su región', () => {
  const indices = indicesRegion(detalle.regiones, [-71.62, -70.3], [-33.04, -18.48], geoContains);
  const nombres = Array.from(indices, i => detalle.regiones[i].properties.nombre);
  assert.deepEqual(nombres, ['Valparaíso', 'Arica y Parinacota']);
});

test('nombreCorto: acorta solo los nombres largos', () => {
  assert.equal(nombreCorto('Valparaíso'), 'Valparaíso');
  assert.equal(nombreCorto('Aysén del General Carlos Ibáñez del Campo'), 'Aysén');
});
