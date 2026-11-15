import * as THREE from 'three';
import { elegirRango, claveRango, metrosPorPixel } from './teselas.js?v=20261115chl3';

// Imagen satelital por niveles para la pieza del país. Dos mosaicos en Web Mercator:
// «grueso» cubre el país entero y «fino» la zona a la vista con el nivel que pide el
// zoom. El shader de la pieza los mezcla sobre el mapa base; donde falta una tesela
// (o toda la fuente), sigue viéndose el mapa base. Nada se descarga si está apagado.
const tactil = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
const PRESUPUESTO = {
  grueso: { lado: 2048, teselas: 64, z: 10 },
  fino: { lado: tactil ? 2048 : 3072, teselas: tactil ? 64 : 120 },
};

export class CapaSatelital {
  constructor({ renderer, onCambio, onEstado }) {
    Object.assign(this, { renderer, onCambio, onEstado });
    const vacia = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    vacia.needsUpdate = true;
    this.vacia = vacia;
    this.uniforms = {
      uSatGrueso: { value: vacia },
      uCajaGrueso: { value: new THREE.Vector4(0, 0, 1, 1) },
      uSatFino: { value: vacia },
      uCajaFino: { value: new THREE.Vector4(0, 0, 1, 1) },
      uSat: { value: 0 },
    };
    this.activo = false;
    this.pedido = 0;
    this.pendiente = { grueso: 0, fino: 0 };
    this.clave = { grueso: null, fino: null };
    this.z = { grueso: 0, fino: 0 };
    this.fallo = { grueso: false, fino: false };
    this.parcial = { grueso: false, fino: false };
    this.sinCobertura = { grueso: false, fino: false };
    this.latitud = 0;
  }
  hayImagen() {
    return this.uniforms.uSatGrueso.value !== this.vacia || this.uniforms.uSatFino.value !== this.vacia;
  }

  activar(activo) {
    this.activo = activo;
    if (!activo) this.cancelar();
    this.avisar();
  }
  // Pide lo que falte para el país y para la vista. Si la clave coincide con lo que ya
  // está en pantalla o en camino, no hace nada: mover un poco el mapa no recarga.
  actualizar(cajaPais, vista) {
    if (!this.activo) return;
    this.worker ||= this.crearWorker();
    this.latitud = vista ? (vista.limites[1] + vista.limites[3]) / 2 : (cajaPais[1] + cajaPais[3]) / 2;
    const g = PRESUPUESTO.grueso;
    const grueso = elegirRango(cajaPais, g.z, g.lado, g.teselas);
    this.pedir('grueso', cajaPais, grueso);
    if (vista) {
      const f = PRESUPUESTO.fino;
      const lado = Math.min(f.lado, this.renderer.capabilities.maxTextureSize);
      const r = elegirRango(vista.limites, vista.z, lado, f.teselas);
      // Si la vista no pide más que el mosaico del país, basta con él.
      if (r.z > grueso.z) this.pedir('fino', vista.limites, r);
    }
    this.avisar();
  }
  pedir(capa, limites, r) {
    if (!r.ancho || !r.alto) return;
    const clave = claveRango(r);
    if (this.clave[capa] === clave) return;
    this.clave[capa] = clave;
    const pedido = ++this.pedido;
    this.pendiente[capa] = pedido;
    this.worker.postMessage({ tipo: 'mosaico', pedido, capa, limites, z: r.z });
  }
  crearWorker() {
    const worker = new Worker(new URL('./satelite-worker.js?v=20261115chl3', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => this.recibir(data);
    worker.onerror = error => {
      console.warn('Worker satelital:', error.message);
      this.fallo.grueso = this.fallo.fino = true;
      this.pendiente.grueso = this.pendiente.fino = 0;
      this.clave.grueso = this.clave.fino = null;
      this.avisar();
    };
    return worker;
  }
  recibir(data) {
    const { capa, pedido } = data;
    if (pedido !== this.pendiente[capa]) {
      data.imagen?.close();
      return;
    }
    this.pendiente[capa] = 0;
    if (data.cancelado) {
      this.avisar();
      return;
    }
    // Zona sin datos Sentinel-2 (interior antártico): no es un fallo, queda el mapa base.
    this.sinCobertura[capa] = Boolean(data.vacio);
    if (data.vacio) {
      this.fallo[capa] = this.parcial[capa] = false;
      this.avisar();
      return;
    }
    if (data.error) {
      // Sin respuesta del proveedor: se queda lo que hubiera y se reintenta en la próxima vista.
      this.clave[capa] = null;
      this.fallo[capa] = true;
      this.avisar();
      return;
    }
    this.fallo[capa] = false;
    this.parcial[capa] = data.fallidas > 0;
    // Con teselas perdidas, la próxima vista vuelve a pedir el mismo mosaico.
    if (data.fallidas) this.clave[capa] = null;
    const nombre = capa === 'grueso' ? 'uSatGrueso' : 'uSatFino';
    const anterior = this.uniforms[nombre].value;
    this.uniforms[nombre].value = this.crearTextura(data.imagen);
    this.uniforms[capa === 'grueso' ? 'uCajaGrueso' : 'uCajaFino'].value.fromArray(data.caja);
    this.z[capa] = data.z;
    this.liberar(anterior);
    this.avisar();
    this.onCambio?.();
  }
  crearTextura(imagen) {
    const t = new THREE.Texture(imagen);
    t.flipY = false;
    t.colorSpace = THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    t.needsUpdate = true;
    return t;
  }
  liberar(textura) {
    if (!textura || textura === this.vacia) return;
    textura.dispose();
    textura.image?.close?.();
  }
  cancelar() {
    this.worker?.postMessage({ tipo: 'cancelar' });
    for (const capa of ['grueso', 'fino']) {
      if (this.pendiente[capa]) this.clave[capa] = null;
      this.pendiente[capa] = 0;
    }
  }
  // Otro país: fuera todo lo anterior.
  limpiar() {
    this.cancelar();
    for (const capa of ['grueso', 'fino']) {
      const nombre = capa === 'grueso' ? 'uSatGrueso' : 'uSatFino';
      this.liberar(this.uniforms[nombre].value);
      this.uniforms[nombre].value = this.vacia;
      this.clave[capa] = null;
      this.z[capa] = 0;
      this.fallo[capa] = this.parcial[capa] = this.sinCobertura[capa] = false;
    }
    this.avisar();
  }
  estado() {
    if (!this.activo) return { estado: 'apagado' };
    const cargando = Boolean(this.pendiente.grueso || this.pendiente.fino);
    const fino = this.uniforms.uSatFino.value !== this.vacia;
    const z = fino ? Math.max(this.z.fino, this.z.grueso) : this.z.grueso;
    const metros = this.hayImagen() ? metrosPorPixel(this.latitud, z) : null;
    if (cargando) return { estado: 'cargando', metros };
    if (!this.hayImagen() && (this.fallo.grueso || this.fallo.fino)) return { estado: 'sin-conexion' };
    if (!this.hayImagen() && this.sinCobertura.grueso) return { estado: 'sin-cobertura' };
    if (this.fallo.fino || this.parcial.fino || this.parcial.grueso) return { estado: 'parcial', metros };
    return { estado: this.hayImagen() ? 'listo' : 'esperando', metros };
  }
  avisar() {
    const e = this.estado();
    const firma = `${e.estado}|${e.metros ? Math.round(e.metros) : ''}`;
    if (firma === this.ultimoAviso) return;
    this.ultimoAviso = firma;
    this.onEstado?.(e);
  }
}
