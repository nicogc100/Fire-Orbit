// Geometría de la pieza 3D de un país. Cada vértice guarda su posición sobre la
// esfera y la del plano: la pieza se despega del globo sin saltos y aterriza plana.
// Sin Three.js ni DOM: la usan el worker de cartografía y el mapa del país.
const RAD = Math.PI / 180;
export const aVector = (lon, lat) => {
  const a = lat * RAD,
    o = lon * RAD;
  return [Math.cos(a) * Math.cos(o), Math.sin(a), -Math.cos(a) * Math.sin(o)];
};
const punto = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unir = a => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const angulo = (a, b) => Math.acos(Math.max(-1, Math.min(1, punto(a, b)))) / RAD;
const media = anillo =>
  unir(
    anillo.reduce(
      (s, [lon, lat]) => {
        const v = aVector(lon, lat);
        return [s[0] + v[0], s[1] + v[1], s[2] + v[2]];
      },
      [0, 0, 0],
    ),
  );

function areaAnillo(anillo) {
  let total = 0,
    lat = 0;
  for (let i = 0; i < anillo.length - 1; i++) {
    total += anillo[i][0] * anillo[i + 1][1] - anillo[i + 1][0] * anillo[i][1];
    lat += anillo[i][1];
  }
  return Math.abs(total / 2) * Math.cos((lat / Math.max(1, anillo.length - 1)) * RAD);
}
const limites = anillo =>
  anillo.reduce(
    (b, [lon, lat]) => [Math.min(b[0], lon), Math.min(b[1], lat), Math.max(b[2], lon), Math.max(b[3], lat)],
    [Infinity, Infinity, -Infinity, -Infinity],
  );

// En la Antártida el anillo exterior es un círculo junto al polo y la costa es el
// «hueco»: válido en una esfera, pero en el plano la tierra queda dentro de la costa.
function normalizarAnillos(rings) {
  const extension = anillo => {
    const [, sur, , norte] = limites(anillo);
    return norte - sur;
  };
  const mayor = rings.reduce((elegido, anillo) => (extension(anillo) > extension(elegido) ? anillo : elegido));
  return mayor === rings[0] ? rings : [mayor];
}

// Elige qué polígonos forman la pieza: territorio principal, costa cercana y grandes
// islas (Indonesia, Alaska). Las islas pequeñas y remotas desencuadrarían la pieza.
export function construirMarco(feature) {
  const { type, coordinates } = feature.geometry;
  const poligonos = type === 'Polygon' ? [coordinates] : coordinates;
  const medidos = poligonos
    .map(normalizarAnillos)
    .map(rings => ({ rings, area: areaAnillo(rings[0]), centro: media(rings[0]) }));
  const principal = medidos.reduce((a, b) => (b.area > a.area ? b : a));
  const centro = principal.centro;
  const radio = principal.rings[0].reduce((max, [lon, lat]) => Math.max(max, angulo(centro, aVector(lon, lat))), 0);
  const conservados = [],
    omitidos = [];
  for (const p of medidos) {
    const distancia = angulo(centro, p.centro);
    const relativa = p.area / (principal.area || 1);
    const cerca = distancia <= Math.max(radio * 1.6, 3) && (relativa >= 0.01 || distancia <= Math.max(radio * 1.1, 2));
    const grande = relativa >= 0.08 && distancia <= 60;
    if (p === principal || cerca || grande) conservados.push(p);
    else omitidos.push({ limites: limites(p.rings[0]) });
  }
  const polar = Math.abs(centro[1]) > 0.999;
  const este = unir(cruz(polar ? [1, 0, 0] : [0, 1, 0], centro));
  const norte = cruz(centro, este);
  return { centro, este, norte, conservados, omitidos };
}

export function proyectar(marco, lon, lat) {
  const v = aVector(lon, lat);
  let x = punto(v, marco.este),
    y = punto(v, marco.norte);
  const l = Math.hypot(x, y);
  if (l > 0.999) {
    x *= 0.999 / l;
    y *= 0.999 / l;
  }
  return [x, y];
}
const alturaEsfera = (x, y) => Math.sqrt(Math.max(0, 1 - x * x - y * y));

export function desproyectar(marco, x, y) {
  if (x * x + y * y >= 1) return null;
  const z = alturaEsfera(x, y);
  const [a, b, c] = marco.centro.map((v, i) => v * z + marco.este[i] * x + marco.norte[i] * y);
  return [Math.atan2(-c, a) / RAD, Math.asin(Math.max(-1, Math.min(1, b))) / RAD];
}

export function fueraDePieza(marco, lon, lat) {
  return marco.omitidos.some(
    ({ limites: [w, s, e, n] }) => lon >= w - 0.2 && lon <= e + 0.2 && lat >= s - 0.2 && lat <= n + 0.2,
  );
}

function subdividir(a, b, c, maximo, salida, profundidad = 0) {
  const ab = Math.hypot(a[0] - b[0], a[1] - b[1]),
    bc = Math.hypot(b[0] - c[0], b[1] - c[1]),
    ca = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const mayor = Math.max(ab, bc, ca);
  if (mayor <= maximo || profundidad > 9) {
    salida.push(a[0], a[1], b[0], b[1], c[0], c[1]);
    return;
  }
  const medio = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  if (mayor === ab) {
    const m = medio(a, b);
    subdividir(a, m, c, maximo, salida, profundidad + 1);
    subdividir(m, b, c, maximo, salida, profundidad + 1);
  } else if (mayor === bc) {
    const m = medio(b, c);
    subdividir(a, b, m, maximo, salida, profundidad + 1);
    subdividir(a, m, c, maximo, salida, profundidad + 1);
  } else {
    const m = medio(c, a);
    subdividir(a, b, m, maximo, salida, profundidad + 1);
    subdividir(m, b, c, maximo, salida, profundidad + 1);
  }
}

const areaPlano = puntos =>
  puntos.reduce((total, p, i) => {
    const q = puntos[(i + 1) % puntos.length];
    return total + p.x * q.y - q.x * p.y;
  }, 0) / 2;

// Menor arco de longitudes que contiene el país, aunque cruce el antimeridiano:
// así se recorta del mapa de 8K solo lo necesario.
function cajaGeografica(polys) {
  const ocupado = new Uint8Array(360);
  let sur = 90,
    norte = -90;
  for (const { rings } of polys)
    for (const [lon, lat] of rings[0]) {
      ocupado[Math.min(359, Math.floor(lon + 180))] = 1;
      sur = Math.min(sur, lat);
      norte = Math.max(norte, lat);
    }
  let mejor = 0,
    inicio = 0,
    racha = 0;
  for (let i = 0; i < 720; i++) {
    if (ocupado[i % 360]) {
      racha = 0;
      continue;
    }
    racha++;
    if (racha > mejor && racha <= 360) {
      mejor = racha;
      inicio = (i + 1) % 360;
    }
  }
  const margen = 1.5;
  return {
    oeste: inicio - 180 - margen,
    ancho: Math.min(360, 360 - mejor + 1 + margen * 2),
    sur: Math.max(-90, sur - margen),
    norte: Math.min(90, norte + margen),
  };
}

// «Aysén del General Carlos Ibáñez del Campo» no cabe en un mapa.
export function nombreCorto(nombre) {
  if (!nombre) return '';
  if (nombre.length <= 22) return nombre;
  return nombre.split(/\s+(?:del|de la|de los|de|y)\s+/)[0];
}

// triangular: (contorno, huecos) => índices. Se inyecta para no atar este módulo a Three.
export function construirGeometria(feature, triangular, detalle = null) {
  const completo = construirMarco(detalle ? { geometry: detalle.geometry } : feature);
  const anillos = completo.conservados
    .map(({ rings }) =>
      rings
        .map(anillo => {
          const puntos = [];
          for (const [lon, lat] of anillo) {
            const [x, y] = proyectar(completo, lon, lat);
            const previo = puntos.at(-1);
            // El anillo antártico recorre 90° S: en el plano esos puntos coinciden y romperían la triangulación.
            if (!previo || Math.hypot(previo.x - x, previo.y - y) > 1e-5) puntos.push({ x, y });
          }
          while (puntos.length > 1 && Math.hypot(puntos[0].x - puntos.at(-1).x, puntos[0].y - puntos.at(-1).y) <= 1e-5)
            puntos.pop();
          return puntos;
        })
        .filter(puntos => puntos.length >= 3),
    )
    .filter(rings => rings.length);

  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const rings of anillos)
    for (const p of rings[0]) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2;
  const ancho = x1 - x0,
    alto = y1 - y0,
    dimension = Math.max(ancho, alto);
  const grosor = dimension * 0.018;
  const maximo = dimension / 26;

  const esfera = [],
    plano = [],
    normal = [],
    lado = [],
    contornoEsfera = [],
    contornoPlano = [];
  let areaCubierta = 0,
    areaEsperada = 0;
  const vertice = (x, y, tipo, nx = 0, ny = 0, nz = 1) => {
    const z = alturaEsfera(x, y);
    const k = tipo >= 2 ? 1 - grosor : 1;
    esfera.push(x * k, y * k, z * k);
    plano.push(x - cx, y - cy, tipo >= 2 ? -grosor : 0);
    normal.push(nx, ny, nz);
    lado.push(tipo);
  };
  for (const rings of anillos) {
    const caras = triangular(rings[0], rings.slice(1));
    const todos = rings.flat();
    const planos = [];
    for (let c = 0; c < caras.length; c++) {
      const [i, j, k] = caras[c];
      const a = todos[i],
        b = todos[j],
        d = todos[k];
      subdividir([a.x, a.y], [b.x, b.y], [d.x, d.y], maximo, planos);
    }
    for (let i = 0; i < planos.length; i += 6) {
      areaCubierta +=
        Math.abs(
          (planos[i + 2] - planos[i]) * (planos[i + 5] - planos[i + 1]) -
            (planos[i + 4] - planos[i]) * (planos[i + 3] - planos[i + 1]),
        ) / 2;
    }
    rings.forEach((puntos, indice) => {
      areaEsperada += Math.abs(areaPlano(puntos)) * (indice ? -1 : 1);
    });
    for (let i = 0; i < planos.length; i += 2) vertice(planos[i], planos[i + 1], 0);
    for (let i = planos.length - 2; i >= 0; i -= 2) vertice(planos[i], planos[i + 1], 3, 0, 0, -1);
    rings.forEach((puntos, indice) => {
      const signo = (areaPlano(puntos) >= 0 ? 1 : -1) * (indice ? -1 : 1);
      puntos.forEach((p, i) => {
        const q = puntos[(i + 1) % puntos.length];
        const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        const nx = ((q.y - p.y) / l) * signo,
          ny = (-(q.x - p.x) / l) * signo;
        vertice(p.x, p.y, 1, nx, ny, 0);
        vertice(p.x, p.y, 2, nx, ny, 0);
        vertice(q.x, q.y, 1, nx, ny, 0);
        vertice(q.x, q.y, 1, nx, ny, 0);
        vertice(p.x, p.y, 2, nx, ny, 0);
        vertice(q.x, q.y, 2, nx, ny, 0);
        contornoEsfera.push(p.x, p.y, alturaEsfera(p.x, p.y), q.x, q.y, alturaEsfera(q.x, q.y));
        contornoPlano.push(p.x - cx, p.y - cy, 0, q.x - cx, q.y - cy, 0);
      });
    });
  }

  // Marco ligero: es lo único que necesita el hilo principal para colocar los focos.
  const marco = { centro: completo.centro, este: completo.este, norte: completo.norte, omitidos: completo.omitidos };
  const limitesEsfera = [],
    limitesPlano = [],
    etiquetas = [];
  if (detalle) {
    const s = detalle.limites;
    for (let i = 0; i < s.length; i += 4) {
      if (fueraDePieza(marco, s[i], s[i + 1]) || fueraDePieza(marco, s[i + 2], s[i + 3])) continue;
      const [ax, ay] = proyectar(marco, s[i], s[i + 1]),
        [bx, by] = proyectar(marco, s[i + 2], s[i + 3]);
      limitesEsfera.push(ax, ay, alturaEsfera(ax, ay), bx, by, alturaEsfera(bx, by));
      limitesPlano.push(ax - cx, ay - cy, 0, bx - cx, by - cy, 0);
    }
    detalle.regiones.forEach((region, indice) => {
      if (!region.properties.nombre) return;
      const g = region.geometry;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      const mayor = polys.reduce((a, b) => (areaAnillo(b[0]) > areaAnillo(a[0]) ? b : a));
      const c = media(mayor[0]);
      const lon = Math.atan2(-c[2], c[0]) / RAD,
        lat = Math.asin(c[1]) / RAD;
      if (fueraDePieza(marco, lon, lat)) return;
      const [x, y] = proyectar(marco, lon, lat);
      // Ancho de la región: si el nombre no cabe dentro, va al costado y no tapa los focos.
      let oeste = Infinity,
        este = -Infinity,
        sur = Infinity,
        norte = -Infinity;
      let lonMin = Infinity,
        lonMax = -Infinity,
        latMin = Infinity,
        latMax = -Infinity;
      for (const [plon, plat] of mayor[0]) {
        const [px, py] = proyectar(marco, plon, plat);
        oeste = Math.min(oeste, px);
        este = Math.max(este, px);
        sur = Math.min(sur, py);
        norte = Math.max(norte, py);
        const longitud = lon + ((plon - lon + 540) % 360) - 180;
        lonMin = Math.min(lonMin, longitud);
        lonMax = Math.max(lonMax, longitud);
        latMin = Math.min(latMin, plat);
        latMax = Math.max(latMax, plat);
      }
      etiquetas.push({
        indice,
        nombre: nombreCorto(region.properties.nombre),
        nombreCompleto: region.properties.nombre,
        x: x - cx,
        y: y - cy,
        oeste: oeste - cx,
        este: este - cx,
        sur: sur - cy,
        norte: norte - cy,
        limites: [lonMin, latMin, lonMax, latMax],
        area: polys.reduce((t, p) => t + areaAnillo(p[0]), 0),
      });
    });
  }
  return {
    marco,
    cx,
    cy,
    ancho,
    alto,
    dimension,
    grosor,
    areaCubierta,
    areaEsperada,
    caja: cajaGeografica(completo.conservados),
    escala: detalle?.escala ?? '1:50m',
    esfera: new Float32Array(esfera),
    plano: new Float32Array(plano),
    normal: new Float32Array(normal),
    lado: new Float32Array(lado),
    contornoEsfera: new Float32Array(contornoEsfera),
    contornoPlano: new Float32Array(contornoPlano),
    limitesEsfera: new Float32Array(limitesEsfera),
    limitesPlano: new Float32Array(limitesPlano),
    etiquetas,
    nombresRegion: detalle ? detalle.regiones.map(r => nombreCorto(r.properties.nombre)) : [],
  };
}

// Focos en las mismas dos posiciones que la pieza, siempre en sus coordenadas originales.
export function construirPuntos(geometria, registros, dias) {
  const { marco, cx, cy, grosor } = geometria;
  const esfera = [],
    plano = [],
    dia = [],
    frp = [],
    sensor = [],
    visibles = [],
    origen = [];
  let omitidos = 0;
  registros.forEach((registro, i) => {
    if (fueraDePieza(marco, registro.lon, registro.lat)) {
      omitidos++;
      return;
    }
    const [x, y] = proyectar(marco, registro.lon, registro.lat);
    esfera.push(x, y, alturaEsfera(x, y) * 1.0005);
    plano.push(x - cx, y - cy, grosor * 0.03);
    dia.push(dias[i]);
    frp.push(Math.min(1, Math.log10(1 + registro.frp) / 3));
    sensor.push(registro.sensor === 'MODIS' ? 0 : 1);
    visibles.push(registro);
    origen.push(i);
  });
  return {
    esfera: new Float32Array(esfera),
    plano: new Float32Array(plano),
    dia: new Float32Array(dia),
    frp: new Float32Array(frp),
    sensor: new Float32Array(sensor),
    registros: visibles,
    origen,
    omitidos,
  };
}

// Prueba rápida de «punto dentro de la región»: un rayo horizontal (regla par/impar) con las
// aristas agrupadas por franjas de latitud, así cada punto revisa solo las pocas aristas de su
// franja. Con regiones de miles de vértices, la prueba esférica de d3 tardaba unos 20 s en un año
// de Chile. Devuelve null si la región cruza el antimeridiano: ahí sigue la prueba esférica.
const FRANJA = 0.05;
export function localizadorRegion(region) {
  const g = region.geometry;
  const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : null;
  if (!polys) return null;
  let s = Infinity,
    n = -Infinity;
  for (const poly of polys)
    for (const anillo of poly)
      for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
        if (Math.abs(anillo[i][0] - anillo[j][0]) > 180) return null;
        s = Math.min(s, anillo[i][1]);
        n = Math.max(n, anillo[i][1]);
      }
  const nf = Math.max(1, Math.floor((n - s) / FRANJA) + 1);
  const franjas = Array.from({ length: nf }, () => []);
  for (const poly of polys)
    for (const anillo of poly)
      for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
        const [x1, y1] = anillo[j],
          [x2, y2] = anillo[i];
        if (y1 === y2) continue;
        const a = Math.floor((Math.min(y1, y2) - s) / FRANJA),
          b = Math.min(nf - 1, Math.floor((Math.max(y1, y2) - s) / FRANJA));
        for (let f = a; f <= b; f++) franjas[f].push(x1, y1, x2, y2);
      }
  const tablas = franjas.map(lista => Float64Array.from(lista));
  return (lon, lat) => {
    const f = Math.floor((lat - s) / FRANJA);
    if (!(f >= 0 && f < nf)) return false;
    const t = tablas[f];
    let dentro = false;
    for (let k = 0; k < t.length; k += 4) {
      const y1 = t[k + 1],
        y2 = t[k + 3];
      if (y1 > lat !== y2 > lat && lon < t[k] + ((lat - y1) / (y2 - y1)) * (t[k + 2] - t[k])) dentro = !dentro;
    }
    return dentro;
  };
}
// contiene(region, [lon, lat]) con el localizador rápido cuando existe y la prueba esférica si no.
export function crearContiene(regiones, esferica) {
  const rapidos = new Map(regiones.map(r => [r, localizadorRegion(r)]));
  return (region, punto) => {
    const rapido = rapidos.get(region);
    return rapido ? rapido(punto[0], punto[1]) : esferica(region, punto);
  };
}

// Región de cada registro según los límites administrativos. Los focos se agrupan
// mucho en el espacio, así que una rejilla de memoria evita repetir comprobaciones.
export function indicesRegion(regiones, lons, lats, contiene) {
  const cajas = regiones.map(r => {
    const [[w, s], [e, n]] = r.properties.bounds;
    return { w, s, e, n, cruza: w > e, r };
  });
  const salida = new Int16Array(lons.length).fill(-1);
  const memoria = new Map();
  for (let i = 0; i < lons.length; i++) {
    const lon = lons[i],
      lat = lats[i];
    const clave = Math.round(lon * 40) * 100000 + Math.round(lat * 40);
    const previo = memoria.get(clave) ?? -2;
    if (previo >= 0 && contiene(cajas[previo].r, [lon, lat])) {
      salida[i] = previo;
      continue;
    }
    for (let k = 0; k < cajas.length; k++) {
      const c = cajas[k];
      if (lat < c.s || lat > c.n || (c.cruza ? lon < c.w && lon > c.e : lon < c.w || lon > c.e)) continue;
      if (contiene(c.r, [lon, lat])) {
        salida[i] = k;
        memoria.set(clave, k);
        break;
      }
    }
  }
  return salida;
}
