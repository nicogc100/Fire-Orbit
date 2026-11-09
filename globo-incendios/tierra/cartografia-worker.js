// Descompresión, triangulación y búsqueda de regiones fuera del hilo principal:
// ninguna de estas tareas puede competir con la cámara mientras el país se abre.
import { ShapeUtils, Vector2 } from './vendor/three.core.js';
import { geoContains } from './vendor/d3-geo.js';
import { construirGeometria, indicesRegion } from './pieza-geo.js?v=7359ea78';
import { cargarRelieve } from './relieve-pais.js';

const vectores = puntos => puntos.map(p => new Vector2(p.x, p.y));
const triangular = (contorno, huecos) => ShapeUtils.triangulateShape(vectores(contorno), huecos.map(vectores));
const regionesPorPais = new Map();
let ciudades, cargaRelieve;

async function leerDetalle(id) {
  const respuesta = await fetch(`assets/cartografia/${encodeURIComponent(id)}.json.gz`);
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  const flujo = respuesta.body.pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(flujo).text());
}

self.onmessage = async ({ data }) => {
  const { tipo, pedido, id } = data;
  try {
    if (tipo === 'detalle') {
      const detalle = await leerDetalle(id);
      regionesPorPais.set(id, detalle.regiones);
      const g = construirGeometria(null, triangular, detalle);
      self.postMessage({ tipo, pedido, id, geometria: g }, [
        g.esfera.buffer,
        g.plano.buffer,
        g.normal.buffer,
        g.lado.buffer,
        g.contornoEsfera.buffer,
        g.contornoPlano.buffer,
        g.limitesEsfera.buffer,
        g.limitesPlano.buffer,
      ]);
    } else if (tipo === 'ciudades') {
      const region = regionesPorPais.get(id)?.[data.indice];
      if (!region) throw new Error('Región no disponible');
      ciudades ||= fetch('assets/cartografia/ciudades.json')
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .catch(error => {
          ciudades = null;
          throw error;
        });
      const [[w, s], [e, n]] = region.properties.bounds;
      const localidades = (await ciudades).filter(
        ([, lon, lat]) =>
          lat >= s &&
          lat <= n &&
          (w <= e ? lon >= w && lon <= e : lon >= w || lon <= e) &&
          geoContains(region, [lon, lat]),
      );
      self.postMessage({ tipo, pedido, id, localidades });
    } else if (tipo === 'cancelarRelieve') {
      cargaRelieve?.abort();
    } else if (tipo === 'relieve') {
      cargaRelieve?.abort();
      cargaRelieve = new AbortController();
      const relieve = await cargarRelieve(data.limites, cargaRelieve.signal);
      self.postMessage({ tipo, pedido, id, relieve }, relieve ? [relieve.datos.buffer] : []);
    } else if (tipo === 'regiones') {
      if (!regionesPorPais.has(id)) regionesPorPais.set(id, (await leerDetalle(id)).regiones);
      const indices = indicesRegion(regionesPorPais.get(id), data.lons, data.lats, geoContains);
      self.postMessage({ tipo, pedido, id, indices }, [indices.buffer]);
    }
  } catch (error) {
    self.postMessage({ tipo, pedido, id, error: String(error) });
  }
};
