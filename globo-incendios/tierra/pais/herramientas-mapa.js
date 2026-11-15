// Herramientas del mapa de Chile: puntos originales o armonizados, poblaciones (INE, Censo 2024)
// y «Medir área» (arrastrar un rectángulo para contar los focos que caen dentro).
const numero = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const corto = n => (n >= 1e6 ? `${dec1.format(n / 1e6)} M` : n >= 1000 ? `${numero.format(n / 1000)} mil` : numero.format(n));
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const ICONOS = {
  poblaciones:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V10l5-3v14M10 21V4l9 5v12"/><path d="M13 12h3M13 16h3"/></svg>',
  area: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="3 2.4" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="1.5"/></svg>',
  mover:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  cerrar:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};
const POSICION = 'fireorbit.herramientas';

export class HerramientasMapa {
  // escena: #escena. modo: ModoPais. describirFiltro(): { periodo, sensor }. onPuntos(modo): 'originales' | 'armonizados'.
  constructor({ escena, modo, describirFiltro, onPuntos }) {
    Object.assign(this, { escena, modo, describirFiltro, onPuntos });
    this.puntos = 'originales';
    this.lista = null;
    this.raiz = document.createElement('div');
    this.raiz.className = 'herramientas-mapa';
    this.raiz.setAttribute('role', 'toolbar');
    this.raiz.setAttribute('aria-label', 'Herramientas del mapa de Chile');
    this.raiz.innerHTML = `
      <button type="button" class="hm-mover" data-mover aria-label="Mover herramientas (arrastra o usa las flechas)" title="Arrastra para mover">${ICONOS.mover}</button>
      <div class="hm-puntos" role="group" aria-label="Puntos en el mapa">
        <button type="button" data-puntos="originales" aria-pressed="true">Originales</button>
        <button type="button" data-puntos="armonizados" aria-pressed="false" title="Actividad de fuego armonizada con IA (escala VIIRS), total del mes o del año">Armonizados</button>
      </div>
      <button type="button" class="hm-boton" data-herr="poblaciones" aria-pressed="false">${ICONOS.poblaciones}Poblaciones</button>
      <button type="button" class="hm-boton" data-herr="area" aria-pressed="false" title="Arrastra sobre el mapa para contar los focos de un área">${ICONOS.area}Área</button>`;
    this.caja = document.createElement('div');
    this.caja.className = 'caja-area';
    this.caja.hidden = true;
    this.resultado = document.createElement('section');
    this.resultado.className = 'resultado-area';
    this.resultado.setAttribute('aria-live', 'polite');
    this.resultado.hidden = true;
    escena.append(this.raiz, this.caja, this.resultado);
    this.raiz.addEventListener('click', e => this.alHacerClic(e));
    this.hacerMovible();
    this.resultado.addEventListener('click', e => {
      if (e.target.closest('[data-cerrar-area]')) this.limpiarArea();
    });
    modo.onArea = a => this.dibujarArea(a);
    modo.onVistaMovida = () => this.limpiarArea();
    addEventListener('keydown', e => {
      if (e.key === 'Escape' && !this.resultado.hidden) this.limpiarArea();
    });
  }

  // Al abrir un país: las herramientas solo existen para Chile (con detalle diario).
  mostrar(chile) {
    this.escena.dataset.chile = chile ? 'si' : 'no';
    if (!chile) {
      this.reiniciar();
      return;
    }
    this.cargar();
  }
  cargar() {
    this.carga ||= fetch('../data/chile-poblaciones.json?v=20261115chl3')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => {
        this.lista = d.localidades;
        this.modo.listaPoblaciones = this.lista;
        if (this.boton('poblaciones').getAttribute('aria-pressed') === 'true') this.modo.ponerPoblaciones(this.lista);
        return this.lista;
      })
      .catch(error => {
        console.warn('Poblaciones no disponibles:', error);
        this.carga = null;
        return null;
      });
    return this.carga;
  }
  reiniciar() {
    this.fijarPuntos('originales', false);
    this.boton('poblaciones').setAttribute('aria-pressed', 'false');
    this.modo.ponerPoblaciones(null);
    this.boton('area').setAttribute('aria-pressed', 'false');
    this.modo.activarArea(false);
    this.limpiarArea();
    this.ayuda();
  }
  boton(nombre) {
    return this.raiz.querySelector(`[data-herr="${nombre}"]`);
  }
  alHacerClic(e) {
    const puntos = e.target.closest('.hm-puntos [data-puntos]')?.dataset.puntos;
    if (puntos) {
      this.fijarPuntos(puntos, true);
      return;
    }
    const herr = e.target.closest('[data-herr]')?.dataset.herr;
    if (!herr) return;
    const b = this.boton(herr);
    const activo = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(activo));
    if (herr === 'poblaciones') {
      if (activo) this.cargar().then(lista => lista && this.modo.ponerPoblaciones(lista));
      else this.modo.ponerPoblaciones(null);
    }
    if (herr === 'area') {
      this.modo.activarArea(activo);
      if (!activo) this.limpiarArea();
    }
    this.ayuda();
  }
  fijarPuntos(valor, avisar) {
    if (this.puntos === valor && avisar) return;
    this.puntos = valor;
    for (const b of this.raiz.querySelectorAll('[data-puntos]')) b.setAttribute('aria-pressed', String(b.dataset.puntos === valor));
    this.escena.dataset.puntosMapa = valor;
    this.limpiarArea();
    this.ayuda();
    if (avisar) this.onPuntos?.(valor);
  }
  ayuda() {}

  // ---------- Mover la barra ----------
  // Se arrastra desde el asa (o con las flechas). La posición se recuerda en este navegador.
  hacerMovible() {
    const asa = this.raiz.querySelector('[data-mover]');
    try {
      const p = JSON.parse(localStorage.getItem(POSICION) || 'null');
      if (p) this.ponerPosicion(p.x, p.y, false);
    } catch {
      /* sin almacenamiento: posición por defecto */
    }
    let inicio = null;
    asa.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const r = this.raiz.getBoundingClientRect();
      inicio = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
      asa.setPointerCapture(e.pointerId);
      this.raiz.classList.add('moviendo');
      e.preventDefault();
    });
    asa.addEventListener('pointermove', e => {
      if (inicio?.id !== e.pointerId) return;
      this.ponerPosicion(e.clientX - inicio.dx, e.clientY - inicio.dy, false);
    });
    const soltar = e => {
      if (inicio?.id !== e.pointerId) return;
      inicio = null;
      this.raiz.classList.remove('moviendo');
      this.guardarPosicion();
    };
    asa.addEventListener('pointerup', soltar);
    asa.addEventListener('pointercancel', soltar);
    asa.addEventListener('keydown', e => {
      const paso = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[e.key];
      if (!paso) return;
      e.preventDefault();
      const r = this.raiz.getBoundingClientRect();
      this.ponerPosicion(r.left + paso[0], r.top + paso[1], true);
    });
    asa.addEventListener('dblclick', () => {
      this.raiz.style.left = this.raiz.style.top = '';
      try {
        localStorage.removeItem(POSICION);
      } catch {
        /* nada */
      }
    });
    addEventListener('resize', () => {
      if (this.raiz.style.left) {
        const r = this.raiz.getBoundingClientRect();
        this.ponerPosicion(r.left, r.top, false);
      }
    });
  }
  ponerPosicion(x, y, guardar) {
    const caja = this.escena.getBoundingClientRect();
    const r = this.raiz.getBoundingClientRect();
    const ancho = r.width || 360,
      alto = r.height || 40;
    const left = Math.max(8, Math.min(x - caja.left, caja.width - ancho - 8));
    const top = Math.max(8, Math.min(y - caja.top, caja.height - alto - 8));
    this.raiz.style.left = `${Math.round(left)}px`;
    this.raiz.style.top = `${Math.round(top)}px`;
    if (guardar) this.guardarPosicion();
  }
  guardarPosicion() {
    try {
      localStorage.setItem(POSICION, JSON.stringify({ x: parseFloat(this.raiz.style.left), y: parseFloat(this.raiz.style.top) }));
    } catch {
      /* nada */
    }
  }

  // Población más cercana a un punto (distancia en km sobre la esfera).
  cercana(lon, lat) {
    if (!this.lista || this.escena.dataset.chile !== 'si' || !Number.isFinite(lon)) return null;
    const rad = Math.PI / 180;
    let mejor = null,
      dMin = Infinity;
    for (const [nombre, lo, la, habitantes] of this.lista) {
      const dLat = (la - lat) * rad,
        dLon = (lo - lon) * rad;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat * rad) * Math.cos(la * rad) * Math.sin(dLon / 2) ** 2;
      const d = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
      if (d < dMin) {
        dMin = d;
        mejor = { nombre, habitantes, km: d };
      }
    }
    return dMin < 80 ? mejor : null;
  }

  // ---------- Medir área ----------
  dibujarArea(a) {
    if (!a) {
      this.limpiarArea();
      return;
    }
    const x = Math.min(a.x0, a.x1),
      y = Math.min(a.y0, a.y1),
      w = Math.abs(a.x1 - a.x0),
      h = Math.abs(a.y1 - a.y0);
    Object.assign(this.caja.style, { transform: `translate(${x}px, ${y}px)`, width: `${w}px`, height: `${h}px` });
    this.caja.hidden = false;
    if (!a.final) {
      this.resultado.hidden = true;
      return;
    }
    this.mostrarResultado(a.resultado, x + w, y + h, x, y);
  }
  mostrarResultado(r, xDer, yAbajo, xIzq, yArriba) {
    if (!r) {
      this.limpiarArea();
      return;
    }
    const { periodo, sensor } = this.describirFiltro?.() ?? {};
    const armonizado = r.armonizado !== null;
    const lineas = [];
    if (armonizado) {
      lineas.push(`<p class="ra-cifra"><strong>${numero.format(Math.round(r.armonizado))}</strong> celdas-día con fuego</p>`);
      lineas.push('<p class="ra-nota">Armonizado con IA (escala VIIRS)</p>');
    } else {
      const total = r.modis + r.viirs;
      lineas.push(`<p class="ra-cifra"><strong>${numero.format(total)}</strong> ${total === 1 ? 'foco' : 'focos'}</p>`);
      const partes = [];
      if (r.viirs) partes.push(`<i class="marca-sensor VIIRS" aria-hidden="true"></i>VIIRS ${numero.format(r.viirs)}`);
      if (r.modis) partes.push(`<i class="marca-sensor MODIS" aria-hidden="true"></i>MODIS ${numero.format(r.modis)}`);
      if (partes.length) lineas.push(`<p class="ra-sensores">${partes.join('<span>·</span>')}</p>`);
      if (r.frpMax) lineas.push(`<p class="ra-nota">Potencia máxima: ${dec1.format(r.frpMax)} MW</p>`);
    }
    const pobl = [...r.poblaciones].sort((a, b) => b[3] - a[3]);
    if (pobl.length) {
      const total = pobl.reduce((s, p) => s + p[3], 0);
      lineas.push(
        `<p class="ra-pobl"><b>Poblaciones en el área</b> (${corto(total)} hab.):<br>${pobl
          .slice(0, 5)
          .map(p => `${esc(p[0])} <small>${corto(p[3])}</small>`)
          .join(', ')}${pobl.length > 5 ? ` y ${pobl.length - 5} más` : ''}</p>`,
      );
    } else if (r.centro) {
      const c = this.cercana(r.centro[0], r.centro[1]);
      if (c) lineas.push(`<p class="ra-pobl"><b>Población más cercana:</b> ${esc(c.nombre)} <small>${corto(c.habitantes)} hab.</small>, a ${numero.format(c.km)} km del centro</p>`);
    }
    this.resultado.innerHTML = `
      <header><strong>Área seleccionada</strong><button type="button" class="ra-cerrar" data-cerrar-area aria-label="Borrar área">${ICONOS.cerrar}</button></header>
      <p class="ra-sub">${r.km2 ? `≈ ${numero.format(r.km2)} km² · ` : ''}${esc(periodo ?? '')}${!armonizado && sensor ? ` · ${esc(sensor)}` : ''}</p>
      ${lineas.join('')}`;
    this.resultado.hidden = false;
    // Junto al rectángulo, sin salirse de la pantalla ni tapar el panel.
    const t = this.resultado.getBoundingClientRect();
    const panel = document.querySelector('#panel-pais');
    const limite = panel && !panel.hidden && innerWidth > 720 ? panel.getBoundingClientRect().left - 12 : innerWidth - 12;
    let left = xDer + 12;
    if (left + t.width > limite) left = xIzq - t.width - 12;
    left = Math.max(12, Math.min(left, limite - t.width));
    const top = Math.max(76, Math.min(yAbajo - t.height, innerHeight - t.height - 12, yArriba));
    this.resultado.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
  limpiarArea() {
    this.caja.hidden = true;
    this.resultado.hidden = true;
  }
}
