// Funciones de datos: puedes estudiarlas y probarlas sin dibujar la interfaz.
export const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

export function filtrarRegistros(registros, { mes = 0, sensor = 'todos', periodo = 'todos' } = {}) {
  return registros.filter(
    registro =>
      (Number(mes) === 0 || Number(registro.fecha.slice(5, 7)) === Number(mes)) &&
      (sensor === 'todos' || registro.sensor === sensor) &&
      (periodo === 'todos' || registro.periodo === periodo),
  );
}

export function contarPorMes(registros) {
  const resultado = MESES.map(mes => ({ mes, MODIS: 0, VIIRS: 0 }));
  for (const registro of registros) {
    resultado[Number(registro.fecha.slice(5, 7)) - 1][registro.sensor] += 1;
  }
  return resultado;
}

export function resumir(registros) {
  return {
    total: registros.length,
    MODIS: registros.filter(registro => registro.sensor === 'MODIS').length,
    VIIRS: registros.filter(registro => registro.sensor === 'VIIRS').length,
    dias: new Set(registros.map(registro => registro.fecha)).size,
  };
}

export function muestrearParaMapa(registros, limite = 6000) {
  if (registros.length <= limite) return registros;
  return Array.from({ length: limite }, (_, indice) => registros[Math.floor((indice * registros.length) / limite)]);
}

export function convertirCSV(registros) {
  const columnas = ['lat', 'lon', 'fecha', 'hora', 'sensor', 'satelite', 'frp', 'periodo', 'confianza', 'version'];
  const escapar = valor => '"' + String(valor).replaceAll('"', '""') + '"';
  return [
    columnas.join(','),
    ...registros.map(registro => columnas.map(columna => escapar(registro[columna])).join(',')),
  ].join('\r\n');
}
