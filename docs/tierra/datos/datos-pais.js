// Datos guardados por país. Sin DOM ni WebGL: solo carga y cálculo.
// anios: años con detecciones guardadas (data/<prefijo>-<año>.json).
// serie: archivo con la serie mensual harmonizada MODIS + VIIRS (procesamiento/2_armonizar.py).
const rango = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
export const CATALOGO = {
  152: {
    id: '152',
    nombre: 'Chile',
    prefijo: 'chile',
    anios: rango(2003, 2026),
    serie: 'chile-mensual.json',
    grilla: 'chile-grilla.json',
  },
};
// Índice mundial (procesamiento/5_mundo_armonizar.py): serie mensual harmonizada de cada país.
let indiceMundo = new Map();
export async function cargarIndice() {
  try {
    const indice = await pedirJSON('../data/mundo/indice.json', 2);
    indiceMundo = new Map(indice.paises.map(p => [String(p.id), p]));
  } catch (error) {
    console.warn('Sin índice mundial; solo países con datos detallados.', error);
  }
  return indiceMundo;
}
export const datosMundo = id => indiceMundo.get(String(id)) || null;
export const paisesMundo = () => [...indiceMundo.values()];

// Mapa del país: celdas (0,25° a 1°) × meses, harmonizado. Uint16 comprimido con gzip.
const mapas = new Map();
export function cargarCeldas(id) {
  if (!mapas.has(id)) {
    const base = `../data/mundo/celdas-pais/${id}`;
    mapas.set(
      id,
      Promise.all([
        pedirJSON(`${base}.json`, 2),
        fetch(`${base}.bin.gz`).then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        }),
      ])
        .then(async ([cabecera, bytes]) => {
          let crudo = new Uint8Array(bytes);
          // Si el servidor ya lo descomprimió (Content-Encoding), no empieza con la firma de gzip.
          if (crudo[0] === 0x1f && crudo[1] === 0x8b) {
            crudo = new Uint8Array(
              await new Response(new Blob([crudo]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(),
            );
          }
          const valores = new Uint16Array(crudo.buffer, crudo.byteOffset, crudo.byteLength / 2);
          const [a0, m0] = cabecera.meses_inicio.split('-').map(Number);
          return { ...cabecera, valores, a0, m0: m0 - 1 };
        })
        .catch(error => {
          mapas.delete(id);
          throw error;
        }),
    );
  }
  return mapas.get(id);
}
// Suma de cada celda entre dos meses (incluidos). Devuelve Float32Array por celda.
export function sumarCeldas(mapa, anio, mes = null) {
  const indice = (a, m) => (a - mapa.a0) * 12 + (m - mapa.m0);
  const i0 = Math.max(0, indice(anio, mes ?? 0)),
    i1 = Math.min(mapa.n_meses - 1, indice(anio, mes ?? 11));
  const n = mapa.celdas.length,
    salida = new Float32Array(n);
  if (i1 < i0) return salida;
  for (let c = 0; c < n; c++) {
    let s = 0;
    for (let i = i0, base = c * mapa.n_meses; i <= i1; i++) s += mapa.valores[base + i];
    salida[c] = s * mapa.escala;
  }
  return salida;
}

// Entrada para un año concreto; sin año, el más reciente con datos.
export function entradaAnio(entrada, anio) {
  if (!entrada) return null;
  if (entrada.soloSerie) return entrada;
  const a = entrada.anios.includes(+anio) ? +anio : entrada.anios.at(-1);
  return { ...entrada, anio: a, archivo: `${entrada.prefijo}-${a}.json` };
}
// Países con detecciones guardadas (CATALOGO): detalle diario + serie.
// El resto de los países del índice mundial: solo la serie mensual harmonizada.
export function entradaCatalogo(id, anio) {
  const detalle = CATALOGO[id],
    mundo = datosMundo(id);
  if (detalle) {
    return entradaAnio(
      { ...detalle, serie: detalle.serie || (mundo && `mundo/${mundo.archivo}`), calidad: mundo?.calidad },
      anio,
    );
  }
  if (mundo) {
    return {
      id: String(id),
      nombre: mundo.spanish || mundo.nombre,
      soloSerie: true,
      anios: [],
      serie: `mundo/${mundo.archivo}`,
      calidad: mundo.calidad,
    };
  }
  return null;
}

const cache = new Map();
let procedencia;

async function pedirJSON(url, intentos = 3) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try {
      const respuesta = await fetch(url);
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      return await respuesta.json();
    } catch (error) {
      ultimo = error;
    }
  }
  throw ultimo;
}

export function cargarProcedencia() {
  procedencia ||= pedirJSON('../data/procedencia.json').catch(error => {
    procedencia = null;
    throw error;
  });
  return procedencia;
}

export function cargarDatos(entrada) {
  const clave = entrada.archivo;
  if (!cache.has(clave)) {
    // Solo se guardan en memoria los últimos años abiertos: cada año puede pesar varios MB.
    if (cache.size >= 4) cache.delete(cache.keys().next().value);
    cache.set(
      clave,
      pedirJSON(`../data/${entrada.archivo}`)
        .then(prepararDatos)
        .catch(error => {
          cache.delete(clave);
          throw error;
        }),
    );
  }
  return cache.get(clave);
}

// Serie mensual harmonizada (2000 → hoy). null si el país no la tiene.
const series = new Map();
export function cargarSerie(entrada) {
  if (!entrada?.serie) return Promise.resolve(null);
  if (!series.has(entrada.id)) {
    series.set(
      entrada.id,
      pedirJSON(`../data/${entrada.serie}`).catch(error => {
        series.delete(entrada.id);
        throw error;
      }),
    );
  }
  return series.get(entrada.id);
}

export function diasDelAnio(anio) {
  return (Date.UTC(anio + 1, 0, 1) - Date.UTC(anio, 0, 1)) / 864e5;
}
export function diaDelAnio(fecha, anio) {
  return Math.round(
    (Date.UTC(+fecha.slice(0, 4), +fecha.slice(5, 7) - 1, +fecha.slice(8, 10)) - Date.UTC(anio, 0, 1)) / 864e5,
  );
}
export function fechaDeDia(dia, anio) {
  return new Date(Date.UTC(anio, 0, 1 + dia)).toISOString().slice(0, 10);
}

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
export function diasActivos(conteos) {
  return conteos.reduce((total, valor) => total + (valor > 0 ? 1 : 0), 0);
}
export function mayoresDias(conteos, cantidad = 3) {
  return Array.from(conteos, (valor, dia) => ({ dia, valor }))
    .filter(d => d.valor > 0)
    .sort((a, b) => b.valor - a.valor || a.dia - b.dia)
    .slice(0, cantidad);
}

// La actividad es muy asimétrica (Chile: mediana 35, pico 11.841). Los cortes por
// cuantil mantienen legible el año entero; la leyenda muestra los valores reales.
export function escalaCalendario(conteos) {
  const positivos = Array.from(conteos)
    .filter(v => v > 0)
    .sort((a, b) => a - b);
  if (!positivos.length) return { nivel: () => 0, tramos: [] };
  const crudos = [0.3, 0.55, 0.78, 0.93].map(
    q => positivos[Math.min(positivos.length - 1, Math.floor(positivos.length * q))],
  );
  const cortes = [...new Set(crudos)].filter(c => c < positivos.at(-1));
  const nivel = valor => {
    if (valor <= 0) return 0;
    let i = 0;
    while (i < cortes.length && valor > cortes[i]) i++;
    // Con pocos cortes se reparten por toda la rampa para conservar el contraste.
    return cortes.length ? 1 + Math.round((i * 4) / cortes.length) : 5;
  };
  const tramos = [...cortes, positivos.at(-1)].map((hasta, i, lista) => ({
    desde: i ? lista[i - 1] + 1 : positivos[0],
    hasta,
    nivel: cortes.length ? 1 + Math.round((i * 4) / cortes.length) : 5,
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
  fecha: r => r.fecha + r.hora,
  sensor: r => r.sensor,
  frp: r => r.frp,
  lat: r => r.lat,
  lon: r => r.lon,
};
export function ordenarTabla(registros, campo = 'fecha', direccion = 'asc') {
  const clave = CLAVES[campo] || CLAVES.fecha;
  const signo = direccion === 'desc' ? -1 : 1;
  return [...registros].sort((a, b) => {
    const x = clave(a),
      y = clave(b);
    return x < y ? -signo : x > y ? signo : 0;
  });
}
export function etiquetaConfianza(valor) {
  return { l: 'Baja', n: 'Nominal', h: 'Alta' }[valor] || `${valor} %`;
}
export function etiquetaSatelite(valor) {
  return valor === 'N' ? 'Suomi NPP' : valor;
}

// ---------- Territorio: país completo o una región ----------
// Zonas con conteo mensual harmonizado. Chile usa su grilla propia de 0,25° (llega hasta el mes
// en curso); el resto, las celdas del índice mundial. Mismo formato que cargarCeldas.
const zonas = new Map();
export function cargarZonas(entrada) {
  if (!entrada) return Promise.reject(new Error('Sin país'));
  if (!entrada.grilla) return cargarCeldas(entrada.id);
  if (!zonas.has(entrada.id)) {
    zonas.set(
      entrada.id,
      pedirJSON(`../data/${entrada.grilla}`)
        .then(g => {
          const n = g.meses.length;
          const valores = new Float32Array(g.celdas.length * n);
          g.celdas.forEach((c, i) => {
            for (const [m, v] of c.v) valores[i * n + m] = v;
          });
          const [a0, m0] = g.meses[0].split('-').map(Number);
          return {
            celda_grados: g.celda_grados,
            celdas: g.celdas.map(c => [c.lat, c.lon]),
            n_meses: n,
            escala: 1,
            valores,
            a0,
            m0: m0 - 1,
          };
        })
        .catch(error => {
          zonas.delete(entrada.id);
          throw error;
        }),
    );
  }
  return zonas.get(entrada.id);
}

const mediana = lista => {
  const v = lista.filter(x => x != null).sort((a, b) => a - b);
  if (!v.length) return 0;
  const k = (v.length - 1) / 2;
  return (v[Math.floor(k)] + v[Math.ceil(k)]) / 2;
};

// Serie mensual de una región con el mismo formato que la nacional, para el calendario histórico.
// regionDeZona: índice de región del centro de cada zona (una zona cuenta entera en una sola región).
export function serieDeRegion(mapa, regionDeZona, indice, nacional) {
  const porClave = new Map();
  for (let i = 0; i < mapa.n_meses; i++) {
    const t = mapa.m0 + i;
    const clave = `${mapa.a0 + Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
    let s = 0;
    for (let c = 0; c < mapa.celdas.length; c++) {
      if (regionDeZona[c] === indice) s += mapa.valores[c * mapa.n_meses + i];
    }
    porClave.set(clave, Math.round(s * mapa.escala * 10) / 10);
  }
  const meses = nacional.meses.filter(m => porClave.has(m));
  const posicion = new Map(nacional.meses.map((m, i) => [m, i]));
  const armonizado = meses.map(m => porClave.get(m));
  const [b0, b1] = nacional.por_mes_calendario?.anios_base || [2003, 2025];
  const medianas = Array.from({ length: 12 }, (_, mes) =>
    mediana(
      meses
        .map((m, i) => ({ anio: +m.slice(0, 4), mes: +m.slice(5, 7) - 1, v: armonizado[i], i: posicion.get(m) }))
        .filter(x => x.mes === mes && x.anio >= b0 && x.anio <= b1 && !nacional.incompleto?.[x.i])
        .map(x => x.v),
    ),
  );
  return {
    ...nacional,
    region: true,
    meses,
    armonizado,
    origen: meses.map(m => nacional.origen?.[posicion.get(m)] ?? ''),
    incompleto: meses.map(m => nacional.incompleto?.[posicion.get(m)] ?? false),
    modis: undefined,
    viirs: undefined,
    por_mes_calendario: { mediana: medianas, anios_base: [b0, b1] },
    metodo: { ...nacional.metodo, zonas_grados: mapa.celda_grados },
  };
}

// Referencia histórica de un mes (o del año completo si mes es null) en una serie harmonizada.
// Es una comparación con el pasado: no anticipa lo que vaya a ocurrir.
export function referenciaHistorica(serie, anio, mes = null) {
  if (!serie) return null;
  const pos = new Map(serie.meses.map((m, i) => [m, i]));
  const med = serie.por_mes_calendario.mediana;
  const [b0, b1] = serie.por_mes_calendario.anios_base || [2003, 2025];
  const clave = m => `${anio}-${String(m + 1).padStart(2, '0')}`;
  if (mes !== null) {
    const i = pos.get(clave(mes));
    if (i === undefined) return null;
    const valor = serie.armonizado[i];
    return {
      valor,
      normal: med[mes],
      razon: med[mes] > 0 ? valor / med[mes] : null,
      incompleto: Boolean(serie.incompleto?.[i]),
      base: [b0, b1],
    };
  }
  const totalDe = a => {
    let s = 0,
      n = 0,
      incompleto = false;
    for (let m = 0; m < 12; m++) {
      const i = pos.get(`${a}-${String(m + 1).padStart(2, '0')}`);
      if (i === undefined) continue;
      s += serie.armonizado[i] || 0;
      n++;
      incompleto ||= Boolean(serie.incompleto?.[i]);
    }
    return { s, completo: n === 12 && !incompleto };
  };
  const actual = totalDe(anio);
  const normales = [];
  for (let a = b0; a <= b1; a++) {
    const t = totalDe(a);
    if (t.completo) normales.push(t.s);
  }
  const normal = mediana(normales);
  return {
    valor: actual.s,
    normal,
    razon: normal > 0 ? actual.s / normal : null,
    incompleto: !actual.completo,
    base: [b0, b1],
  };
}
// Mediana de cada mes del calendario: qué meses suelen tener más fuego.
export function estacionalidad(serie) {
  return serie?.por_mes_calendario.mediana.map((valor, mes) => ({ mes, valor })) ?? [];
}
