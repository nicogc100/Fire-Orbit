// Teselas satelitales en Web Mercator (tierra/teselas.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FUENTE, mercatorY, metrosPorPixel, rango, elegirRango, cajaDe, claveRango } from '../tierra/teselas.js';

test('mercatorY: ecuador en el centro y límites en los bordes', () => {
  assert.equal(mercatorY(0), 0.5);
  assert.ok(Math.abs(mercatorY(85.05112878)) < 1e-9);
  assert.ok(Math.abs(mercatorY(-85.05112878) - 1) < 1e-9);
  // Más allá de ±85,05° se recorta, no se sale de la textura.
  assert.equal(mercatorY(90), mercatorY(85.05112878));
});

test('metrosPorPixel: nivel 14 ≈ 10 m en el ecuador (resolución de Sentinel-2)', () => {
  assert.ok(Math.abs(metrosPorPixel(0, 14) - 9.55) < 0.01);
  assert.ok(metrosPorPixel(-33, 14) < metrosPorPixel(0, 14));
});

test('rango: cubre los límites pedidos', () => {
  const r = rango([-72, -34, -70, -32], 10);
  const lonIzq = (r.izq / r.n) * 360 - 180;
  const lonDer = (r.der / r.n) * 360 - 180;
  assert.ok(lonIzq <= -72 && lonDer >= -70);
  assert.ok(r.arriba / r.n <= mercatorY(-32) && r.abajo / r.n >= mercatorY(-34));
  assert.equal(r.ancho, r.der - r.izq);
});

test('rango: un país que cruza el antimeridiano no supera una vuelta', () => {
  const r = rango([-181.5, -20, 181.5, -10], 3);
  assert.ok(r.ancho <= r.n);
  // La caja de textura queda dentro de [0, 1) aunque la columna inicial sea negativa.
  const [u0] = cajaDe(rango([-181.5, -20, -170, -10], 6));
  assert.ok(u0 >= 0 && u0 < 1);
});

test('elegirRango: respeta el presupuesto y nunca pasa del nivel máximo', () => {
  const chile = [-77, -57, -65, -16];
  const r = elegirRango(chile, 10, 2048, 64);
  assert.ok(r.ancho * FUENTE.lado <= 2048 && r.alto * FUENTE.lado <= 2048 && r.ancho * r.alto <= 64);
  assert.ok(elegirRango([-71.7, -33.1, -71.5, -33], 20, 3072, 120).z <= FUENTE.zMax);
});

test('claveRango: distingue niveles y posiciones', () => {
  assert.notEqual(claveRango(rango([0, 0, 1, 1], 8)), claveRango(rango([0, 0, 1, 1], 9)));
  assert.equal(claveRango(rango([0, 0, 1, 1], 8)), claveRango(rango([0, 0, 1, 1], 8)));
});
