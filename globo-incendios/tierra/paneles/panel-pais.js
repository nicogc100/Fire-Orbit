import {
  suma,
  diasActivos,
  mayoresDias,
  escalaCalendario,
  fechaDeDia,
  CATALOGO,
  cargarSerie,
  cargarZonas,
  serieDeRegion,
  referenciaHistorica,
} from '../datos/datos-pais.js?v=20261115chl3';
import { CalendarioHistorico } from './calendario-historico.js?v=20261115chl3';
import { TablaRegistros, nombreArchivo } from './tabla-registros.js?v=20261115chl3';

const numero = new Intl.NumberFormat('es-CL');
const decimal = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fechaLarga = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const fechaCorta = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const mesCorto = new Intl.DateTimeFormat('es', { month: 'short', timeZone: 'UTC' });
const fecha = (dia, anio) => new Date(`${fechaDeDia(dia, anio)}T00:00:00Z`);
export const MESES_LARGOS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const NOMBRES_SENSOR = { todos: 'Ambos (crudo)', MODIS: 'MODIS', VIIRS: 'VIIRS' };
const DIAS_POR_SEGUNDO = 12;
const ICONO_PLAY =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M7 4.8v14.4c0 .8.9 1.3 1.5.8l11-7.2c.6-.4.6-1.2 0-1.6l-11-7.2c-.6-.5-1.5 0-1.5.8Z"/></svg>';
const ICONO_PAUSA =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
const ICONO_CSV =
  '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>';

// Acceso al panel «Armonización» (armonizacion.js atiende data-abrir-metodo). Solo Chile tiene el modelo con IA.
const BOTON_METODO = `<button type="button" class="hc-como hc-como-pais" data-abrir-metodo>
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#9cc4ff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V5M4 19h16M7 15l4-5 3 3 5-7"/></svg>
  <span><strong>Armonización MODIS + VIIRS</strong><span>Gráficos y precisión de la serie 2003–2025.</span></span>
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
</button>`;

// Primer día (índice dentro del año) y cantidad de días de cada mes.
function diasDelMes(anio, mes) {
  const ini = Math.round((Date.UTC(anio, mes, 1) - Date.UTC(anio, 0, 1)) / 864e5);
  return { ini, fin: ini + new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate() - 1 };
}
const mesDeDia = (dia, anio) => fecha(dia, anio).getUTCMonth();
const periodoTexto = (anio, mes) => (mes === null ? `todo ${anio}` : `${MESES_LARGOS[mes]} de ${anio}`);
const capital = t => t.charAt(0).toUpperCase() + t.slice(1);

export class PanelPais {
  constructor(opciones) {
    Object.assign(this, opciones);
    const { raiz } = opciones;
    this.satelital = false;
    this.territorio = null;
    this.pestana = 'calendario';
    this.modo = 'anio';
    this.mes = null;
    this.series = new Map();
    raiz.innerHTML = `
      <button type="button" class="panel-asa" data-accion="hoja" aria-expanded="false" aria-label="Mostrar más datos"><span aria-hidden="true"></span></button>
      <div class="panel-contenido" data-parte="contenido">
        <div class="panel-acciones">
          <button type="button" class="volver" data-accion="cerrar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>Volver a la Tierra</button>
          <div class="panel-herramientas">
            <button type="button" class="interruptor" role="switch" aria-checked="false" data-accion="satelital" aria-describedby="estado-satelital">
              <span class="interruptor-pista" aria-hidden="true"><span class="interruptor-perilla"></span></span>
              <span>Detalle satelital</span>
              <span class="interruptor-estado" aria-hidden="true">OFF</span>
            </button>
          </div>
        </div>
        <nav class="ruta" aria-label="Ubicación" data-parte="ruta" hidden></nav>
        <h2 id="panel-titulo" class="panel-titulo"></h2>
        <p class="estado-satelital" id="estado-satelital" role="status" hidden></p>
        <div data-parte="cuerpo"></div>
      </div>`;
    this.titulo = raiz.querySelector('.panel-titulo');
    this.ruta = raiz.querySelector('[data-parte="ruta"]');
    this.contenido = raiz.querySelector('[data-parte="contenido"]');
    this.cuerpo = raiz.querySelector('[data-parte="cuerpo"]');
    this.botonSatelital = raiz.querySelector('[data-accion="satelital"]');
    this.estadoSat = raiz.querySelector('#estado-satelital');
    raiz.addEventListener('click', e => this.alHacerClic(e));
    raiz.addEventListener('keydown', e => this.teclaPestanas(e));
    this.tip = document.createElement('div');
    this.tip.className = 'tip-calendario';
    this.tip.hidden = true;
    this.tip.setAttribute('role', 'tooltip');
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
      const maximo = this.raiz.offsetHeight - innerHeight * 0.4;
      const y = inicio.base + d;
      // Más allá de los topes, cede con fricción en vez de frenar en seco.
      const conFriccion = y < 0 ? y * 0.25 : y > maximo ? maximo + (y - maximo) * 0.25 : y;
      this.raiz.style.transform = `translateY(${conFriccion}px)`;
    });
    const soltar = e => {
      if (!inicio) return;
      const d = e.clientY - inicio.y,
        v = Math.abs(d) / Math.max(1, e.timeStamp - inicio.t);
      const movido = inicio.movido;
      inicio = null;
      this.raiz.classList.remove('arrastrando');
      if (!movido) {
        this.fijarHoja(!this.hojaAlta);
        return;
      }
      this.fijarHoja(Math.abs(d) > 80 || v > 0.11 ? d < 0 : this.hojaAlta);
    };
    asa.addEventListener('pointerup', soltar);
    asa.addEventListener('pointercancel', soltar);
  }

  // ---------- País y territorio ----------
  get nombrePais() {
    return this.feature ? this.feature.properties.spanish || this.feature.properties.name : '';
  }
  preparar(feature, entrada) {
    this.detener();
    this.feature = feature;
    this.entrada = entrada;
    this.datos = null;
    this.regiones = null;
    this.parte = null;
    this.dia = null;
    this.mes = null;
    this.mesPendiente = null;
    this.modo = 'anio';
    this.sensor = 'todos';
    this.omitidos = 0;
    this.territorio = null;
    this.ciudad = null;
    this.series = new Map();
    this.zonas = null;
    this.cache = null;
    this.pintarTitulo();
    this.fijarHoja(false);
    if (!entrada) {
      this.estadoVacio();
      return;
    }
    this.cuerpo.innerHTML = `<div class="panel-cargando" role="status"><span class="solo-lectores">Cargando detecciones…</span>
      <div class="esqueleto alto"></div><div class="esqueleto"></div><div class="esqueleto calendario"></div></div>`;
  }
  // Región o ciudad abierta en el mapa (null: país completo). La ciudad solo acerca el mapa:
  // las cifras siguen siendo las de su región.
  mostrarVista(vista) {
    const region = vista ? { indice: vista.region.indice, nombre: vista.region.nombre } : null;
    const cambia = region?.indice !== this.territorio?.indice;
    this.territorio = region;
    this.ciudad = vista?.ciudad?.nombre ?? null;
    this.pintarTitulo();
    if (cambia) this.cambioTerritorio();
  }
  pintarTitulo() {
    const pais = this.nombrePais;
    const t = this.territorio;
    this.titulo.textContent = t ? t.nombre : pais;
    this.titulo.classList.toggle('largo', this.titulo.textContent.length > 13);
    this.ruta.hidden = !t;
    if (!t) {
      this.ruta.replaceChildren();
      return;
    }
    this.ruta.innerHTML = `<ol><li><button type="button" class="ruta-paso" data-accion="nacional"></button></li>${
      this.ciudad
        ? '<li><button type="button" class="ruta-paso" data-accion="volver-vista"></button></li><li><span aria-current="page"></span></li>'
        : '<li><span aria-current="page"></span></li>'
    }</ol>`;
    const pasos = this.ruta.querySelectorAll('button, span');
    pasos[0].textContent = pais;
    pasos[0].setAttribute('aria-label', `${pais}: volver a la vista nacional`);
    pasos[1].textContent = t.nombre;
    if (this.ciudad) pasos[2].textContent = this.ciudad;
  }
  cambioTerritorio() {
    this.detener();
    this.dia = null;
    if (this.entrada?.soloSerie) {
      if (this.parte) this.pintarHistorico();
    } else if (this.datos && this.parte) {
      this.cache = null;
      this.pintarModo();
      this.actualizar();
    }
  }
  // ---------- Detalle satelital ----------
  fijarSatelital(activo) {
    this.satelital = activo;
    this.botonSatelital.setAttribute('aria-checked', String(activo));
    this.botonSatelital.querySelector('.interruptor-estado').textContent = activo ? 'ON' : 'OFF';
    this.onSatelital?.(activo);
  }
  estadoSatelital({ estado, metros }) {
    const nodo = this.estadoSat;
    const resolucion = metros
      ? ` · ~${metros < 100 ? Math.round(metros) : numero.format(Math.round(metros / 10) * 10)} m por píxel`
      : '';
    const textos = {
      cargando: `Cargando imagen Sentinel-2…${resolucion}`,
      listo: `Imagen Sentinel-2${resolucion}`,
      parcial: `Imagen Sentinel-2 incompleta${resolucion}. Se reintentará al mover el mapa.`,
      esperando: 'Imagen Sentinel-2 lista al llegar al mapa.',
      'sin-conexion': 'El proveedor de imágenes no responde. Se mantiene el mapa base.',
      'sin-cobertura': 'Sentinel-2 no cubre esta zona. Se mantiene el mapa base.',
    };
    nodo.hidden = estado === 'apagado';
    nodo.dataset.estado = estado;
    nodo.textContent = textos[estado] ?? '';
  }
  estadoVacio() {
    const nombre = this.nombrePais;
    this.cuerpo.innerHTML = `<div class="panel-vacio">
      <p class="vacio-texto"></p>
      <p class="vacio-nota">Fire Orbit guarda por ahora estos conjuntos de NASA FIRMS. Mientras tanto, puedes recorrer este territorio y sus regiones en el mapa.</p>
      <div class="vacio-acciones">${Object.values(CATALOGO)
        .map(c => `<button type="button" class="enlace" data-pais="${c.id}">Ver ${c.nombre}</button>`)
        .join('')}</div>
    </div>`;
    this.cuerpo.querySelector('.vacio-texto').textContent = `Todavía no hay detecciones guardadas de ${nombre}.`;
  }
  error() {
    this.cuerpo.innerHTML = `<div class="panel-vacio" role="alert">
      <p class="vacio-texto">La descarga de los registros se interrumpió.</p>
      <p class="vacio-nota">Comprueba que el servidor local sigue abierto y vuelve a intentarlo.</p>
      <div class="vacio-acciones"><button type="button" class="enlace" data-accion="reintentar">Volver a intentar</button></div></div>`;
  }

  // ---------- Series harmonizadas del territorio ----------
  // Región de cada zona de la grilla, una sola vez por país (en segundo plano).
  async zonasDelPais() {
    const entrada = this.entrada;
    if (!this.zonas) {
      this.zonas = cargarZonas(entrada).then(async mapa => {
        const lado = mapa.celda_grados / 2;
        const regiones = await this.onZonas?.(
          mapa.celdas.map(c => c[1] + lado),
          mapa.celdas.map(c => c[0] + lado),
        );
        if (!regiones) throw new Error('Regiones no disponibles');
        return { mapa, regiones };
      });
      this.zonas.catch(() => {
        if (this.entrada === entrada) this.zonas = null;
      });
    }
    return this.zonas;
  }
  // Serie del país (indice null) o de una de sus regiones. Mismo formato en ambos casos.
  serieDe(indice = this.territorio?.indice ?? null) {
    const clave = indice ?? 'pais';
    if (!this.series.has(clave)) {
      const entrada = this.entrada;
      const promesa =
        indice === null
          ? cargarSerie(entrada)
          : Promise.all([cargarSerie(entrada), this.zonasDelPais()]).then(([nacional, z]) =>
              nacional ? serieDeRegion(z.mapa, z.regiones, indice, nacional) : null,
            );
      promesa.catch(() => this.series.delete(clave));
      this.series.set(clave, promesa);
    }
    return this.series.get(clave);
  }

  // ---------- Datos (países con detecciones guardadas) ----------
  ponerDatos(datos, omitidos, inicial = {}) {
    this.datos = datos;
    this.omitidos = omitidos;
    this.cache = null;
    // Un solo sensor por defecto: sumar MODIS + VIIRS cuenta dos veces el mismo fuego.
    // Desde 2012 se usa VIIRS, igual que la serie harmonizada; antes, MODIS.
    this.sensor = inicial.sensor || (datos.anio >= 2012 ? 'VIIRS' : 'MODIS');
    this.dia = null;
    this.mes = this.mesPendiente ?? (Number.isInteger(inicial.mes) ? inicial.mes : null);
    this.mesPendiente = null;
    // Las regiones se calculan por registro: las de otro año no sirven (llegan después).
    if (this.regiones && this.regiones.indices.length !== datos.registros.length) this.regiones = null;
    if (Number.isInteger(inicial.dia) && inicial.dia >= 0 && inicial.dia < datos.totalDias) {
      this.dia = inicial.dia;
      this.mes = mesDeDia(inicial.dia, datos.anio);
    }
    const anios = this.entrada?.anios || [datos.anio];
    this.cuerpo.innerHTML = `
      <div class="panel-filtros">
        <label class="selector-anio">Año
          <select data-parte="anio">
            <option value="historial">Historial completo</option>
            ${anios
              .slice()
              .reverse()
              .map(a => `<option value="${a}">${a}</option>`)
              .join('')}
          </select>
        </label>
      </div>
      ${this.entrada?.id === '152' ? BOTON_METODO : ''}
      <div class="pestanas" role="tablist" aria-label="Información del territorio">
        <button type="button" role="tab" id="pestana-calendario" aria-controls="vista-calendario" data-pestana="calendario">Calendario</button>
        <button type="button" role="tab" id="pestana-datos" aria-controls="vista-datos" data-pestana="datos">Datos</button>
        ${this.entrada?.id === '152' ? '<button type="button" role="tab" id="pestana-validacion" aria-controls="vista-validacion" data-pestana="validacion">Validación</button>' : ''}
      </div>
      <div class="vista-pestana" role="tabpanel" id="vista-calendario" aria-labelledby="pestana-calendario" data-parte="vista-calendario">
        <div data-parte="vista-anio">
          <div class="meses-cabeza">
            <h3 data-parte="titulo-meses"></h3>
            <button type="button" class="chip" data-accion="todo-anio">Todo el año</button>
          </div>
          <div class="meses" role="group" aria-label="Elegir un mes" data-parte="meses"></div>
          <p class="mes-explica" data-parte="explica" aria-live="polite"></p>
          <div data-parte="detalle-territorio">
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
                <h3 id="titulo-calendario">Día a día</h3>
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
          </div>
          <div class="panel-cargando" data-parte="esperando-region" role="status" hidden>
            <p class="vacio-nota" data-parte="texto-esperando"></p>
            <div class="esqueleto alto"></div><div class="esqueleto calendario"></div>
          </div>
          <p class="panel-nota">El día a día muestra los puntos de calor originales de cada sensor (no son incendios únicos y no están harmonizados). Para comparar años elige «Historial completo» en «Año».<span data-parte="omitidos"></span></p>
        </div>
        <section class="bloque historico" aria-labelledby="titulo-historico" data-parte="historico" hidden></section>
      </div>
      ${this.entrada?.id === '152' ? '<div class="vista-pestana" role="tabpanel" id="vista-validacion" aria-labelledby="pestana-validacion" data-parte="vista-validacion" hidden></div>' : ''}
      <div class="vista-pestana" role="tabpanel" id="vista-datos" aria-labelledby="pestana-datos" data-parte="vista-datos" hidden>
        <p class="datos-contexto" data-parte="datos-contexto"></p>
        <div class="datos-barra">
          <p data-parte="datos-resumen" role="status"></p>
          <button type="button" class="boton-secundario" data-parte="boton-csv">${ICONO_CSV}<span data-parte="csv">Descargar CSV</span></button>
        </div>
        <div class="tabla-marco" tabindex="0" role="region" aria-label="Registros del período" data-parte="tabla"></div>
        <div class="paginacion">
          <span data-parte="rango" aria-live="polite"></span>
          <div>
            <button type="button" class="boton-secundario" data-parte="anterior">Anterior</button>
            <button type="button" class="boton-secundario" data-parte="siguiente">Siguiente</button>
          </div>
        </div>
      </div>`;
    this.parte = nombre => this.cuerpo.querySelector(`[data-parte="${nombre}"]`);
    this.tabla = new TablaRegistros({
      tabla: this.parte('tabla'),
      rango: this.parte('rango'),
      anterior: this.parte('anterior'),
      siguiente: this.parte('siguiente'),
      csv: this.parte('boton-csv'),
      etiquetaCSV: this.parte('csv'),
    });
    this.parte('anio').addEventListener('change', e => this.elegirAnio(e.target.value));
    this.construirMeses();
    this.construirCalendario();
    this.pintarPestana();
    this.pintarModo();
    this.actualizar();
  }
  // Mientras llega otro año, el detalle se atenúa; el resto del panel sigue visible.
  cargandoAnio(entrada) {
    this.entrada = entrada;
    this.detener();
    this.regiones = null;
    this.cache = null;
    for (const n of this.cuerpo.querySelectorAll('[data-parte="vista-anio"], [data-parte="vista-datos"]'))
      n.classList.add('cargando-anio');
    const sel = this.parte?.('anio');
    if (sel && this.modo !== 'historial') sel.value = entrada.anio;
  }
  ponerRegiones(nombres, indices) {
    this.regiones = { nombres, indices };
    this.cache = null;
    if (this.parte && this.datos) this.actualizar();
  }
  regionDe(indice) {
    if (!this.regiones || indice < 0) return null;
    return this.regiones.nombres[this.regiones.indices[indice]] ?? null;
  }

  // ---------- Año, mes, pestañas ----------
  elegirAnio(valor) {
    this.detener();
    if (valor === 'historial') {
      this.modo = 'historial';
      this.pintarModo();
      return;
    }
    const anio = +valor;
    this.modo = 'anio';
    // Cambiar de año conserva la región y la pestaña; el mes vuelve a «Todo el año».
    if (anio !== this.datos?.anio) {
      this.mesPendiente = null;
      this.pintarModo();
      this.onAnio?.(anio);
      return;
    }
    this.pintarModo();
    this.actualizar();
  }
  // Desde el historial: un mes concreto de un año (mes null: el año completo).
  irA(anio, mes = null) {
    this.detener();
    this.modo = 'anio';
    if (this.datos && anio !== this.datos.anio) {
      this.mesPendiente = mes;
      if (this.parte?.('anio')) this.parte('anio').value = anio;
      this.pintarModo();
      this.onAnio?.(anio);
      return;
    }
    this.mes = mes;
    this.dia = null;
    if (this.parte?.('anio')) this.parte('anio').value = anio;
    this.pintarModo();
    this.actualizar();
  }
  elegirPestana(nombre, foco = false) {
    this.pestana = nombre;
    this.pintarPestana();
    if (nombre === 'datos') this.pintarDatos();
    if (nombre === 'validacion') this.pintarValidacion();
    if (foco) this.cuerpo.querySelector(`[data-pestana="${nombre}"]`)?.focus();
  }
  pintarPestana() {
    if (!this.parte?.('vista-calendario')) return;
    for (const b of this.cuerpo.querySelectorAll('[data-pestana]')) {
      const activa = b.dataset.pestana === this.pestana;
      b.setAttribute('aria-selected', String(activa));
      b.tabIndex = activa ? 0 : -1;
    }
    this.parte('vista-calendario').hidden = this.pestana !== 'calendario';
    this.parte('vista-datos').hidden = this.pestana !== 'datos';
    const validacion = this.parte('vista-validacion');
    if (validacion) {
      validacion.hidden = this.pestana !== 'validacion';
      if (!validacion.hidden) this.pintarValidacion();
    }
    else if (this.pestana === 'validacion') this.elegirPestana('calendario');
  }
  // Validación con CONAF (solo Chile). Mismo módulo que el panel «Armonización».
  pintarValidacion() {
    const nodo = this.parte?.('vista-validacion');
    if (!nodo || nodo.dataset.listo) return;
    nodo.dataset.listo = '1';
    import('../armonizacion.js?v=20261115chl3')
      .then(m => m.pintarValidacion(nodo))
      .catch(error => {
        console.error('Validación:', error);
        delete nodo.dataset.listo;
      });
  }
  teclaPestanas(e) {
    const tab = e.target.closest('[role="tab"]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const nombres = [...this.cuerpo.querySelectorAll('[data-pestana]')].map(b => b.dataset.pestana);
    const i = nombres.indexOf(this.pestana);
    const destino =
      e.key === 'Home' ? 0 : e.key === 'End' ? nombres.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : nombres.length - 1)) % nombres.length;
    this.elegirPestana(nombres[destino], true);
  }
  pintarModo() {
    if (!this.parte?.('vista-anio')) return;
    const historial = this.modo === 'historial';
    const sel = this.parte('anio');
    if (sel && historial) sel.value = 'historial';
    else if (sel && sel.value === 'historial' && this.datos) sel.value = this.datos.anio;
    this.parte('vista-anio').hidden = historial;
    this.parte('historico').hidden = !historial;
    if (historial) this.pintarHistorico();
  }
  pintarHistorico() {
    const nodo = this.parte?.('historico');
    if (!nodo || !this.entrada?.serie) return;
    const detalle = !this.entrada.soloSerie;
    const indice = this.territorio?.indice ?? null;
    const pedido = (this.pedidoHistorico = {});
    nodo.innerHTML = '<div class="panel-cargando" role="status"><div class="esqueleto"></div><div class="esqueleto calendario"></div></div>';
    nodo.hidden = detalle && this.modo !== 'historial';
    this.historico = new CalendarioHistorico({
      nodo,
      tip: this.tip,
      detalle,
      territorio: this.territorio?.nombre ?? null,
      onAnio: detalle ? a => this.irA(a, null) : null,
      onMes: detalle ? (a, m) => this.irA(a, m) : null,
      onSeleccion: detalle ? null : sel => this.elegirPeriodo(sel),
    });
    this.serieDe(indice)
      .then(serie => {
        if (!serie || this.pedidoHistorico !== pedido) return;
        this.historico.poner(serie, this.datos?.anio ?? null);
        // Sin detalle diario: el mapa muestra el último año completo hasta que se elija otro período.
        if (!detalle) this.historico.seleccionar(this.seleccionSerie?.anio ?? this.historico.ultimoAnioCompleto(), this.seleccionSerie?.mes ?? null);
      })
      .catch(error => {
        console.error('Serie mensual:', error);
        if (this.pedidoHistorico !== pedido) return;
        nodo.innerHTML = '<p class="vacio-nota">No se pudo calcular el historial de este territorio.</p>';
      });
  }
  elegirPeriodo(sel) {
    this.seleccionSerie = sel;
    const nodo = this.parte?.('periodo');
    if (nodo) {
      nodo.hidden = false;
      nodo.querySelector('strong').textContent = periodoTexto(sel.anio, sel.mes);
    }
    this.onPeriodo?.(sel);
  }
  // Países del índice mundial sin detecciones guardadas: serie harmonizada y mapa mensual por celdas.
  // seleccion: período pedido al abrir. Por defecto se usa el último año completo.
  ponerSoloSerie(seleccion = null) {
    this.datos = null;
    this.regiones = null;
    this.seleccionSerie = seleccion;
    this.cuerpo.innerHTML = `
      <p class="periodo-mapa" data-parte="periodo" aria-live="polite" hidden>En el mapa: <strong></strong> <span>(zonas de 25 a 100 km, harmonizado)</span></p>
      <section class="bloque historico" aria-labelledby="titulo-historico" data-parte="historico" hidden></section>
      <p class="panel-nota">Serie mensual harmonizada a partir de los archivos anuales de NASA FIRMS (MODIS, VIIRS Suomi NPP y NOAA-20).
        Cada punto del mapa es una zona con fuego en el período elegido. El detalle día a día con cada detección está disponible para ${Object.values(
          CATALOGO,
        )
          .map(c => c.nombre)
          .join(' y ')}.</p>`;
    this.parte = nombre => this.cuerpo.querySelector(`[data-parte="${nombre}"]`);
    this.pintarHistorico();
  }

  // ---------- Conteos del territorio ----------
  // Conteos por día y sensor del país o de la región elegida. null mientras se asignan regiones.
  conteosTerritorio(indice = this.territorio?.indice ?? null) {
    const { datos } = this;
    if (indice === null) return datos.porSensor;
    if (!this.regiones || this.regiones.indices.length !== datos.registros.length) return null;
    if (this.cache?.indice === indice) return this.cache.porSensor;
    const porSensor = { MODIS: new Int32Array(datos.totalDias), VIIRS: new Int32Array(datos.totalDias) };
    const { indices } = this.regiones;
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] !== indice) continue;
      const d = datos.dias[i];
      if (d >= 0 && d < datos.totalDias) porSensor[datos.registros[i].sensor][d]++;
    }
    this.cache = { indice, porSensor };
    return porSensor;
  }
  conteosDe(porSensor, sensor) {
    if (sensor !== 'todos') return porSensor[sensor];
    return porSensor.MODIS.map((v, i) => v + porSensor.VIIRS[i]);
  }
  // Suma por mes con el sensor elegido. Usado por las casillas de mes.
  mensuales(conteos, anio = this.datos.anio) {
    return MESES_LARGOS.map((_, m) => {
      const { ini, fin } = diasDelMes(anio, m);
      let s = 0;
      for (let d = ini; d <= fin && d < conteos.length; d++) s += conteos[d];
      return s;
    });
  }
  rangoActual() {
    const { datos, dia, mes } = this;
    if (dia !== null) return { ini: dia, fin: dia };
    if (mes !== null) return diasDelMes(datos.anio, mes);
    return { ini: 0, fin: datos.totalDias - 1 };
  }

  // ---------- Casillas de mes ----------
  construirMeses() {
    const { anio } = this.datos;
    this.parte('meses').innerHTML = MESES_LARGOS.map(
      (m, i) =>
        `<button type="button" class="mes" data-mes="${i}" aria-pressed="false"><span class="mes-nombre">${mesCorto.format(new Date(Date.UTC(anio, i, 1))).replace('.', '')}</span><span class="mes-valor" data-valor></span></button>`,
    ).join('');
  }
  pintarMeses(mensuales) {
    const maximo = Math.max(1, ...mensuales);
    const { anio } = this.datos;
    this.parte('titulo-meses').textContent = `Meses de ${anio}`;
    const todo = this.cuerpo.querySelector('[data-accion="todo-anio"]');
    todo.setAttribute('aria-pressed', String(this.mes === null));
    const unidad = this.sensor === 'todos' ? 'detecciones' : `detecciones de ${this.sensor}`;
    for (const b of this.parte('meses').children) {
      const m = +b.dataset.mes;
      const v = mensuales[m];
      // Escala por raíz: un mes extremo no deja en blanco al resto del año.
      b.dataset.nivel = v ? Math.max(1, Math.round(Math.sqrt(v / maximo) * 5)) : 0;
      b.setAttribute('aria-pressed', String(this.mes === m));
      b.querySelector('[data-valor]').textContent = v >= 10000 ? `${decimal.format(v / 1000)} mil` : numero.format(v);
      b.setAttribute('aria-label', `${MESES_LARGOS[m]} de ${anio}: ${numero.format(v)} ${unidad}`);
    }
  }
  // Explica la cifra del período y la compara con la serie histórica del mismo territorio.
  pintarExplicacion(total) {
    const nodo = this.parte('explica');
    const { anio } = this.datos;
    const mes = this.mes;
    const lugar = this.territorio?.nombre ?? this.nombrePais;
    const sensor = this.sensor === 'todos' ? 'MODIS y VIIRS (sin harmonizar)' : this.sensor;
    const cabeza = `${capital(periodoTexto(anio, mes))} en ${lugar}: ${numero.format(total)} ${total === 1 ? 'detección' : 'detecciones'} de ${sensor}.`;
    nodo.innerHTML = '<strong></strong> <span data-referencia>Buscando la referencia histórica…</span>';
    nodo.querySelector('strong').textContent = cabeza;
    const pedido = (this.pedidoExplica = {});
    const indice = this.territorio?.indice ?? null;
    this.serieDe(indice)
      .then(serie => {
        if (this.pedidoExplica !== pedido) return;
        const ref = referenciaHistorica(serie, anio, mes);
        nodo.querySelector('[data-referencia]').textContent = textoReferencia(ref, mes, Boolean(this.territorio));
      })
      .catch(() => {
        if (this.pedidoExplica === pedido)
          nodo.querySelector('[data-referencia]').textContent = 'No hay serie histórica para comparar este territorio.';
      });
  }

  // ---------- Calendario día a día ----------
  construirCalendario() {
    const { anio, totalDias } = this.datos;
    const raiz = this.parte('calendario');
    const fragmento = document.createDocumentFragment();
    const encabezado = document.createElement('div');
    encabezado.className = 'cal-dias';
    encabezado.setAttribute('aria-hidden', 'true');
    for (const d of [1, 10, 20, 31]) {
      const s = document.createElement('span');
      s.textContent = d;
      s.style.gridColumn = d;
      encabezado.append(s);
    }
    fragmento.append(encabezado);
    this.celdas = [];
    this.filas = [];
    let dia = 0;
    for (let mes = 0; mes < 12; mes++) {
      const fila = document.createElement('div');
      fila.className = 'cal-fila';
      fila.setAttribute('role', 'group');
      const inicio = new Date(Date.UTC(anio, mes, 1));
      fila.setAttribute('aria-label', MESES_LARGOS[mes]);
      const nombre = document.createElement('span');
      nombre.className = 'cal-mes';
      nombre.textContent = mesCorto.format(inicio).replace('.', '');
      nombre.setAttribute('aria-hidden', 'true');
      const celdas = document.createElement('div');
      celdas.className = 'cal-celdas';
      const largo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
      for (let d = 0; d < largo && dia < totalDias; d++, dia++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'celda';
        b.dataset.dia = dia;
        b.tabIndex = -1;
        celdas.append(b);
        this.celdas.push(b);
      }
      fila.append(nombre, celdas);
      fragmento.append(fila);
      this.filas.push(fila);
    }
    raiz.replaceChildren(fragmento);
    this.celdas[0].tabIndex = 0;
    raiz.addEventListener('pointerover', e => {
      const c = e.target.closest('.celda');
      if (c) this.mostrarTip(c);
    });
    raiz.addEventListener('pointerleave', () => {
      this.tip.hidden = true;
    });
    raiz.addEventListener('focusin', e => {
      const c = e.target.closest('.celda');
      if (c?.matches(':focus-visible')) this.mostrarTip(c);
    });
    raiz.addEventListener('focusout', () => {
      this.tip.hidden = true;
    });
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
    const destino = {
      ArrowLeft: i - 1,
      ArrowRight: i + 1,
      ArrowUp: moverMes(-1),
      ArrowDown: moverMes(1),
      Home: 0,
      End: totalDias - 1,
    }[e.key];
    if (destino === undefined) return;
    e.preventDefault();
    const objetivo = this.celdas[Math.max(0, Math.min(totalDias - 1, destino))];
    actual.tabIndex = -1;
    objetivo.tabIndex = 0;
    objetivo.focus();
  }
  mostrarTip(celda) {
    if (!this.conteos) return;
    const dia = +celda.dataset.dia;
    const valor = this.conteos[dia];
    this.tip.textContent = `${fechaLarga.format(fecha(dia, this.datos.anio))} · ${valor ? `${numero.format(valor)} ${valor === 1 ? 'detección' : 'detecciones'}` : 'sin detecciones'}`;
    this.tip.hidden = false;
    const r = celda.getBoundingClientRect(),
      t = this.tip.getBoundingClientRect();
    this.tip.style.left = `${Math.max(8, Math.min(innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2))}px`;
    this.tip.style.top = `${Math.max(8, r.top - t.height - 8)}px`;
  }

  // ---------- Estado ----------
  actualizar() {
    const { datos, dia, sensor } = this;
    if (!datos || !this.parte) return;
    for (const n of this.cuerpo.querySelectorAll('.cargando-anio')) n.classList.remove('cargando-anio');
    const porSensor = this.conteosTerritorio();
    const esperando = !porSensor;
    this.parte('detalle-territorio').hidden = esperando;
    this.parte('esperando-region').hidden = !esperando;
    this.parte('meses').classList.toggle('cargando-anio', esperando);
    if (esperando) {
      this.conteos = null;
      this.parte('texto-esperando').textContent = `Ubicando cada detección de ${datos.anio} en ${this.territorio.nombre}…`;
      this.parte('explica').textContent = '';
      if (this.pestana === 'datos') this.pintarDatos();
      // Mientras tanto el mapa ya muestra el período; sin región por punto aún, todo el país.
      this.emitir();
      return;
    }
    this.conteos = this.conteosDe(porSensor, sensor);
    const { anio } = datos;
    const mensuales = this.mensuales(this.conteos);
    this.pintarMeses(mensuales);
    const { ini, fin } = this.rangoActual();
    const enMes = this.mes === null ? null : diasDelMes(anio, this.mes);
    const escala = escalaCalendario(this.conteos);
    this.celdas.forEach((c, i) => {
      const valor = this.conteos[i];
      c.dataset.nivel = escala.nivel(valor);
      const estaActiva = i === dia;
      c.classList.toggle('activa', estaActiva);
      c.setAttribute('aria-pressed', String(estaActiva));
      c.setAttribute(
        'aria-label',
        `${fechaLarga.format(fecha(i, anio))}: ${valor ? `${numero.format(valor)} ${valor === 1 ? 'detección' : 'detecciones'}` : 'sin detecciones'}`,
      );
    });
    this.filas.forEach((f, m) => f.classList.toggle('atenuada', enMes !== null && m !== this.mes));
    for (const b of this.cuerpo.querySelectorAll('[data-sensor]'))
      b.setAttribute('aria-pressed', String(b.dataset.sensor === sensor));
    let total = 0;
    for (let d = ini; d <= fin; d++) total += this.conteos[d] || 0;
    const delPeriodo = this.mes === null ? suma(this.conteos) : mensuales[this.mes];
    this.parte('cifra').textContent = numero.format(total);
    this.parte('cifra-unidad').textContent =
      `${total === 1 ? 'detección' : 'detecciones'}${sensor === 'todos' ? '' : ` de ${sensor}`}`;
    this.parte('fecha').textContent =
      dia !== null ? `${fechaLarga.format(fecha(dia, anio))} de ${anio}` : capital(periodoTexto(anio, this.mes));
    // Días del período (mes o año), aunque haya un día elegido.
    const periodo = enMes === null ? this.conteos : enMesArreglo(this.conteos, enMes);
    const pico = mayoresDias(periodo, 1)[0];
    this.parte('nota').textContent =
      dia === null
        ? `${numero.format(diasActivos(periodo))} días con actividad${pico ? ` · pico el ${fechaLarga.format(fecha(pico.dia, anio))}` : ''}`
        : 'Datos históricos de NASA FIRMS';
    const contar = s => {
      let n = 0;
      for (let d = ini; d <= fin; d++) n += porSensor[s][d] || 0;
      return n;
    };
    const [m, v] = [contar('MODIS'), contar('VIIRS')];
    this.parte('n-todos').textContent = numero.format(m + v);
    this.parte('n-MODIS').textContent = numero.format(m);
    this.parte('n-VIIRS').textContent = numero.format(v);
    this.parte('leyenda').innerHTML =
      `<span>Menos</span>${escala.tramos.map(t => `<i class="celda-leyenda" data-nivel="${t.nivel}" title="${numero.format(t.desde)}${t.desde === t.hasta ? '' : `–${numero.format(t.hasta)}`} por día"></i>`).join('')}<span>Más</span>`;
    const picos = mayoresDias(periodo, 3);
    const maximo = picos[0]?.valor || 1;
    this.parte('picos').innerHTML =
      picos
        .map(
          d => `
      <li><button type="button" class="fila-ranking" data-dia-pico="${d.dia}" aria-pressed="${d.dia === dia}">
        <span class="fila-nombre">${fechaCorta.format(fecha(d.dia, anio)).replace('.', '')}</span>
        <span class="fila-barra" aria-hidden="true"><i style="width:${((d.valor / maximo) * 100).toFixed(1)}%"></i></span>
        <span class="fila-valor">${numero.format(d.valor)}</span></button></li>`,
        )
        .join('') || '<li class="sin-datos">Sin actividad con este filtro</li>';
    const todo = this.cuerpo.querySelector('[data-accion="todo"]');
    todo.hidden = dia === null;
    todo.textContent = this.mes === null ? `Ver todo ${anio}` : `Ver todo ${MESES_LARGOS[this.mes]}`;
    this.pintarReproducir();
    this.parte('omitidos').textContent = this.omitidos
      ? ` ${numero.format(this.omitidos)} en islas lejanas no aparecen en el mapa, sí en los registros.`
      : '';
    this.pintarRegiones();
    this.pintarExplicacion(delPeriodo);
    if (this.pestana === 'datos') this.pintarDatos();
    this.emitir();
  }
  pintarRegiones() {
    const { datos, sensor, regiones } = this;
    const bloque = this.parte('bloque-regiones');
    // Con una región abierta el ranking nacional ya no corresponde.
    if (this.territorio || !regiones || regiones.indices.length !== datos.registros.length) {
      bloque.hidden = true;
      return;
    }
    const { ini, fin } = this.rangoActual();
    const conteo = new Int32Array(regiones.nombres.length);
    for (let i = 0; i < regiones.indices.length; i++) {
      const r = regiones.indices[i];
      if (r < 0) continue;
      if (datos.dias[i] < ini || datos.dias[i] > fin) continue;
      if (sensor !== 'todos' && datos.registros[i].sensor !== sensor) continue;
      conteo[r]++;
    }
    const lista = Array.from(conteo, (valor, i) => ({ nombre: regiones.nombres[i], indice: i, valor }))
      .filter(x => x.valor)
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 5);
    const maximo = lista[0]?.valor || 1;
    bloque.hidden = false;
    const nodo = this.parte('regiones');
    nodo.innerHTML =
      lista
        .map(
          x =>
            `<li><button type="button" class="fila-ranking" data-region="${x.indice}"><span class="fila-nombre"></span><span class="fila-barra" aria-hidden="true"><i style="width:${((x.valor / maximo) * 100).toFixed(1)}%"></i></span><span class="fila-valor">${numero.format(x.valor)}</span></button></li>`,
        )
        .join('') || '<li class="sin-datos">Sin actividad con este filtro</li>';
    lista.forEach((x, i) => {
      const b = nodo.children[i].querySelector('button');
      b.querySelector('.fila-nombre').textContent = x.nombre;
      b.setAttribute('aria-label', `${x.nombre}: ${numero.format(x.valor)} detecciones. Abrir la región`);
    });
  }
  // Pestaña «Datos»: la misma tabla y CSV de «Datos guardados», filtrados por territorio y período.
  pintarDatos() {
    const { datos, sensor, dia, mes } = this;
    if (!datos || !this.tabla) return;
    const indice = this.territorio?.indice ?? null;
    const lugar = this.territorio ? `${this.territorio.nombre}, ${this.nombrePais}` : this.nombrePais;
    const periodo = dia !== null ? `${fechaLarga.format(fecha(dia, datos.anio))} de ${datos.anio}` : periodoTexto(datos.anio, mes);
    this.parte('datos-contexto').textContent = `${lugar} · ${periodo} · ${sensor === 'todos' ? 'MODIS y VIIRS' : sensor}`;
    if (indice !== null && (!this.regiones || this.regiones.indices.length !== datos.registros.length)) {
      this.parte('datos-resumen').textContent = 'Ubicando cada detección en su región…';
      this.tabla.cargando();
      return;
    }
    const salida = [];
    datos.registros.forEach((r, i) => {
      if (indice !== null && this.regiones.indices[i] !== indice) return;
      if (sensor !== 'todos' && r.sensor !== sensor) return;
      if (dia !== null) {
        if (datos.dias[i] !== dia) return;
      } else if (mes !== null && +r.fecha.slice(5, 7) !== mes + 1) return;
      salida.push(r);
    });
    this.parte('datos-resumen').textContent =
      `${numero.format(salida.length)} ${salida.length === 1 ? 'registro' : 'registros'}. Cada fila es un punto de calor, no un incendio único.`;
    this.tabla.poner(salida, {
      nombre: nombreArchivo(
        this.nombrePais,
        this.territorio?.nombre,
        datos.anio,
        dia !== null ? fechaDeDia(dia, datos.anio) : mes !== null ? MESES_LARGOS[mes] : null,
        sensor !== 'todos' ? sensor : null,
      ),
      titulo: `Detecciones de ${lugar}, ${periodo}`,
      vacio: 'Ningún registro en este período. Prueba con otro mes o con ambos sensores.',
    });
  }
  emitir() {
    const { dia, sensor } = this;
    const { ini, fin } = this.rangoActual();
    let visibles = 0;
    if (this.conteos) for (let d = ini; d <= fin; d++) visibles += this.conteos[d] || 0;
    else visibles = 1000;
    this.onFiltro?.({
      ini: this.reproduciendo ? dia : ini,
      fin: this.reproduciendo ? dia : fin,
      sensor,
      cola: this.reproduciendo ? 6 : 0,
      visibles: this.reproduciendo ? Math.max(40, (this.conteos?.[dia] ?? 0) * 4) : visibles,
      dia,
      mes: this.mes,
      persistente: !this.reproduciendo,
    });
  }
  pintarReproducir() {
    const b = this.cuerpo.querySelector('[data-accion="reproducir"]');
    if (!b) return;
    const que = this.mes === null ? this.datos.anio : MESES_LARGOS[this.mes];
    b.innerHTML = `${this.reproduciendo ? ICONO_PAUSA : ICONO_PLAY}${this.reproduciendo ? 'Pausar' : `Reproducir ${que}`}`;
    b.setAttribute('aria-pressed', String(Boolean(this.reproduciendo)));
    // Doce fechas por segundo serían ilegibles para un lector de pantalla.
    this.cuerpo.querySelector('.resumen')?.setAttribute('aria-live', this.reproduciendo ? 'off' : 'polite');
  }
  alHacerClic(e) {
    const accion = e.target.closest('[data-accion]')?.dataset.accion;
    if (accion === 'hoja') return;
    if (accion === 'satelital') {
      this.fijarSatelital(!this.satelital);
      return;
    }
    if (accion === 'cerrar') {
      this.onCerrar?.();
      return;
    }
    if (accion === 'nacional') {
      this.onNacional?.();
      return;
    }
    if (accion === 'volver-vista') {
      this.onVolverVista?.();
      return;
    }
    if (accion === 'reintentar') {
      this.onReintentar?.();
      return;
    }
    const pais = e.target.closest('[data-pais]')?.dataset.pais;
    if (pais) {
      this.onPais?.(pais);
      return;
    }
    const pestana = e.target.closest('[data-pestana]')?.dataset.pestana;
    if (pestana) {
      this.elegirPestana(pestana);
      return;
    }
    if (!this.datos) return;
    const region = e.target.closest('[data-region]')?.dataset.region;
    if (region !== undefined) {
      this.onRegion?.(+region);
      return;
    }
    if (accion === 'todo-anio') {
      this.detener();
      this.mes = null;
      this.dia = null;
      this.actualizar();
      return;
    }
    const mes = e.target.closest('.mes[data-mes]')?.dataset.mes;
    if (mes !== undefined) {
      this.detener();
      this.mes = this.mes === +mes ? null : +mes;
      this.dia = null;
      this.actualizar();
      return;
    }
    if (accion === 'todo') {
      this.detener();
      this.dia = null;
      this.actualizar();
      return;
    }
    if (accion === 'reproducir') {
      if (this.reproduciendo) this.detener(true);
      else this.reproducir();
      return;
    }
    const sensor = e.target.closest('[data-sensor]')?.dataset.sensor;
    if (sensor) {
      this.sensor = sensor;
      this.actualizar();
      return;
    }
    const celda = e.target.closest('.celda') || e.target.closest('[data-dia-pico]');
    if (celda && this.conteos) {
      const dia = +(celda.dataset.dia ?? celda.dataset.diaPico);
      this.detener();
      this.dia = this.dia === dia ? null : dia;
      if (this.dia !== null && this.mes !== null) this.mes = mesDeDia(dia, this.datos.anio);
      this.actualizar();
    }
  }

  // ---------- Reproducción ----------
  reproducir() {
    if (!this.conteos) return;
    const { ini, fin } = this.mes === null ? { ini: 0, fin: this.datos.totalDias - 1 } : diasDelMes(this.datos.anio, this.mes);
    this.reproduciendo = { fin };
    this.posicion = this.dia ?? ini;
    this.dia = Math.floor(this.posicion);
    this.ultimo = performance.now();
    this.pintarReproducir();
    const paso = ahora => {
      if (!this.reproduciendo) return;
      const ritmo = this.reduceMotion.matches ? 2.5 : DIAS_POR_SEGUNDO;
      this.posicion += ((ahora - this.ultimo) / 1000) * ritmo;
      this.ultimo = ahora;
      if (this.posicion > this.reproduciendo.fin + 0.999) {
        this.detener();
        this.dia = null;
        this.actualizar();
        return;
      }
      const dia = Math.floor(this.posicion);
      if (dia !== this.dia) {
        this.dia = dia;
        this.pintarDiaReproducido();
      }
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

function enMesArreglo(conteos, { ini, fin }) {
  return Array.from(conteos, (v, d) => (d >= ini && d <= fin ? v : 0));
}

// Texto de la referencia histórica: cuánto se parece el período a lo habitual en ese lugar.
export function textoReferencia(ref, mes, region) {
  if (!ref || ref.valor == null) return 'No hay serie histórica para este período.';
  const [b0, b1] = ref.base;
  const que = mes === null ? 'un año típico' : `un ${MESES_LARGOS[mes]} típico`;
  const donde = region ? ' en esta región' : '';
  const fuente = `(mediana ${b0}–${b1} de la serie harmonizada MODIS + VIIRS)`;
  const cierre = ' Es una referencia del pasado, no un pronóstico.';
  if (ref.incompleto) {
    return `Período aún incompleto o con datos parciales: lleva ${numero.format(Math.round(ref.valor))} celdas con fuego frente a ${numero.format(Math.round(ref.normal))} de ${que}${donde} ${fuente}.${cierre}`;
  }
  if (ref.razon == null) {
    return `En ${que}${donde} casi no hay fuego ${fuente}; este período tuvo ${numero.format(Math.round(ref.valor))} celdas con fuego.${cierre}`;
  }
  const r = ref.razon;
  const comparacion =
    r >= 1.25
      ? `${decimal.format(r)} veces la actividad de ${que}${donde}`
      : r <= 0.8
        ? `${Math.round(r * 100)} % de la actividad de ${que}${donde}`
        : `una actividad cercana a la de ${que}${donde}, ${decimal.format(r)} veces lo habitual`;
  return `Frente a la historia: ${comparacion} ${fuente}.${cierre}`;
}
