import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { HandFlow } from './nubes/nubes-interactivas.js?v=20261109d';
import { createCloudNoiseTexture } from './nubes/cloud-volume.js';
import { CloudLayer } from './nubes/capa-nubes.js?v=20261109d';
import { Countries } from './globo/paises.js?v=20261109d';
import { ModoPais } from './pais/modo-pais.js?v=20261109d';
import { PanelPais } from './paneles/panel-pais.js?v=20261109d';
import { PanelDatos } from './paneles/panel-datos.js?v=20261109d';
import {
  entradaCatalogo,
  cargarDatos,
  cargarIndice,
  cargarCeldas,
  sumarCeldas,
  fechaDeDia,
} from './datos/datos-pais.js?v=20261109d';
import { vertexShader, surfaceShader } from './globo/globo-shaders.js?v=20261109d';
import { actualizarURL, leerInicial } from './estado-url.js?v=20261109d';
import { crearFichaPunto } from './pais/ficha-punto.js?v=20261109d';

const canvas = document.querySelector('#tierra');
const loading = document.querySelector('#carga');
const loadingMessage = document.querySelector('#mensaje-carga');
const errorPanel = document.querySelector('#error');
const rotationButton = document.querySelector('#giro');
const resetButton = document.querySelector('#restaurar');
const exploreButton = document.querySelector('#explorar');
const hero = document.querySelector('#portada');
const stage = document.querySelector('#escena');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let renderer;

// Los datos guardados no dependen de WebGL: siguen disponibles si la escena no abre.
const parametrosIniciales = new URLSearchParams(location.search);
let paisPendiente = parametrosIniciales.get('pais')
  ? { id: parametrosIniciales.get('pais'), inicial: leerInicial(parametrosIniciales) }
  : null;
let solicitarPais = (id, inicial) => {
  paisPendiente = { id, inicial };
};
const panelDatos = new PanelDatos({
  dialogo: document.querySelector('#datos-guardados'),
  onVerPais: (id, inicial) => solicitarPais(id, inicial),
  onCambio: id => actualizarURL({ datos: id }),
});
for (const boton of document.querySelectorAll('#abrir-datos, #error-datos')) {
  boton.addEventListener('click', () => panelDatos.abrir());
}
if (parametrosIniciales.get('datos')) panelDatos.abrir({ id: parametrosIniciales.get('datos') });

document.querySelector('#reintentar').addEventListener('click', () => location.reload());
const ICONO_PAUSA =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
const ICONO_REANUDAR =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M7 4.8v14.4c0 .8.9 1.3 1.5.8l11-7.2c.6-.4.6-1.2 0-1.6l-11-7.2c-.6-.5-1.5 0-1.5.8Z"/></svg>';

function showError(message) {
  loading.hidden = true;
  errorPanel.hidden = false;
  document.querySelector('#mensaje-error').textContent = message;
  rotationButton.disabled = resetButton.disabled = exploreButton.disabled = true;
  hero.hidden = true;
  document.querySelector('#escena').dataset.state = 'error';
}

async function main() {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
  const globe = new THREE.Group();
  scene.add(globe);

  function direction(latitude, longitude) {
    const lat = THREE.MathUtils.degToRad(latitude);
    const lon = THREE.MathUtils.degToRad(longitude);
    return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
  }
  const initialDirection = direction(5, 135);
  const introDirection = direction(1, 193);
  const right = new THREE.Vector3().crossVectors(camera.up, initialDirection).normalize();
  const sunDirection = initialDirection
    .clone()
    .multiplyScalar(0.48)
    .addScaledVector(right, -0.9)
    .add(new THREE.Vector3(0, 0.65, 0))
    .normalize();
  const solInicial = sunDirection.clone();

  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => {
    loadingMessage.textContent = `Preparando la Tierra… ${Math.round((loaded / total) * 100)} %`;
  };
  const loader = new THREE.TextureLoader(manager);
  const noiseRequest = fetch('./assets/cloud-billows-128.rg.bin').then(response => {
    if (!response.ok) throw new Error('No se pudo cargar el volumen de nubes');
    return response.arrayBuffer();
  });
  const normalGuideRequest = fetch('./assets/nubes-relieve.rgba.gz?v=20261109d').then(async response => {
    if (!response.ok) throw new Error('No se pudo cargar el relieve de las nubes');
    const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    if (bytes.length !== 1024 * 512 * 4) throw new Error('Relieve de nubes incompleto');
    if (new URLSearchParams(location.search).has('revision')) {
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      canvas.dataset.cloudNormalHash = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
    }
    return bytes;
  });
  const volumeRequest = fetch('./assets/nubes-esfericas.rg.gz?v=20261109d').then(async response => {
    if (!response.ok) throw new Error('No se pudo cargar el volumen de nubes');
    const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    if (bytes.length !== 2048 * 1024 * 32 * 2) throw new Error('Volumen de nubes incompleto');
    if (new URLSearchParams(location.search).has('revision')) {
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      canvas.dataset.cloudHash = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
    }
    return bytes;
  });
  const paths = [
    'earth-day-4k.webp',
    'earth-night-2k.webp',
    'earth-normal-2k.png',
    'earth-specular-2k.png',
    'earth-bathymetry-4k.webp',
  ];
  const textures = await Promise.all(paths.map(file => loader.loadAsync(`./assets/${file}`)));
  textures.forEach(texture => {
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    texture.wrapS = THREE.RepeatWrapping;
  });
  const [dayMap, nightMap, normalMap, oceanMap, bathymetryMap] = textures;
  dayMap.colorSpace = nightMap.colorSpace = bathymetryMap.colorSpace = THREE.SRGBColorSpace;
  loadingMessage.textContent = 'Preparando las nubes…';
  const cloudBrush = new HandFlow(canvas, camera);
  const cloudNoise = createCloudNoiseTexture(new Uint8Array(await noiseRequest));
  const cloudVolume = new THREE.Data3DTexture(await volumeRequest, 2048, 1024, 32);
  cloudVolume.format = THREE.RGFormat;
  cloudVolume.type = THREE.UnsignedByteType;
  cloudVolume.wrapS = THREE.RepeatWrapping;
  cloudVolume.minFilter = cloudVolume.magFilter = THREE.LinearFilter;
  cloudVolume.generateMipmaps = false;
  cloudVolume.unpackAlignment = 1;
  cloudVolume.needsUpdate = true;
  const cloudSurfaceNormals = new THREE.DataTexture(await normalGuideRequest, 1024, 512, THREE.RGBAFormat);
  cloudSurfaceNormals.wrapS = THREE.RepeatWrapping;
  cloudSurfaceNormals.minFilter = cloudSurfaceNormals.magFilter = THREE.LinearFilter;
  cloudSurfaceNormals.generateMipmaps = false;
  cloudSurfaceNormals.unpackAlignment = 1;
  cloudSurfaceNormals.colorSpace = THREE.NoColorSpace;
  cloudSurfaceNormals.needsUpdate = true;
  const uniforms = {
    dayMap: { value: dayMap },
    nightMap: { value: nightMap },
    normalMap: { value: normalMap },
    oceanMap: { value: oceanMap },
    cloudVolume: { value: cloudVolume },
    bathymetryMap: { value: bathymetryMap },
    cloudDisturbance: { value: cloudBrush.texture },
    cloudNoise: { value: cloudNoise },
    cloudSurfaceNormals: { value: cloudSurfaceNormals },
    sunDirection: { value: sunDirection },
    localSunDirection: { value: sunDirection.clone() },
    localCameraPosition: { value: camera.position.clone() },
    cloudOffset: { value: 0 },
  };
  const geometry = new THREE.SphereGeometry(1, 192, 128);
  const cloudLayer = new CloudLayer(renderer, camera, globe, geometry, uniforms);
  uniforms.cloudShadowMap = { value: cloudLayer.shadowTexture };
  const surface = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader: surfaceShader }),
  );
  globe.add(surface);
  function renderEarth() {
    cloudLayer.prepare();
    cloudLayer.compose(scene);
  }

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.enablePan = false;
  controls.rotateSpeed = 0.4;
  controls.zoomSpeed = 0.6;
  controls.minDistance = 1.65;
  controls.maxDistance = 5.5;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = Math.PI - 0.15;
  // The wheel changes distance only. It never advances between application views.
  controls.autoRotate = false;
  let fullDistance;
  let view = 'intro';
  let transition = null;
  let introPose;
  let fullPose;
  let countries;
  let framing = 0;
  const encuadre = { x: 0, y: 0 };
  // A repeatable initial pose for visual comparisons; normal visits still rotate.
  const revision = new URLSearchParams(location.search).has('revision');
  let rotating = !reduceMotion.matches && !revision;
  if (revision) {
    // Solo revisión visual: la misma cámara para comparar capturas.
    window.__atlas = {
      ver(lat, lon, distancia, elevar = 0) {
        controls.enabled = false;
        frameGlobe(0);
        const d = direction(lat, lon);
        const arriba = new THREE.Vector3(0, 1, 0).addScaledVector(d, -d.y).normalize();
        const objetivo = arriba.multiplyScalar(elevar);
        camera.position.copy(d).multiplyScalar(distancia).add(objetivo);
        controls.target.copy(objetivo);
        camera.lookAt(objetivo);
        globe.quaternion.identity();
        cloudTime = 0;
      },
      bloqueada: () => seleccionBloqueada(),
      seleccionar: id => {
        const c = countries.countries.find(x => x.id === id);
        return countries.select(c, true);
      },
      limbo: () => geometriaLateral().limbo,
      congelar: t => {
        if (vuelo) vuelo.congelado = t;
      },
      soltar: () => {
        if (vuelo) {
          delete vuelo.congelado;
          vuelo.ultimo = performance.now();
        }
      },
    };
    // Opt-in visual QA only: G exercises the real pointer listener and flow.
    canvas.addEventListener('keydown', event => {
      if (event.key.toLowerCase() !== 'g' || canvas.dataset.gesture === 'active') return;
      const rect = canvas.getBoundingClientRect(),
        start = performance.now();
      canvas.dataset.gesture = 'active';
      const gesture = now => {
        const t = Math.min((now - start) / 800, 1);
        canvas.dispatchEvent(
          new PointerEvent('pointermove', {
            clientX: rect.left + rect.width * (0.46 + t * 0.22),
            clientY: rect.top + rect.height * (0.78 + Math.sin(t * Math.PI) * 0.035),
            buttons: 0,
            pointerType: 'mouse',
            bubbles: true,
          }),
        );
        if (t < 1) requestAnimationFrame(gesture);
        else {
          canvas.dispatchEvent(new PointerEvent('pointerleave'));
          canvas.dataset.gesture = 'settling';
        }
      };
      requestAnimationFrame(gesture);
    });
  }
  let dragging = false;
  let cloudTime = 0;
  let vuelo = null;
  let cambioOrbita = null;
  let paisAbierto = null;
  let modo;
  let lastFrame;
  let frameCount = 0,
    frameSampleStart = performance.now();
  const inverseRotation = new THREE.Quaternion();
  const cameraTransitionRotation = new THREE.Quaternion();
  const introRight = new THREE.Vector3().crossVectors(camera.up, introDirection).normalize();
  const initialUp = new THREE.Vector3().crossVectors(introDirection, introRight).normalize();

  function setRotation(value) {
    rotating = value;
    pintarGiro(rotating);
  }
  function applyPose(pose) {
    controls.minDistance = view === 'intro' ? 1.05 : 1.65;
    camera.position.copy(pose.position);
    controls.target.copy(pose.target);
    controls.update();
  }
  function pintarGiro(activo) {
    rotationButton.innerHTML = activo ? ICONO_PAUSA : ICONO_REANUDAR;
    rotationButton.setAttribute('aria-label', activo ? 'Pausar giro' : 'Reanudar giro');
    rotationButton.setAttribute('aria-pressed', String(!activo));
  }
  // El encuadre mueve la imagen sin mover la cámara: el mismo globo puede estar
  // centrado o a un lado, y OrbitControls sigue orbitando el centro de la Tierra.
  function ponerEncuadre(x, y) {
    encuadre.x = x;
    encuadre.y = y;
    const { width, height } = canvas.getBoundingClientRect();
    if (x || y) camera.setViewOffset(width, height, x, y, width, height);
    else camera.clearViewOffset();
  }
  // En móvil el buscador ocupa la parte baja: el globo no baja como en escritorio.
  function desplazamientoGlobo() {
    const { width, height } = canvas.getBoundingClientRect();
    return -height * (width <= 720 ? 0.015 : 0.11);
  }
  function frameGlobe(value) {
    framing = value;
    // Preserve the intro camera. The full view reserves space above the globe
    // for the country typography while OrbitControls still orbit Earth's centre.
    ponerEncuadre(0, desplazamientoGlobo() * value);
  }
  function finishTransition() {
    transition = null;
    controls.enabled = true;
    controls.enableRotate = controls.enableZoom = view === 'globe';
    controls.minDistance = view === 'intro' ? 1.05 : 1.65;
    exploreButton.disabled = false;
    resetButton.disabled = false;
    stage.dataset.transition = 'idle';
  }
  function fijarTextoInstruccion() {
    pintarGiro(paisAbierto ? giroLado : rotating);
    document.querySelector('#instruccion').textContent = window.matchMedia('(hover: none)').matches
      ? 'Arrastra para girar · Toca un país para ver su actividad'
      : 'Arrastra para girar · Haz clic en un país para ver su actividad';
  }
  function changeView(nextView) {
    if (transition || vuelo || paisAbierto) return;
    const pose = nextView === 'intro' ? introPose : fullPose;
    view = nextView;
    stage.dataset.view = view;
    countries?.fitName();
    stage.dataset.transition = 'moving';
    hero.inert = view !== 'intro';
    fijarTextoInstruccion();
    controls.enabled = false;
    exploreButton.disabled = resetButton.disabled = true;
    // Flush any remaining mouse inertia before interpolating the camera.
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;
    if (reduceMotion.matches) {
      applyPose(pose);
      frameGlobe(view === 'globe' ? 1 : 0);
      sunDirection.copy(solInicial);
      finishTransition();
    } else {
      const fromOffset = camera.position.clone().sub(controls.target);
      const toOffset = pose.position.clone().sub(pose.target);
      transition = {
        start: performance.now(),
        duration: 2600,
        fromFraming: framing,
        toFraming: view === 'globe' ? 1 : 0,
        fromTarget: controls.target.clone(),
        toTarget: pose.target.clone(),
        fromDistance: fromOffset.length(),
        toDistance: toOffset.length(),
        fromDirection: fromOffset.clone().normalize(),
        orbit: new THREE.Quaternion().setFromUnitVectors(fromOffset.normalize(), toOffset.normalize()),
        fromSol: sunDirection.clone(),
      };
    }
  }
  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    cloudLayer.resize(width, height);
    // Two compositions share the same globe: a low horizon and the whole Earth.
    const fill = Math.min(0.8, camera.aspect * 0.84);
    stage.style.setProperty('--globe-top', `${((width <= 720 ? 0.515 : 0.61) - fill / 2) * 100}%`);
    const previousDistance = fullDistance;
    fullDistance = Math.sqrt(1 + 1 / (fill * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) ** 2);
    const landscape = THREE.MathUtils.smoothstep(camera.aspect, 0.6, 1.6);
    const closeDistance = THREE.MathUtils.lerp(1.9, 1.24, landscape);
    const horizon = 0.44;
    const angle = Math.atan((1 - horizon * 2) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    const lift = (1 - closeDistance * Math.sin(angle)) / Math.cos(angle);
    const introTarget = initialUp.clone().multiplyScalar(lift);
    introPose = {
      target: introTarget,
      position: introDirection.clone().multiplyScalar(closeDistance).add(introTarget),
    };
    fullPose = { target: new THREE.Vector3(), position: initialDirection.clone().multiplyScalar(fullDistance) };
    controls.maxDistance = Math.max(5.5, fullDistance * 1.3);
    if (transition) {
      applyPose(view === 'intro' ? introPose : fullPose);
      finishTransition();
    } else if (view === 'intro') applyPose(introPose);
    else if (previousDistance) {
      camera.position.multiplyScalar(fullDistance / previousDistance);
      controls.update();
    }
    if (paisAbierto) reencuadrarLateral();
    else frameGlobe(view === 'globe' ? 1 : 0);
    countries?.fitName();
  }
  // ---------- Modo país ----------
  // Un solo movimiento reversible: t avanza de 0 a 1 y de él salen la cámara, el
  // encuadre lateral, la luz y el despegue del mapa. Si el usuario vuelve a mitad
  // de camino, t solo cambia de sentido; no hay nada que deshacer ni que reiniciar.
  const piezaCanvas = document.querySelector('#pieza');
  const panelPaisRaiz = document.querySelector('#panel-pais');
  const tipPunto = document.querySelector('#tip-punto');
  document.querySelector('#pieza-ayuda').textContent = window.matchMedia('(hover: none)').matches
    ? 'Toca una región · Pellizca para acercar'
    : 'Haz clic en una región · Rueda para acercar';
  const suave = t => t * t * t * (10 + t * (-15 + t * 6));
  const tramo = (a, b, t) => THREE.MathUtils.clamp((t - a) / (b - a), 0, 1);
  const qVuelo = new THREE.Quaternion();
  const dirVuelo = new THREE.Vector3();
  let pedidoPais = 0;
  let inicialPais = {};
  let datosAlAterrizar = null;
  let giroPrevio = false;
  let avanceMapa = 0;
  let giroLado = !revision && !reduceMotion.matches;

  function seleccionBloqueada() {
    return view !== 'globe' || Boolean(transition || vuelo || paisAbierto);
  }
  function direccionPais(country) {
    return direction(country.properties.center[1], country.properties.center[0]).applyQuaternion(globe.quaternion);
  }
  function solDe(dir) {
    const derecha = new THREE.Vector3().crossVectors(camera.up, dir).normalize();
    const arriba = new THREE.Vector3().crossVectors(dir, derecha).normalize();
    return derecha.multiplyScalar(0.72).addScaledVector(arriba, 0.38).addScaledVector(dir, 0.58).normalize();
  }
  // Globo parcialmente fuera de pantalla a la izquierda; en móvil, en la esquina.
  function geometriaLateral() {
    const { width: W, height: H } = canvas.getBoundingClientRect();
    const movil = W <= 720;
    const R = movil ? Math.min(W * 0.4, H * 0.2) : Math.min(H * 0.62, W * 0.34);
    const cx = movil ? W * 0.06 : W * 0.24 - R;
    const cy = movil ? H * 0.1 : H * 0.5;
    const fill = (R * 2) / H;
    return {
      dist: Math.sqrt(1 + 1 / (fill * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) ** 2),
      ox: W / 2 - cx,
      oy: H / 2 - cy,
      limbo: movil ? 0 : cx + R,
    };
  }
  function estadoCamara() {
    const offset = camera.position.clone().sub(controls.target);
    return {
      target: controls.target.clone(),
      dir: offset.clone().normalize(),
      dist: offset.length(),
      ox: encuadre.x,
      oy: encuadre.y,
      sol: sunDirection.clone(),
    };
  }
  function aplicarVuelo(t) {
    const { A, B, orbita, solFinal } = vuelo;
    const e = suave(t),
      lado = suave(tramo(0.14, 1, t));
    qVuelo.identity().slerp(orbita, e);
    dirVuelo.copy(A.dir).applyQuaternion(qVuelo);
    controls.target.lerpVectors(A.target, B.target, e);
    camera.position
      .copy(dirVuelo)
      .multiplyScalar(THREE.MathUtils.lerp(A.dist, B.dist, e))
      .add(controls.target);
    camera.lookAt(controls.target);
    ponerEncuadre(THREE.MathUtils.lerp(A.ox, B.ox, lado), THREE.MathUtils.lerp(A.oy, B.oy, lado));
    // La luz acompaña a la cámara: el país nunca se abre desde el lado nocturno.
    sunDirection.copy(A.sol).applyQuaternion(qVuelo).lerp(solFinal, lado).normalize();
    // El país despega cuando la cámara ya lo tiene de frente, no desde el borde del globo.
    avanceMapa = suave(tramo(0.48, 1, t));
    modo.uOpacidad.value = THREE.MathUtils.smoothstep(t, 0.48, 0.56);
    // Panel y mapa entran juntos, dentro del mismo gesto.
    if (vuelo.sentido > 0 && t >= 0.46 && stage.dataset.modo !== 'pais') {
      stage.dataset.modo = 'pais';
      panelPaisRaiz.focus({ preventScroll: true });
    }
  }
  function iniciarVuelo(A, B, t, sentido) {
    const duracion = THREE.MathUtils.clamp(1700 + A.dir.angleTo(B.dir) * 420, 1800, 2700);
    vuelo = {
      A,
      B,
      t,
      sentido,
      duracion,
      ultimo: performance.now(),
      orbita: new THREE.Quaternion().setFromUnitVectors(A.dir, B.dir),
      solFinal: solDe(B.dir),
    };
    stage.dataset.transition = 'moving';
    controls.enabled = false;
    if (reduceMotion.matches) {
      vuelo.t = sentido > 0 ? 1 : 0;
      avanzarVuelo();
    }
  }
  function avanzarVuelo() {
    if (vuelo.congelado !== undefined) {
      vuelo.t = vuelo.congelado;
      aplicarVuelo(vuelo.t);
      return;
    }
    const ahora = performance.now();
    // La vuelta es más ágil que la ida: la decisión de salir ya está tomada.
    const rapidez = vuelo.sentido > 0 ? 1 : 1.35;
    vuelo.t = THREE.MathUtils.clamp(
      vuelo.t + (vuelo.sentido * rapidez * Math.min(120, ahora - vuelo.ultimo)) / vuelo.duracion,
      0,
      1,
    );
    vuelo.ultimo = ahora;
    aplicarVuelo(vuelo.t);
    if (vuelo.t === 1 && vuelo.sentido > 0) terminarEntrada();
    else if (vuelo.t === 0 && vuelo.sentido < 0) terminarSalida();
  }
  function terminarEntrada() {
    vuelo = null;
    avanceMapa = 1;
    modo.uOpacidad.value = 1;
    modo.llegar();
    stage.dataset.transition = 'idle';
    pintarGiro(giroLado);
    // Leer 10 MB de registros y crear el calendario esperan a que termine el vuelo:
    // durante el movimiento solo se dibuja. El panel enseña su esqueleto mientras tanto.
    datosAlAterrizar?.();
    datosAlAterrizar = null;
  }
  function terminarSalida() {
    const solRegreso = vuelo.A.sol;
    vuelo = null;
    paisAbierto = null;
    datosAlAterrizar = null;
    avanceMapa = 0;
    modo.terminar();
    panelPaisRaiz.hidden = true;
    countries.limpiar();
    sunDirection.copy(solRegreso);
    frameGlobe(1);
    controls.target.set(0, 0, 0);
    controls.enabled = true;
    controls.enableRotate = controls.enableZoom = true;
    controls.minDistance = 1.65;
    controls.update();
    stage.dataset.transition = 'idle';
    // El planeta sigue como estaba: si giraba antes de abrir el país, vuelve a girar.
    setRotation(giroPrevio);
    canvas.focus({ preventScroll: true });
  }
  function avanzarOrbita() {
    const c = cambioOrbita;
    c.t = Math.min(1, c.t + Math.min(120, performance.now() - c.ultimo) / c.duracion);
    c.ultimo = performance.now();
    qVuelo.identity().slerp(c.orbita, suave(c.t));
    dirVuelo.copy(c.desde).applyQuaternion(qVuelo);
    camera.position.copy(dirVuelo).multiplyScalar(c.dist);
    camera.lookAt(0, 0, 0);
    sunDirection.copy(solDe(dirVuelo));
    if (c.t === 1) cambioOrbita = null;
  }
  function reencuadrarLateral() {
    const g = geometriaLateral();
    modo.fijarLimbo(g.limbo);
    if (vuelo) {
      vuelo.B.ox = g.ox;
      vuelo.B.oy = g.oy;
      vuelo.B.dist = g.dist;
      return;
    }
    ponerEncuadre(g.ox, g.oy);
    camera.position.setLength(g.dist);
    camera.lookAt(0, 0, 0);
    modo.medir();
  }
  const mostrarPunto = crearFichaPunto({ tip: tipPunto, regionDe: indice => panelPais.regionDe(indice) });
  modo = new ModoPais({
    canvas: piezaCanvas,
    stage,
    camera,
    globe,
    imagenMapa: dayMap.image,
    panel: panelPaisRaiz,
    reduceMotion,
    onPunto: mostrarPunto,
    capaEtiquetas: document.querySelector('#etiquetas-regiones'),
    leyenda: document.querySelector('#pieza-leyenda'),
    atribucion: document.querySelector('#atribucion-satelital'),
    onVista: vista => {
      panelPais.mostrarVista(vista);
      // Con una región abierta, el mapa muestra solo sus focos, igual que el panel.
      modo.mostrarRegion(vista?.region.indice ?? null);
      if (vista) {
        giroLado = false;
        pintarGiro(false);
      }
    },
    onSatelite: estado => panelPais.estadoSatelital(estado),
  });
  const panelPais = new PanelPais({
    raiz: panelPaisRaiz,
    reduceMotion,
    onCerrar: cerrarPais,
    onPais: id => solicitarPais(id, {}),
    onReintentar: () => abrirPais(panelPais.feature),
    onPeriodo: sel => ponerMapaSerie(sel),
    onVolverVista: () => {
      modo.volverVista();
      piezaCanvas.focus({ preventScroll: true });
    },
    // «Chile» en la ruta: vuelve a la vista nacional. El año, el mes y la pestaña no cambian.
    onNacional: () => {
      modo.reiniciarVista();
      panelPaisRaiz.focus({ preventScroll: true });
    },
    onRegion: indice => modo.seleccionarRegion(indice),
    onZonas: (lons, lats) => modo.regionesEn(lons, lats),
    // Solo cambia el dibujo del mapa: fecha, sensor, región, ciudad y zoom quedan igual.
    onSatelital: activo => {
      stage.dataset.detalle = activo ? 'si' : 'no';
      tipPunto.hidden = true;
      modo.ponerSatelital(activo);
    },
    onAnio: anio => {
      // Cambiar de año recarga solo el detalle diario y los puntos del mapa.
      if (!paisAbierto) return;
      const entrada = entradaCatalogo(paisAbierto.id, anio);
      if (!entrada) return;
      panelPais.cargandoAnio(entrada);
      actualizarURL({ anio: entrada.anio, dia: null });
      cargarDatosPais(paisAbierto, entrada, {}, ++pedidoPais);
    },
    onFiltro: filtro => {
      modo.filtrar(filtro);
      if (filtro.persistente) {
        actualizarURL({
          anio: panelPais.datos.anio,
          dia: filtro.dia === null ? null : fechaDeDia(filtro.dia, panelPais.datos.anio),
          sensor: filtro.sensor === 'todos' ? null : filtro.sensor,
        });
      }
    },
  });
  // Países sin detecciones guardadas: un punto por celda con fuego en el período elegido.
  function ponerMapaSerie(sel) {
    const entrada = panelPais.entrada,
      pedido = pedidoPais;
    if (!entrada?.soloSerie) return;
    cargarCeldas(entrada.id)
      .then(mapa => {
        if (pedido !== pedidoPais) return;
        const suma = sumarCeldas(mapa, sel.anio, sel.mes);
        const positivos = Array.from(suma)
          .filter(v => v > 0)
          .sort((a, b) => a - b);
        const ref = positivos[Math.floor(positivos.length * 0.98)] || 1;
        const lado = mapa.celda_grados;
        // Mapa de densidad: cada zona recibe más puntos cuanto más fuego tuvo, repartidos al azar
        // dentro de ella (siempre en el mismo lugar). Las zonas casi sin fuego no se dibujan.
        const MAX_PUNTOS = 14;
        const azar = semilla => {
          let t = semilla >>> 0;
          return () => {
            t += 0x6d2b79f5;
            let r = Math.imul(t ^ (t >>> 15), 1 | t);
            r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
            return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
          };
        };
        const registros = [];
        mapa.celdas.forEach(([lat, lon], i) => {
          const r = suma[i] / ref;
          if (r < 0.02) return;
          const n = Math.max(1, Math.round(MAX_PUNTOS * Math.sqrt(Math.min(1, r))));
          const aleatorio = azar(i * 7919 + 17);
          // Intensidad del color: proporcional a la raíz (la escala del mapa es logarítmica en FRP).
          const frp = 10 ** (3 * Math.min(1, Math.sqrt(r))) - 1;
          for (let k = 0; k < n; k++) {
            registros.push({
              lat: lat + aleatorio() * lado,
              lon: lon + aleatorio() * lado,
              frp,
              sensor: 'VIIRS',
              celda: true,
              valor: suma[i],
              tam: lado,
              sel,
            });
          }
        });
        modo.ponerPuntos({ registros, dias: new Int16Array(registros.length) });
        modo.filtrar({ ini: 0, fin: 400, cola: 0, sensor: 'todos', visibles: registros.length });
      })
      .catch(error => console.warn('Mapa del país no disponible:', error));
  }
  function cargarDatosPais(country, entrada, inicial, pedido) {
    if (!entrada) return;
    if (entrada.soloSerie) {
      // Países sin detecciones guardadas: solo el calendario histórico, sin puntos en el mapa.
      modo.quitarPuntos();
      if (pedido === pedidoPais)
        panelPais.ponerSoloSerie(inicial.anio ? { anio: +inicial.anio, mes: Number.isInteger(inicial.mes) ? inicial.mes : null } : null);
      return;
    }
    cargarDatos(entrada)
      .then(async datos => {
        if (pedido !== pedidoPais) return;
        panelPais.ponerDatos(datos, modo.ponerPuntos(datos), inicial);
        const detalle = await modo.promesaDetalle;
        if (pedido !== pedidoPais || !detalle) return;
        // El contorno detallado puede dejar fuera otras islas que el general.
        panelPais.omitidos = modo.datosPuntos?.omitidos ?? panelPais.omitidos;
        panelPais.actualizar();
        const indices = await modo.regionesDe(datos, country.id);
        if (pedido === pedidoPais && indices) {
          panelPais.ponerRegiones(detalle.nombresRegion, indices);
          modo.ponerRegionesPuntos(indices);
        }
      })
      .catch(error => {
        console.error('Datos del país:', error);
        if (pedido === pedidoPais) panelPais.error();
      });
  }
  function abrirPais(country) {
    if (transition) return;
    const inicial = inicialPais;
    const entrada = entradaCatalogo(country.id, inicial.anio);
    inicialPais = {};
    const pedido = ++pedidoPais;
    if (!paisAbierto) giroPrevio = rotating;
    setRotation(false);
    panelPais.preparar(country, entrada);
    stage.dataset.conDatos = !entrada ? 'no' : entrada.soloSerie ? 'serie' : 'si';
    actualizarURL({ pais: country.id, dia: null, sensor: null, anio: null });
    const nombre = country.properties.spanish || country.properties.name;
    piezaCanvas.setAttribute(
      'aria-label',
      `Mapa de ${nombre}. Selecciona una región con un clic o con su nombre. Usa la rueda para acercar. Escape vuelve a la vista anterior.`,
    );
    if (paisAbierto) {
      // Ya hay un país abierto: solo cambia el mapa y el globo gira hacia el nuevo.
      paisAbierto = country;
      if (vuelo && vuelo.sentido < 0) {
        vuelo.sentido = 1;
        vuelo.ultimo = performance.now();
        stage.dataset.modo = 'pais';
      }
      modo.cambiar(country);
      datosAlAterrizar = null;
      if (!vuelo) {
        const desde = camera.position.clone().normalize(),
          hacia = direccionPais(country);
        cambioOrbita = reduceMotion.matches
          ? null
          : {
              desde,
              dist: camera.position.length(),
              t: 0,
              duracion: 900,
              ultimo: performance.now(),
              orbita: new THREE.Quaternion().setFromUnitVectors(desde, hacia),
            };
        if (reduceMotion.matches) {
          camera.position.copy(hacia).multiplyScalar(camera.position.length());
          camera.lookAt(0, 0, 0);
          sunDirection.copy(solDe(hacia));
        }
      }
      cargarDatosPais(country, entrada, inicial, pedido);
      panelPaisRaiz.focus({ preventScroll: true });
      return;
    }
    paisAbierto = country;
    if (view !== 'globe') {
      view = 'globe';
      stage.dataset.view = 'globe';
      hero.inert = true;
      fijarTextoInstruccion();
    }
    countries.marcar(country);
    modo.preparar(country);
    modo.entrar();
    panelPaisRaiz.hidden = false;
    const g = geometriaLateral();
    modo.fijarLimbo(g.limbo);
    datosAlAterrizar = () => cargarDatosPais(country, entrada, inicial, pedido);
    panelPaisRaiz.tabIndex = -1;
    const B = { target: new THREE.Vector3(), dir: direccionPais(country), dist: g.dist, ox: g.ox, oy: g.oy };
    iniciarVuelo(estadoCamara(), B, 0, 1);
  }
  function cerrarPais() {
    if (!paisAbierto || (vuelo && vuelo.sentido < 0)) return;
    pedidoPais++;
    cambioOrbita = null;
    panelPais.detener();
    delete stage.dataset.modo;
    modo.salir();
    actualizarURL({ pais: null, dia: null, sensor: null, anio: null });
    if (vuelo) {
      vuelo.sentido = -1;
      vuelo.ultimo = performance.now();
      return;
    }
    // Vuelve al planeta completo mirando el país, aunque el globo haya seguido girando.
    const dirRegreso = direccionPais(paisAbierto);
    // De regreso, el planeta se ve iluminado como al principio, mirando este país.
    const solRegreso = solInicial
      .clone()
      .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(initialDirection, dirRegreso));
    const A = {
      target: new THREE.Vector3(),
      dir: dirRegreso,
      dist: fullDistance,
      ox: 0,
      oy: desplazamientoGlobo(),
      sol: solRegreso,
    };
    iniciarVuelo(A, estadoCamara(), 1, -1);
  }
  document.addEventListener('keydown', evento => {
    if (evento.key === 'Escape' && paisAbierto && !panelDatos.dialogo.open) {
      if (modo.vista) modo.volverVista();
      else cerrarPais();
    }
  });
  // El índice mundial dice qué países tienen serie harmonizada (marca "Con datos" y panel).
  await cargarIndice();
  countries = await Countries.create({
    canvas,
    camera,
    globe,
    stage,
    uniforms,
    onSelect: country => abrirPais(country),
  });
  countries.update(0, 0, true);
  // Abrir un país desde «Datos guardados» o un enlace directo es una petición explícita:
  // no pasa por la selección en el globo, que sigue bloqueada en la portada.
  solicitarPais = (id, inicial = {}) => {
    const country = countries.countries.find(c => c.id === id);
    if (!country) return;
    inicialPais = inicial;
    abrirPais(country);
  };
  for (const boton of document.querySelectorAll('[data-pais-rapido]')) {
    boton.addEventListener('click', () => {
      if (!seleccionBloqueada()) solicitarPais(boton.dataset.paisRapido, {});
    });
  }
  window.addEventListener('resize', resize);
  rotationButton.addEventListener('click', () => {
    if (paisAbierto) {
      giroLado = !giroLado;
      pintarGiro(giroLado);
    } else setRotation(!rotating);
  });
  exploreButton.addEventListener('click', () => changeView('globe'));
  resetButton.addEventListener('click', () => changeView('intro'));
  reduceMotion.addEventListener('change', () => setRotation(!reduceMotion.matches));
  controls.addEventListener('start', () => {
    dragging = true;
    canvas.classList.add('arrastrando');
    setRotation(false);
  });
  controls.addEventListener('end', () => {
    dragging = false;
    canvas.classList.remove('arrastrando');
  });
  canvas.addEventListener('keydown', event => {
    const angle = 0.07;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', ' '].includes(event.key)) return;
    event.preventDefault();
    if (event.key === ' ') {
      setRotation(!rotating);
      return;
    }
    if (view === 'intro' || transition) return;
    setRotation(false);
    if (event.key === '+' || event.key === '=') camera.position.multiplyScalar(0.92);
    else if (event.key === '-') camera.position.multiplyScalar(1.08);
    else {
      const axis =
        event.key.includes('Left') || event.key.includes('Right')
          ? new THREE.Vector3(0, 1, 0)
          : new THREE.Vector3().crossVectors(camera.up, camera.position).normalize();
      camera.position.applyAxisAngle(axis, ['ArrowRight', 'ArrowUp'].includes(event.key) ? angle : -angle);
    }
    camera.position.clampLength(controls.minDistance, controls.maxDistance);
    controls.update();
  });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    renderer.setAnimationLoop(null);
    showError('El navegador interrumpió los gráficos 3D. Cierra otras pestañas exigentes y vuelve a intentar.');
  });
  resize();
  controls.enableRotate = controls.enableZoom = false;
  uniforms.localCameraPosition.value.copy(camera.position);
  // Compile first so shader errors cannot leave a misleading empty preview.
  let shaderFailed = false;
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    shaderFailed = true;
    console.error(
      'Efecto 3D:',
      gl.getProgramInfoLog(program),
      gl.getShaderInfoLog(vertex),
      gl.getShaderInfoLog(fragment),
    );
  };
  await renderer.compileAsync(scene, camera);
  await cloudLayer.compile();
  if (shaderFailed) throw new Error('shader');
  renderEarth();
  if (shaderFailed) throw new Error('shader');
  await modo.precalentar().catch(error => console.warn('Precalentado del mapa:', error));
  canvas.classList.add('listo');
  loading.hidden = true;
  rotationButton.disabled = resetButton.disabled = exploreButton.disabled = false;
  document.querySelector('#escena').dataset.state = 'ready';
  setRotation(rotating);
  let arranqueHecho = false;
  document.addEventListener('visibilitychange', () => {
    lastFrame = undefined;
  });
  renderer.setAnimationLoop(time => {
    if (document.hidden) return;
    const delta = lastFrame === undefined ? 0 : Math.min((time - lastFrame) / 1000, 0.05);
    lastFrame = time;
    if (rotating && !dragging && !paisAbierto) {
      globe.rotation.y += delta * 0.018;
      cloudTime += delta * 0.00025;
    }
    // El globo sigue vivo al lado del mapa. Nunca durante el regreso: el país
    // debe aterrizar donde la cámara ya lo está mirando.
    if (paisAbierto && giroLado && !(vuelo && vuelo.sentido < 0)) {
      globe.rotation.y += delta * 0.014;
      cloudTime += delta * 0.0002;
    }
    if (vuelo) avanzarVuelo();
    else if (cambioOrbita) avanzarOrbita();
    else if (transition) {
      const t = THREE.MathUtils.clamp((time - transition.start) / transition.duration, 0, 1);
      const eased = t * t * t * (10 + t * (-15 + t * 6));
      controls.target.lerpVectors(transition.fromTarget, transition.toTarget, eased);
      frameGlobe(THREE.MathUtils.lerp(transition.fromFraming, transition.toFraming, eased));
      sunDirection.copy(transition.fromSol).lerp(solInicial, eased).normalize();
      // Follow an orbital arc, so returning from the far side never crosses Earth.
      cameraTransitionRotation.identity().slerp(transition.orbit, eased);
      camera.position
        .copy(transition.fromDirection)
        .applyQuaternion(cameraTransitionRotation)
        .multiplyScalar(THREE.MathUtils.lerp(transition.fromDistance, transition.toDistance, eased))
        .add(controls.target);
      camera.lookAt(controls.target);
      if (t === 1) {
        finishTransition();
        (view === 'globe' ? resetButton : exploreButton).focus({ preventScroll: true });
      }
    } else if (!paisAbierto) controls.update(delta);
    inverseRotation.copy(globe.quaternion).invert();
    uniforms.localSunDirection.value.copy(sunDirection).applyQuaternion(inverseRotation);
    uniforms.localCameraPosition.value.copy(camera.position).applyQuaternion(inverseRotation);
    uniforms.cloudOffset.value = cloudTime;
    cloudBrush.update(delta, inverseRotation, cloudTime, !dragging && !transition && !paisAbierto);
    // La selección de países solo existe con el planeta completo a la vista.
    countries.update(time, delta, seleccionBloqueada(), 1 - avanceMapa);
    modo.update(avanceMapa, Boolean(vuelo || cambioOrbita));
    renderEarth();
    frameCount++;
    if (!arranqueHecho && paisPendiente) {
      arranqueHecho = true;
      const pendiente = paisPendiente;
      paisPendiente = null;
      solicitarPais(pendiente.id, pendiente.inicial);
    }
    if (time - frameSampleStart > 2000) {
      canvas.dataset.fps = String(Math.round((frameCount * 1000) / (time - frameSampleStart)));
      frameCount = 0;
      frameSampleStart = time;
    }
  });
}

main().catch(error => {
  console.error('No se pudo preparar la Tierra:', error);
  renderer?.setAnimationLoop(null);
  showError(
    error.message === 'shader'
      ? 'No se pudieron preparar los efectos de luz en este navegador. Prueba con Chrome o Edge actualizado.'
      : 'La descarga pudo interrumpirse o la aceleración gráfica no está disponible. Comprueba que el servidor local sigue abierto y vuelve a intentarlo.',
  );
});
