// Satélites girando alrededor de la Tierra: Aqua (MODIS) y NOAA-20 (VIIRS).
// Órbitas polares heliosincrónicas (inclinación 98,2°), altura exagerada para que se vean.
// Se dibujan en una pasada aparte, después de las nubes, con la Tierra como oclusor.
import * as THREE from 'three';

const INCLINACION = THREE.MathUtils.degToRad(98.2);
const SATELITES = [
  // nodo: ángulo del plano orbital; vuelta: segundos por órbita en pantalla (la real dura ~99 min).
  { nombre: 'Aqua', sensor: 'MODIS', color: 0xd9761c, radio: 1.13, nodo: 58, vuelta: 95, fase: 0.08 },
  { nombre: 'NOAA-20', sensor: 'VIIRS', color: 0x1597b0, radio: 1.155, nodo: 22, vuelta: 110, fase: 0.55 },
];
const ESTELA = 0.32; // fracción de la órbita que deja rastro

function planoOrbital(nodoGrados) {
  const n = THREE.MathUtils.degToRad(nodoGrados);
  const u = new THREE.Vector3(Math.cos(n), 0, -Math.sin(n));
  const w = new THREE.Vector3(-Math.sin(n), 0, -Math.cos(n));
  const v = w.multiplyScalar(Math.cos(INCLINACION)).add(new THREE.Vector3(0, Math.sin(INCLINACION), 0));
  return { u, v };
}
function puntoOrbita({ u, v }, radio, angulo, destino = new THREE.Vector3()) {
  return destino
    .copy(u)
    .multiplyScalar(Math.cos(angulo) * radio)
    .addScaledVector(v, Math.sin(angulo) * radio);
}

let brilloCache = null;
function texturaBrillo() {
  if (brilloCache) return brilloCache;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,0.9)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  brilloCache = new THREE.CanvasTexture(c);
  brilloCache.colorSpace = THREE.SRGBColorSpace;
  return brilloCache;
}
function modeloSatelite(colorSensor) {
  const g = new THREE.Group();
  const oro = new THREE.MeshStandardMaterial({ color: 0xd8b04a, metalness: 0.75, roughness: 0.32, transparent: true });
  const panel = new THREE.MeshStandardMaterial({
    color: 0x2c55b8,
    metalness: 0.4,
    roughness: 0.35,
    emissive: 0x0c1d48,
    transparent: true,
  });
  const marco = new THREE.MeshStandardMaterial({ color: 0xc9d3e0, metalness: 0.6, roughness: 0.4, transparent: true });
  const sensor = new THREE.MeshBasicMaterial({ color: colorSensor, transparent: true });
  const cuerpo = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.016), oro);
  g.add(cuerpo);
  for (const lado of [-1, 1]) {
    // Alas a lo largo de la dirección de vuelo, con la cara hacia fuera del plano orbital (se ven de frente).
    const brazo = new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.008, 0.0012), marco);
    brazo.position.y = lado * 0.012;
    const ala = new THREE.Mesh(new THREE.BoxGeometry(0.0008, 0.026, 0.012), panel);
    ala.position.y = lado * 0.029;
    g.add(brazo, ala);
  }
  // Instrumento mirando a la Tierra (eje +z del modelo apunta al centro).
  const ojo = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0035, 0.005, 12), sensor);
  ojo.rotation.x = Math.PI / 2;
  ojo.position.z = 0.0095;
  g.add(ojo);
  // Brillo suave para encontrarlo de lejos
  const brillo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texturaBrillo(), color: colorSensor, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  brillo.scale.setScalar(0.07);
  g.add(brillo);
  g.scale.setScalar(2.4);
  g.userData.materiales = [oro, panel, marco, sensor, brillo.material];
  return g;
}

export class Orbitas {
  constructor({ camera, sunDirection, contenedor, lienzo }) {
    this.camera = camera;
    this.sunDirection = sunDirection;
    this.escena = new THREE.Scene();
    this.opacidad = 0;
    this.tiempo = 0;
    this.lienzo = lienzo;
    // La Tierra solo escribe profundidad: tapa lo que pasa por detrás.
    const oclusor = new THREE.Mesh(new THREE.SphereGeometry(1.0, 64, 48), new THREE.MeshBasicMaterial({ colorWrite: false }));
    oclusor.renderOrder = -1;
    this.escena.add(oclusor);
    this.sol = new THREE.DirectionalLight(0xffffff, 2.6);
    this.escena.add(this.sol, this.sol.target, new THREE.AmbientLight(0x8fa6c8, 0.55));

    this.sats = SATELITES.map(s => {
      const plano = planoOrbital(s.nodo);
      const modelo = modeloSatelite(s.color);
      // Anillo tenue de la órbita completa
      const anillo = [];
      for (let i = 0; i <= 256; i++) anillo.push(puntoOrbita(plano, s.radio, (i / 256) * Math.PI * 2));
      const lineaOrbita = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(anillo),
        new THREE.LineBasicMaterial({ color: s.color, transparent: true, opacity: 0.12, depthWrite: false }),
      );
      // Estela: más brillante cerca del satélite, se apaga hacia atrás.
      const nEstela = 64;
      const posEstela = new Float32Array((nEstela + 1) * 3);
      const colEstela = new Float32Array((nEstela + 1) * 4);
      const c = new THREE.Color(s.color);
      for (let i = 0; i <= nEstela; i++) {
        colEstela.set([c.r, c.g, c.b, Math.pow(1 - i / nEstela, 1.6) * 0.85], i * 4);
      }
      const geoEstela = new THREE.BufferGeometry();
      geoEstela.setAttribute('position', new THREE.BufferAttribute(posEstela, 3));
      geoEstela.setAttribute('color', new THREE.BufferAttribute(colEstela, 4));
      const estela = new THREE.Line(
        geoEstela,
        new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
      );
      estela.frustumCulled = false;
      this.escena.add(lineaOrbita, estela, modelo);
      const etiqueta = document.createElement('div');
      etiqueta.className = 'etiqueta-satelite';
      etiqueta.innerHTML = `<b>${s.nombre}</b><span style="color:#${c.getHexString()}">${s.sensor}</span>`;
      etiqueta.hidden = true;
      contenedor?.append(etiqueta);
      return { ...s, plano, modelo, lineaOrbita, estela, posEstela, nEstela, etiqueta };
    });
    this.escena.visible = false;
    this.tmp = { p: new THREE.Vector3(), t: new THREE.Vector3(), x: new THREE.Vector3(), z: new THREE.Vector3(), m: new THREE.Matrix4() };
  }

  // visible: 0 a 1 (se desvanece al entrar a un país o en la portada).
  update(delta, visible) {
    this.opacidad += (visible - this.opacidad) * Math.min(1, delta * 4);
    this.tiempo += delta;
    const op = this.opacidad;
    this.escena.visible = op > 0.02;
    this.sol.position.copy(this.sunDirection).multiplyScalar(5);
    const { p, t, x, z, m } = this.tmp;
    const caja = this.lienzo.getBoundingClientRect();
    const ancho = caja.width,
      alto = caja.height;
    for (const s of this.sats) {
      const ang = ((this.tiempo / s.vuelta + s.fase) % 1) * Math.PI * 2;
      puntoOrbita(s.plano, s.radio, ang, p);
      t.copy(s.plano.u)
        .multiplyScalar(-Math.sin(ang))
        .addScaledVector(s.plano.v, Math.cos(ang))
        .normalize();
      z.copy(p).negate().normalize();
      x.crossVectors(t, z).normalize();
      m.makeBasis(x, t, z);
      s.modelo.position.copy(p);
      s.modelo.quaternion.setFromRotationMatrix(m);
      for (const mat of s.modelo.userData.materiales) mat.opacity = mat.isSpriteMaterial ? op * 0.55 : op;
      s.lineaOrbita.material.opacity = 0.12 * op;
      s.estela.material.opacity = op;
      for (let i = 0; i <= s.nEstela; i++) {
        puntoOrbita(s.plano, s.radio, ang - (i / s.nEstela) * ESTELA * Math.PI * 2, x);
        s.posEstela.set([x.x, x.y, x.z], i * 3);
      }
      s.estela.geometry.attributes.position.needsUpdate = true;
      this.etiquetar(s, p, op, ancho, alto);
    }
  }
  // Etiqueta HTML junto al satélite; se oculta si la Tierra lo tapa.
  etiquetar(s, p, op, ancho, alto) {
    const cam = this.camera.position;
    const d = p.clone().sub(cam);
    const largo = d.length();
    d.divideScalar(largo);
    const b = cam.dot(d),
      disc = b * b - cam.lengthSq() + 1;
    const tapado = disc > 0 && -b - Math.sqrt(disc) > 0 && -b - Math.sqrt(disc) < largo;
    if (op < 0.3 || tapado) {
      s.etiqueta.hidden = true;
      return;
    }
    const v = p.clone().project(this.camera);
    if (v.z > 1) {
      s.etiqueta.hidden = true;
      return;
    }
    s.etiqueta.hidden = false;
    s.etiqueta.style.opacity = String(Math.min(1, (op - 0.3) / 0.5));
    s.etiqueta.style.transform = `translate(${Math.round(((v.x + 1) / 2) * ancho + 16)}px, ${Math.round(((1 - v.y) / 2) * alto - 10)}px)`;
  }
  render(renderer) {
    if (!this.escena.visible) return;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.escena, this.camera);
    renderer.autoClear = auto;
  }
}
