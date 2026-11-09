import {
  conteosPara, suma, diasActivos, mayoresDias, escalaCalendario, fechaDeDia, CATALOGO, cargarSerie,
} from './datos-pais.js?v=4';
import { CalendarioHistorico } from './calendario-historico.js?v=5';

const numero = new Intl.NumberFormat('es-CL');
const fechaLarga = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const fechaCorta = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const mesCorto = new Intl.DateTimeFormat('es', { month: 'short', timeZone: 'UTC' });
const fecha = (dia, anio) => new Date(`${fechaDeDia(dia, anio)}T00:00:00Z`);
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const NOMBRES_SENSOR = { todos: 'Ambos (crudo)', MODIS: 'MODIS', VIIRS: 'VIIRS' };
const DIAS_POR_SEGUNDO = 12;
const ICONO_PLAY = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M7 4.8v14.4c0 .8.9 1.3 1.5.8l11-7.2c.6-.4.6-1.2 0-1.6l-11-7.2c-.6-.5-1.5 0-1.5.8Z"/></svg>';
const ICONO_PAUSA = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';

export class PanelPais {
  constructor({ raiz, reduceMotion, onCerrar, onFiltro, onRegistros, onPais, onReintentar, onAnio, onPeriodo }) {
    Object.assign(this, { raiz, reduceMotion, onCerrar, onFiltro, onRegistros, onPais, onReintentar, onAnio, onPeriodo });
    raiz.innerHTML = `
      <button type="button" class="panel-asa" data-accion="hoja" aria-expanded="false" aria-label="Mostrar más datos"><span aria-hidden="true"></span></button>
      <div class="panel-contenido" data-parte="contenido">
        <div class="panel-acciones">
          <button type="button" class="volver" data-accion="cerrar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>Volver a la Tierra</button>
          <button type="button" class="enlace" data-accion="registros" hidden>Ver registros</button>
        </div>
        <h2 id="panel-titulo" class="panel-titulo"></h2>
        <div data-parte="cuerpo"></div>
      </div>`;
    this.titulo = raiz.querySelector('.panel-titulo');
    this.contenido = raiz.querySelector('[data-parte="contenido"]');
    this.cuerpo = raiz.querySelector('[data-parte="cuerpo"]');
    this.botonRegistros = raiz.querySelector('[data-accion="registros"]');
    raiz.addEventListener('click', e => this.alHacerClic(e));
    this.tip = document.createElement('div');
    this.tip.className = 'tip-calendario'; this.tip.hidden = true; this.tip.setAttribute('role', 'tooltip');
    document.querySelector('#escena').append(this.tip);
    this.escucharHoja();
  }

  // ---------- Hoja móvil ----------
  // Dos alturas. Se decide por velocidad además de distancia: un gesto rápido basta.
  fijarHoja(alta) {
    this.hojaAlta = alta;
    this.raiz.dataset.hoja = alta ? 'alta' : 'baja';
    this.raiz.style.transform = '';
    const asa = this.raiz.querySelector('.panel-asa');
    asa.setAttribute('aria-expanded', String(alta));
    asa.setAttribute('aria-label', alta ? 'Mostrar más mapa' : 'Mostrar más datos');
    if (!alta) this.contenido.scrollTop = 0;
  }
  escucharHoja() {
    const asa = this.raiz.querySelector('.panel-asa');
    let inicio = null;
    asa.addEventListener('pointerdown', e => {
      asa.setPointerCapture(e.pointerId);
      const matriz = new DOMMatrixReadOnly(getComputedStyle(this.raiz).transform);
      inicio = { y: e.clientY, base: matriz.m42, t: e.timeStamp, movido: false };
      this.raiz.classList.add('arrastrando');
    });
    asa.addEventListener('pointermove', e => {
      if (!inicio) return;
      const d = e.clientY - inicio.y;
      if (Math.abs(d) > 4) inicio.movido = true;
      if (!inicio.movido) return;
      const maximo = this.raiz.offsetHeight - innerHeight * .4;
      const y = inicio.base + d;
      // Más allá de los topes, cede con fricción en vez de frenar en seco.
      const conFriccion = y < 0 ? y * .25 : y > maximo ? maximo + (y - maximo) * .25 : y;
      this.raiz.style.transform = `translateY(${conFriccion}px)`;
    });
    const soltar = e => {
      if (!inicio) return;
      const d = e.clientY - inicio.y, v = Math.abs(d) / Math.max(1, e.timeStamp - inicio.t);
      const movido = inicio.movido;
      inicio = null;
      this.raiz.classList.remove('arrastrando');
      if (!movido) { this.fijarHoja(!this.hojaAlta); return; }
      this.fijarHoja(Math.abs(d) > 80 || v > .11 ? d < 0 : this.hojaAlta);
    };
    asa.addEventListener('pointerup', soltar);
    asa.addEventListener('pointercancel', soltar);
  }

  preparar(feature, entrada) {
    this.detener();
    this.feature = feature; this.entrada = entrada; this.datos = null; this.regiones = null; this.parte = null;
    this.dia = null; this.sensor = 'todos'; this.omitidos = 0;
    this.titulo.textContent = feature.properties.spanish || feature.properties.name;
    this.titulo.classList.toggle('largo', this.titulo.textContent.length > 13);
    this.botonRegistros.hidden = true;
    this.fijarHoja(false);
    if (!entrada) { this.estadoVacio(); return; }
    this.cuerpo.innerHTML = `<div class="panel-cargando" role="status"><span class="solo-lectores">Cargando detecciones…</span>
      <div class="esqueleto alto"></div><div class="esqueleto"></div><div class="esqueleto calendario"></div></div>`;
  }
  estadoVacio() {
    const nombre = this.titulo.textContent;
    this.cuerpo.innerHTML = `<div class="panel-vacio">
      <p class="vacio-texto"></p>
      <p class="vacio-nota">Fire Sat guarda por ahora estos conjuntos de NASA FIRMS. Mientras tanto, puedes recorrer este territorio y sus regiones en el mapa.</p>
      <div class="vacio-acciones">${Object.values(CATALOGO).map(c => `<button type="button" class="enlace" data-pais="${c.id}">Ver ${c.nombre}</button>`).join('')}</div>
    </div>`;
    this.cuerpo.querySelector('.vacio-texto').textContent = `Todavía no hay detecciones guardadas de ${nombre}.`;
  }
  error() {
    this.cuerpo.innerHTML = `<div class="panel-vacio" role="alert">
      <p class="vacio-texto">La descarga de los registros se interrumpió.</p>
      <p class="vacio-nota">Comprueba que el servidor local sigue abierto y vuelve a intentarlo.</p>
      <div class="vacio-acciones"><button type="button" class="enlace" data-accion="reintentar">Volver a intentar</button></div></div>`;
  }

  // ---------- Datos ----------
  ponerDatos(datos, omitidos, inicial = {}) {
    this.datos = datos; this.omitidos = omitidos;
    // Un solo sensor por defecto: sumar MODIS + VIIRS cuenta dos veces el mismo fuego.
    // Desde 2012 se usa VIIRS, igual que la serie harmonizada; antes, MODIS.
    this.sensor = inicial.sensor || (datos.anio >= 2012 ? 'VIIRS' : 'MODIS');
    this.dia = null;
    // Las regiones se calculan por registro: las de otro año no sirven (llegan después).
    if (this.regiones && this.regiones.indices.length !== datos.registros.length) this.regiones = null;
    if (Number.isInteger(inicial.dia) && inicial.dia >= 0 && inicial.dia < datos.totalDias) this.dia = inicial.dia;
    this.botonRegistros.hidden = false;
    const anios = this.entrada?.anios || [datos.anio];
    this.cuerpo.innerHTML = `
      <section class="bloque historico" aria-labelledby="titulo-historico" data-parte="historico" hidden></section>
      <div class="diario-cabeza">
        <h3>Detalle diario</h3>
        <label class="selector-anio">Año
          <select data-parte="anio" aria-label="Año del detalle diario">${anios.slice().reverse().map(a => `<option value="${a}"${a === datos.anio ? ' selected' : ''}>${a}</option>`).join('')}</select>
        </label>
      </div>
      <section class="resumen" aria-live="polite">
        <p class="resumen-fecha"><span data-parte="fecha"></span><button type="button" class="enlace" data-accion="todo" hidden></button></p>
        <p class="cifra"><strong data-parte="cifra"></strong> <span data-parte="cifra-unidad"></span></p>
        <p class="resumen-nota" data-parte="nota"></p>
      </section>
      <div class="sensores" role="group" aria-label="Filtrar por sensor">
        ${['todos', 'MODIS', 'VIIRS'].map(s => `<button type="button" data-sensor="${s}"><span>${s === 'todos' ? '' : `<i class="marca-sensor ${s}" aria-hidden="true"></i>`}${NOMBRES_SENSOR[s]}</span><strong data-parte="n-${s}"></strong></button>`).join('')}
      </div>
      <section class="bloque" aria-labelledby="titulo-calendario">
        <div class="bloque-cabeza">
          <h3 id="titulo-calendario">Calendario de actividad</h3>
          <button type="button" class="enlace enlace-icono" data-accion="reproducir" aria-pressed="false"></button>
        </div>
        <div class="calendario" data-parte="calendario"></div>
        <div class="leyenda" data-parte="leyenda"></div>
      </section>
      <section class="bloque" aria-labelledby="titulo-regiones" data-parte="bloque-regiones" hidden>
        <h3 id="titulo-regiones">Regiones con más detecciones</h3>
        <ol class="ranking" data-parte="regiones"></ol>
      </section>
      <section class="bloque" aria-labelledby="titulo-picos">
        <h3 id="titulo-picos">Días de mayor actividad</h3>
        <ol class="ranking" data-parte="picos"></ol>
      </section>
      <p class="panel-nota">El detalle diario muestra los puntos de calor originales de cada sensor (no son incendios únicos y no están harmonizados). Para comparar años usa el calendario histórico.<span data-parte="omitidos"></span></p>`;
    this.parte = nombre => this.cuerpo.querySelector(`[data-parte="${nombre}"]`);
    this.parte('anio').addEventListener('change', e => this.onAnio?.(+e.target.value));
    this.pintarHistorico();
    this.construirCalendario();
    this.actualizar();
  }
  pintarHistorico() {
    const nodo = this.parte('historico');
    const entrada = this.entrada, anio = this.datos?.anio ?? null;
    if (!entrada?.serie) return;
    const detalle = !entrada.soloSerie;
    this.historico = new CalendarioHistorico({
      nodo, tip: this.tip, detalle,
      onAnio: detalle ? a => { if (a !== this.datos?.anio) this.onAnio?.(a); } : null,
      onSeleccion: detalle ? null : sel => this.elegirPeriodo(sel),
    });
    cargarSerie(entrada).then(serie => {
      if (!serie || this.parte?.('historico') !== nodo) return;
      nodo.hidden = false;
      this.historico.poner(serie, anio);
      // Sin detalle diario: el mapa muestra el último año completo hasta que se elija otro período.
      if (!detalle) this.historico.seleccionar(this.historico.ultimoAnioCompleto(), null);
    }).catch(error => {
      console.error('Serie mensual:', error);
      if (!detalle && this.parte?.('historico') === nodo) this.error();
    });
  }
  elegirPeriodo(sel) {
    const nodo = this.parte?.('periodo');
    if (nodo) {
      nodo.hidden = false;
      nodo.querySelector('strong').textContent = sel.mes === null ? `todo ${sel.anio}` : `${MESES_LARGOS[sel.mes]} de ${sel.anio}`;
    }
    this.onPeriodo?.(sel);
  }
  // Países del índice mundial sin detecciones guardadas: serie harmonizada y mapa mensual por celdas.
  ponerSoloSerie() {
    this.datos = null; this.regiones = null;
    this.botonRegistros.hidden = true;
    this.cuerpo.innerHTML = `
      <p class="periodo-mapa" data-parte="periodo" aria-live="polite" hidden>En el mapa: <strong></strong> <span>(zonas de 25 a 100 km, harmonizado)</span></p>
      <section class="bloque historico" aria-labelledby="titulo-historico" data-parte="historico" hidden></section>
      <p class="panel-nota">Serie mensual harmonizada a partir de los archivos anuales de NASA FIRMS (MODIS, VIIRS Suomi NPP y NOAA-20).
        Cada punto del mapa es una zona con fuego en el período elegido. El detalle día a día con cada detección está disponible para ${Object.values(CATALOGO).map(c => c.nombre).join(' y ')}.</p>`;
    this.parte = nombre => this.cuerpo.querySelector(`[data-parte="${nombre}"]`);
    this.pintarHistorico();
  }
  // Mientras llega otro año, el detalle se atenúa; el calendario histórico sigue visible.
  cargandoAnio(entrada) {
    this.entrada = entrada;
    this.detener();
    this.regiones = null;
    this.historico?.marcarAnio(entrada.anio);
    for (const n of this.cuerpo.querySelectorAll('.resumen, .sensores, .bloque:not(.historico), .panel-nota')) n.classList.add('cargando-anio');
    const sel = this.parte?.('anio'); if (sel) sel.value = entrada.anio;
  }
  ponerRegiones(nombres, indices) {
    this.regiones = { nombres, indices };
    if (this.parte) this.pintarRegiones();
  }
  regionDe(indice) {
    if (!this.regiones || indice < 0) return null;
    return this.regiones.nombres[this.regiones.indices[indice]] ?? null;
  }
  pintarRegiones() {
    const { datos, dia, sensor, regiones } = this;
    if (!regiones || !this.parte || regiones.indices.length !== datos.registros.length) return;
    const conteo = new Int32Array(regiones.nombres.length);
    for (let i = 0; i < regiones.indices.length; i++) {
      const r = regiones.indices[i];
      if (r < 0) continue;
      if (dia !== null && datos.dias[i] !== dia) continue;
      if (sensor !== 'todos' && datos.registros[i].sensor !== sensor) continue;
      conteo[r]++;
    }
    const lista = Array.from(conteo, (valor, i) => ({ nombre: regiones.nombres[i], valor })).filter(x => x.valor).sort((a, b) => b.valor - a.valor).slice(0, 5);
    const maximo = lista[0]?.valor || 1;
    this.parte('bloque-regiones').hidden = false;
    const nodo = this.parte('regiones');
    nodo.innerHTML = lista.map(x => `<li class="fila-ranking"><span class="fila-nombre"></span><span class="fila-barra" aria-hidden="true"><i style="width:${(x.valor / maximo * 100).toFixed(1)}%"></i></span><span class="fila-valor">${numero.format(x.valor)}</span></li>`).join('') || '<li class="sin-datos">Sin actividad con este filtro</li>';
    lista.forEach((x, i) => { nodo.children[i].querySelector('.fila-nombre').textContent = x.nombre; });
  }
  construirCalendario() {
    const { anio, totalDias } = this.datos;
    const raiz = this.parte('calendario');
    const fragmento = document.createDocumentFragment();
    const encabezado = document.createElement('div');
    encabezado.className = 'cal-dias'; encabezado.setAttribute('aria-hidden', 'true');
    for (const d of [1, 10, 20, 31]) { const s = document.createElement('span'); s.textContent = d; s.style.gridColumn = d; encabezado.append(s); }
    fragmento.append(encabezado);
    this.celdas = [];
    let dia = 0;
    for (let mes = 0; mes < 12; mes++) {
      const fila = document.createElement('div');
      fila.className = 'cal-fila'; fila.setAttribute('role', 'group');
      const inicio = new Date(Date.UTC(anio, mes, 1));
      const etiqueta = mesCorto.format(inicio).replace('.', '');
      fila.setAttribute('aria-label', new Intl.DateTimeFormat('es', { month: 'long', timeZone: 'UTC' }).format(inicio));
      const nombre = document.createElement('span');
      nombre.className = 'cal-mes'; nombre.textContent = etiqueta; nombre.setAttribute('aria-hidden', 'true');
      const celdas = document.createElement('div');
      celdas.className = 'cal-celdas';
      const largo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
      for (let d = 0; d < largo && dia < totalDias; d++, dia++) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'celda'; b.dataset.dia = dia; b.tabIndex = -1;
        celdas.append(b); this.celdas.push(b);
      }
      fila.append(nombre, celdas);
      fragmento.append(fila);
    }
    raiz.replaceChildren(fragmento);
    this.celdas[0].tabIndex = 0;
    raiz.addEventListener('pointerover', e => { const c = e.target.closest('.celda'); if (c) this.mostrarTip(c); });
    raiz.addEventListener('pointerleave', () => { this.tip.hidden = true; });
    raiz.addEventListener('focusin', e => { const c = e.target.closest('.celda'); if (c?.matches(':focus-visible')) this.mostrarTip(c); });
    raiz.addEventListener('focusout', () => { this.tip.hidden = true; });
    raiz.addEventListener('keydown', e => this.teclaCalendario(e));
  }
  teclaCalendario(e) {
    const actual = e.target.closest('.celda');
    if (!actual) return;
    const i = +actual.dataset.dia;
    const { anio, totalDias } = this.datos;
    const moverMes = paso => {
      const f = fecha(i, anio);
      const destino = new Date(Date.UTC(anio, f.getUTCMonth() + paso, 1));
      const largo = new Date(Date.UTC(anio, f.getUTCMonth() + paso + 1, 0)).getUTCDate();
      destino.setUTCDate(Math.min(f.getUTCDate(), largo));
      return destino.getUTCFullYear() === anio ? Math.round((destino - Date.UTC(anio, 0, 1)) / 864e5) : i;
    };
    const destino = { ArrowLeft: i - 1, ArrowRight: i + 1, ArrowUp: moverMes(-1), ArrowDown: moverMes(1), Home: 0, End: totalDias - 1 }[e.key];
    if (destino === undefined) return;
    e.preventDefault();
    const objetivo = this.celdas[Math.max(0, Math.min(totalDias - 1, destino))];
    actual.tabIndex = -1; objetivo.tabIndex = 0; objetivo.focus();
  }
  mostrarTip(celda) {
    const dia = +celda.dataset.dia;
    const valor = this.conteos[dia];
    this.tip.textContent = `${fechaLarga.format(fecha(dia, this.datos.anio))} · ${valor ? `${numero.format(valor)} ${valor === 1 ? 'detección' : 'detecciones'}` : 'sin detecciones'}`;
    this.tip.hidden = false;
    const r = celda.getBoundingClientRect(), t = this.tip.getBoundingClientRect();
    this.tip.style.left = `${Math.max(8, Math.min(innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2))}px`;
    this.tip.style.top = `${Math.max(8, r.top - t.height - 8)}px`;
  }

  // ---------- Estado ----------
  actualizar() {
    const { datos, dia, sensor } = this;
    this.conteos = conteosPara(datos, sensor);
    const escala = escalaCalendario(this.conteos);
    const { anio } = datos;
    this.celdas.forEach((c, i) => {
      const valor = this.conteos[i];
      c.dataset.nivel = escala.nivel(valor);
      const estaActiva = i === dia;
      c.classList.toggle('activa', estaActiva);
      c.setAttribute('aria-pressed', String(estaActiva));
      c.setAttribute('aria-label', `${fechaLarga.format(fecha(i, anio))}: ${valor ? `${numero.format(valor)} ${valor === 1 ? 'detección' : 'detecciones'}` : 'sin detecciones'}`);
    });
    for (const b of this.cuerpo.querySelectorAll('[data-sensor]')) b.setAttribute('aria-pressed', String(b.dataset.sensor === sensor));
    const total = suma(this.conteos);
    const valor = dia === null ? total : this.conteos[dia];
    this.parte('cifra').textContent = numero.format(valor);
    this.parte('cifra-unidad').textContent = `${valor === 1 ? 'detección' : 'detecciones'}${sensor === 'todos' ? '' : ` de ${sensor}`}`;
    this.parte('fecha').textContent = dia === null ? `Todo ${anio}` : `${fechaLarga.format(fecha(dia, anio))} de ${anio}`;
    const pico = mayoresDias(this.conteos, 1)[0];
    this.parte('nota').textContent = dia === null
      ? `${numero.format(diasActivos(this.conteos))} días con actividad${pico ? ` · pico el ${fechaLarga.format(fecha(pico.dia, anio))}` : ''}`
      : 'Datos históricos de NASA FIRMS';
    const contar = s => (dia === null ? suma(datos.porSensor[s]) : datos.porSensor[s][dia]);
    const [m, v] = [contar('MODIS'), contar('VIIRS')];
    this.parte('n-todos').textContent = numero.format(m + v);
    this.parte('n-MODIS').textContent = numero.format(m);
    this.parte('n-VIIRS').textContent = numero.format(v);
    this.parte('leyenda').innerHTML = `<span>Menos</span>${escala.tramos.map(t => `<i class="celda-leyenda" data-nivel="${t.nivel}" title="${numero.format(t.desde)}${t.desde === t.hasta ? '' : `–${numero.format(t.hasta)}`} por día"></i>`).join('')}<span>Más</span>`;
    const maximo = pico?.valor || 1;
    this.parte('picos').innerHTML = mayoresDias(this.conteos, 3).map(d => `
      <li><button type="button" class="fila-ranking" data-dia-pico="${d.dia}" aria-pressed="${d.dia === dia}">
        <span class="fila-nombre">${fechaCorta.format(fecha(d.dia, anio)).replace('.', '')}</span>
        <span class="fila-barra" aria-hidden="true"><i style="width:${(d.valor / maximo * 100).toFixed(1)}%"></i></span>
        <span class="fila-valor">${numero.format(d.valor)}</span></button></li>`).join('') || '<li class="sin-datos">Sin actividad con este filtro</li>';
    const todo = this.cuerpo.querySelector('[data-accion="todo"]');
    todo.hidden = dia === null; todo.textContent = `Ver todo ${anio}`;
    this.pintarReproducir();
    this.parte('omitidos').textContent = this.omitidos ? ` ${numero.format(this.omitidos)} en islas lejanas no aparecen en el mapa, sí en los registros.` : '';
    this.pintarRegiones();
    this.emitir();
  }
  emitir() {
    const { dia, sensor } = this;
    const fin = this.datos.totalDias;
    this.onFiltro?.({
      ini: dia ?? 0, fin: dia ?? fin, sensor, cola: this.reproduciendo ? 6 : 0,
      visibles: this.reproduciendo ? Math.max(40, this.conteos[dia] * 4) : (dia === null ? suma(this.conteos) : this.conteos[dia]),
      dia, persistente: !this.reproduciendo,
    });
  }
  pintarReproducir() {
    const b = this.cuerpo.querySelector('[data-accion="reproducir"]');
    if (!b) return;
    b.innerHTML = `${this.reproduciendo ? ICONO_PAUSA : ICONO_PLAY}${this.reproduciendo ? 'Pausar' : `Reproducir ${this.datos.anio}`}`;
    b.setAttribute('aria-pressed', String(Boolean(this.reproduciendo)));
    // Doce fechas por segundo serían ilegibles para un lector de pantalla.
    this.cuerpo.querySelector('.resumen')?.setAttribute('aria-live', this.reproduciendo ? 'off' : 'polite');
  }
  alHacerClic(e) {
    const accion = e.target.closest('[data-accion]')?.dataset.accion;
    if (accion === 'hoja') return;
    if (accion === 'cerrar') { this.onCerrar?.(); return; }
    if (accion === 'reintentar') { this.onReintentar?.(); return; }
    const pais = e.target.closest('[data-pais]')?.dataset.pais;
    if (pais) { this.onPais?.(pais); return; }
    if (!this.datos) return;
    if (accion === 'todo') { this.detener(); this.dia = null; this.actualizar(); return; }
    if (accion === 'reproducir') { if (this.reproduciendo) this.detener(true); else this.reproducir(); return; }
    if (accion === 'registros') { this.onRegistros?.({ id: this.entrada.id, dia: this.dia, sensor: this.sensor, anio: this.datos.anio }); return; }
    const sensor = e.target.closest('[data-sensor]')?.dataset.sensor;
    if (sensor) { this.sensor = sensor; this.actualizar(); return; }
    const celda = e.target.closest('.celda') || e.target.closest('[data-dia-pico]');
    if (celda) {
      const dia = +(celda.dataset.dia ?? celda.dataset.diaPico);
      this.detener();
      this.dia = this.dia === dia ? null : dia;
      this.actualizar();
    }
  }

  // ---------- Reproducción ----------
  reproducir() {
    this.reproduciendo = true;
    this.posicion = this.dia ?? 0;
    this.dia = Math.floor(this.posicion);
    this.ultimo = performance.now();
    this.pintarReproducir();
    const paso = ahora => {
      if (!this.reproduciendo) return;
      const ritmo = this.reduceMotion.matches ? 2.5 : DIAS_POR_SEGUNDO;
      this.posicion += (ahora - this.ultimo) / 1000 * ritmo;
      this.ultimo = ahora;
      if (this.posicion >= this.datos.totalDias) { this.detener(); this.dia = null; this.actualizar(); return; }
      const dia = Math.floor(this.posicion);
      if (dia !== this.dia) { this.dia = dia; this.pintarDiaReproducido(); }
      this.marco = requestAnimationFrame(paso);
    };
    this.pintarDiaReproducido();
    this.marco = requestAnimationFrame(paso);
  }
  // Un solo día cambia por fotograma: no se recalculan escala ni etiquetas de todo el año.
  pintarDiaReproducido() {
    const { dia, datos } = this;
    this.cuerpo.querySelector('.celda.activa')?.classList.remove('activa');
    this.celdas[dia].classList.add('activa');
    this.parte('cifra').textContent = numero.format(this.conteos[dia]);
    this.parte('fecha').textContent = `${fechaLarga.format(fecha(dia, datos.anio))} de ${datos.anio}`;
    this.emitir();
  }
  detener(actualizar = false) {
    if (!this.reproduciendo) return;
    this.reproduciendo = false;
    cancelAnimationFrame(this.marco);
    if (actualizar) this.actualizar();
    else this.pintarReproducir();
  }
}
