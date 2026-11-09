import { diaDelAnio } from './datos/datos-pais.js?v=20261109';

// Estado de la vista en la URL (?pais=, ?anio=, ?dia=, ?sensor=, ?datos=): permite
// compartir un enlace que abre exactamente el mismo país, fecha y sensor.
export function actualizarURL(cambios) {
  const parametros = new URLSearchParams(location.search);
  for (const [clave, valor] of Object.entries(cambios)) {
    if (valor === null || valor === undefined) parametros.delete(clave);
    else parametros.set(clave, valor);
  }
  const texto = parametros.toString();
  history.replaceState(null, '', `${location.pathname}${texto ? `?${texto}` : ''}`);
}
export function leerInicial(parametros) {
  const fecha = parametros.get('dia');
  const sensor = parametros.get('sensor');
  const anio = parametros.get('anio');
  return {
    anio: /^\d{4}-/.test(fecha || '') ? +fecha.slice(0, 4) : /^\d{4}$/.test(anio || '') ? +anio : null,
    dia: /^\d{4}-\d{2}-\d{2}$/.test(fecha || '') ? diaDelAnio(fecha, +fecha.slice(0, 4)) : null,
    sensor: ['MODIS', 'VIIRS'].includes(sensor) ? sensor : null,
  };
}
