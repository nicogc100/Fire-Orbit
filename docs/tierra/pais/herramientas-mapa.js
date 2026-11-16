// Herramientas del mapa de Chile: puntos originales o armonizados, poblaciones (INE, Censo 2024)
// y «Área»: dibujar un polígono (o arrastrar un rectángulo) para consultar las detecciones que
// caen dentro y la evolución histórica de esa área.
import { medidasArea } from './modo-pais.js?v=20261115orb5';

const numero = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const corto = n => (n >= 1e6 ? `${dec1.format(n / 1e6)} M` : n >= 1000 ? `${numero.format(n / 1000)} mil` : numero.format(n));
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const ICONOS = {
  poblaciones:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V10l5-3v14M10 21V4l9 5v12"/><path d="M13 12h3M13 16h3"/></svg>',
  area: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 6.5 17 4l3 9-7 7-8-4z" stroke-dasharray="3 2.4"/><circle cx="5" cy="6.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="17" cy="4" r="1.4" fill="currentColor" stroke="none"/><circle cx="20" cy="13" r="1.4" fill="currentColor" stroke="none"/><circle cx="13" cy="20" r="1.4" fill="currentColor" stroke="none"/><circle cx="5" cy="16" r="1.4" fill="currentColor" stroke="none"/></svg>',
  mover:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  cerrar:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};
const POSICION = 'fireorbit.herramientas';
const SVG = 'http://www.w3.org/2000/svg';

export class HerramientasMapa {
  // escena: #escena. modo: ModoPais. describirFiltro(): { periodo, sensor, anio }.
  // onPuntos(modo): 'originales' | 'armonizados'. historia(poligono): Promise de serieDeArea().
  constructor({ escena, modo, describirFiltro, onPuntos, historia }) {
    Object.assign(this, { escena, modo, describirFiltro, onPuntos, historia });
    this.puntos = 'originales';
    this.lista = null;
    this.trazo = []; // vértices [lon, lat] del polígono que se está dibujando
    this.cursor = null; // posición del puntero mientras se dibuja
    this.rect = null; // rectángulo en pantalla mientras se arrastra
    this.area = null; // polígono terminado: { geo, historia }
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
      <button type="button" class="hm-boton" data-herr="area" aria-pressed="false" title="Dibuja un área para consultar sus detecciones y su evolución histórica">${ICONOS.area}Área</button>`;
    this.dibujo = document.createElementNS(SVG, 'svg');
    this.dibujo.setAttribute('class', 'trazo-area');
    this.dibujo.setAttribute('aria-hidden', 'true');
    this.dibujo.hidden = true;
    this.guia = document.createElement('div');
    this.guia.className = 'ayuda-area';
    this.guia.hidden = true;
    this.resultado = document.createElement('section');
    this.resultado.className = 'resultado-area';
    this.resultado.setAttribute('aria-live', 'polite');
    this.resultado.setAttribute('aria-label', 'Área seleccionada');
    this.resultado.hidden = true;
    escena.append(this.raiz, this.dibujo, this.guia, this.resultado);
    this.raiz.addEventListener('click', e => this.alHacerClic(e));
    this.hacerMovible();
    this.guia.addEventListener('click', e => {
      const accion = e.target.closest('[data-area]')?.dataset.area;
      if (accion === 'deshacer') this.deshacer();
      if (accion === 'cerrar') this.terminar(this.trazo);
    });
    this.resultado.addEventListener('click', e => {
      if (e.target.closest('[data-cerrar-area]')) this.limpiarArea();
    });
    this.escucharGrafico();
    modo.onAreaPuntero = (tipo, e) => this.alPuntero(tipo, e);
    modo.onDibujo = () => this.dibujar();
    modo.onPuntosCambiados = () => this.refrescarArea();
    addEventListener('keydown', e => {
      if (this.escena.dataset.chile !== 'si') return;
      if (e.key === 'Escape' && this.trazo.length) {
        this.trazo = [];
        this.dibujar();
        this.ayuda();
      } else if (e.key === 'Escape' && this.area) this.limpiarArea();
      else if (e.key === 'Enter' && this.trazo.length >= 3) this.terminar(this.trazo);
      else if ((e.key === 'Backspace' || e.key === 'Delete') && this.trazo.length && !e.target.closest?.('input, select, textarea')) this.deshacer();
    });
    addEventListener('resize', () => {
      this.dibujar();
      this.ayuda();
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
    this.carga ||= fetch('../data/chile-poblaciones.json?v=20261115orb5')
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
  }
  boton(nombre) {
    return this.raiz.querySelector(`[data-herr="${nombre}"]`);
  }
  get dibujando() {
    return this.boton('area').getAttribute('aria-pressed') === 'true';
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
      // Al dejar de dibujar se descarta el trazo a medias; un área ya cerrada sigue en el mapa.
      this.modo.activarArea(activo);
      this.trazo = [];
      this.rect = this.cursor = null;
      this.dibujar();
    }
    this.ayuda();
  }
  fijarPuntos(valor, avisar) {
    if (this.puntos === valor && avisar) return;
    this.puntos = valor;
    for (const b of this.raiz.querySelectorAll('[data-puntos]')) b.setAttribute('aria-pressed', String(b.dataset.puntos === valor));
    this.escena.dataset.puntosMapa = valor;
    if (avisar) this.onPuntos?.(valor);
  }
  // Instrucciones mientras se dibuja, justo debajo de la barra.
  ayuda() {
    const visible = this.dibujando && !this.area && this.escena.dataset.chile === 'si';
    this.guia.hidden = !visible;
    if (!visible) return;
    const n = this.trazo.length;
    const tactil = matchMedia('(pointer: coarse)').matches;
    const texto = !n
      ? `${tactil ? 'Toca' : 'Haz clic en'} el mapa para marcar los vértices del área, o arrastra para trazar un rectángulo.`
      : n < 3
        ? `Marca al menos 3 vértices (llevas ${n}).`
        : `${n} vértices. ${tactil ? 'Toca el primer vértice' : 'Doble clic o clic en el primer vértice'} para cerrar el área.`;
    this.guia.innerHTML = `<span>${texto}</span>${
      n ? `<button type="button" data-area="deshacer">Deshacer</button>` : ''
    }${n >= 3 ? `<button type="button" class="principal" data-area="cerrar">Cerrar área</button>` : ''}`;
    const barra = this.raiz.getBoundingClientRect(),
      caja = this.escena.getBoundingClientRect();
    const ancho = this.guia.offsetWidth;
    this.guia.style.left = `${Math.round(Math.max(8, Math.min(barra.left - caja.left, caja.width - ancho - 8)))}px`;
    this.guia.style.top = `${Math.round(barra.bottom - caja.top + 6)}px`;
  }

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
      this.ayuda();
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
    if (this.guia && !this.guia.hidden) this.ayuda();
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

  // ---------- Dibujar el área ----------
  // El mapa avisa de cada gesto mientras «Área» está activa. Un clic añade un vértice;
  // arrastrar (sin vértices puestos) traza un rectángulo.
  alPuntero(tipo, e) {
    const x = e.clientX,
      y = e.clientY;
    if (tipo === 'baja') {
      this.pulso = { x, y, movido: false };
      return;
    }
    if (tipo === 'cancela') {
      this.pulso = this.rect = null;
      this.dibujar();
      return;
    }
    if (tipo === 'flota') {
      if (this.trazo.length && e.pointerType !== 'touch') {
        this.cursor = [x, y];
        this.dibujar();
      }
      return;
    }
    if (tipo === 'doble') {
      if (this.trazo.length >= 3) this.terminar(this.trazo);
      return;
    }
    const p = this.pulso;
    if (!p) return;
    if (tipo === 'arrastra') {
      if (Math.hypot(x - p.x, y - p.y) > 6) p.movido = true;
      if (p.movido && !this.trazo.length) {
        if (this.area) this.limpiarArea();
        this.rect = { x0: p.x, y0: p.y, x1: x, y1: y };
        this.dibujar();
      }
      return;
    }
    // 'sube'
    this.pulso = null;
    const r = this.rect;
    this.rect = null;
    if (r && Math.abs(r.x1 - r.x0) >= 6 && Math.abs(r.y1 - r.y0) >= 6) {
      const esquinas = [
        [r.x0, r.y0],
        [r.x1, r.y0],
        [r.x1, r.y1],
        [r.x0, r.y1],
      ].map(([a, b]) => this.modo.lonLatEn(a, b));
      if (esquinas.every(Boolean)) this.terminar(esquinas);
      else this.dibujar();
      return;
    }
    // Clic: con un área ya cerrada empieza otra.
    if (this.area) this.limpiarArea();
    const aPantalla = this.modo.proyectorGeo();
    if (!aPantalla) return;
    const tactil = e.pointerType === 'touch';
    if (this.trazo.length >= 3) {
      const [fx, fy] = aPantalla(...this.trazo[0]);
      if (Math.hypot(x - fx, y - fy) <= (tactil ? 22 : 12)) {
        this.terminar(this.trazo);
        return;
      }
    }
    if (this.trazo.length) {
      const [ux, uy] = aPantalla(...this.trazo.at(-1));
      if (Math.hypot(x - ux, y - uy) < 5) return; // segundo clic de un doble clic
    }
    const geo = this.modo.lonLatEn(x, y);
    if (!geo) return;
    this.trazo.push(geo);
    this.cursor = tactil ? null : [x, y];
    this.dibujar();
    this.ayuda();
  }
  deshacer() {
    this.trazo.pop();
    this.dibujar();
    this.ayuda();
  }
  terminar(geo) {
    if (!geo || geo.length < 3) return;
    this.area = { geo: geo.map(v => [...v]), historia: null };
    this.trazo = [];
    this.cursor = this.rect = null;
    this.dibujar();
    this.ayuda();
    this.contar(true);
    const area = this.area;
    this.historia?.(area.geo)
      .then(h => {
        if (this.area !== area) return;
        area.historia = h ?? false;
        this.pintarHistoria();
        this.colocarResultado();
      })
      .catch(error => {
        console.warn('Evolución del área no disponible:', error);
        if (this.area !== area) return;
        area.historia = false;
        this.pintarHistoria();
      });
  }
  // El polígono vive en longitud y latitud: se vuelve a proyectar cada vez que el mapa se dibuja.
  dibujar() {
    const hayAlgo = this.rect || this.trazo.length || this.area;
    this.dibujo.hidden = !hayAlgo;
    if (!hayAlgo) {
      this.dibujo.replaceChildren();
      return;
    }
    const caja = this.escena.getBoundingClientRect();
    const partes = [];
    const f = v => v.toFixed(1);
    if (this.rect) {
      const { x0, y0, x1, y1 } = this.rect;
      partes.push(
        `<rect class="ta-forma" x="${f(Math.min(x0, x1) - caja.left)}" y="${f(Math.min(y0, y1) - caja.top)}" width="${f(Math.abs(x1 - x0))}" height="${f(Math.abs(y1 - y0))}"/>`,
      );
    }
    const aPantalla = this.trazo.length || this.area ? this.modo.proyectorGeo() : null;
    const pantalla = geo => geo.map(([lon, lat]) => aPantalla(lon, lat)).map(([x, y]) => [x - caja.left, y - caja.top]);
    if (aPantalla && this.area) {
      const pts = pantalla(this.area.geo);
      partes.push(`<polygon class="ta-forma" points="${pts.map(p => `${f(p[0])},${f(p[1])}`).join(' ')}"/>`);
      const { km2 } = medidasArea(this.area.geo);
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length,
        cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      const ancho = Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0]));
      if (ancho > 90) partes.push(`<text class="ta-medida" x="${f(cx)}" y="${f(cy)}">${numero.format(km2)} km²</text>`);
    }
    if (aPantalla && this.trazo.length) {
      const pts = pantalla(this.trazo);
      const linea = [...pts];
      if (this.cursor) linea.push([this.cursor[0] - caja.left, this.cursor[1] - caja.top]);
      if (pts.length >= 3) partes.push(`<polygon class="ta-relleno" points="${linea.map(p => `${f(p[0])},${f(p[1])}`).join(' ')}"/>`);
      partes.push(`<polyline class="ta-linea" points="${linea.map(p => `${f(p[0])},${f(p[1])}`).join(' ')}"/>`);
      pts.forEach((p, i) =>
        partes.push(`<circle class="ta-vertice${i === 0 && pts.length >= 3 ? ' ta-primero' : ''}" cx="${f(p[0])}" cy="${f(p[1])}" r="${i === 0 && pts.length >= 3 ? 6 : 4}"/>`),
      );
    }
    this.dibujo.innerHTML = partes.join('');
  }

  // ---------- Consultar el área ----------
  // Los filtros del mapa cambian: el recuento del área se rehace (una sola vez por fotograma).
  refrescarArea() {
    if (!this.area || this.pendiente) return;
    this.pendiente = requestAnimationFrame(() => {
      this.pendiente = 0;
      if (this.area) this.contar(false);
    });
  }
  contar(colocar) {
    const r = this.modo.contarEnPoligono(this.area.geo);
    if (!r) {
      if (colocar) this.limpiarArea();
      return;
    }
    this.mostrarResultado(r, colocar);
  }
  mostrarResultado(r, colocar) {
    const { periodo, sensor } = this.describirFiltro?.() ?? {};
    const armonizado = r.armonizado !== null;
    const lineas = [];
    if (armonizado) {
      lineas.push(`<p class="ra-cifra"><strong>${numero.format(Math.round(r.armonizado))}</strong> celdas-día con fuego</p>`);
      lineas.push('<p class="ra-nota">Armonizado con IA (escala VIIRS)</p>');
    } else {
      const total = r.modis + r.viirs;
      lineas.push(`<p class="ra-cifra"><strong>${numero.format(total)}</strong> ${total === 1 ? 'detección' : 'detecciones'}</p>`);
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
      ${lineas.join('')}
      <div class="ra-historia" data-historia></div>`;
    this.resultado.hidden = false;
    this.pintarHistoria();
    if (colocar) this.colocarResultado();
  }
  // Junto al área, sin salirse de la pantalla ni tapar el panel. En pantallas angostas, CSS lo ancla arriba.
  colocarResultado() {
    const aPantalla = this.modo.proyectorGeo();
    if (!aPantalla || !this.area) return;
    const pts = this.area.geo.map(v => aPantalla(...v));
    const xIzq = Math.min(...pts.map(p => p[0])),
      xDer = Math.max(...pts.map(p => p[0])),
      yArriba = Math.min(...pts.map(p => p[1]));
    const t = this.resultado.getBoundingClientRect();
    const panel = document.querySelector('#panel-pais');
    const limite = panel && !panel.hidden && innerWidth > 720 ? panel.getBoundingClientRect().left - 12 : innerWidth - 12;
    let left = xDer + 12;
    if (left + t.width > limite) left = xIzq - t.width - 12;
    left = Math.max(12, Math.min(left, limite - t.width));
    const top = Math.max(76, Math.min(yArriba, innerHeight - t.height - 12));
    this.resultado.style.setProperty('--x', `${Math.round(left)}px`);
    this.resultado.style.setProperty('--y', `${Math.round(top)}px`);
  }

  // ---------- Evolución histórica del área ----------
  pintarHistoria() {
    const hueco = this.resultado.querySelector('[data-historia]');
    if (!hueco || !this.area) return;
    const h = this.area.historia;
    if (h === null) {
      hueco.innerHTML = '<p class="ra-titulo">Evolución histórica</p><p class="ra-nota">Calculando…</p>';
      return;
    }
    if (!h || !h.zonas || !h.anios.length) {
      hueco.innerHTML = '<p class="ra-titulo">Evolución histórica</p><p class="ra-nota">No hay serie histórica para esta área.</p>';
      return;
    }
    const anioSel = this.describirFiltro?.().anio ?? h.anios.at(-1).anio;
    const sel = h.anios.find(a => a.anio === anioSel) ?? h.anios.at(-1);
    const completos = h.anios.filter(a => !a.incompleto);
    const mayor = completos.reduce((m, a) => (a.valor > (m?.valor ?? -1) ? a : m), null);
    const W = 276,
      H = 92,
      base = H - 16,
      alto = base - 6,
      paso = W / h.anios.length,
      maximo = Math.max(1, ...h.anios.map(a => a.valor), h.mediana);
    const y = v => base - (v / maximo) * alto;
    const barras = h.anios
      .map((a, i) => {
        const x = i * paso + 1,
          w = Math.max(2, paso - 2),
          yy = y(a.valor),
          r = Math.min(2, (base - yy) / 2);
        const forma =
          a.valor > 0
            ? `<path class="rh-barra" d="M${x.toFixed(1)} ${base}V${(yy + r).toFixed(1)}q0-${r.toFixed(1)} ${r.toFixed(1)}-${r.toFixed(1)}h${(w - 2 * r).toFixed(1)}q${r.toFixed(1)} 0 ${r.toFixed(1)} ${r.toFixed(1)}V${base}z"/>`
            : '';
        return `<g class="rh-anio${a.anio === sel.anio ? ' elegido' : ''}${a.incompleto ? ' incompleto' : ''}" data-i="${i}">${forma}<rect class="rh-zona" x="${(i * paso).toFixed(1)}" y="0" width="${paso.toFixed(1)}" height="${H}"/></g>`;
      })
      .join('');
    // Eje: primer año, último y el elegido (que sustituye al extremo si queda demasiado cerca).
    const iSel = h.anios.indexOf(sel),
      ultimo = h.anios.length - 1;
    const etiquetas = [...new Set([iSel < 5 ? iSel : 0, iSel, ultimo - iSel < 5 ? iSel : ultimo])]
      .map(i => {
        const ancla = i < 2 ? 'start' : i > ultimo - 2 ? 'end' : 'middle';
        const x = i < 2 ? i * paso : i > ultimo - 2 ? (i + 1) * paso : i * paso + paso / 2;
        return `<text class="rh-eje${i === iSel ? ' elegido' : ''}" x="${x.toFixed(1)}" y="${H - 3}" text-anchor="${ancla}">${h.anios[i].anio}</text>`;
      })
      .join('');
    const yMed = y(h.mediana);
    const razon = h.mediana > 0 && !sel.incompleto ? sel.valor / h.mediana : null;
    const [a0, a1] = [completos[0]?.anio, completos.at(-1)?.anio];
    hueco.innerHTML = `
      <p class="ra-titulo">Evolución histórica <small>${h.anios[0].anio}–${h.anios.at(-1).anio}</small></p>
      <p class="rh-lectura" data-lectura></p>
      <svg class="rh-grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Actividad de fuego por año en el área, de ${h.anios[0].anio} a ${h.anios.at(-1).anio}. Mediana anual: ${numero.format(h.mediana)} celdas-día.">
        <line class="rh-base" x1="0" x2="${W}" y1="${base + 0.5}" y2="${base + 0.5}"/>
        ${barras}
        ${h.mediana > 0 ? `<line class="rh-mediana" x1="0" x2="${W}" y1="${yMed.toFixed(1)}" y2="${yMed.toFixed(1)}"/>` : ''}
        ${etiquetas}
      </svg>
      <p class="ra-nota rh-leyenda"><i class="rh-raya" aria-hidden="true"></i>Mediana anual ${a0}–${a1}: ${numero.format(h.mediana)}${
        razon !== null ? `<br>${sel.anio}: ${dec1.format(razon)} veces la mediana` : ''
      }${mayor ? `<br>Año con más actividad: ${mayor.anio} (${numero.format(mayor.valor)})` : ''}</p>
      <p class="ra-nota">Serie armonizada con IA (escala VIIRS), comparable entre años. ${
        h.aproximada
          ? `El área es menor que una zona de la grilla: se muestra la zona de ${String(h.grados).replace('.', ',')}° que la contiene.`
          : `Suma ${numero.format(h.zonas)} ${h.zonas === 1 ? 'zona' : 'zonas'} de ${String(h.grados).replace('.', ',')}° (~${Math.round(h.grados * 111)} km) con centro dentro del área.`
      } Una detección no es un incendio.</p>`;
    this.leer(null);
  }
  // Línea de lectura sobre el gráfico: el año bajo el puntero o, si no hay, el año del panel.
  leer(i) {
    const h = this.area?.historia;
    const linea = this.resultado.querySelector('[data-lectura]');
    if (!h || !linea) return;
    const anioSel = this.describirFiltro?.().anio;
    const a = h.anios[i] ?? h.anios.find(x => x.anio === anioSel) ?? h.anios.at(-1);
    linea.innerHTML = `<b>${a.anio}</b> ${numero.format(a.valor)} celdas-día con fuego${a.incompleto ? ' <small>(año incompleto)</small>' : ''}`;
    for (const g of this.resultado.querySelectorAll('.rh-anio')) g.classList.toggle('activo', +g.dataset.i === i);
  }
  escucharGrafico() {
    const indice = e => {
      const g = e.target.closest?.('.rh-anio');
      return g ? +g.dataset.i : null;
    };
    this.resultado.addEventListener('pointermove', e => this.leer(indice(e)));
    this.resultado.addEventListener('pointerdown', e => this.leer(indice(e)));
    this.resultado.addEventListener('pointerleave', () => this.leer(null));
  }
  limpiarArea() {
    this.area = null;
    this.trazo = [];
    this.rect = this.cursor = this.pulso = null;
    this.resultado.hidden = true;
    this.dibujar();
    this.ayuda();
  }
}
