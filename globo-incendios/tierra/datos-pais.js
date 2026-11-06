// Datos guardados por país. Sin DOM ni WebGL: se prueba con comprobar-datos.mjs.
// anios: años con detecciones guardadas (data/<prefijo>-<año>.json).
// serie: archivo con la serie mensual harmonizada MODIS + VIIRS (procesamiento/2_armonizar.py).
const rango = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
export const CATALOGO = {
  152: { id: '152', nombre: 'Chile', prefijo: 'chile', anios: rango(2000, 2026), serie: 'chile-mensual.json', grilla: 'chile-grilla.json' },
  620: { id: '620', nombre: 'Portugal', prefijo: 'portugal', anios: [2023] },
};
// Entrada para un año concreto; sin año, el más reciente con datos.
export function entradaAnio(entrada, anio) {
  if (!entrada) return null;
  const a = entrada.anios.includes(+anio) ? +anio : entrada.anios.at(-1);
  return { ...entrada, anio: a, archivo: `${entrada.prefijo}-${a}.json` };
}
export const entradaCatalogo = (id, anio) => entradaAnio(CATALOGO[id], anio);

const cache = new Map();
let procedencia;

async function pedirJSON(url, intentos = 3) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try {
      const respuesta = await fetch(url);
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      return await respuesta.json();
    } catch (error) { ultimo = error; }
  }
  throw ultimo;
}

export function cargarProcedencia() {
  procedencia ||= pedirJSON('../data/procedencia.json').catch(error => { procedencia = null; throw error; });
  return procedencia;
}

export function cargarDatos(entrada) {
  const clave = entrada.archivo;
  if (!cache.has(clave)) {
    // Solo se guardan en memoria los últimos años abiertos: cada año puede pesar varios MB.
    if (cache.size >= 4) cache.delete(cache.keys().next().value);
    cache.set(clave, pedirJSON(`../data/${entrada.archivo}`).then(prepararDatos).catch(error => {
      cache.delete(clave);
      throw error;
    }));
  }
  return cache.get(clave);
}

// Serie mensual harmonizada (2000 → hoy). null si el país no la tiene.
const series = new Map();
export function cargarSerie(entrada) {
  if (!entrada?.serie) return Promise.resolve(null);
  if (!series.has(entrada.id)) {
    series.set(entrada.id, pedirJSON(`../data/${entrada.serie}`).catch(error => { series.delete(entrada.id); throw error; }));
  }
  return series.get(entrada.id);
}

export function diasDelAnio(anio) { return (Date.UTC(anio + 1, 0, 1) - Date.UTC(anio, 0, 1)) / 864e5; }
export function diaDelAnio(fecha, anio) {
  return Math.round((Date.UTC(+fecha.slice(0, 4), +fecha.slice(5, 7) - 1, +fecha.slice(8, 10)) - Date.UTC(anio, 0, 1)) / 864e5);
}
export function fechaDeDia(dia, anio) { return new Date(Date.UTC(anio, 0, 1 + dia)).toISOString().slice(0, 10); }

export function prepararDatos({ pais, anio, registros }) {
  const total = diasDelAnio(anio);
  const porSensor = { MODIS: new Int32Array(total), VIIRS: new Int32Array(total) };
  const dias = new Int16Array(registros.length);
  registros.forEach((registro, i) => {
    const dia = diaDelAnio(registro.fecha, anio);
    dias[i] = dia;
    if (dia >= 0 && dia < total) porSensor[registro.sensor][dia]++;
  });
  return { pais, anio, registros, dias, porSensor, totalDias: total };
}

export function conteosPara(datos, sensor) {
  if (sensor !== 'todos') return datos.porSensor[sensor];
  return datos.porSensor.MODIS.map((valor, i) => valor + datos.porSensor.VIIRS[i]);
}
export const suma = lista => lista.reduce((total, valor) => total + valor, 0);
export function diasActivos(conteos) { return conteos.reduce((total, valor) => total + (valor > 0 ? 1 : 0), 0); }
export function mayoresDias(conteos, cantidad = 3) {
  return Array.from(conteos, (valor, dia) => ({ dia, valor })).filter(d => d.valor > 0)
    .sort((a, b) => b.valor - a.valor || a.dia - b.dia).slice(0, cantidad);
}

// La actividad es muy asimétrica (Chile: mediana 35, pico 11.841). Los cortes por
// cuantil mantienen legible el año entero; la leyenda muestra los valores reales.
export function escalaCalendario(conteos) {
  const positivos = Array.from(conteos).filter(v => v > 0).sort((a, b) => a - b);
  if (!positivos.length) return { nivel: () => 0, tramos: [] };
  const crudos = [.3, .55, .78, .93].map(q => positivos[Math.min(positivos.length - 1, Math.floor(positivos.length * q))]);
  const cortes = [...new Set(crudos)].filter(c => c < positivos.at(-1));
  const nivel = valor => {
    if (valor <= 0) return 0;
    let i = 0;
    while (i < cortes.length && valor > cortes[i]) i++;
    // Con pocos cortes se reparten por toda la rampa para conservar el contraste.
    return cortes.length ? 1 + Math.round(i * 4 / cortes.length) : 5;
  };
  const tramos = [...cortes, positivos.at(-1)].map((hasta, i, lista) => ({
    desde: i ? lista[i - 1] + 1 : positivos[0], hasta, nivel: cortes.length ? 1 + Math.round(i * 4 / cortes.length) : 5,
  }));
  return { nivel, tramos };
}

export function filtrarTabla(datos, { mes = 0, dia = null, sensor = 'todos' } = {}) {
  const salida = [];
  datos.registros.forEach((registro, i) => {
    if (sensor !== 'todos' && registro.sensor !== sensor) return;
    if (dia !== null && datos.dias[i] !== dia) return;
    if (mes && +registro.fecha.slice(5, 7) !== mes) return;
    salida.push(registro);
  });
  return salida;
}

const CLAVES = {
  fecha: r => r.fecha + r.hora, sensor: r => r.sensor, frp: r => r.frp, lat: r => r.lat, lon: r => r.lon,
};
export function ordenarTabla(registros, campo = 'fecha', direccion = 'asc') {
  const clave = CLAVES[campo] || CLAVES.fecha;
  const signo = direccion === 'desc' ? -1 : 1;
  return [...registros].sort((a, b) => {
    const x = clave(a), y = clave(b);
    return x < y ? -signo : x > y ? signo : 0;
  });
}
export function etiquetaConfianza(valor) {
  return { l: 'Baja', n: 'Nominal', h: 'Alta' }[valor] || `${valor} %`;
}
export function etiquetaSatelite(valor) { return valor === 'N' ? 'Suomi NPP' : valor; }
