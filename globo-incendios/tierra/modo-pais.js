import * as THREE from 'three';
import { construirGeometria, construirPuntos } from './pieza-geo.js';

// El mapa del país se dibuja en su propio lienzo, sobre el globo. El pase de nubes
// no cambia y el globo sigue vivo al lado. La cámara del mapa copia la del globo,
// de modo que el país despega exactamente desde donde está en el planeta.
const INCLINACION = -.3;
const DISTANCIA = 3;
const aVectores = puntos => puntos.map(p => new THREE.Vector2(p.x, p.y));
const triangular = (contorno, huecos) => THREE.ShapeUtils.triangulateShape(aVectores(contorno), huecos.map(aVectores));
const suaveRango = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const verticePieza = /* glsl */`
  attribute vec3 aEsfera;
  attribute float aLado;
  uniform float uMorph;
  varying vec3 vEsfera;
  varying float vLado;
  varying vec3 vNormal;
  void main() {
    vEsfera = aEsfera;
    vLado = aLado;
    vec3 n = aLado < .5 ? mix(normalize(aEsfera), normal, uMorph) : normal;
    vNormal = normalize(normalMatrix * n);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(mix(aEsfera, position, uMorph), 1.0);
  }`;
const fragmentoPieza = /* glsl */`
  uniform sampler2D uMapa;
  uniform mat3 uBase;
  uniform float uMorph, uOpacidad, uAltoMapa;
  uniform vec4 uCaja;
  varying vec3 vEsfera;
  varying float vLado;
  varying vec3 vNormal;
  const float PI = 3.14159265;
  void main() {
    vec3 color;
    float luz = clamp(dot(normalize(vNormal), normalize(vec3(-.35, .55, .75))), 0.0, 1.0);
    if (vLado < .5) {
      vec3 d = normalize(uBase * vEsfera);
      float v = asin(clamp(d.y, -1.0, 1.0)) / PI + .5;
      vec2 uv = vec2(fract(atan(-d.z, d.x) / (2.0 * PI) + .5 - uCaja.x) / uCaja.z, (v - uCaja.y) / uCaja.w);
      // El nivel de detalle sale de la latitud, continua incluso en el antimeridiano.
      float nivel = max(0.0, log2(max(fwidth(v), 1e-6) * uAltoMapa));
      vec3 mapa = textureLod(uMapa, uv, nivel).rgb;
      float gris = dot(mapa, vec3(.299, .587, .114));
      // Terreno contenido: el color intenso queda reservado para los focos.
      vec3 sobrio = mix(vec3(gris), mapa, .62) * vec3(.6, .7, .78) + vec3(.012, .03, .05);
      color = mix(mapa, sobrio, uMorph) * (.8 + .24 * luz);
    } else if (vLado < 2.5) {
      color = mix(vec3(.16, .3, .42), vec3(.03, .085, .14), vLado - 1.0) * (.6 + .55 * luz);
    } else color = vec3(.02, .055, .09);
    gl_FragColor = vec4(color, uOpacidad);
  }`;
// Líneas de grosor fijo en píxeles: a cualquier zoom la costa sigue nítida.
const verticeLinea = /* glsl */`
  attribute vec3 iPlanoA, iPlanoB, iEsferaA, iEsferaB;
  uniform float uMorph, uAncho;
  uniform vec2 uPantalla;
  varying float vBorde;
  void main() {
    vec4 a = projectionMatrix * modelViewMatrix * vec4(mix(iEsferaA, iPlanoA, uMorph), 1.0);
    vec4 b = projectionMatrix * modelViewMatrix * vec4(mix(iEsferaB, iPlanoB, uMorph), 1.0);
    vec2 pa = a.xy / a.w * uPantalla, pb = b.xy / b.w * uPantalla;
    vec2 tramo = pb - pa;
    float largo = max(length(tramo), 1e-4);
    vec2 normal = vec2(-tramo.y, tramo.x) / largo;
    vec4 base = position.x < .5 ? a : b;
    vBorde = position.y;
    base.xy += normal * position.y * (uAncho + 1.0) / uPantalla * base.w;
    base.z -= .0004 * base.w;
    gl_Position = base;
  }`;
const fragmentoLinea = /* glsl */`
  uniform vec3 uColor;
  uniform float uAlfa, uAncho, uOpacidad;
  varying float vBorde;
  void main() {
    float d = abs(vBorde) * (uAncho + 1.0);
    gl_FragColor = vec4(uColor, uAlfa * uOpacidad * (1.0 - smoothstep(uAncho - .5, uAncho + .5, d)));
  }`;
const verticePuntos = /* glsl */`
  attribute vec3 aEsfera;
  attribute float aDia, aFrp, aSensor;
  uniform float uMorph, uDiaIni, uDiaFin, uCola, uTamano, uAparicion;
  uniform vec2 uSensores;
  varying float vFrp, vFuerza;
  void main() {
    float activo = aSensor < .5 ? uSensores.x : uSensores.y;
    float dentro = step(uDiaIni - uCola, aDia) * step(aDia, uDiaFin) * activo;
    float cola = uCola > 0.0 && aDia < uDiaIni ? 1.0 - (uDiaIni - aDia) / (uCola + 1.0) : 1.0;
    vFrp = aFrp;
    vFuerza = cola * uAparicion;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(mix(aEsfera, position, uMorph), 1.0);
    gl_PointSize = dentro * uTamano * (1.8 + 7.0 * aFrp) * (.55 + .45 * cola) * (.6 + .4 * uAparicion);
    // Tamaño 0 no basta: muchas GPU dibujan igual un punto de 1 píxel. Se saca de la vista.
    if (dentro < .5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }`;
const fragmentoPuntos = /* glsl */`
  uniform float uIntensidad;
  varying float vFrp, vFuerza;
  void main() {
    float d = length(gl_PointCoord - .5) * 2.0;
    if (d > 1.0 || vFuerza <= 0.0) discard;
    float halo = exp(-d * d * 3.6);
    float nucleo = smoothstep(.42, 0.0, d);
    vec3 calor = mix(vec3(1.0, .28, .07), vec3(1.0, .66, .2), smoothstep(.15, .55, vFrp));
    calor = mix(calor, vec3(1.0, .92, .68), smoothstep(.55, .95, vFrp));
    gl_FragColor = vec4(calor + nucleo * .35, halo * uIntensidad * vFuerza);
  }`;

const cuadro = () => {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
  return g;
};

export class ModoPais {
  constructor({ canvas, stage, camera, globe, imagenMapa, panel, capaEtiquetas, leyenda, reduceMotion, onPunto }) {
    Object.assign(this, { canvas, stage, cameraGlobo: camera, globe, panel, capaEtiquetas, leyenda, reduceMotion, onPunto });
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
    this.uMapa = { value: this.mapa };
    this.uPantalla = { value: new THREE.Vector2(1, 1) };
    this.uniformesPuntos = {
      uMorph: this.uMorph, uDiaIni: { value: 0 }, uDiaFin: { value: 365 }, uCola: { value: 0 },
      uTamano: { value: 1 }, uAparicion: { value: 0 }, uSensores: { value: new THREE.Vector2(1, 1) }, uIntensidad: { value: 1 },
    };
    this.p = 0; this.activo = false; this.llegado = false; this.sucio = true;
    this.giro = 0; this.cabeceo = 0; this.vGiro = 0; this.vCabeceo = 0; this.zoom = 1; this.pan = { x: 0, y: 0 };
    this.punteros = new Map(); this.ultimoPick = 0; this.ultimoTiempo = 0; this.limbo = 0;
    this.base = new THREE.Quaternion(); this.q0 = new THREE.Quaternion(); this.qFinal = new THREE.Quaternion(); this.qAux = new THREE.Quaternion();
    this.objetivo = new THREE.Vector3(); this.escalaFinal = 1; this.filtro = { ini: 0, fin: 365, sensor: 'todos', cola: 0, visibles: 1000 };
    this.ejeX = new THREE.Vector3(1, 0, 0); this.ejeZ = new THREE.Vector3(0, 0, 1);
    this.medidor = document.createElement('canvas').getContext('2d');
    this.etiquetasDom = [];
    this.pedido = 0;
    this.respuestas = new Map();
    this.uBase = { value: new THREE.Matrix3() };
    this.materialPieza = new THREE.ShaderMaterial({
      vertexShader: verticePieza, fragmentShader: fragmentoPieza, transparent: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      uniforms: { uMapa: this.uMapa, uBase: this.uBase, uMorph: this.uMorph, uOpacidad: this.uOpacidad, uCaja: this.uCaja, uAltoMapa: this.uAltoMapa },
    });
    this.materialCosta = this.crearMaterialLinea(new THREE.Color(.95, .98, 1), .78, 1);
    this.materialLimite = this.crearMaterialLinea(new THREE.Color(.92, .96, 1), .46, .8);
    this.materialPuntos = new THREE.ShaderMaterial({
      vertexShader: verticePuntos, fragmentShader: fragmentoPuntos, uniforms: this.uniformesPuntos,
      // Sin prueba de profundidad: los focos están sobre la superficie y, con la pieza
      // aplanada al acercar, la precisión no alcanza para distinguirlos de ella.
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    this.worker = new Worker(new URL('./cartografia-worker.js?v=1', import.meta.url), { type: 'module' });
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
      vertexShader: verticeLinea, fragmentShader: fragmentoLinea, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {
        uMorph: this.uMorph, uOpacidad: this.uOpacidad, uPantalla: this.uPantalla, uColor: { value: color }, uAlfa: { value: alfa }, uAncho: { value: ancho },
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
    for (const [nombre, tam] of [['position', 3], ['aEsfera', 3], ['normal', 3], ['aLado', 1]]) pieza.setAttribute(nombre, atributo(3, tam));
    const puntos = new THREE.BufferGeometry();
    for (const [nombre, tam] of [['position', 3], ['aEsfera', 3], ['aDia', 1], ['aFrp', 1], ['aSensor', 1]]) puntos.setAttribute(nombre, atributo(3, tam));
    const linea = cuadro();
    for (const nombre of ['iPlanoA', 'iPlanoB', 'iEsferaA', 'iEsferaB']) linea.setAttribute(nombre, new THREE.InstancedBufferAttribute(new Float32Array(3), 3));
    linea.instanceCount = 1;
    const objetos = [new THREE.Mesh(pieza, this.materialPieza), new THREE.Mesh(linea, this.materialCosta), new THREE.Points(puntos, this.materialPuntos)];
    objetos.forEach(o => { o.frustumCulled = false; escena.add(o); });
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
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
      .then(b => createImageBitmap(b))
      .catch(error => { console.warn('Mapa de 8K no disponible:', error); return null; });
    return this.promesaMapa;
  }
  async ponerMapa(geometria) {
    const imagen = await this.cargarMapaDetalle();
    if (!imagen || geometria !== this.geometria) return;
    const { oeste, ancho, sur, norte } = geometria.caja;
    const W = imagen.width, H = imagen.height;
    const maximo = this.renderer.capabilities.maxTextureSize;
    const lienzo = document.createElement('canvas');
    const sw = Math.ceil(ancho / 360 * W), sh = Math.ceil((norte - sur) / 180 * H);
    const factor = Math.min(1, maximo / Math.max(sw, sh));
    lienzo.width = Math.round(sw * factor); lienzo.height = Math.round(sh * factor);
    // En memoria, no en la GPU: el recorte no debe competir con el dibujado.
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    const sx = (((oeste + 180) / 360 * W) % W + W) % W, sy = (90 - norte) / 180 * H;
    ctx.scale(factor, factor);
    ctx.drawImage(imagen, sx, sy, Math.min(sw, W - sx), sh, 0, 0, Math.min(sw, W - sx), sh);
    if (sx + sw > W) ctx.drawImage(imagen, 0, sy, sx + sw - W, sh, W - sx, 0, sx + sw - W, sh);
    const anterior = this.mapa;
    this.mapa = this.crearTextura(lienzo, true);
    this.uMapa.value = this.mapa;
    this.uAltoMapa.value = lienzo.height / ((norte - sur) / 180);
    this.uCaja.value.set((((oeste + 180) / 360) % 1 + 1) % 1, (sur + 90) / 180, ancho / 360, (norte - sur) / 180);
    if (anterior !== this.mapaBase) anterior.dispose();
    this.sucio = true;
  }

  // ---------- Construcción ----------
  // El detalle se calcula en el worker. Si aún no llegó al despegar, se muestra el
  // contorno general (1:50m) y se sustituye en cuanto el detallado esté listo.
  preparar(feature) {
    this.feature = feature;
    this.detalle = null;
    const promesa = this.consultar({ tipo: 'detalle', id: feature.id }).then(respuesta => {
      if (promesa !== this.promesaDetalle) return null;
      if (respuesta.error) { console.warn('Cartografía detallada no disponible:', respuesta.error); return null; }
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
      g.marco.este[0], g.marco.norte[0], g.marco.centro[0],
      g.marco.este[1], g.marco.norte[1], g.marco.centro[1],
      g.marco.este[2], g.marco.norte[2], g.marco.centro[2],
    );
    this.base.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...g.marco.este), new THREE.Vector3(...g.marco.norte), new THREE.Vector3(...g.marco.centro),
    ));
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
    if (this.llegado) this.ponerMapa(g);
    if (this.datos) this.ponerPuntos(this.datos);
    this.sucio = true;
  }
  crearLineas(plano, esfera, material) {
    if (!plano.length) return null;
    const g = cuadro();
    const instancias = plano.length / 6;
    const dividir = (fuente, nombreA, nombreB) => {
      const a = new Float32Array(instancias * 3), b = new Float32Array(instancias * 3);
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
      if (objeto) { this.grupo.remove(objeto); objeto.geometry.dispose(); }
    }
    this.malla = null; this.lineas = [];
    this.quitarPuntos(false);
    this.capaEtiquetas.replaceChildren();
    this.etiquetasDom = [];
  }
  quitarPuntos(olvidar = true) {
    if (this.puntos) { this.grupo.remove(this.puntos); this.puntos.geometry.dispose(); }
    this.puntos = null; this.datosPuntos = null;
    if (olvidar) this.datos = null;
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
    this.puntos = new THREE.Points(geo, this.materialPuntos);
    this.puntos.frustumCulled = false;
    this.puntos.renderOrder = 2;
    this.grupo.add(this.puntos);
    this.aplicarFiltro();
    this.sucio = true;
    return p.omitidos;
  }
  // Región de cada registro, en segundo plano. Llega cuando esté lista.
  async regionesDe(datos, id) {
    const lons = Float32Array.from(datos.registros, r => r.lon), lats = Float32Array.from(datos.registros, r => r.lat);
    const respuesta = await this.consultar({ tipo: 'regiones', id, lons, lats }, [lons.buffer, lats.buffer]);
    if (respuesta.error) { console.warn('Regiones no disponibles:', respuesta.error); return null; }
    return respuesta.indices;
  }
  filtrar(filtro) { Object.assign(this.filtro, filtro); this.aplicarFiltro(); }
  aplicarFiltro() {
    const u = this.uniformesPuntos, f = this.filtro;
    u.uDiaIni.value = f.ini; u.uDiaFin.value = f.fin; u.uCola.value = f.cola;
    u.uSensores.value.set(f.sensor === 'VIIRS' ? 0 : 1, f.sensor === 'MODIS' ? 0 : 1);
    this.ajustarTamano(f.visibles);
    this.sucio = true;
  }
  // Muchos puntos juntos saturarían a blanco; pocos deben seguir siendo visibles.
  ajustarTamano(visibles) {
    const u = this.uniformesPuntos, escala = this.renderer.getPixelRatio();
    const densidad = Math.log10(Math.max(visibles, 1));
    const espacio = THREE.MathUtils.clamp(Math.min(this.area?.w ?? 700, this.area?.h ?? 700) / 620, .42, 1);
    const acercado = THREE.MathUtils.clamp(Math.pow(this.zoom, .35), 1, 2);
    u.uTamano.value = escala * espacio * acercado * THREE.MathUtils.clamp(1.9 - densidad * .27, .72, 1.9);
    u.uIntensidad.value = THREE.MathUtils.clamp(1.4 - densidad * .27, .16, 1) * Math.sqrt(espacio);
  }

  // ---------- Etiquetas de región ----------
  crearEtiquetas(g) {
    this.capaEtiquetas.replaceChildren();
    this.medidor.font = '600 12px Atlas, Arial, sans-serif';
    this.etiquetasDom = [...g.etiquetas].sort((a, b) => b.area - a.area).map(e => {
      const nodo = document.createElement('span');
      nodo.className = 'etiqueta-region';
      nodo.textContent = e.nombre;
      nodo.hidden = true;
      this.capaEtiquetas.append(nodo);
      return { ...e, nodo, ancho: this.medidor.measureText(e.nombre).width + 6 };
    });
  }
  // Solo se recalcula cuando la vista cambió. Primero las regiones grandes; las que
  // chocan con otra se ocultan hasta que el zoom les abre sitio.
  actualizarEtiquetas() {
    const visibles = this.llegado && this.uOpacidad.value >= 1;
    if (!visibles) { for (const e of this.etiquetasDom) if (!e.nodo.hidden) e.nodo.hidden = true; return; }
    this.grupo.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(this.camara.projectionMatrix, this.camara.matrixWorldInverse).multiply(this.grupo.matrixWorld).elements;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const ocupados = [];
    const margenDerecho = this.area.x + this.area.w + 16;
    // A escala de país, pocas etiquetas: el mapa y los focos van primero.
    const maximo = this.zoom >= 1.3 ? Infinity : W <= 720 ? 12 : 18;
    const enPantalla = (x, y) => {
      const w = m[3] * x + m[7] * y + m[15];
      return [((m[0] * x + m[4] * y + m[12]) / w + 1) * W / 2, (1 - (m[1] * x + m[5] * y + m[13]) / w) * H / 2];
    };
    for (const e of this.etiquetasDom) {
      let [sx, sy] = enPantalla(e.x, e.y);
      const borde = enPantalla(e.este, e.y)[0], opuesto = enPantalla(e.oeste, e.y)[0];
      // Región más estrecha que su nombre: se rotula a su lado, sobre el cielo.
      if (Math.abs(borde - opuesto) < e.ancho * 1.15) sx = Math.max(borde, opuesto) + e.ancho / 2 + 8;
      const caja = { x0: sx - e.ancho / 2, x1: sx + e.ancho / 2, y0: sy - 9, y1: sy + 9 };
      const dentro = caja.x0 > 4 && caja.x1 < margenDerecho && caja.y0 > 56 && caja.y1 < this.area.y + this.area.h + 8;
      const libre = dentro && ocupados.length < maximo && !ocupados.some(o => caja.x0 < o.x1 + 6 && caja.x1 > o.x0 - 6 && caja.y0 < o.y1 && caja.y1 > o.y0);
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
    this.activo = true; this.p = 0;
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
    else this.ponerMapa(this.geometria);
    this.sucio = true;
  }
  // Cambio de país sin cerrar: solo un fundido corto, la pieza no vuelve a volar.
  cambiar(feature) {
    this.preparar(feature);
    this.montar(construirGeometria(feature, triangular));
    this.reiniciarVista();
    this.uOpacidad.value = this.reduceMotion.matches ? 1 : 0;
    this.uniformesPuntos.uAparicion.value = 0;
    this.medir();
  }
  salir() { this.llegado = false; this.onPunto?.(null); this.sucio = true; }
  terminar() {
    this.activo = false; this.p = 0; this.canvas.hidden = true; this.leyenda.hidden = true; this.canvas.tabIndex = -1;
    this.limpiarPieza(); this.geometria = null; this.detalle = null; this.datos = null; this.promesaDetalle = null;
    this.uniformesPuntos.uAparicion.value = 0;
    if (this.mapa !== this.mapaBase) { this.mapa.dispose(); this.mapa = this.mapaBase; this.uMapa.value = this.mapa; }
    this.uCaja.value.set(0, 0, 1, 1); this.uAltoMapa.value = this.mapaBase.image.height;
  }
  reiniciarVista() {
    this.giro = this.cabeceo = this.vGiro = this.vCabeceo = 0;
    this.zoom = 1; this.pan = { x: 0, y: 0 }; this.sucio = true;
  }
  fijarLimbo(px) { this.limbo = px; this.medir(); }
  medir() {
    if (!this.geometria) return;
    const { clientWidth: W, clientHeight: H } = this.canvas;
    if (!W || !H) return;
    this.renderer.setSize(W, H, false);
    this.uPantalla.value.set(W, H);
    const p = this.panel;
    const lateral = p.offsetLeft > W * .4;
    // El mapa tiene su propio espacio entre el borde del globo y el panel.
    if (lateral) {
      const x = this.limbo * .94;
      this.area = { x, y: 64, w: Math.max(200, p.offsetLeft - x - 24), h: H - 64 - 76 };
    } else {
      this.area = { x: 12, y: 96, w: W - 24, h: Math.max(120, H * .6 - 96 - 16) };
    }
    this.leyenda.style.left = `${Math.round(lateral ? Math.max(this.area.x, 88) : 16)}px`;
    this.mpp = 2 * DISTANCIA * Math.tan(THREE.MathUtils.degToRad(this.cameraGlobo.fov / 2)) / H;
    const { ancho, alto, grosor } = this.geometria;
    const inclinado = alto * Math.cos(INCLINACION) + grosor * Math.abs(Math.sin(INCLINACION));
    this.escalaFinal = Math.min(this.area.w * this.mpp / ancho, this.area.h * this.mpp / inclinado) * .92;
    this.aplicarFiltro();
    this.sucio = true;
  }
  calcularObjetivo() {
    const { clientWidth: W, clientHeight: H } = this.canvas;
    const cx = this.area.x + this.area.w / 2 + this.pan.x, cy = this.area.y + this.area.h / 2 + this.pan.y;
    const rayo = new THREE.Vector3(cx / W * 2 - 1, 1 - cy / H * 2, .5).unproject(this.camara).sub(this.camara.position).normalize();
    const frente = new THREE.Vector3(); this.camara.getWorldDirection(frente);
    this.objetivo.copy(this.camara.position).addScaledVector(rayo, DISTANCIA / rayo.dot(frente));
  }
  update(p, enVuelo) {
    if (!this.activo || !this.geometria) return;
    const ahora = performance.now();
    const dt = Math.min(.25, (ahora - this.ultimoTiempo) / 1000);
    this.ultimoTiempo = ahora;
    if (this.uOpacidad.value < 1) {
      this.uOpacidad.value = Math.min(1, this.uOpacidad.value + dt / .22);
      this.sucio = true;
    }
    if (this.punteros.size === 0 && (Math.abs(this.vGiro) > .002 || Math.abs(this.vCabeceo) > .002)) {
      this.giro += this.vGiro * dt; this.cabeceo += this.vCabeceo * dt;
      const freno = Math.exp(-dt * 3.5); this.vGiro *= freno; this.vCabeceo *= freno;
      this.sucio = true;
    }
    const aparicion = this.uniformesPuntos.uAparicion;
    const destino = this.llegado && this.puntos ? 1 : 0;
    if (aparicion.value !== destino) {
      aparicion.value = this.reduceMotion.matches ? destino : THREE.MathUtils.clamp(aparicion.value + Math.sign(destino - aparicion.value) * dt / (destino ? .4 : .14), 0, 1);
      this.sucio = true;
    }
    // Quieto, el mapa no se vuelve a dibujar: libera la GPU para las nubes del globo.
    if (!enVuelo && !this.sucio) return;
    this.camara.copy(this.cameraGlobo);
    this.camara.updateMatrixWorld();
    this.camara.updateProjectionMatrix();
    this.calcularObjetivo();
    this.p = p;
    this.cabeceo = THREE.MathUtils.clamp(this.cabeceo, -1, .3);
    // De cerca el mapa se endereza para poder leer las regiones.
    const inclinacion = THREE.MathUtils.lerp(INCLINACION, -.02, suaveRango(1.1, 2.2, this.zoom));
    this.q0.copy(this.globe.quaternion).multiply(this.base);
    this.qFinal.copy(this.camara.quaternion)
      .multiply(this.qAux.setFromAxisAngle(this.ejeX, inclinacion + this.cabeceo))
      .multiply(this.qAux.setFromAxisAngle(this.ejeZ, this.giro));
    this.grupo.quaternion.slerpQuaternions(this.q0, this.qFinal, p);
    this.grupo.position.set(0, 0, 0).lerp(this.objetivo, p);
    const plano = suaveRango(1.1, 2.2, this.zoom);
    const escala = THREE.MathUtils.lerp(1, this.escalaFinal * this.zoom, p);
    // De cerca, un mapa: el grosor de la pieza se aplana para no tapar la costa.
    this.grupo.scale.set(escala, escala, escala * THREE.MathUtils.lerp(1, .06, plano));
    this.leyenda.classList.toggle('apartada', this.zoom > 1.2);
    this.uMorph.value = p;
    this.renderer.render(this.scene, this.camara);
    this.actualizarEtiquetas();
    this.sucio = false;
  }

  // ---------- Manipulación ----------
  escucharPunteros() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => {
      if (!this.llegado) return;
      c.setPointerCapture(e.pointerId);
      this.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY });
      this.vGiro = this.vCabeceo = 0; this.distanciaPinza = null;
      c.classList.add('arrastrando'); this.onPunto?.(null);
    });
    c.addEventListener('pointermove', e => {
      const p = this.punteros.get(e.pointerId);
      if (!p) { if (e.pointerType !== 'touch') this.buscarPunto(e.clientX, e.clientY); return; }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.punteros.size === 2) {
        const [a, b] = [...this.punteros.values()];
        const distancia = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.distanciaPinza) this.acercar(distancia / this.distanciaPinza, (a.x + b.x) / 2, (a.y + b.y) / 2);
        this.distanciaPinza = distancia;
      } else if (this.zoom > 1.2) {
        this.pan.x += dx; this.pan.y += dy; this.limitarPan();
      } else {
        this.giro += dx * .004; this.cabeceo += dy * .003;
        this.vGiro = dx * .16; this.vCabeceo = dy * .1;
      }
      this.sucio = true;
    });
    const soltar = e => {
      const p = this.punteros.get(e.pointerId);
      const toque = p && e.type === 'pointerup' && this.punteros.size === 1 && Math.hypot(e.clientX - p.ox, e.clientY - p.oy) < 8;
      this.punteros.delete(e.pointerId); this.distanciaPinza = null;
      if (toque) { this.ultimoPick = 0; this.buscarPunto(e.clientX, e.clientY); }
      if (!this.punteros.size) c.classList.remove('arrastrando');
    };
    c.addEventListener('pointerup', soltar);
    c.addEventListener('pointercancel', soltar);
    c.addEventListener('pointerleave', () => this.onPunto?.(null));
    c.addEventListener('wheel', e => {
      if (!this.llegado) return;
      e.preventDefault();
      this.acercar(Math.exp(-e.deltaY * .0014), e.clientX, e.clientY);
    }, { passive: false });
    c.addEventListener('dblclick', () => this.reiniciarVista());
    c.addEventListener('keydown', e => {
      const paso = { ArrowLeft: [-.09, 0], ArrowRight: [.09, 0], ArrowUp: [0, -.07], ArrowDown: [0, .07] }[e.key];
      if (paso) { e.preventDefault(); this.giro += paso[0]; this.cabeceo += paso[1]; this.sucio = true; }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); this.acercar(1.2); }
      if (e.key === '-') { e.preventDefault(); this.acercar(1 / 1.2); }
    });
  }
  // Acerca hacia el cursor: así se puede recorrer un país largo como Chile.
  acercar(factor, x, y) {
    const nuevo = THREE.MathUtils.clamp(this.zoom * factor, .7, 24);
    const real = nuevo / this.zoom;
    if (x !== undefined) {
      const rect = this.canvas.getBoundingClientRect();
      const ax = this.area.x + this.area.w / 2 + this.pan.x, ay = this.area.y + this.area.h / 2 + this.pan.y;
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
    const margenX = this.area.w * .5 * this.zoom, margenY = this.area.h * .55 * this.zoom;
    this.pan.x = THREE.MathUtils.clamp(this.pan.x, -margenX, margenX);
    this.pan.y = THREE.MathUtils.clamp(this.pan.y, -margenY, margenY);
  }
  buscarPunto(x, y) {
    if (!this.llegado || !this.datosPuntos) return;
    const ahora = performance.now();
    if (ahora - this.ultimoPick < 45) return;
    this.ultimoPick = ahora;
    const rect = this.canvas.getBoundingClientRect();
    const px = x - rect.left, py = y - rect.top, W = rect.width, H = rect.height;
    const m = new THREE.Matrix4().multiplyMatrices(this.camara.projectionMatrix, this.camara.matrixWorldInverse).multiply(this.grupo.matrixWorld).elements;
    const { plano, dia, sensor, registros, origen } = this.datosPuntos;
    const f = this.filtro, u = this.uniformesPuntos.uSensores.value;
    let mejor = -1, distancia = 14 * 14;
    for (let i = 0; i < registros.length; i++) {
      if (dia[i] < f.ini - f.cola || dia[i] > f.fin || (sensor[i] < .5 ? u.x : u.y) === 0) continue;
      const a = plano[i * 3], b = plano[i * 3 + 1], c = plano[i * 3 + 2];
      const w = m[3] * a + m[7] * b + m[11] * c + m[15];
      const sx = ((m[0] * a + m[4] * b + m[8] * c + m[12]) / w + 1) * W / 2;
      const sy = (1 - (m[1] * a + m[5] * b + m[9] * c + m[13]) / w) * H / 2;
      const d = (sx - px) ** 2 + (sy - py) ** 2;
      if (d < distancia) { distancia = d; mejor = i; }
    }
    this.onPunto?.(mejor < 0 ? null : registros[mejor], x, y, mejor < 0 ? -1 : origen[mejor]);
  }
}
