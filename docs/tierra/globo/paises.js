import * as THREE from 'three';
import { geoPath, geoEquirectangular } from '../vendor/d3-geo.js';
import { countryAt, coordinatesFromPoint, searchCountries } from './paises-geo.js';
import { entradaCatalogo } from '../datos/datos-pais.js?v=20261115orb4';

const W = 4096,
  H = 2048;
export const countryColor = index =>
  new THREE.Vector3(index / 255, ((index * 37) % 256) / 255, ((index * 91) % 256) / 255);

// A polygon atlas is built once. Only a colour uniform changes on hover; the
// terrain shader provides depth/occlusion and the existing clouds compose above it.
export class Countries {
  static async create(options) {
    const response = await fetch('./assets/paises-50m.geo.json');
    if (!response.ok) throw new Error('No se pudieron cargar los países');
    return new Countries({ ...options, countries: (await response.json()).features });
  }
  constructor({ canvas, camera, globe, stage, uniforms, onSelect, countries }) {
    Object.assign(this, { canvas, camera, globe, stage, onSelect, countries });
    this.name = document.querySelector('#nombre-pais');
    this.search = document.querySelector('#buscar-pais');
    this.list = document.querySelector('#lista-paises');
    this.status = document.querySelector('#estado-pais');
    this.clear = document.querySelector('#limpiar-pais');
    this.panel = document.querySelector('#buscador-paises');
    this.selected = null;
    this.hover = null;
    this.active = null;
    this.pointer = null;
    // Bloqueada hasta que se abre el planeta completo; update() decide cada fotograma.
    this.down = new Map();
    this.multiTouch = false;
    this.blocked = true;
    this.lastPick = -Infinity;
    this.atenuar = 1;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.sphere = new THREE.Sphere(new THREE.Vector3(), 1);
    this.hit = new THREE.Vector3();
    this.inverse = new THREE.Quaternion();
    this.measure = document.createElement('canvas').getContext('2d');
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.uniforms = uniforms;
    const atlas = document.createElement('canvas');
    atlas.width = W;
    atlas.height = H;
    const ctx = atlas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const path = geoPath(
      geoEquirectangular()
        .scale(W / (2 * Math.PI))
        .translate([W / 2, H / 2])
        .precision(0.05),
      ctx,
    );
    for (const c of countries) {
      const i = c.properties.index;
      ctx.fillStyle = `rgb(${i},${(i * 37) % 256},${(i * 91) % 256})`;
      ctx.beginPath();
      path(c);
      ctx.fill();
    }
    const texture = new THREE.CanvasTexture(atlas);
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    uniforms.countryMap = { value: texture };
    uniforms.countryColor = { value: new THREE.Vector3() };
    uniforms.countryActive = { value: 0 };
    uniforms.countryOpacity = { value: 0 };
    canvas.addEventListener('pointermove', e => {
      this.pointer = e.pointerType === 'touch' ? null : { x: e.clientX, y: e.clientY };
      const down = this.down.get(e.pointerId);
      if (down) down.travel = Math.max(down.travel, Math.hypot(e.clientX - down.x, e.clientY - down.y));
    });
    canvas.addEventListener('pointerleave', () => {
      this.pointer = null;
      if (!this.down.size) this.setHover(null);
    });
    canvas.addEventListener('pointerdown', e => {
      if (this.blocked || e.button !== 0) return;
      this.down.set(e.pointerId, { x: e.clientX, y: e.clientY, travel: 0, time: e.timeStamp });
      if (this.down.size > 1) this.multiTouch = true;
    });
    window.addEventListener('pointerup', e => {
      const down = this.down.get(e.pointerId);
      if (!down) return;
      const travel = Math.max(down.travel, Math.hypot(e.clientX - down.x, e.clientY - down.y));
      const tap =
        !this.multiTouch &&
        !this.blocked &&
        travel < (e.pointerType === 'touch' ? 10 : 6) &&
        e.timeStamp - down.time < 650;
      this.down.delete(e.pointerId);
      if (tap) {
        const c = this.pick(e.clientX, e.clientY);
        if (c) this.select(c, false);
        else this.setHover(null);
      }
      if (!this.down.size) {
        this.multiTouch = false;
        this.lastPick = -Infinity;
      }
    });
    window.addEventListener('pointercancel', () => this.cancelPointer());
    window.addEventListener('blur', () => this.cancelPointer());
    this.search.addEventListener('input', () => this.openList());
    this.search.addEventListener('focus', () => {
      this.pointer = null;
      this.setHover(null);
      this.openList();
    });
    this.search.addEventListener('keydown', e => this.searchKey(e));
    this.list.addEventListener('pointerdown', e => e.preventDefault());
    this.list.addEventListener('click', e => {
      const option = e.target.closest('[data-country]');
      if (option)
        this.select(
          this.countries.find(c => c.id === option.dataset.country),
          true,
        );
    });
    this.search.addEventListener('blur', () => this.closeList());
    this.clear.addEventListener('click', () => {
      this.selected = null;
      this.search.value = '';
      this.pointer = null;
      this.setHover(null);
      this.refresh();
      this.search.focus();
    });
    canvas.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        this.selected = null;
        this.pointer = null;
        this.setHover(null);
        this.search.value = '';
        this.refresh();
      }
    });
    window.addEventListener('resize', () => this.fitName());
    document.fonts.ready.then(() => this.fitName());
    this.refresh();
  }
  limpiar() {
    this.selected = null;
    this.hover = null;
    this.pointer = null;
    this.search.value = '';
    this.closeList();
    this.refresh();
  }
  cancelPointer() {
    this.down.clear();
    this.multiTouch = false;
    this.pointer = null;
    this.setHover(null);
  }
  pick(x, y) {
    const rect = this.canvas.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    this.ndc.set(((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc, this.camera);
    if (!this.raycaster.ray.intersectSphere(this.sphere, this.hit)) return null;
    this.inverse.copy(this.globe.quaternion).invert();
    this.hit.applyQuaternion(this.inverse);
    return countryAt(this.countries, coordinatesFromPoint(this.hit), this.hover);
  }
  setHover(country) {
    if (this.hover?.id === country?.id) return;
    this.hover = country;
    this.refresh();
  }
  // El bloqueo vive aquí, no solo en la interfaz: en la portada ningún camino
  // (clic, toque o teclado) puede seleccionar un país.
  select(country, center) {
    if (!country || this.blocked) return false;
    this.marcar(country);
    this.onSelect(country, center);
    return true;
  }
  marcar(country) {
    this.selected = country;
    this.hover = null;
    this.pointer = null;
    this.search.value = country.properties.spanish || country.properties.name;
    this.closeList();
    this.search.blur();
    this.refresh();
  }
  refresh() {
    const next = this.hover || this.selected;
    this.clear.hidden = !this.selected;
    this.stage.dataset.countryState = this.hover ? 'hover' : this.selected ? 'selected' : 'neutral';
    document.querySelector('#anuncio-pais').textContent = this.selected
      ? `País seleccionado: ${this.selected.properties.spanish || this.selected.properties.name}`
      : '';
    if (next?.id === this.active?.id) return;
    this.active = next;
    this.name.textContent = next?.properties.spanish || next?.properties.name || '';
    this.name.classList.toggle('visible', Boolean(next));
    this.nameAnimation?.cancel();
    if (next && !this.reduceMotion.matches)
      this.nameAnimation = this.name.animate([{ opacity: 0.5 }, { opacity: 0.94 }], {
        duration: 150,
        easing: 'ease-out',
      });
    this.stage.dataset.country = next?.id || '';
    this.uniforms.countryActive.value = next ? 1 : 0;
    if (next) this.uniforms.countryColor.value.copy(countryColor(next.properties.index));
    this.fitName();
    // Announce committed choices, not every transient mouse crossing.
  }
  fitName() {
    if (!this.active) return;
    const { width, height } = this.canvas.getBoundingClientRect();
    const maxSize = Math.min(height * 0.17, width * 0.2, 170);
    this.measure.font = `700 ${maxSize}px Atlas`;
    const measured = this.measure.measureText(this.name.textContent).width;
    const size = maxSize * Math.min(1, (width - (width < 641 ? 28 : 80)) / Math.max(measured, 1));
    this.name.style.fontSize = `${size}px`;
    // The baseline is just below the silhouette; the opaque Earth masks it.
    this.name.style.top = 'calc(var(--globe-top,21%) - .8em)';
  }
  openList() {
    this.results = searchCountries(this.countries, this.search.value);
    this.optionIndex = -1;
    this.list.replaceChildren();
    for (const c of this.results) {
      const item = document.createElement('li');
      item.id = `opcion-${c.id}`;
      item.setAttribute('role', 'option');
      item.dataset.country = c.id;
      item.setAttribute('aria-selected', 'false');
      const label = document.createElement('span');
      label.textContent = c.properties.spanish || c.properties.name;
      if (entradaCatalogo(c.id)) {
        const marca = document.createElement('em');
        marca.textContent = 'Con datos';
        label.append(marca);
      }
      item.append(label);
      if (c.properties.spanish && c.properties.spanish !== c.properties.name) {
        const small = document.createElement('small');
        small.textContent = c.properties.name;
        item.append(small);
      }
      this.list.append(item);
    }
    if (!this.results.length) {
      const empty = document.createElement('li');
      empty.className = 'sin-resultados';
      empty.textContent = 'No encontramos ese país';
      this.list.append(empty);
    }
    this.list.hidden = false;
    this.search.setAttribute('aria-expanded', 'true');
    this.search.removeAttribute('aria-activedescendant');
  }
  closeList() {
    this.list.hidden = true;
    this.search.setAttribute('aria-expanded', 'false');
    this.search.removeAttribute('aria-activedescendant');
  }
  searchKey(e) {
    if (e.key === 'Escape') {
      this.closeList();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.list.hidden) this.openList();
      if (!this.results.length) return;
      this.optionIndex =
        (this.optionIndex + (e.key === 'ArrowDown' ? 1 : -1) + this.results.length) % this.results.length;
      for (const [i, li] of [...this.list.children].entries())
        li.setAttribute('aria-selected', String(i === this.optionIndex));
      const li = this.list.children[this.optionIndex];
      this.search.setAttribute('aria-activedescendant', li.id);
      li.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.list.hidden) this.openList();
      if (this.results.length) this.select(this.results[Math.max(0, this.optionIndex)], true);
    }
  }
  update(time, delta, blocked, atenuar = 1) {
    if (blocked !== this.bloqueoPintado) {
      this.bloqueoPintado = blocked;
      this.panel.inert = blocked;
      this.search.disabled = blocked;
    }
    this.blocked = blocked;
    this.atenuar = atenuar;
    if (blocked) {
      this.setHover(null);
      this.pointer = null;
      this.closeList();
    } else if (this.pointer && !this.down.size && time - this.lastPick > 40) {
      this.lastPick = time;
      this.setHover(this.pick(this.pointer.x, this.pointer.y));
    }
    const target = this.active ? this.atenuar : 0;
    this.uniforms.countryOpacity.value = this.reduceMotion.matches
      ? target
      : THREE.MathUtils.damp(this.uniforms.countryOpacity.value, target, 18, delta || 0.016);
  }
}
