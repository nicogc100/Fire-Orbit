import * as THREE from 'three';
import { construirGeometria, construirPuntos, desproyectar, fueraDePieza, proyectar } from './pieza-geo.js?v=20261115orb1';
import { dentroDePoligono } from '../datos/datos-pais.js?v=20261115orb1';
import { CapaSatelital } from '../satelite/capa-satelital.js?v=20261115orb1';
import {
  verticePieza,
  fragmentoPieza,
  verticeLinea,
  fragmentoLinea,
  verticePuntos,
  fragmentoPuntos,
  verticeCuadros,
  fragmentoCuadros,
} from './modo-pais-shaders.js?v=20261115orb1';

// El mapa del país se dibuja en su propio lienzo, sobre el globo. El pase de nubes
// no cambia y el globo sigue vivo al lado. La cámara del mapa copia la del globo,
// de modo que el país despega exactamente desde donde está en el planeta.
const INCLINACION = -0.3;
const DISTANCIA = 3;
const aVectores = puntos => puntos.map(p => new THREE.Vector2(p.x, p.y));
const triangular = (contorno, huecos) => THREE.ShapeUtils.triangulateShape(aVectores(contorno), huecos.map(aVectores));
const suaveRango = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const cuadro = () => {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, -1, 0, 1, 1, 0, 0, 1, 0]), 3),
  );
  return g;
};

const habitantesCorto = n =>
  n >= 1e6 ? `${(n / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 })} M` : n >= 1000 ? `${Math.round(n / 1000)} mil` : `${n}`;

// Superficie aproximada (proyección local en km) y centro de un polígono de [lon, lat].
export function medidasArea(geo) {
  const n = geo.length;
  const centro = [geo.reduce((s, e) => s + e[0], 0) / n, geo.reduce((s, e) => s + e[1], 0) / n];
  const lat0 = (centro[1] * Math.PI) / 180;
  const xy = geo.map(([lon, lat]) => [lon * 111.32 * Math.cos(lat0), lat * 110.57]);
  const km2 = Math.abs(xy.reduce((s, [x, y], i) => s + x * xy[(i + 1) % n][1] - xy[(i + 1) % n][0] * y, 0) / 2);
  return { km2, centro };
}

export class ModoPais {
  constructor({
    canvas,
    stage,
    camera,
    globe,
    imagenMapa,
    panel,
    capaEtiquetas,
    leyenda,
    atribucion,
    reduceMotion,
    onPunto,
    onVista,
    onSatelite,
  }) {
    Object.assign(this, {
      canvas,
      stage,
      cameraGlobo: camera,
      globe,
      panel,
      capaEtiquetas,
      leyenda,
      atribucion,
      reduceMotion,
      onPunto,
      onVista,
      onSatelite,
    });
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camara = new THREE.PerspectiveCamera();
    this.grupo = new THREE.Group();
    this.scene.add(this.grupo);
    this.mapaBase = this.crearTextura(imagenMapa, false);
    this.mapa = this.mapaBase;
    this.uMorph = { value: 0 };
    this.uOpacidad = { value: 1 };
    this.uCaja = { value: new THREE.Vector4(0, 0, 1, 1) };
    this.uAltoMapa = { value: imagenMapa.height };
    this.uRelieve = { value: null };
    this.uCajaRelieve = { value: new THREE.Vector4(0, 0, 1, 1) };
    this.uMostrarRelieve = { value: 0 };
    this.vista = null;
    this.localidades = [];
    // Poblaciones de Chile (INE): [nombre, lon, lat, habitantes]. null: capa apagada.
    this.poblaciones = null;
    // Herramienta «medir área»: el arrastre dibuja un rectángulo en vez de mover el mapa.
    this.modoArea = false;
    this.arrastreArea = null;
    this.uMapa = { value: this.mapa };
    this.uPantalla = { value: new THREE.Vector2(1, 1) };
    this.uniformesPuntos = {
      uMorph: this.uMorph,
      uDiaIni: { value: 0 },
      uDiaFin: { value: 365 },
      uCola: { value: 0 },
      uTamano: { value: 1 },
      uAparicion: { value: 0 },
      uSensores: { value: new THREE.Vector2(1, 1) },
      uIntensidad: { value: 1 },
      uRegion: { value: -1 },
    };
    // Región cuyos focos se muestran (null: todo el país).
    this.regionFocos = null;
    this.p = 0;
    this.activo = false;
    this.llegado = false;
    this.sucio = true;
    this.giro = 0;
    this.cabeceo = 0;
    this.vGiro = 0;
    this.vCabeceo = 0;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.punteros = new Map();
    this.ultimoPick = 0;
    this.ultimoTiempo = 0;
    this.limbo = 0;
    this.base = new THREE.Quaternion();
    this.q0 = new THREE.Quaternion();
    this.qFinal = new THREE.Quaternion();
    this.qAux = new THREE.Quaternion();
    this.objetivo = new THREE.Vector3();
    this.escalaFinal = 1;
    this.filtro = { ini: 0, fin: 365, sensor: 'todos', cola: 0, visibles: 1000 };
    this.ejeX = new THREE.Vector3(1, 0, 0);
    this.ejeZ = new THREE.Vector3(0, 0, 1);
    this.medidor = document.createElement('canvas').getContext('2d');
    this.etiquetasDom = [];
    this.pedido = 0;
    this.respuestas = new Map();
    this.uBase = { value: new THREE.Matrix3() };
    // Detalle satelital: apagado al empezar. uDetalle es el modo; uSat, la imagen ya llegada.
    this.satelital = false;
    this.uDetalle = { value: 0 };
    this.satelite = new CapaSatelital({
      renderer: this.renderer,
      onCambio: () => {
        this.sucio = true;
      },
      onEstado: estado => this.onSatelite?.(estado),
    });
    this.materialPieza = new THREE.ShaderMaterial({
      vertexShader: verticePieza,
      fragmentShader: fragmentoPieza,
      transparent: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      uniforms: {
        uMapa: this.uMapa,
        uBase: this.uBase,
        uMorph: this.uMorph,
        uOpacidad: this.uOpacidad,
        uCaja: this.uCaja,
        uAltoMapa: this.uAltoMapa,
        uRelieve: this.uRelieve,
        uCajaRelieve: this.uCajaRelieve,
        uMostrarRelieve: this.uMostrarRelieve,
        uDetalle: this.uDetalle,
        ...this.satelite.uniforms,
      },
    });
    this.materialCosta = this.crearMaterialLinea(new THREE.Color(0.95, 0.98, 1), 0.78, 1);
    this.materialLimite = this.crearMaterialLinea(new THREE.Color(0.92, 0.96, 1), 0.46, 0.8);
    this.materialPuntos = new THREE.ShaderMaterial({
      vertexShader: verticePuntos,
      fragmentShader: fragmentoPuntos,
      uniforms: this.uniformesPuntos,
      // Sin prueba de profundidad: los focos están sobre la superficie y, con la pieza
      // aplanada al acercar, la precisión no alcanza para distinguirlos de ella.
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const rangoPuntos = this.renderer.getContext().getParameter(this.renderer.getContext().ALIASED_POINT_SIZE_RANGE);
    this.uPR = { value: this.renderer.getPixelRatio() };
    this.uPxPorMetro = { value: 0 };
    this.uTamMin = { value: 6 * this.uPR.value };
    this.uTamMax = { value: Math.max(8, Math.min(rangoPuntos?.[1] ?? 64, 96 * this.uPR.value)) };
    this.materialCuadros = new THREE.ShaderMaterial({
      vertexShader: verticeCuadros,
      fragmentShader: fragmentoCuadros,
      uniforms: {
        ...this.uniformesPuntos,
        uPR: this.uPR,
        uPxPorMetro: this.uPxPorMetro,
        uTamMin: this.uTamMin,
        uTamMax: this.uTamMax,
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.worker = new Worker(new URL('./cartografia-worker.js?v=20261115orb1', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      const resolver = this.respuestas.get(data.pedido);
      this.respuestas.delete(data.pedido);
      resolver?.(data);
    };
    this.escucharPunteros();
  }
  consultar(mensaje, transferir = []) {
    const pedido = ++this.pedido;
    return new Promise(resolver => {
      this.respuestas.set(pedido, resolver);
      this.worker.postMessage({ ...mensaje, pedido }, transferir);
    });
  }
  crearMaterialLinea(color, alfa, ancho) {
    return new THREE.ShaderMaterial({
      vertexShader: verticeLinea,
      fragmentShader: fragmentoLinea,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uMorph: this.uMorph,
        uOpacidad: this.uOpacidad,
        uPantalla: this.uPantalla,
        uColor: { value: color },
        uAlfa: { value: alfa },
        uAncho: { value: ancho },
      },
    });
  }
  // En Windows (ANGLE sobre Direct3D) el shader definitivo se genera en el primer
  // dibujado real y según el formato de los atributos: compilar no basta, y ese coste
  // congelaba varios segundos el inicio del vuelo. Se paga una vez, en la carga, con
  // un dibujado idéntico en formato al de un país de verdad.
  async precalentar() {
    const escena = new THREE.Scene();
    const atributo = (n, tam) => new THREE.BufferAttribute(new Float32Array(n * tam), tam);
    const pieza = new THREE.BufferGeometry();
    for (const [nombre, tam] of [
      ['position', 3],
      ['aEsfera', 3],
      ['normal', 3],
      ['aLado', 1],
    ])
      pieza.setAttribute(nombre, atributo(3, tam));
    const puntos = new THREE.BufferGeometry();
    for (const [nombre, tam] of [
      ['position', 3],
      ['aEsfera', 3],
      ['aDia', 1],
      ['aFrp', 1],
      ['aSensor', 1],
    ])
      puntos.setAttribute(nombre, atributo(3, tam));
    const linea = cuadro();
    for (const nombre of ['iPlanoA', 'iPlanoB', 'iEsferaA', 'iEsferaB'])
      linea.setAttribute(nombre, new THREE.InstancedBufferAttribute(new Float32Array(3), 3));
    linea.instanceCount = 1;
    // Los cuadrados del detalle satelital también: activar el
    // interruptor no debe congelar el mapa mientras se compilan.
    const objetos = [
      new THREE.Mesh(pieza, this.materialPieza),
      new THREE.Mesh(linea, this.materialCosta),
      new THREE.Points(puntos, this.materialPuntos),
      new THREE.Points(puntos, this.materialCuadros),
    ];
    objetos.forEach(o => {
      o.frustumCulled = false;
      escena.add(o);
    });
    this.renderer.setSize(8, 8, false);
    this.renderer.initTexture(this.mapaBase);
    await this.renderer.compileAsync(escena, this.camara);
    this.renderer.render(escena, this.camara);
    // Una lectura espera a que la GPU termine de verdad antes de dar la carga por hecha.
    const gl = this.renderer.getContext();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    for (const g of [pieza, puntos, linea]) g.dispose();
  }
  crearTextura(imagen, mipmaps) {
    const t = new THREE.Texture(imagen);
    t.colorSpace = THREE.NoColorSpace;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    t.generateMipmaps = mipmaps;
    t.needsUpdate = true;
    return t;
  }

  // ---------- Mapa de terreno ----------
  // El de 8K se pide una sola vez, al abrir el primer país; nunca desde la portada.
  cargarMapaDetalle() {
    this.promesaMapa ||= fetch('assets/earth-day-8k.webp')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then(b => createImageBitmap(b))
      .catch(error => {
        console.warn('Mapa de 8K no disponible:', error);
        return null;
      });
    return this.promesaMapa;
  }
  async ponerMapa(geometria) {
    const imagen = await this.cargarMapaDetalle();
    if (!imagen || geometria !== this.geometria) return;
    const { oeste, ancho, sur, norte } = geometria.caja;
    const W = imagen.width,
      H = imagen.height;
    const maximo = this.renderer.capabilities.maxTextureSize;
    const lienzo = document.createElement('canvas');
    const sw = Math.ceil((ancho / 360) * W),
      sh = Math.ceil(((norte - sur) / 180) * H);
    const factor = Math.min(1, maximo / Math.max(sw, sh));
    lienzo.width = Math.round(sw * factor);
    lienzo.height = Math.round(sh * factor);
    // En memoria, no en la GPU: el recorte no debe competir con el dibujado.
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    const sx = (((((oeste + 180) / 360) * W) % W) + W) % W,
      sy = ((90 - norte) / 180) * H;
    ctx.scale(factor, factor);
    ctx.drawImage(imagen, sx, sy, Math.min(sw, W - sx), sh, 0, 0, Math.min(sw, W - sx), sh);
    if (sx + sw > W) ctx.drawImage(imagen, 0, sy, sx + sw - W, sh, W - sx, 0, sx + sw - W, sh);
    const anterior = this.mapa;
    this.mapa = this.crearTextura(lienzo, true);
    this.uMapa.value = this.mapa;
    this.uAltoMapa.value = lienzo.height / ((norte - sur) / 180);
    this.uCaja.value.set(((((oeste + 180) / 360) % 1) + 1) % 1, (sur + 90) / 180, ancho / 360, (norte - sur) / 180);
    if (anterior !== this.mapaBase) anterior.dispose();
    this.sucio = true;
  }

  // ---------- Construcción ----------
  // El detalle se calcula en el worker. Si aún no llegó al despegar, se muestra el
  // contorno general (1:50m) y se sustituye en cuanto el detallado esté listo.
  preparar(feature) {
    this.reiniciarVista();
    this.feature = feature;
    this.detalle = null;
    const promesa = this.consultar({ tipo: 'detalle', id: feature.id }).then(respuesta => {
      if (promesa !== this.promesaDetalle) return null;
      if (respuesta.error) {
        console.warn('Cartografía detallada no disponible:', respuesta.error);
        return null;
      }
      this.detalle = respuesta.geometria;
      // Nunca a mitad de vuelo: si la pieza está volando, se cambia al aterrizar.
      if (this.activo && this.llegado) this.montar(this.detalle);
      return this.detalle;
    });
    this.promesaDetalle = promesa;
    return promesa;
  }
  montar(g) {
    this.limpiarPieza();
    this.geometria = g;
    this.uBase.value.set(
      g.marco.este[0],
      g.marco.norte[0],
      g.marco.centro[0],
      g.marco.este[1],
      g.marco.norte[1],
      g.marco.centro[1],
      g.marco.este[2],
      g.marco.norte[2],
      g.marco.centro[2],
    );
    this.base.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...g.marco.este),
        new THREE.Vector3(...g.marco.norte),
        new THREE.Vector3(...g.marco.centro),
      ),
    );
    const malla = new THREE.BufferGeometry();
    malla.setAttribute('position', new THREE.BufferAttribute(g.plano, 3));
    malla.setAttribute('aEsfera', new THREE.BufferAttribute(g.esfera, 3));
    malla.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3));
    malla.setAttribute('aLado', new THREE.BufferAttribute(g.lado, 1));
    this.malla = new THREE.Mesh(malla, this.materialPieza);
    this.malla.frustumCulled = false;
    // Orden explícito. Three ordena los transparentes por el centro de cada geometría,
    // y en Chile eso dibujaba el terreno encima de los focos.
    this.malla.renderOrder = 0;
    this.grupo.add(this.malla);
    this.lineas = [
      this.crearLineas(g.contornoPlano, g.contornoEsfera, this.materialCosta),
      this.crearLineas(g.limitesPlano, g.limitesEsfera, this.materialLimite),
    ].filter(Boolean);
    this.lineas.forEach(l => this.grupo.add(l));
    this.crearEtiquetas(g);
    this.medir();
    if (this.llegado) {
      this.ponerMapa(g);
      this.pedirSatelite();
    }
    if (this.datos) this.ponerPuntos(this.datos);
    this.sucio = true;
  }
  crearLineas(plano, esfera, material) {
    if (!plano.length) return null;
    const g = cuadro();
    const instancias = plano.length / 6;
    const dividir = (fuente, nombreA, nombreB) => {
      const a = new Float32Array(instancias * 3),
        b = new Float32Array(instancias * 3);
      for (let i = 0; i < instancias; i++) {
        a.set(fuente.subarray(i * 6, i * 6 + 3), i * 3);
        b.set(fuente.subarray(i * 6 + 3, i * 6 + 6), i * 3);
      }
      g.setAttribute(nombreA, new THREE.InstancedBufferAttribute(a, 3));
      g.setAttribute(nombreB, new THREE.InstancedBufferAttribute(b, 3));
    };
    dividir(plano, 'iPlanoA', 'iPlanoB');
    dividir(esfera, 'iEsferaA', 'iEsferaB');
    g.instanceCount = instancias;
    const m = new THREE.Mesh(g, material);
    m.frustumCulled = false;
    m.renderOrder = 1;
    return m;
  }
  limpiarPieza() {
    for (const objeto of [this.malla, ...(this.lineas || [])]) {
      if (objeto) {
        this.grupo.remove(objeto);
        objeto.geometry.dispose();
      }
    }
    this.malla = null;
    this.lineas = [];
    this.quitarPuntos(false);
    this.capaEtiquetas.replaceChildren();
    this.etiquetasDom = [];
  }
  quitarPuntos(olvidar = true) {
    if (this.puntos) {
      this.grupo.remove(this.puntos);
      this.puntos.geometry.dispose();
    }
    this.puntos = null;
    this.datosPuntos = null;
    if (olvidar) this.datos = null;
  }
  // Con detalle, todos los focos son cuadrados nítidos, también los de la serie por celdas.
  aplicarModoPuntos() {
    if (this.puntos) this.puntos.material = this.satelital ? this.materialCuadros : this.materialPuntos;
    this.sucio = true;
  }
  ponerPuntos(datos) {
    this.datos = datos;
    if (!this.geometria) return 0;
    this.quitarPuntos(false);
    const p = construirPuntos(this.geometria, datos.registros, datos.dias);
    this.datosPuntos = p;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p.plano, 3));
    geo.setAttribute('aEsfera', new THREE.BufferAttribute(p.esfera, 3));
    geo.setAttribute('aDia', new THREE.BufferAttribute(p.dia, 1));
    geo.setAttribute('aFrp', new THREE.BufferAttribute(p.frp, 1));
    geo.setAttribute('aSensor', new THREE.BufferAttribute(p.sensor, 1));
    geo.setAttribute('aRegion', new THREE.BufferAttribute(new Float32Array(p.dia.length).fill(-1), 1));
    p.conRegiones = false;
    this.puntos = new THREE.Points(geo, this.materialPuntos);
    this.puntos.frustumCulled = false;
    this.puntos.renderOrder = 2;
    this.grupo.add(this.puntos);
    this.aplicarModoPuntos();
    this.aplicarFiltro();
    this.sucio = true;
    return p.omitidos;
  }
  // Región de cada registro, en segundo plano. Llega cuando esté lista.
  async regionesDe(datos, id) {
    const lons = Float32Array.from(datos.registros, r => r.lon),
      lats = Float32Array.from(datos.registros, r => r.lat);
    const respuesta = await this.consultar({ tipo: 'regiones', id, lons, lats }, [lons.buffer, lats.buffer]);
    if (respuesta.error) {
      console.warn('Regiones no disponibles:', respuesta.error);
      return null;
    }
    return respuesta.indices;
  }
  // Región de cada punto dibujado (indices: una por registro, en el orden de los datos).
  ponerRegionesPuntos(indices) {
    const p = this.datosPuntos;
    if (!p || !this.puntos || indices.length !== this.datos?.registros.length) return;
    const atributo = this.puntos.geometry.getAttribute('aRegion');
    p.origen.forEach((i, k) => {
      atributo.array[k] = indices[i];
    });
    atributo.needsUpdate = true;
    p.region = atributo.array;
    p.conRegiones = true;
    this.aplicarFiltro();
  }
  // Solo los focos de una región (null: todo el país).
  mostrarRegion(indice) {
    this.regionFocos = Number.isInteger(indice) ? indice : null;
    this.aplicarFiltro();
  }
  // Región de cualquier lista de coordenadas (por ejemplo, el centro de cada zona de la serie).
  async regionesEn(lons, lats) {
    if (!this.feature) return null;
    const lo = Float32Array.from(lons),
      la = Float32Array.from(lats);
    const r = await this.consultar({ tipo: 'regiones', id: this.feature.id, lons: lo, lats: la }, [lo.buffer, la.buffer]);
    return r.error ? null : r.indices;
  }
  filtrar(filtro) {
    Object.assign(this.filtro, filtro);
    this.aplicarFiltro();
  }
  aplicarFiltro() {
    const u = this.uniformesPuntos,
      f = this.filtro;
    u.uDiaIni.value = f.ini;
    u.uDiaFin.value = f.fin;
    u.uCola.value = f.cola;
    u.uSensores.value.set(f.sensor === 'VIIRS' ? 0 : 1, f.sensor === 'MODIS' ? 0 : 1);
    // Mientras se ubica cada foco en su región (unos segundos), no se muestran focos de otras regiones.
    u.uRegion.value = this.regionFocos === null ? -1 : this.datosPuntos?.conRegiones ? this.regionFocos : -2;
    this.ajustarTamano(f.visibles);
    this.onPuntosCambiados?.();
    this.sucio = true;
  }
  // Muchos puntos juntos saturarían a blanco; pocos deben seguir siendo visibles.
  ajustarTamano(visibles) {
    const u = this.uniformesPuntos,
      escala = this.renderer.getPixelRatio();
    const densidad = Math.log10(Math.max(visibles, 1));
    const espacio = THREE.MathUtils.clamp(Math.min(this.area?.w ?? 700, this.area?.h ?? 700) / 620, 0.42, 1);
    const acercado = THREE.MathUtils.clamp(Math.pow(this.zoom, 0.35), 1, 2);
    u.uTamano.value = escala * espacio * acercado * THREE.MathUtils.clamp(1.9 - densidad * 0.27, 0.72, 1.9);
    u.uIntensidad.value = THREE.MathUtils.clamp(1.4 - densidad * 0.27, 0.16, 1) * Math.sqrt(espacio);
    // Cuadrados del detalle: con miles a escala de país, más pequeños para que se vea el terreno.
    if (this.uTamMin)
      this.uTamMin.value = escala * Math.min(6, THREE.MathUtils.clamp(7.5 - densidad * 1.1, 2.5, 6) * acercado);
  }

  // ---------- Selección sobre la misma pieza ----------
  // Longitud y latitud bajo un punto del lienzo (en píxeles CSS del lienzo).
  lonLatPantalla(px, py, W, H) {
    const g = this.geometria;
    if (!g) return null;
    const rayo = this.grupo.worldToLocal(
      new THREE.Vector3((px / W) * 2 - 1, 1 - (py / H) * 2, 0.5).unproject(this.camara),
    );
    const ojo = this.grupo.worldToLocal(this.camara.position.clone());
    const t = -ojo.z / (rayo.z - ojo.z);
    if (!(t > 0 && Number.isFinite(t))) return null;
    const punto = ojo.lerp(rayo, t);
    return desproyectar(g.marco, punto.x + g.cx, punto.y + g.cy);
  }
  lonLatEn(x, y) {
    const rect = this.canvas.getBoundingClientRect();
    return this.lonLatPantalla(x - rect.left, y - rect.top, rect.width, rect.height);
  }
  async seleccionarEn(x, y) {
    const g = this.geometria;
    if (!this.llegado || !g?.etiquetas.length) return false;
    const coord = this.lonLatEn(x, y);
    if (!coord) return false;
    const [lon, lat] = coord;
    const solicitud = this.consultar({ tipo: 'regiones', id: this.feature.id, lons: [lon], lats: [lat] });
    this.seleccionPendiente = solicitud;
    const { indices } = await solicitud;
    if (this.seleccionPendiente !== solicitud || g !== this.geometria || !this.llegado) return false;
    const indice = indices?.[0];
    return indice !== this.vista?.region.indice && this.seleccionarRegion(indice);
  }

  seleccionarRegion(indice) {
    const g = this.geometria;
    const region = g?.etiquetas.find(e => e.indice === indice);
    if (!this.llegado || !region) return false;
    this.seleccionPendiente = null;
    if (this.vista?.region !== region) this.localidades = [];
    this.aplicarVista({ region, limites: region.limites, encuadre: region });
    this.crearEtiquetas(g);
    this.consultar({ tipo: 'ciudades', id: this.feature.id, indice }).then(({ localidades }) => {
      if (!localidades || g !== this.geometria || this.vista?.region !== region || !this.llegado) return;
      this.localidades = localidades.flatMap(([nombre, lon, lat]) => {
        if (fueraDePieza(g.marco, lon, lat)) return [];
        const [x, y] = proyectar(g.marco, lon, lat);
        return [{ nombre, lon, lat, x: x - g.cx, y: y - g.cy, ciudad: true }];
      });
      this.crearEtiquetas(g);
      this.sucio = true;
    });
    return true;
  }

  seleccionarCiudad(ciudad) {
    if (!this.llegado || !this.vista) return;
    const { lon, lat, x, y } = ciudad;
    const deltaLon = 0.13 / Math.max(0.15, Math.cos(THREE.MathUtils.degToRad(lat)));
    const deltaLat = 0.1;
    const margen = THREE.MathUtils.degToRad(0.12);
    this.aplicarVista({
      region: this.vista.region,
      ciudad,
      limites: [lon - deltaLon, lat - deltaLat, lon + deltaLon, lat + deltaLat],
      encuadre: { oeste: x - margen, este: x + margen, sur: y - margen, norte: y + margen },
    });
  }

  aplicarVista(vista) {
    this.vista = vista;
    this.giro = this.cabeceo = this.vGiro = this.vCabeceo = 0;
    this.onPunto?.(null);
    this.onVista?.(vista);
    this.encuadrarVista();
    this.quitarRelieve();
    this.consultar({ tipo: 'relieve', id: this.feature.id, limites: vista.limites }).then(({ relieve }) => {
      if (!relieve || this.vista !== vista || !this.llegado) return;
      const textura = new THREE.DataTexture(relieve.datos, relieve.ancho, relieve.alto, THREE.RedFormat);
      textura.minFilter = THREE.LinearMipmapLinearFilter;
      textura.magFilter = THREE.LinearFilter;
      textura.generateMipmaps = true;
      textura.needsUpdate = true;
      this.uRelieve.value = textura;
      this.uCajaRelieve.value.fromArray(relieve.caja);
      this.uMostrarRelieve.value = 0.9;
      this.sucio = true;
    });
  }

  encuadrarVista(animar = true) {
    const { oeste, este, sur, norte } = this.vista.encuadre;
    const { w, h } = this.area;
    const escala = 0.78 * this.mpp * Math.min(w / Math.max(este - oeste, 1e-5), h / Math.max(norte - sur, 1e-5));
    const zoom = THREE.MathUtils.clamp(escala / this.escalaFinal, 1, 160);
    const porPixel = (this.escalaFinal * zoom) / this.mpp;
    const pan = { x: (-(oeste + este) / 2) * porPixel, y: ((sur + norte) / 2) * porPixel };
    if (animar && !this.reduceMotion.matches) {
      this.enfoque = { inicio: performance.now(), zoom: this.zoom, pan: { ...this.pan }, destino: { zoom, pan } };
    } else {
      this.enfoque = null;
      this.zoom = zoom;
      this.pan = pan;
      this.ajustarTamano(this.filtro.visibles);
    }
    this.sucio = true;
  }

  quitarRelieve() {
    this.worker.postMessage({ tipo: 'cancelarRelieve' });
    this.uRelieve.value?.dispose();
    this.uRelieve.value = null;
    this.uMostrarRelieve.value = 0;
  }

  volverVista() {
    if (this.vista?.ciudad) this.seleccionarRegion(this.vista.region.indice);
    else this.reiniciarVista();
  }

  // ---------- Detalle satelital ----------
  // Solo cambia cómo se dibuja: encuadre, región, ciudad, zoom, fecha y sensor siguen igual.
  ponerSatelital(activo) {
    this.satelital = activo;
    this.satelite.activar(activo);
    this.aplicarModoPuntos();
    this.firmaVista = null;
    this.pedirSatelite();
    // Nunca medir() aquí: reencuadra la región o ciudad y perdería el zoom del usuario.
    this.colocarAtribucion();
    this.ajustarTamano(this.filtro.visibles);
    this.sucio = true;
  }
  pedirSatelite() {
    if (!this.satelital || !this.llegado || !this.geometria || !this.area) return;
    const { oeste, ancho, sur, norte } = this.geometria.caja;
    this.satelite.actualizar([oeste, sur, oeste + ancho, norte], this.limitesVisibles());
  }
  // Zona del país que se ve ahora y nivel de tesela que pide su escala en pantalla.
  limitesVisibles() {
    const g = this.geometria;
    const W = this.canvas.clientWidth,
      H = this.canvas.clientHeight;
    if (!W || !H || !this.mpp) return null;
    this.grupo.updateMatrixWorld();
    const lateral = this.panel.offsetLeft > W * 0.4;
    const x1 = lateral ? this.panel.offsetLeft : W;
    const y1 = lateral ? H : Math.min(H, this.area.y + this.area.h + 24);
    const { oeste, ancho, sur, norte } = g.caja;
    const centro = oeste + ancho / 2;
    let w = Infinity,
      e = -Infinity,
      s = Infinity,
      n = -Infinity,
      aciertos = 0;
    const N = 8;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const c = this.lonLatPantalla((x1 * i) / N, (y1 * j) / N, W, H);
        if (!c) continue;
        const lon = centro + ((c[0] - centro + 540) % 360) - 180;
        w = Math.min(w, lon);
        e = Math.max(e, lon);
        s = Math.min(s, c[1]);
        n = Math.max(n, c[1]);
        aciertos++;
      }
    }
    // Pocos aciertos: la vista inclinada mira sobre todo cielo. Basta el mosaico del país.
    if (aciertos < 6) return null;
    const mw = (e - w) * 0.06,
      mh = (n - s) * 0.06;
    const limites = [
      Math.max(oeste, w - mw),
      Math.max(sur, s - mh),
      Math.min(oeste + ancho, e + mw),
      Math.min(norte, n + mh),
    ];
    if (!(limites[2] > limites[0] && limites[3] > limites[1])) return null;
    const lat = (limites[1] + limites[3]) / 2;
    const metrosPorPixelPantalla = (6371000 * this.mpp) / (this.grupo.scale.x * this.renderer.getPixelRatio());
    const z = Math.max(
      0,
      Math.ceil(Math.log2((156543.034 * Math.cos(THREE.MathUtils.degToRad(lat))) / metrosPorPixelPantalla) - 0.25),
    );
    return { limites, z };
  }
  // En detalle se puede acercar hasta ~4 m por píxel de pantalla: lo que da Sentinel-2.
  zoomMaximo() {
    const base = this.vista ? 160 : 24;
    if (!this.satelital || !this.mpp || !this.escalaFinal) return base;
    return Math.max(base, (6371000 * this.mpp) / (4 * this.escalaFinal));
  }
  colocarAtribucion() {
    const a = this.atribucion;
    if (!a) return;
    const W = this.canvas.clientWidth;
    const lateral = this.panel.offsetLeft > W * 0.4;
    a.style.right = lateral ? `${Math.max(16, W - this.panel.offsetLeft + 16)}px` : '';
  }

  // ---------- Etiquetas de región y ciudad ----------
  crearEtiquetas(g) {
    this.capaEtiquetas.replaceChildren();
    this.medidor.font = '600 12px Atlas, Arial, sans-serif';
    const regiones = g.etiquetas.filter(e => e !== this.vista?.region).sort((a, b) => b.area - a.area);
    const poblaciones = this.poblaciones
      ? this.poblaciones.flatMap(([nombre, lon, lat, habitantes]) => {
          if (fueraDePieza(g.marco, lon, lat)) return [];
          const [x, y] = proyectar(g.marco, lon, lat);
          return [{ nombre, lon, lat, x: x - g.cx, y: y - g.cy, ciudad: true, habitantes }];
        })
      : [];
    const lista = poblaciones.length ? [...poblaciones, ...regiones] : [...this.localidades, ...regiones];
    this.etiquetasDom = lista.map(e => {
      const nodo = document.createElement('button');
      nodo.type = 'button';
      nodo.className = e.ciudad ? 'etiqueta-region etiqueta-ciudad' : 'etiqueta-region';
      if (e.habitantes) {
        nodo.classList.add('etiqueta-poblacion');
        nodo.textContent = e.nombre;
        const n = document.createElement('small');
        n.textContent = habitantesCorto(e.habitantes);
        nodo.append(n);
        nodo.setAttribute('aria-label', `Acercar a ${e.nombre} (${e.habitantes.toLocaleString('es-CL')} habitantes)`);
      } else {
        nodo.textContent = e.nombre;
        nodo.setAttribute('aria-label', `Acercar a ${e.nombreCompleto ?? e.nombre}`);
      }
      nodo.hidden = true;
      nodo.addEventListener('click', () => {
        if (e.ciudad) this.seleccionarCiudad(e);
        else this.seleccionarRegion(e.indice);
        this.canvas.focus({ preventScroll: true });
      });
      this.capaEtiquetas.append(nodo);
      const texto = e.habitantes ? `${e.nombre}  ${habitantesCorto(e.habitantes)}` : e.nombre;
      return { ...e, nodo, ancho: this.medidor.measureText(texto).width + (e.ciudad ? 13 : 6) };
    });
  }
  // Solo se recalcula cuando la vista cambió. Primero las regiones grandes; las que
  // chocan con otra se ocultan hasta que el zoom les abre sitio.
  actualizarEtiquetas() {
    const visibles = this.llegado && this.uOpacidad.value >= 1;
    if (!visibles) {
      for (const e of this.etiquetasDom) if (!e.nodo.hidden) e.nodo.hidden = true;
      return;
    }
    this.grupo.updateMatrixWorld();
    const m = new THREE.Matrix4()
      .multiplyMatrices(this.camara.projectionMatrix, this.camara.matrixWorldInverse)
      .multiply(this.grupo.matrixWorld).elements;
    const W = this.canvas.clientWidth,
      H = this.canvas.clientHeight;
    const ocupados = [];
    const margenDerecho = this.area.x + this.area.w + 16;
    // A escala de país, pocas etiquetas: el mapa y los focos van primero.
    const maximo = this.zoom >= 1.3 ? Infinity : this.poblaciones ? (W <= 720 ? 16 : 34) : W <= 720 ? 12 : 18;
    const enPantalla = (x, y) => {
      const w = m[3] * x + m[7] * y + m[15];
      return [(((m[0] * x + m[4] * y + m[12]) / w + 1) * W) / 2, ((1 - (m[1] * x + m[5] * y + m[13]) / w) * H) / 2];
    };
    for (const e of this.etiquetasDom) {
      const [x, sy] = enPantalla(e.x, e.y);
      let sx = x;
      if (e.ciudad) sx += e.ancho / 2 - 2.5;
      else {
        const borde = enPantalla(e.este, e.y)[0],
          opuesto = enPantalla(e.oeste, e.y)[0];
        // Región más estrecha que su nombre: se rotula a su lado, sobre el cielo.
        if (Math.abs(borde - opuesto) < e.ancho * 1.15) sx = Math.max(borde, opuesto) + e.ancho / 2 + 8;
      }
      const caja = { x0: sx - e.ancho / 2, x1: sx + e.ancho / 2, y0: sy - 9, y1: sy + 9 };
      const dentro = caja.x0 > 4 && caja.x1 < margenDerecho && caja.y0 > 56 && caja.y1 < this.area.y + this.area.h + 8;
      const libre =
        dentro &&
        ocupados.length < maximo &&
        !ocupados.some(o => caja.x0 < o.x1 + 6 && caja.x1 > o.x0 - 6 && caja.y0 < o.y1 && caja.y1 > o.y0);
      e.nodo.hidden = !libre;
      if (libre) {
        ocupados.push(caja);
        e.nodo.style.transform = `translate(${(sx - e.ancho / 2).toFixed(1)}px, ${(sy - 9).toFixed(1)}px)`;
      }
    }
  }

  // ---------- Ciclo de vida ----------
  // p es el avance ya suavizado del despegue: 0 sobre el globo, 1 en su sitio.
  entrar() {
    this.llegado = false;
    this.montar(this.detalle || construirGeometria(this.feature, triangular));
    this.reiniciarVista();
    this.activo = true;
    this.p = 0;
    this.uOpacidad.value = this.reduceMotion.matches ? 1 : 0;
    this.canvas.hidden = false;
    this.leyenda.hidden = false;
    this.medir();
    this.canvas.tabIndex = 0;
    this.ultimoTiempo = performance.now();
  }
  // Al aterrizar llega todo lo pesado: contorno detallado y terreno de 8K.
  llegar() {
    this.llegado = true;
    if (this.detalle && this.geometria !== this.detalle) this.montar(this.detalle);
    else {
      this.ponerMapa(this.geometria);
      this.pedirSatelite();
    }
    this.sucio = true;
  }
  // Cambio de país sin cerrar: solo un fundido corto, la pieza no vuelve a volar.
  cambiar(feature) {
    this.satelite.limpiar();
    this.datos = null;
    this.preparar(feature);
    this.montar(construirGeometria(feature, triangular));
    this.reiniciarVista();
    this.uOpacidad.value = this.reduceMotion.matches ? 1 : 0;
    this.uniformesPuntos.uAparicion.value = 0;
    this.medir();
  }
  salir() {
    this.llegado = false;
    this.seleccionPendiente = null;
    this.enfoque = null;
    this.quitarRelieve();
    this.satelite.cancelar();
    this.onPunto?.(null);
    this.sucio = true;
  }
  terminar() {
    this.satelite.limpiar();
    this.uDetalle.value = 0;
    this.satelite.uniforms.uSat.value = 0;
    this.activo = false;
    this.p = 0;
    this.canvas.hidden = true;
    this.leyenda.hidden = true;
    this.canvas.tabIndex = -1;
    this.limpiarPieza();
    this.geometria = null;
    this.detalle = null;
    this.datos = null;
    this.promesaDetalle = null;
    this.uniformesPuntos.uAparicion.value = 0;
    if (this.mapa !== this.mapaBase) {
      this.mapa.dispose();
      this.mapa = this.mapaBase;
      this.uMapa.value = this.mapa;
    }
    this.uCaja.value.set(0, 0, 1, 1);
    this.uAltoMapa.value = this.mapaBase.image.height;
  }
  reiniciarVista() {
    const estabaEnfocada = Boolean(this.vista);
    this.vista = null;
    this.enfoque = null;
    this.seleccionPendiente = null;
    this.localidades = [];
    if (estabaEnfocada) {
      this.quitarRelieve();
      if (this.geometria) this.crearEtiquetas(this.geometria);
      this.onVista?.(null);
    }
    this.giro = this.cabeceo = this.vGiro = this.vCabeceo = 0;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.ajustarTamano(this.filtro.visibles);
    this.sucio = true;
  }
  fijarLimbo(px) {
    this.limbo = px;
    this.medir();
  }
  medir() {
    if (!this.geometria) return;
    const { clientWidth: W, clientHeight: H } = this.canvas;
    if (!W || !H) return;
    this.renderer.setSize(W, H, false);
    this.uPantalla.value.set(W, H);
    const p = this.panel;
    const lateral = p.offsetLeft > W * 0.4;
    // El mapa tiene su propio espacio entre el borde del globo y el panel.
    if (lateral) {
      const x = this.limbo * 0.94;
      this.area = { x, y: 64, w: Math.max(200, p.offsetLeft - x - 24), h: H - 64 - 76 };
    } else {
      this.area = { x: 12, y: 96, w: W - 24, h: Math.max(120, H * 0.6 - 96 - 16) };
    }
    this.leyenda.style.left = `${Math.round(lateral ? Math.max(this.area.x, 88) : 16)}px`;
    this.mpp = (2 * DISTANCIA * Math.tan(THREE.MathUtils.degToRad(this.cameraGlobo.fov / 2))) / H;
    const { ancho, alto, grosor } = this.geometria;
    const inclinado = alto * Math.cos(INCLINACION) + grosor * Math.abs(Math.sin(INCLINACION));
    this.escalaFinal = Math.min((this.area.w * this.mpp) / ancho, (this.area.h * this.mpp) / inclinado) * 0.92;
    this.uPR.value = this.renderer.getPixelRatio();
    this.colocarAtribucion();
    if (this.vista) this.encuadrarVista(false);
    this.aplicarFiltro();
    this.sucio = true;
  }
  calcularObjetivo() {
    const { clientWidth: W, clientHeight: H } = this.canvas;
    const cx = this.area.x + this.area.w / 2 + this.pan.x,
      cy = this.area.y + this.area.h / 2 + this.pan.y;
    const rayo = new THREE.Vector3((cx / W) * 2 - 1, 1 - (cy / H) * 2, 0.5)
      .unproject(this.camara)
      .sub(this.camara.position)
      .normalize();
    const frente = new THREE.Vector3();
    this.camara.getWorldDirection(frente);
    this.objetivo.copy(this.camara.position).addScaledVector(rayo, DISTANCIA / rayo.dot(frente));
  }
  update(p, enVuelo) {
    if (!this.activo || !this.geometria) return;
    const ahora = performance.now();
    const dt = Math.min(0.25, (ahora - this.ultimoTiempo) / 1000);
    this.ultimoTiempo = ahora;
    if (this.uOpacidad.value < 1) {
      this.uOpacidad.value = Math.min(1, this.uOpacidad.value + dt / 0.22);
      this.sucio = true;
    }
    if (this.punteros.size === 0 && (Math.abs(this.vGiro) > 0.002 || Math.abs(this.vCabeceo) > 0.002)) {
      this.giro += this.vGiro * dt;
      this.cabeceo += this.vCabeceo * dt;
      const freno = Math.exp(-dt * 3.5);
      this.vGiro *= freno;
      this.vCabeceo *= freno;
      this.sucio = true;
    }
    const aparicion = this.uniformesPuntos.uAparicion;
    const destino = this.llegado && this.puntos ? 1 : 0;
    if (aparicion.value !== destino) {
      aparicion.value = this.reduceMotion.matches
        ? destino
        : THREE.MathUtils.clamp(
            aparicion.value + (Math.sign(destino - aparicion.value) * dt) / (destino ? 0.4 : 0.14),
            0,
            1,
          );
      this.sucio = true;
    }
    if (this.enfoque) {
      const { inicio, zoom, pan, destino } = this.enfoque;
      const avance = suaveRango(0, 1, (ahora - inicio) / 450);
      this.zoom = THREE.MathUtils.lerp(zoom, destino.zoom, avance);
      this.pan.x = THREE.MathUtils.lerp(pan.x, destino.pan.x, avance);
      this.pan.y = THREE.MathUtils.lerp(pan.y, destino.pan.y, avance);
      this.ajustarTamano(this.filtro.visibles);
      if (avance === 1) this.enfoque = null;
      this.sucio = true;
    }
    // Detalle satelital: el modo y la imagen entran con un fundido corto. Sin imagen
    // (proveedor caído), el modo sigue activo sobre el mapa base.
    const fundir = (u, destino, duracion) => {
      if (u.value === destino) return;
      u.value = this.reduceMotion.matches
        ? destino
        : THREE.MathUtils.clamp(u.value + (Math.sign(destino - u.value) * dt) / duracion, 0, 1);
      this.sucio = true;
    };
    fundir(this.uDetalle, this.satelital && this.llegado ? 1 : 0, 0.25);
    fundir(this.satelite.uniforms.uSat, this.satelital && this.llegado && this.satelite.hayImagen() ? 1 : 0, 0.35);
    // La imagen de la zona visible se pide cuando la vista se detiene, no a cada fotograma.
    if (this.satPendiente && !this.enfoque && !this.punteros.size && ahora - this.vistaCambio > 220) {
      this.satPendiente = false;
      this.pedirSatelite();
    }
    // Quieto, el mapa no se vuelve a dibujar: libera la GPU para las nubes del globo.
    if (!enVuelo && !this.sucio) return;
    this.camara.copy(this.cameraGlobo);
    this.camara.updateMatrixWorld();
    this.camara.updateProjectionMatrix();
    this.calcularObjetivo();
    this.p = p;
    this.cabeceo = THREE.MathUtils.clamp(this.cabeceo, -1, 0.3);
    // De cerca el mapa se endereza para poder leer las regiones.
    const plano = suaveRango(1.1, 2.2, this.zoom);
    const inclinacion = this.vista ? 0 : THREE.MathUtils.lerp(INCLINACION, -0.02, plano);
    this.q0.copy(this.globe.quaternion).multiply(this.base);
    this.qFinal
      .copy(this.camara.quaternion)
      .multiply(this.qAux.setFromAxisAngle(this.ejeX, inclinacion + this.cabeceo))
      .multiply(this.qAux.setFromAxisAngle(this.ejeZ, this.giro));
    this.grupo.quaternion.slerpQuaternions(this.q0, this.qFinal, p);
    this.grupo.position.set(0, 0, 0).lerp(this.objetivo, p);
    const escala = THREE.MathUtils.lerp(1, this.escalaFinal * this.zoom, p);
    // El grosor no crece con el acercamiento a una región o ciudad.
    const grosor = this.vista ? this.escalaFinal * 0.06 : escala * THREE.MathUtils.lerp(1, 0.06, plano);
    this.grupo.scale.set(escala, escala, grosor);
    this.leyenda.classList.toggle('apartada', this.zoom > 1.2);
    this.uMorph.value = p;
    this.uPxPorMetro.value = ((escala / this.mpp) * this.uPR.value) / 6371000;
    this.renderer.render(this.scene, this.camara);
    this.actualizarEtiquetas();
    this.onDibujo?.();
    this.sucio = false;
    if (this.satelital && this.llegado) {
      const W = this.canvas.clientWidth,
        H = this.canvas.clientHeight;
      const firma = `${this.zoom.toFixed(3)}|${Math.round(this.pan.x)}|${Math.round(this.pan.y)}|${this.giro.toFixed(3)}|${this.cabeceo.toFixed(3)}|${W}x${H}|${p}`;
      if (firma !== this.firmaVista) {
        this.firmaVista = firma;
        this.vistaCambio = ahora;
        this.satPendiente = true;
      }
    }
  }

  // ---------- Manipulación ----------
  // ---------- Poblaciones y área ----------
  ponerPoblaciones(lista) {
    this.poblaciones = lista?.length ? lista : null;
    if (this.geometria) this.crearEtiquetas(this.geometria);
    this.sucio = true;
  }
  activarArea(activo) {
    this.modoArea = activo;
    this.arrastreArea = null;
    this.canvas.classList.toggle('modo-area', activo);
  }
  // Matriz y medidas para pasar de la pieza a píxeles del lienzo.
  proyectorPantalla() {
    const rect = this.canvas.getBoundingClientRect();
    this.grupo.updateMatrixWorld();
    const m = new THREE.Matrix4()
      .multiplyMatrices(this.camara.projectionMatrix, this.camara.matrixWorldInverse)
      .multiply(this.grupo.matrixWorld).elements;
    return (a, b, c = 0) => {
      const w = m[3] * a + m[7] * b + m[11] * c + m[15];
      return [
        rect.left + (((m[0] * a + m[4] * b + m[8] * c + m[12]) / w + 1) * rect.width) / 2,
        rect.top + ((1 - (m[1] * a + m[5] * b + m[9] * c + m[13]) / w) * rect.height) / 2,
      ];
    };
  }
  // Longitud y latitud → píxeles de la ventana, con la vista actual.
  proyectorGeo() {
    const g = this.geometria;
    if (!g) return null;
    const enPantalla = this.proyectorPantalla();
    return (lon, lat) => {
      const [x, y] = proyectar(g.marco, lon, lat);
      return enPantalla(x - g.cx, y - g.cy);
    };
  }
  // Cuenta los focos visibles (mismos filtros que el mapa) dentro de un polígono de [lon, lat].
  contarEnPoligono(geo) {
    const p = this.datosPuntos,
      g = this.geometria;
    if (!p || !g || !geo || geo.length < 3) return null;
    const enPantalla = this.proyectorPantalla();
    const aPantalla = this.proyectorGeo();
    const poli = geo.map(([lon, lat]) => aPantalla(lon, lat));
    const ax = Math.min(...poli.map(v => v[0])),
      bx = Math.max(...poli.map(v => v[0])),
      ay = Math.min(...poli.map(v => v[1])),
      by = Math.max(...poli.map(v => v[1]));
    const dentro = (sx, sy) => sx >= ax && sx <= bx && sy >= ay && sy <= by && dentroDePoligono(poli, sx, sy);
    const f = this.filtro,
      u = this.uniformesPuntos.uSensores.value,
      enRegion = this.uniformesPuntos.uRegion.value;
    const { plano, dia, sensor, registros, region } = p;
    let modis = 0,
      viirs = 0,
      frpMax = 0;
    // Serie armonizada por zonas: cada zona aporta su valor según la fracción de sus puntos que cae dentro.
    const porCelda = new Map();
    for (let i = 0; i < registros.length; i++) {
      const r = registros[i];
      if (!r.celda && (dia[i] < f.ini - f.cola || dia[i] > f.fin || (sensor[i] < 0.5 ? u.x : u.y) === 0)) continue;
      if (enRegion !== -1 && region?.[i] !== enRegion) continue;
      const [sx, sy] = enPantalla(plano[i * 3], plano[i * 3 + 1], plano[i * 3 + 2]);
      const esta = dentro(sx, sy);
      if (r.celda) {
        const c = porCelda.get(r.idCelda) ?? { dentro: 0, total: 0, valor: r.valor };
        c.total++;
        if (esta) c.dentro++;
        porCelda.set(r.idCelda, c);
        continue;
      }
      if (!esta) continue;
      if (sensor[i] < 0.5) modis++;
      else viirs++;
      if (r.frp > frpMax) frpMax = r.frp;
    }
    let armonizado = null;
    if (porCelda.size) {
      armonizado = 0;
      for (const c of porCelda.values()) armonizado += (c.valor * c.dentro) / c.total;
    }
    const { km2, centro } = medidasArea(geo);
    const poblaciones = (this.listaPoblaciones ?? [])
      .filter(([, lon, lat]) => !fueraDePieza(g.marco, lon, lat))
      .filter(([, lon, lat]) => {
        const [x, y] = proyectar(g.marco, lon, lat);
        return dentro(...enPantalla(x - g.cx, y - g.cy));
      });
    return { modis, viirs, frpMax, armonizado, km2, poblaciones, centro };
  }

  escucharPunteros() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => {
      if (!this.llegado || e.button !== 0) return;
      if (this.modoArea) {
        c.setPointerCapture(e.pointerId);
        this.arrastreArea = { id: e.pointerId };
        this.onPunto?.(null);
        this.onAreaPuntero?.('baja', e);
        return;
      }
      this.enfoque = null;
      c.setPointerCapture(e.pointerId);
      this.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY });
      this.vGiro = this.vCabeceo = 0;
      this.distanciaPinza = null;
      c.classList.add('arrastrando');
      this.onPunto?.(null);
    });
    c.addEventListener('pointermove', e => {
      if (this.modoArea) {
        this.onAreaPuntero?.(this.arrastreArea?.id === e.pointerId ? 'arrastra' : 'flota', e);
        return;
      }
      const p = this.punteros.get(e.pointerId);
      if (!p) {
        if (e.pointerType !== 'touch') this.buscarPunto(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - p.x,
        dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.punteros.size === 2) {
        const [a, b] = [...this.punteros.values()];
        const distancia = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.distanciaPinza) this.acercar(distancia / this.distanciaPinza, (a.x + b.x) / 2, (a.y + b.y) / 2);
        this.distanciaPinza = distancia;
      } else if (this.zoom > 1.2) {
        this.pan.x += dx;
        this.pan.y += dy;
        this.limitarPan();
      } else {
        this.giro += dx * 0.004;
        this.cabeceo += dy * 0.003;
        this.vGiro = dx * 0.16;
        this.vCabeceo = dy * 0.1;
      }
      this.sucio = true;
    });
    const soltar = e => {
      const a = this.arrastreArea;
      if (a && a.id === e.pointerId) {
        this.arrastreArea = null;
        this.onAreaPuntero?.(e.type === 'pointercancel' ? 'cancela' : 'sube', e);
        return;
      }
      const p = this.punteros.get(e.pointerId);
      const toque =
        p && e.type === 'pointerup' && this.punteros.size === 1 && Math.hypot(e.clientX - p.ox, e.clientY - p.oy) < 8;
      this.punteros.delete(e.pointerId);
      this.distanciaPinza = null;
      if (toque) {
        this.ultimoPick = 0;
        const x = e.clientX,
          y = e.clientY;
        if (!this.vista || !this.buscarPunto(x, y)) {
          this.seleccionarEn(x, y).then(elegida => {
            if (!elegida && e.pointerType === 'touch') this.buscarPunto(x, y);
          });
        }
      }
      if (!this.punteros.size) c.classList.remove('arrastrando');
    };
    c.addEventListener('pointerup', soltar);
    c.addEventListener('pointercancel', soltar);
    c.addEventListener('pointerleave', () => this.onPunto?.(null));
    c.addEventListener(
      'wheel',
      e => {
        if (!this.llegado) return;
        e.preventDefault();
        this.acercar(Math.exp(-e.deltaY * 0.0014), e.clientX, e.clientY);
        this.onVistaMovida?.();
      },
      { passive: false },
    );
    c.addEventListener('dblclick', () => {
      if (this.modoArea) {
        this.onAreaPuntero?.('doble', e);
        return;
      }
      this.reiniciarVista();
      this.onVistaMovida?.();
    });
    c.addEventListener('keydown', e => {
      const paso = { ArrowLeft: [-0.09, 0], ArrowRight: [0.09, 0], ArrowUp: [0, -0.07], ArrowDown: [0, 0.07] }[e.key];
      if (paso) {
        e.preventDefault();
        this.giro += paso[0];
        this.cabeceo += paso[1];
        this.sucio = true;
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        this.acercar(1.2);
      }
      if (e.key === '-') {
        e.preventDefault();
        this.acercar(1 / 1.2);
      }
    });
  }
  // Acerca hacia el cursor: así se puede recorrer un país largo como Chile.
  acercar(factor, x, y) {
    this.enfoque = null;
    // Si al apagar el detalle el zoom quedó por encima del tope, se conserva y solo
    // se puede alejar: así el interruptor nunca mueve la vista.
    const nuevo = THREE.MathUtils.clamp(this.zoom * factor, 0.7, Math.max(this.zoomMaximo(), this.zoom));
    const real = nuevo / this.zoom;
    if (x !== undefined) {
      const rect = this.canvas.getBoundingClientRect();
      const ax = this.area.x + this.area.w / 2 + this.pan.x,
        ay = this.area.y + this.area.h / 2 + this.pan.y;
      this.pan.x += (x - rect.left - ax) * (1 - real);
      this.pan.y += (y - rect.top - ay) * (1 - real);
    }
    this.zoom = nuevo;
    if (nuevo <= 1) this.pan = { x: 0, y: 0 };
    this.limitarPan();
    this.ajustarTamano(this.filtro.visibles);
    this.sucio = true;
  }
  limitarPan() {
    const margenX = this.area.w * 0.5 * this.zoom,
      margenY = this.area.h * 0.55 * this.zoom;
    this.pan.x = THREE.MathUtils.clamp(this.pan.x, -margenX, margenX);
    this.pan.y = THREE.MathUtils.clamp(this.pan.y, -margenY, margenY);
  }
  buscarPunto(x, y) {
    if (!this.llegado || !this.datosPuntos) return;
    const ahora = performance.now();
    if (ahora - this.ultimoPick < 45) return;
    this.ultimoPick = ahora;
    const rect = this.canvas.getBoundingClientRect();
    const px = x - rect.left,
      py = y - rect.top,
      W = rect.width,
      H = rect.height;
    const m = new THREE.Matrix4()
      .multiplyMatrices(this.camara.projectionMatrix, this.camara.matrixWorldInverse)
      .multiply(this.grupo.matrixWorld).elements;
    const { plano, dia, sensor, registros, origen, region } = this.datosPuntos;
    const f = this.filtro,
      u = this.uniformesPuntos.uSensores.value,
      enRegion = this.uniformesPuntos.uRegion.value;
    // Con cuadrados grandes (huella real a mucho zoom) vale todo el cuadrado.
    const radio = s => {
      if (!this.satelital) return 14;
      const lado =
        THREE.MathUtils.clamp((s < 0.5 ? 1000 : 375) * this.uPxPorMetro.value, this.uTamMin.value, this.uTamMax.value) /
        this.uPR.value;
      return Math.max(14, lado * 0.71);
    };
    const radios = [radio(0) ** 2, radio(1) ** 2];
    let mejor = -1,
      distancia = Infinity;
    for (let i = 0; i < registros.length; i++) {
      if (dia[i] < f.ini - f.cola || dia[i] > f.fin || (sensor[i] < 0.5 ? u.x : u.y) === 0) continue;
      if (enRegion !== -1 && region?.[i] !== enRegion) continue;
      const a = plano[i * 3],
        b = plano[i * 3 + 1],
        c = plano[i * 3 + 2];
      const w = m[3] * a + m[7] * b + m[11] * c + m[15];
      const sx = (((m[0] * a + m[4] * b + m[8] * c + m[12]) / w + 1) * W) / 2;
      const sy = ((1 - (m[1] * a + m[5] * b + m[9] * c + m[13]) / w) * H) / 2;
      const d = (sx - px) ** 2 + (sy - py) ** 2;
      if (d < distancia && d < radios[sensor[i] < 0.5 ? 0 : 1]) {
        distancia = d;
        mejor = i;
      }
    }
    this.onPunto?.(mejor < 0 ? null : registros[mejor], x, y, mejor < 0 ? -1 : origen[mejor]);
    return mejor >= 0;
  }
}
