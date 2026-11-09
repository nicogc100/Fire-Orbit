// Funciones de datos sin interfaz: tierra/datos-pais.js y datos.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diasDelAnio,
  diaDelAnio,
  fechaDeDia,
  prepararDatos,
  conteosPara,
  suma,
  diasActivos,
  mayoresDias,
  escalaCalendario,
  filtrarTabla,
  ordenarTabla,
  entradaAnio,
  etiquetaConfianza,
  etiquetaSatelite,
} from '../tierra/datos-pais.js';
import { convertirCSV, contarPorMes, filtrarRegistros, resumir } from '../datos.js';

const registros = [
  { fecha: '2024-01-01', hora: '0300', sensor: 'MODIS', frp: 5, lat: -33, lon: -71 },
  { fecha: '2024-01-01', hora: '1500', sensor: 'VIIRS', frp: 2, lat: -34, lon: -71 },
  { fecha: '2024-02-29', hora: '1200', sensor: 'VIIRS', frp: 9, lat: -35, lon: -72 },
  { fecha: '2024-12-31', hora: '2300', sensor: 'MODIS', frp: 1, lat: -36, lon: -72 },
];

test('fechas: años bisiestos e ida y vuelta día ↔ fecha', () => {
  assert.equal(diasDelAnio(2024), 366);
  assert.equal(diasDelAnio(2023), 365);
  assert.equal(diaDelAnio('2024-02-29', 2024), 59);
  for (const dia of [0, 59, 365]) assert.equal(diaDelAnio(fechaDeDia(dia, 2024), 2024), dia);
});

test('prepararDatos y conteos por sensor', () => {
  const datos = prepararDatos({ pais: 'Chile', anio: 2024, registros });
  assert.equal(datos.totalDias, 366);
  assert.equal(suma(conteosPara(datos, 'todos')), 4);
  assert.equal(suma(conteosPara(datos, 'VIIRS')), 2);
  assert.equal(diasActivos(conteosPara(datos, 'todos')), 3);
  assert.deepEqual(mayoresDias(conteosPara(datos, 'todos'), 1), [{ dia: 0, valor: 2 }]);
});

test('escalaCalendario: niveles de 0 a 5 y tramos ordenados', () => {
  const conteos = Int32Array.from({ length: 100 }, (_, i) => i);
  const { nivel, tramos } = escalaCalendario(conteos);
  assert.equal(nivel(0), 0);
  assert.equal(nivel(99), 5);
  for (let i = 1; i < tramos.length; i++) assert.ok(tramos[i].desde > tramos[i - 1].hasta);
  assert.equal(escalaCalendario(new Int32Array(10)).tramos.length, 0);
});

test('tabla: filtros y orden', () => {
  const datos = prepararDatos({ pais: 'Chile', anio: 2024, registros });
  assert.equal(filtrarTabla(datos, { mes: 1 }).length, 2);
  assert.equal(filtrarTabla(datos, { dia: 59 }).length, 1);
  assert.deepEqual(
    ordenarTabla(registros, 'frp', 'desc').map(r => r.frp),
    [9, 5, 2, 1],
  );
});

test('entradaAnio: año pedido o el más reciente', () => {
  const entrada = { prefijo: 'chile', anios: [2022, 2023] };
  assert.equal(entradaAnio(entrada, 2022).archivo, 'chile-2022.json');
  assert.equal(entradaAnio(entrada, 1990).anio, 2023);
  assert.equal(entradaAnio(null, 2023), null);
});

test('etiquetas legibles de confianza y satélite', () => {
  assert.equal(etiquetaConfianza('h'), 'Alta');
  assert.equal(etiquetaConfianza('80'), '80 %');
  assert.equal(etiquetaSatelite('N'), 'Suomi NPP');
});

test('datos.js: CSV con comillas escapadas y resumen por sensor', () => {
  const csv = convertirCSV([{ lat: 1, lon: 2, fecha: '2024-01-01', hora: '0300', sensor: 'MODIS', satelite: 'A"qua' }]);
  const [cabecera, fila] = csv.split('\r\n');
  assert.ok(cabecera.startsWith('lat,lon,fecha'));
  assert.ok(fila.includes('"A""qua"'));
  assert.deepEqual(resumir(registros), { total: 4, MODIS: 2, VIIRS: 2, dias: 3 });
  assert.equal(filtrarRegistros(registros, { mes: 2 }).length, 1);
  assert.equal(contarPorMes(registros)[0].VIIRS, 1);
});
