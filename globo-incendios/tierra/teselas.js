// Teselas satelitales en Web Mercator (EPSG:3857). Sin Three.js ni DOM: lo usan
// el hilo principal (para elegir el nivel) y el worker que compone los mosaicos.
//
// Fuente: EOxCloudless 2016, mosaico Sentinel-2 sin nubes a 10 m, de EOX IT Services.
// Licencia CC BY 4.0 (la única capa anual que admite cualquier uso; 2018 en adelante
// es CC BY-NC-SA). El servicio WMTS público admite uso directo desde la web con CORS y
// solo exige atribución visible donde se muestre la imagen.
export const FUENTE = {
  nombre: 'EOxCloudless 2016',
  patron: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg',
  // 10 m de Sentinel-2 equivalen al nivel 14 (9,6 m por píxel en el ecuador). Los
  // niveles mayores solo amplían el mismo dato: no se piden.
  zMax: 14,
  lado: 256,
  enlace: 'https://cloudless.eox.at',
  atribucion: 'EOxCloudless by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017)',
  licencia: 'CC BY 4.0',
};

const LIMITE = 85.05112878;
const RAD = Math.PI / 180;
export const mercatorY = lat => {
  const a = Math.max(-LIMITE, Math.min(LIMITE, lat)) * RAD;
  return .5 - Math.asinh(Math.tan(a)) / (2 * Math.PI);
};
// Metros por píxel de tesela a una latitud y un nivel.
export const metrosPorPixel = (lat, z) => 156543.034 * Math.cos(lat * RAD) / 2 ** z;

// Teselas que cubren unos límites [oeste, sur, este, norte]. Las longitudes pueden salir
// de ±180 (países que cruzan el antimeridiano): la columna se repliega al pedirla.
export function rango([oeste, sur, este, norte], z) {
  const n = 2 ** z;
  const izq = Math.floor((oeste + 180) / 360 * n);
  const der = Math.min(izq + n, Math.ceil((este + 180) / 360 * n));
  const arriba = Math.max(0, Math.floor(mercatorY(norte) * n));
  const abajo = Math.min(n, Math.ceil(mercatorY(sur) * n));
  return { z, n, izq, der, arriba, abajo, ancho: Math.max(0, der - izq), alto: Math.max(0, abajo - arriba) };
}

// Mayor nivel, hasta el deseado, cuyo mosaico cabe en el presupuesto de píxeles y teselas.
export function elegirRango(limites, deseado, ladoMax, teselasMax) {
  for (let z = Math.min(deseado, FUENTE.zMax); z > 0; z--) {
    const r = rango(limites, z);
    if (r.ancho * FUENTE.lado <= ladoMax && r.alto * FUENTE.lado <= ladoMax && r.ancho * r.alto <= teselasMax) return r;
  }
  return rango(limites, 0);
}

// Caja del mosaico en coordenadas de textura mundial: [u0, v0 Mercator, ancho, alto].
export const cajaDe = r => [((r.izq / r.n) % 1 + 1) % 1, r.arriba / r.n, r.ancho / r.n, r.alto / r.n];
export const claveRango = r => `${r.z}/${r.izq}/${r.der}/${r.arriba}/${r.abajo}`;
