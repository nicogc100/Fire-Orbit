// Descarga y composición de teselas satelitales fuera del hilo principal.
// Dos capas independientes: «grueso» (el país entero, una vez) y «fino» (lo que está a
// la vista, según el zoom). Una petición nueva de una capa descarta las teselas de esa
// capa que aún no empezaron; las que ya están en camino terminan y quedan en memoria,
// así un recorrido de ida y vuelta no vuelve a descargarlas.
import { FUENTE, rango, cajaDe } from './teselas.js?v=20261109';

const CONCURRENCIA = 6;
const MEMORIA = 160; // teselas decodificadas (~40 MB)
const ESPERA = 15000; // un proveedor que no responde no deja el estado en «cargando»
const memoria = new Map();
const generacion = { grueso: 0, fino: 0 };
let cola = [];
let activas = 0;

// Donde Sentinel-2 no tiene datos (interior de la Antártida y de Groenlandia), EOX
// sirve teselas de un solo color: ~100 bytes. No son imagen: ahí sigue el mapa base.
const VACIA = Symbol('sin cobertura');
const BYTES_RELLENO = 400;
const LAT_POLAR = 60;
const urlDe = (z, x, y) => FUENTE.patron.replace('{z}', z).replace('{x}', x).replace('{y}', y);
const latitudFila = (y, n) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;

async function descargar(tarea) {
  const { z, x, y, clave } = tarea;
  try {
    const r = await fetch(urlDe(z, x, y), { mode: 'cors', signal: AbortSignal.timeout(ESPERA) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    if (blob.size < BYTES_RELLENO) return VACIA;
    return await createImageBitmap(blob);
  } catch {
    // Un fallo no se recuerda: la próxima vista lo vuelve a intentar.
    if (memoria.get(clave) === tarea.promesa) memoria.delete(clave);
    return null;
  }
}
function bombear() {
  while (activas < CONCURRENCIA && cola.length) {
    const tarea = cola.shift();
    activas++;
    descargar(tarea).then(imagen => {
      activas--;
      tarea.resolver(imagen);
      bombear();
    });
  }
}
function tesela(z, x, y, capa, gen) {
  const clave = `${z}/${x}/${y}`;
  const previa = memoria.get(clave);
  if (previa) {
    memoria.delete(clave);
    memoria.set(clave, previa);
    return previa;
  }
  const tarea = { z, x, y, clave, capa, gen };
  const promesa = new Promise(resolver => {
    tarea.resolver = resolver;
  });
  tarea.promesa = promesa;
  cola.push(tarea);
  memoria.set(clave, promesa);
  // Las más antiguas salen de memoria; quien ya las tenga sigue pudiendo dibujarlas.
  while (memoria.size > MEMORIA) memoria.delete(memoria.keys().next().value);
  bombear();
  return promesa;
}
function descartar(capa, gen = Infinity) {
  cola = cola.filter(t => {
    if (t.capa !== capa || t.gen >= gen) return true;
    if (memoria.get(t.clave) === t.promesa) memoria.delete(t.clave);
    t.resolver(null);
    return false;
  });
}

self.onmessage = async ({ data }) => {
  const { tipo, pedido, capa } = data;
  if (tipo === 'cancelar') {
    for (const c of capa ? [capa] : Object.keys(generacion)) {
      generacion[c]++;
      descartar(c);
    }
    return;
  }
  if (tipo !== 'mosaico') return;
  const gen = ++generacion[capa];
  descartar(capa, gen);
  const r = rango(data.limites, data.z);
  // Primero el centro de la vista: es lo que se mira.
  const cx = (r.izq + r.der) / 2,
    cy = (r.arriba + r.abajo) / 2;
  const lista = [];
  for (let y = r.arriba; y < r.abajo; y++) for (let x = r.izq; x < r.der; x++) lista.push({ x, y });
  lista.sort((a, b) => Math.hypot(a.x + 0.5 - cx, a.y + 0.5 - cy) - Math.hypot(b.x + 0.5 - cx, b.y + 0.5 - cy));
  const imagenes = await Promise.all(lista.map(({ x, y }) => tesela(r.z, ((x % r.n) + r.n) % r.n, y, capa, gen)));
  if (gen !== generacion[capa]) {
    self.postMessage({ pedido, capa, cancelado: true });
    return;
  }
  const lado = FUENTE.lado;
  const lienzo = new OffscreenCanvas(r.ancho * lado, r.alto * lado);
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });
  let dibujadas = 0,
    vacias = 0;
  imagenes.forEach((imagen, i) => {
    if (imagen === VACIA) {
      vacias++;
      return;
    }
    if (!imagen) return;
    const px = (lista[i].x - r.izq) * lado,
      py = (lista[i].y - r.arriba) * lado;
    try {
      ctx.drawImage(imagen, px, py);
      dibujadas++;
    } catch {
      return; /* tesela liberada entre tanto: queda el mapa de debajo */
    }
    // Cerca de los polos, el relleno blanco de las zonas sin datos queda transparente.
    const norte = latitudFila(lista[i].y, r.n),
      sur = latitudFila(lista[i].y + 1, r.n);
    if (sur < -LAT_POLAR || norte > LAT_POLAR) {
      const datos = ctx.getImageData(px, py, lado, lado);
      const d = datos.data;
      let cambios = 0;
      for (let k = 0; k < d.length; k += 4) {
        if (d[k] > 250 && d[k + 1] > 250 && d[k + 2] > 250) {
          d[k + 3] = 0;
          cambios++;
        }
      }
      if (cambios) ctx.putImageData(datos, px, py);
    }
  });
  const total = lista.length,
    fallidas = total - dibujadas - vacias;
  if (!dibujadas && !fallidas) {
    self.postMessage({ pedido, capa, total, fallidas: 0, vacio: true });
    return;
  }
  if (!dibujadas) {
    self.postMessage({ pedido, capa, total, fallidas, error: 'sin-teselas' });
    return;
  }
  const imagen = lienzo.transferToImageBitmap();
  self.postMessage({ pedido, capa, imagen, caja: cajaDe(r), z: r.z, total, fallidas }, [imagen]);
};
