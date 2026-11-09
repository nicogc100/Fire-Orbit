const LADO = 256;
const LIMITE = 85.05112878;
const PATRON = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const Y = lat => {
  const rad = Math.max(-LIMITE, Math.min(LIMITE, lat)) * Math.PI / 180;
  return (.5 - Math.asinh(Math.tan(rad)) / (2 * Math.PI));
};

export async function cargarRelieve([oeste, sur, este, norte], signal) {
  const x0 = (oeste + 180) / 360, x1 = (este + 180) / 360;
  const y0 = Y(norte), y1 = Y(sur);
  if (!(x1 > x0 && y1 > y0)) return null;
  const escala = Math.max(x1 - x0, y1 - y0);
  const zoom = Math.max(0, Math.min(12, Math.floor(Math.log2(3 / escala))));
  const n = 2 ** zoom;
  const izq = Math.floor(x0 * n), der = Math.ceil(x1 * n);
  const arriba = Math.max(0, Math.floor(y0 * n)), abajo = Math.min(n, Math.ceil(y1 * n));
  const ancho = (der - izq) * LADO, alto = (abajo - arriba) * LADO;
  if (!ancho || !alto) return null;
  const lienzo = new OffscreenCanvas(ancho, alto);
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });
  const tareas = [];
  for (let y = arriba; y < abajo; y++) {
    for (let x = izq; x < der; x++) {
      const columna = ((x % n) + n) % n;
      const url = `${PATRON}/${zoom}/${columna}/${y}.png`;
      tareas.push((async () => {
        try {
          const r = await fetch(url, { signal });
          if (!r.ok) return false;
          const imagen = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none' });
          ctx.drawImage(imagen, (x - izq) * LADO, (y - arriba) * LADO);
          imagen.close();
          return true;
        } catch (error) {
          if (signal.aborted) throw error;
          return false;
        }
      })());
    }
  }
  if (!(await Promise.all(tareas)).some(Boolean)) return null;
  signal.throwIfAborted();

  const rgba = ctx.getImageData(0, 0, ancho, alto).data;
  const datos = new Uint8Array(ancho * alto).fill(128);
  const altura = i => rgba[i] * 256 + rgba[i + 1] + rgba[i + 2] / 256;
  const fila = ancho * 4;
  for (let y = 1; y < alto - 1; y++) {
    const latitudMercator = Math.PI * (1 - 2 * (arriba + y / LADO) / n);
    const metros = 40075016.7 / (n * LADO * Math.cosh(latitudMercator));
    for (let x = 1; x < ancho - 1; x++) {
      const i = (y * ancho + x) * 4;
      if (!rgba[i - 1] || !rgba[i + 7] || !rgba[i - fila + 3] || !rgba[i + fila + 3]) continue;
      const dx = (altura(i + 4) - altura(i - 4)) / (2 * metros);
      const dy = (altura(i + fila) - altura(i - fila)) / (2 * metros);
      const luz = (.56 * dx + .45 * dy + .7) / Math.hypot(dx, dy, 1);
      datos[i / 4] = Math.round(255 * Math.min(1, Math.max(0, .5 + (luz - .7) * .9)));
    }
  }
  return {
    datos, ancho, alto,
    caja: [((izq / n) % 1 + 1) % 1, arriba / n, (der - izq) / n, (abajo - arriba) / n],
  };
}
