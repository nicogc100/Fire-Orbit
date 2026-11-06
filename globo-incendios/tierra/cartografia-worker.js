// Descompresión, triangulación y búsqueda de regiones fuera del hilo principal:
// ninguna de estas tareas puede competir con la cámara mientras el país se abre.
import { ShapeUtils, Vector2 } from './vendor/three.core.js';
import { geoContains } from './vendor/d3-geo.js';
import { construirGeometria, indicesRegion } from './pieza-geo.js';

const vectores = puntos => puntos.map(p => new Vector2(p.x, p.y));
const triangular = (contorno, huecos) => ShapeUtils.triangulateShape(vectores(contorno), huecos.map(vectores));
const regionesPorPais = new Map();

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
        g.esfera.buffer, g.plano.buffer, g.normal.buffer, g.lado.buffer,
        g.contornoEsfera.buffer, g.contornoPlano.buffer, g.limitesEsfera.buffer, g.limitesPlano.buffer,
      ]);
    } else if (tipo === 'regiones') {
      if (!regionesPorPais.has(id)) regionesPorPais.set(id, (await leerDetalle(id)).regiones);
      const indices = indicesRegion(regionesPorPais.get(id), data.lons, data.lats, geoContains);
      self.postMessage({ tipo, pedido, id, indices }, [indices.buffer]);
    }
  } catch (error) {
    self.postMessage({ tipo, pedido, id, error: String(error) });
  }
};
